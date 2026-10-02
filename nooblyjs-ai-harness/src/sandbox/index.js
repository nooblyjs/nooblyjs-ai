// Phase 20: THE SANDBOX. Bash commands run inside an OS sandbox.
//
// Two layers of defence, each covering the other's weakness:
//
//   permission gate (Phase 06)   decides WHETHER a command runs, from its text.
//                                Clever, but only as good as its patterns.
//   sandbox (this phase)         limits what ANY command CAN do: write only to the
//                                project, no network, no secrets. Dumb, but it holds.
//
// Because the sandbox holds, the gate can relax: in default mode a sandboxed
// command no longer asks first (gate.js). A command that must leave the sandbox
// (dangerouslyDisableSandbox) always asks.
//
// Backends translate one policy (policy.js) into OS mechanisms:
//   Linux   bubblewrap: namespaces, a private view of the filesystem (bwrap.js)
//   macOS   seatbelt: a kernel-checked profile (seatbelt.js)
//   other   none: Bash runs as before, and you are told so
//
// Phase 22: on Linux, a session's commands all run in ONE long-lived sandbox,
// through a small executor inside it (executor.js), so they share its network:
// a server started in the background can be reached by the next command.
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bwrapArgs } from './bwrap.js';
import { describeNetwork, resolvePolicy } from './policy.js';
import { startProxy } from './proxy.js';
import { seatbeltProfile } from './seatbelt.js';

const EXECUTOR = fileURLToPath(new URL('./executor.js', import.meta.url));
const BRIDGE_PORT = 3128; // inside the sandbox's own network, so it can't clash with anything

/** Which backend works on this computer? Checked once. */
let detected;
export function detectBackend(platform = process.platform) {
  if (detected?.platform === platform) return detected.result;
  let result;
  if (platform === 'linux') {
    const probe = spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--unshare-pid', 'true'], { stdio: 'ignore' });
    result = probe.status === 0
      ? { backend: 'bwrap' }
      : { backend: 'none', reason: probe.error?.code === 'ENOENT' ? 'bubblewrap is not installed (e.g. sudo apt install bubblewrap)' : 'bubblewrap is installed but cannot create a sandbox here (user namespaces may be disabled)' };
  } else if (platform === 'darwin') {
    result = fs.existsSync('/usr/bin/sandbox-exec') ? { backend: 'seatbelt' } : { backend: 'none', reason: 'sandbox-exec was not found' };
  } else {
    result = { backend: 'none', reason: `there is no sandbox backend for ${platform} yet` };
  }
  detected = { platform, result };
  return result;
}

/**
 * The sandbox for one session.
 * @param {object} setting  the `sandbox` setting
 * @param {{ cwd: string, home?: string, platform?: string, detect?: typeof detectBackend }} options
 */
