// @ts-check
// Phase F23: running the repo's commands (setup, gates) in a CONTAINER.
//
// The harness sandbox (bubblewrap) is one way to contain a repo's own code. A container is
// another, and the one most factories use: Docker or Podman, an image with the toolchain,
// the workspace bind-mounted at the SAME path (so error messages and paths match), and:
//
//   --network none                      no network (or the default bridge when the repo's config allows it)
//   --user <your uid>:<your gid>        files it writes are yours, not root's
//   --read-only + --tmpfs /tmp          only the workspace is writable
//   --memory 2g --pids-limit 512        a fork bomb or a leak stops at the container
//   --cap-drop ALL --security-opt no-new-privileges
//
// Turned on by FACTORY_CONTAINER_IMAGE=node:24-slim (or "isolation": { "image": … } in
// ~/.factory/config.json). Only used where bubblewrap isn't available.
//
// Not done here: the AGENT itself in a container (running `noobly` inside), which needs the
// harness's container backend (H37), and an allowlist egress proxy, so "some network" can
// mean "only the package registry". Today network is all or nothing.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

/** Docker or Podman, whichever answers (FACTORY_CONTAINER_RUNTIME forces one). */
export function containerRuntime(env = process.env) {
  for (const cli of env.FACTORY_CONTAINER_RUNTIME ? [env.FACTORY_CONTAINER_RUNTIME] : ['docker', 'podman']) {
    const ok = spawnSync(cli, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 10_000 });
    if (ok.status === 0) return cli;
  }
  return null;
}

/** The docker/podman arguments for one command. Pure, so it can be tested without a container. */
export function containerArgs({ image, command, cwd, network = 'none', name, uid = process.getuid?.() ?? 1000, gid = process.getgid?.() ?? 1000 }) {
  return [
    'run', '--rm', '--name', name,
    '--network', network === 'none' ? 'none' : 'bridge',
    '--user', `${uid}:${gid}`,
    '--read-only', '--tmpfs', '/tmp:rw,exec,size=512m',
    '--memory', '2g', '--pids-limit', '512',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '-e', 'HOME=/tmp', '-e', 'CI=true', '-e', 'npm_config_cache=/tmp/.npm',
    '-v', `${cwd}:${cwd}`, '-w', cwd,
    image, 'sh', '-c', command,
  ];
}

/**
 * Run one command in a fresh container. Same shape as the sandbox runner's result.
 * @returns {Promise<{ code: number, output: string, timedOut: boolean }>}
 */
export function runInContainer({ runtime, image, command, cwd, network = 'none', timeoutMs = 15 * 60_000 }) {
  const name = `factory-${crypto.randomUUID().slice(0, 12)}`;
  const child = spawn(runtime, containerArgs({ image, command, cwd, network, name }), { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (chunk) => (output = (output + chunk.toString()).slice(-20_000));
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    spawnSync(runtime, ['kill', name], { timeout: 20_000 }); // killing the CLI isn't enough: the container would keep running
  }, timeoutMs);
  return new Promise((resolve) =>
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, timedOut });
    }),
  );
}
