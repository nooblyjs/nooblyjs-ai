// Phase 20: the Linux backend, bubblewrap (`bwrap`).
//
// bwrap builds a new view of the filesystem for one process, using Linux
// namespaces (no root needed). We start from "everything, read-only" and add
// exceptions, in order: a later mount covers an earlier one at the same place.
//
//   --ro-bind / /            the whole system, read-only
//   --dev /dev --proc /proc  fresh, minimal /dev and /proc
//   --tmpfs /run             hide /run: it holds SOCKETS (docker.sock!), and a read-only
//                            mount does not stop connect(). Docker access = root access.
//   --bind <tmpDir> /tmp     a private /tmp (also hides tmux, ssh-agent and X11 sockets there)
//   --bind <dir> <dir>       each writable folder: the project, caches
//   --ro-bind <dir> <dir>    …except .git/hooks, .git/config, .noobly
//   --tmpfs ~/.ssh …         hidden folders become empty
//   --unshare-net            no network at all (only a private loopback)
//   --unshare-pid            its own process ids: when the command ends, everything it started ends
//   --die-with-parent        if noobly dies, the sandbox dies too
import fs from 'node:fs';
import path from 'node:path';

/**
 * bwrap arguments for a policy. Pure: it only looks at which paths exist.
 * @param {ReturnType<import('./policy.js').resolvePolicy>} policy
 * @param {{ exists?: (p: string) => boolean, isDir?: (p: string) => boolean, realpath?: (p: string) => string }} [fsInfo]  for tests
 * @returns {string[]} arguments to put before the command
 */
export function bwrapArgs(policy, { exists = fs.existsSync, isDir = isDirectory, realpath = realPath } = {}) {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];

  args.push('--tmpfs', '/run');
  // DNS may live under /run (systemd-resolved). Only needed when the sandbox has its own network access.
  if (policy.network === 'allow') args.push('--ro-bind-try', '/run/systemd/resolve', '/run/systemd/resolve');
  args.push('--bind', policy.tmpDir, '/tmp');

  // Hidden folders: a later mount covers an earlier one, so the ORDER decides what wins.
  //   hidden folder CONTAINING a writable one (a worktree in ~/.noobly, Phase 29): hide first,
  //     then the writable folder is mounted back on top: only it reappears
  //   hidden folder INSIDE a writable one (~/.ssh when the project is ~): hide after, or the
  //     writable mount would show it again
  const hide = (item) => (isDir(item) ? ['--tmpfs', item] : ['--ro-bind', '/dev/null', item]);
  const containsWritable = (item) => policy.writable.some((w) => w === item || w.startsWith(item + path.sep));
  // bwrap can't mount onto a symlink (Codespaces makes ~/.docker one): hide what it points to.
  const hidden = policy.hidden.filter((item) => exists(item)).map((item) => realpath(item));
  for (const item of hidden.filter(containsWritable)) args.push(...hide(item));
  for (const dir of policy.writable) {
    if (exists(dir)) args.push('--bind', dir, dir);
  }
  for (const item of hidden.filter((i) => !containsWritable(i))) args.push(...hide(item));
  for (const item of policy.readOnly) {
    if (exists(item)) args.push('--ro-bind', item, item);
  }

  if (policy.network !== 'allow') args.push('--unshare-net');
  args.push('--unshare-pid', '--die-with-parent');
  return args;
}

function realPath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
