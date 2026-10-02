// @ts-check
// Phase F02: running a command in the harness's OS sandbox, and deciding
// whether it is safe to run without one.
//
// The factory doesn't build its own sandbox. The harness already has one
// (Phase 20: bubblewrap on Linux, seatbelt on macOS), with the same policy the
// agent's own Bash commands get: write only to the workspace, a private /tmp
// and package caches; credentials hidden; network off or an allowlist.
//
// Two different questions:
//
//   1. Commands the FACTORY runs (setup now, gates in F04). These are the
//      repo's own code (`npm ci` runs install scripts!). No sandbox → refuse,
//      unless the operator explicitly allows it.
//
//   2. The AGENT's commands. Without a sandbox, the harness asks before every
//      Bash command, and in a factory run "ask" means no. So an unsandboxed
//      agent can still read and edit files in its workspace; it just can't run
//      anything. The danger is ALLOW rules (e.g. "Bash(npm test:*)"): those
//      would run unsandboxed. That's what isolationProblem() refuses.
import { spawn } from 'node:child_process';
import { createSandbox, detectBackend } from '../harness.js';
import { containerRuntime, runInContainer } from './container.js';

/** Is a sandbox available on this computer? */
export function sandboxStatus() {
  const { backend, reason } = detectBackend();
  return backend === 'none' ? { available: false, reason: reason ?? 'no sandbox backend' } : { available: true, backend };
}

/**
 * Would this agent run commands outside a sandbox? Returns a message saying why it
 * won't start, or null when it's fine.
 * @param {{ allowedTools?: string[], permissionMode?: string, allowUnsandboxed?: boolean }} run
 * @param {{ available: boolean, reason?: string }} [status]
 */
export function isolationProblem(run, status = sandboxStatus()) {
  if (status.available || run.allowUnsandboxed) return null;
  const bashAllowed = (run.allowedTools ?? []).some((rule) => /^Bash(\(|$)/.test(rule.trim()));
  if (!bashAllowed && run.permissionMode !== 'bypass') return null;
  return `No sandbox (${status.reason}), and this agent is allowed to run commands (${run.permissionMode === 'bypass' ? 'bypass mode' : 'Bash allow rules'}), which would run with your full permissions. Install bubblewrap (sudo apt install bubblewrap), or pass --allow-unsandboxed if you accept that.`;
}

/**
 * Phase F23: can the factory run the REPO's commands (setup, gates) contained? A sandbox, or a
 * configured container image. (Never used for the AGENT's own commands: those run through the
 * harness, and a container image doesn't contain them. That's still sandboxStatus().)
 */
export function commandIsolation() {
  const status = sandboxStatus();
  if (status.available) return status;
  if (process.env.FACTORY_CONTAINER_IMAGE && containerRuntime()) return { available: true, backend: 'container' };
  return status;
}

/**
 * Run a shell command for the factory, in the sandbox when there is one.
 * @param {string} command
 * @param {{ cwd: string, network?: 'none' | 'allow' | string[], allowUnsandboxed?: boolean, timeoutMs?: number }} options
 * @returns {Promise<{ code: number, output: string, sandboxed: boolean | 'container', timedOut: boolean, durationMs: number }>}
 */
export async function runCommand(command, { cwd, network = 'none', allowUnsandboxed = false, timeoutMs = 15 * 60_000 }) {
  const sandbox = createSandbox({ enabled: true, network }, { cwd });
  const started = Date.now();
  // Phase F23: no bubblewrap here, but a container image is configured: run it in a container.
  const image = process.env.FACTORY_CONTAINER_IMAGE;
  if (!sandbox.active && image) {
    await sandbox.close();
    const runtime = containerRuntime();
    if (!runtime && !allowUnsandboxed) throw new Error(`FACTORY_CONTAINER_IMAGE is set (${image}) but neither docker nor podman answers.`);
    if (runtime) {
      const out = await runInContainer({ runtime, image, command, cwd, network: Array.isArray(network) ? 'allow' : network, timeoutMs });
      return { ...out, sandboxed: 'container', durationMs: Date.now() - started };
    }
  }
  try {
    if (!sandbox.active && !allowUnsandboxed) {
      throw new Error(`Refusing to run "${command}" without a sandbox (${sandbox.reason}). It is the repository's own code. Install bubblewrap (sudo apt install bubblewrap), or pass --allow-unsandboxed.`);
    }
    const child = sandbox.active
      ? await sandbox.spawn(command, { cwd, env: /** @type {Record<string,string>} */ (process.env) })
      : Object.assign(spawn('bash', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true }), {
          killGroup(/** @type {NodeJS.Signals} */ signal) {
            process.kill(-(/** @type {number} */ (this.pid)), signal);
          },
        });
    let output = '';
    const collect = (chunk) => (output = (output + chunk.toString()).slice(-20_000));
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.killGroup('SIGKILL'); // the whole process GROUP: `npm test` starts children of its own
    }, timeoutMs);
    const code = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 1)));
    clearTimeout(timer);
    return { code, output, sandboxed: sandbox.active, timedOut, durationMs: Date.now() - started };
  } finally {
    await sandbox.close();
  }
}