export function createSandbox(setting = {}, { cwd, home, platform = process.platform, detect = detectBackend, extraReadOnly = [] } = {}) {
  const wanted = { ...setting };
  let backend = 'none';
  let reason = null;
  if (wanted.enabled === false) reason = 'turned off in settings (sandbox.enabled: false)';
  else if (wanted.backend && wanted.backend !== 'auto') {
    backend = wanted.backend === 'none' ? 'none' : wanted.backend;
    if (backend === 'none') reason = 'sandbox.backend is "none"';
  } else {
    ({ backend, reason = null } = detect(platform));
  }

  const active = backend !== 'none';
  const tmpDir = active ? makeTmpDir() : path.join(os.tmpdir(), 'noobly-sandbox-unused');
  const policy = resolvePolicy(wanted, { cwd, home, tmpDir, extraReadOnly });
  let proxy = null;
  let executor = null; // Phase 22: the long-lived sandbox process (Linux)

  return {
    active,
    backend,
    reason,
    policy,

    /**
     * Start one bash script inside the sandbox.
     * @returns {Promise<SandboxedProcess>} stdout/stderr/stdio[3] emit 'data' (strings); 'close' (code); killGroup(signal)
     */
    async spawn(script, { cwd: dir, env }) {
      const sandboxEnv = { ...env };
      delete sandboxEnv.SSH_AUTH_SOCK;
      delete sandboxEnv.DBUS_SESSION_BUS_ADDRESS;
      if (Array.isArray(policy.network)) {
        proxy ??= await startProxy(backend === 'bwrap' ? { domains: policy.network, socketPath: path.join(tmpDir, 'proxy.sock') } : { domains: policy.network });
        Object.assign(sandboxEnv, proxyEnv(`http://127.0.0.1:${backend === 'bwrap' ? BRIDGE_PORT : proxy.port}`));
      }
      if (backend === 'bwrap') {
        sandboxEnv.TMPDIR = '/tmp';
        await ensureExecutor();
        return runInExecutor(path.join(tmpDir, 'executor.sock'), { script, cwd: dir, env: sandboxEnv });
      }
      if (backend === 'seatbelt') {
        sandboxEnv.TMPDIR = tmpDir;
        const child = spawn('sandbox-exec', ['-p', seatbeltProfile(policy, { proxyPort: proxy?.port }), 'bash', '-c', script], {
          cwd: dir,
          env: sandboxEnv,
          stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
          detached: true,
        });
        child.killGroup = (signal) => process.kill(-child.pid, signal);
        return child;
      }
      throw new Error(`Unknown sandbox backend "${backend}".`);
    },

    /** Hosts the proxy refused since the last call. */
    takeBlocked() {
      if (!proxy) return [];
      const hosts = [...proxy.blocked];
      proxy.blocked.clear();
      return hosts;
    },

    /**
     * If a failed command looks like it hit the sandbox's walls, say so, so the model
     * asks for help instead of trying the same thing again and again.
     */
    explainFailure(output, exitCode, blockedHosts = []) {
      if (exitCode === 0) return null;
      const causes = [];
      if (blockedHosts.length) causes.push(`the network proxy refused ${blockedHosts.join(', ')} (not in sandbox.network)`);
      else if (/Could not resolve host|getaddrinfo (ENOTFOUND|EAI_AGAIN)|Temporary failure in name resolution|Network is unreachable|ENETUNREACH|network is unreachable/i.test(output)) {
        causes.push(policy.network === 'none' ? 'the sandbox has no network access' : 'the sandbox only reaches some domains, through a proxy');
      }
      if (/Read-only file system|EROFS/.test(output)) causes.push('the sandbox only allows writing inside the project, /tmp and package caches (and never to .git/hooks, .git/config or .noobly)');
      if (!causes.length) return null;
      return `[sandbox] This command ran in a sandbox, and the failure looks caused by it: ${causes.join('; ')}. If the command really needs this, tell the user, or run it again with dangerouslyDisableSandbox: true (the user will be asked).`;
    },

    /** For the system prompt. */
    forModel() {
      if (!active) return null;
      return [
        '# Sandbox',
        `Bash commands run in a sandbox (${backend}). They may write only inside the project, /tmp and package-manager caches; .git/hooks, .git/config and .noobly stay read-only; credentials folders like ~/.ssh are hidden. Network: ${describeNetwork(policy.network)}. All commands of this session share the sandbox, so a server started in the background is reachable at 127.0.0.1 from later commands.`,
        'Commands that stay inside these limits run without asking the user. If a command fails because of the sandbox (e.g. "Read-only file system", no network), do not work around it: tell the user, or call Bash with dangerouslyDisableSandbox: true, which asks the user first.',
      ].join('\n');
    },

    /** For /sandbox. */
    describe() {
      if (!active) return `The sandbox is off: ${reason}.\nBash commands run with your full permissions, and each one asks first.`;
      const list = (items) => items.map((p) => `    ${p.replace(os.homedir(), '~')}`).join('\n');
      return [
        `Sandbox: ${backend}${policy.autoAllow ? ' · commands inside it run without asking (default mode)' : ''}`,
        `  writable:\n${list(policy.writable.filter((p) => fs.existsSync(p)))}\n    /tmp  (private to this session: ${tmpDir.replace(os.homedir(), '~')})`,
        `  read-only inside the project:\n${list(policy.readOnly)}`,
        `  hidden:\n${list(policy.hidden.filter((p) => fs.existsSync(p)))}`,
        `  network: ${describeNetwork(policy.network)}`,
        '',
        'Change it with the "sandbox" setting, e.g. { "sandbox": { "network": ["registry.npmjs.org"] } }.',
      ].join('\n');
    },

    async close() {
      executor?.kill('SIGKILL');
      executor = null;
      await proxy?.close();
      proxy = null;
    },
  };

  /** Phase 22: start the session's sandbox (bwrap + executor.js) once, and wait until it listens. */
  async function ensureExecutor() {
    const socket = path.join(tmpDir, 'executor.sock');
    if (executor && executor.exitCode === null) return;
    fs.rmSync(socket, { force: true });
    const bridge = Array.isArray(policy.network) ? ['/tmp/proxy.sock', String(BRIDGE_PORT)] : [];
    executor = spawn('bwrap', [...bwrapArgs(policy), '--chdir', cwd, process.execPath, EXECUTOR, '/tmp/executor.sock', ...bridge], { stdio: 'ignore' });
    executor.unref(); // don't keep noobly alive for it; --die-with-parent ends it with noobly
    let failed = null;
    executor.once('error', (error) => (failed = error));
    for (let waited = 0; !fs.existsSync(socket); waited += 10) {
      if (failed || executor.exitCode !== null || waited > 5000) {
        executor = null;
        throw new Error(`The sandbox did not start${failed ? `: ${failed.message}` : ''}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

/** Environment variables that send HTTP(S) clients through the proxy. */
export function proxyEnv(url) {
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    ALL_PROXY: url,
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',
    NODE_USE_ENV_PROXY: '1', // Node's own fetch() only follows HTTP(S)_PROXY when asked to (Node 24+)
  };
}

/**
 * Phase 22: run one script through the executor. Returns an object shaped like a
 * child process (the parts runCommand uses), so callers don't care where it runs.
 * @typedef {EventEmitter & { stdout: EventEmitter, stderr: EventEmitter, stdio: EventEmitter[], killGroup(signal: string): void }} SandboxedProcess
 */
function runInExecutor(socketPath, request) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdio = [null, child.stdout, child.stderr, new EventEmitter()];
  const streams = { out: child.stdout, err: child.stderr, cwd: child.stdio[3] };
  const conn = net.connect(socketPath);
  let exited = false;
  let buffer = '';
  conn.on('connect', () => conn.write(JSON.stringify({ t: 'run', ...request }) + '\n'));
  conn.on('data', (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const message = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (message.t === 'exit') {
        exited = true;
        child.emit('close', message.code);
      } else streams[message.t]?.emit('data', message.d);
    }
  });
  conn.on('error', (error) => child.emit('error', error));
  conn.on('close', () => {
    if (!exited) child.emit('close', null); // the sandbox went away: treat as killed
  });
  child.killGroup = (signal) => {
    if (exited) return;
    if (signal === 'SIGKILL') conn.destroy(); // closing the connection = kill it now
    else conn.write(JSON.stringify({ t: 'kill', signal }) + '\n');
  };
  return child;
}

// Each session gets its own /tmp. They are removed when noobly exits.
const tmpDirs = new Set();
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noobly-sandbox-'));
  if (tmpDirs.size === 0) process.once('exit', () => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  tmpDirs.add(dir);
  return dir;
}
