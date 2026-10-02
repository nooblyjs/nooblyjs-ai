// Phase 20: the macOS backend, seatbelt (`sandbox-exec -p <profile>`).
//
// macOS has no mount namespaces, so it can't give a process its own view of the
// files. Instead the kernel checks every operation against a PROFILE, written in
// SBPL (a small Lisp). The ideas are the same as bwrap's:
//
//   (allow default)                   start from "anything"
//   (deny file-write*)                then no writes…
//   (allow file-write* (subpath …))   …except the writable folders
//   (deny file-write* (subpath …))    …but never .git/hooks etc.  (a LATER rule wins)
//   (deny file-read* (subpath …))     hidden folders
//   (deny network*)                   no network, except the proxy on localhost
//
// Note: written and unit-tested on Linux; see the phase doc for what to check on a Mac.

/**
 * @param {ReturnType<import('./policy.js').resolvePolicy>} policy
 * @param {{ proxyPort?: number }} [options]  the filtering proxy's port, when network is a domain list
 * @returns {string} the profile text
 */
export function seatbeltProfile(policy, { proxyPort } = {}) {
  const q = (p) => JSON.stringify(p); // SBPL strings use the same quoting as JSON
  const lines = ['(version 1)', '(allow default)', '', '; Writes: only these places.', '(deny file-write*)'];
  // macOS can't give the command its own /tmp, so the real temp folders stay writable.
  // (Sockets there are still out of reach: `deny network*` below covers unix sockets too.)
  const writable = [...policy.writable, policy.tmpDir, '/private/tmp', '/private/var/folders'];
  lines.push(`(allow file-write*\n  ${writable.map((p) => `(subpath ${q(p)})`).join('\n  ')}\n  (literal "/dev/null") (regex #"^/dev/tty") (regex #"^/dev/fd/"))`);
  if (policy.readOnly.length) {
    lines.push('', '; …but these stay read-only: writing them would run code later, outside the sandbox.');
    lines.push(`(deny file-write*\n  ${policy.readOnly.map((p) => `(subpath ${q(p)})`).join('\n  ')})`);
  }
  if (policy.hidden.length) {
    lines.push('', '; Secrets: not even readable.');
    lines.push(`(deny file-read*\n  ${policy.hidden.map((p) => `(subpath ${q(p)})`).join('\n  ')})`);
  }
  if (policy.network !== 'allow') {
    lines.push('', '; Network: off (sockets to other programs too: docker.sock would be root access).', '(deny network*)');
    lines.push('(allow network* (local ip "localhost:*"))');
    if (proxyPort) lines.push(`(allow network-outbound (remote ip "localhost:${proxyPort}"))`);
  }
  return lines.join('\n') + '\n';
}
