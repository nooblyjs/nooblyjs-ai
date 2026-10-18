// Pushing a Software Factory branch to Bitbucket (Phase 13). The one place NooblyJS runs `git push`, called by the write
// gate only (kind bitbucket.push-branch). It can push ONE commit to ONE branch whose name starts with "factory/":
// never the repository's own branches, never a tag, never with --force, never a delete. The credential goes to git
// in the environment (not in the command line, the remote's URL or the repository's config), so it is not left in
// the mirror or shown in a process list.
import { execFile } from 'node:child_process';
import { failure } from './transport.js';

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** A branch only the Factory makes. No "..", no "@{", nothing git treats as an option or a refspec. */
export const FACTORY_BRANCH = /^factory\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){0,6}$/;
const SHA = /^[0-9a-f]{40,64}$/;
const TIMEOUT_MS = 120_000;

function run(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** The commit a branch of a mirror is at, or 'unknown' (part of a push's key: a new commit is a new push). */
export async function headOf(dir, branch) {
  if (typeof dir !== 'string' || !dir || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(String(branch)) || String(branch).includes('..')) return 'unknown';
  const r = await run(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], { cwd: dir, env: process.env });
  return r.code === 0 && SHA.test(r.stdout.trim()) ? r.stdout.trim().slice(0, 40) : 'unknown';
}

/**
 * @param {object} options
 * @param {string} options.workspace
 * @param {string} [options.token]     BITBUCKET_WRITE_API_TOKEN. Without it nothing is pushed.
 * @param {(slug: string) => string} [options.remote]  where a repository is pushed (a folder on disk in tests)
 */
export function createGitPush({ workspace, token = '', remote = null } = {}) {
  const urlFor = remote ?? ((slug) => `https://bitbucket.org/${workspace}/${slug}.git`);
  // Bitbucket takes an API token over HTTPS as the password of this fixed user name.
  const header = token ? `Authorization: Basic ${Buffer.from(`x-bitbucket-api-token-auth:${token}`).toString('base64')}` : null;
  const scrub = (text) => (token ? String(text).split(token).join('***') : String(text)).replace(/Basic [A-Za-z0-9+/=]+/g, 'Basic ***');

  return {
    configured: Boolean(workspace && SLUG.test(String(workspace)) && (token || remote)),
    /**
     * Push `fromBranch` of the mirror at `dir` to `toBranch` on the repository. result { sha, branch }.
     * A push that would rewrite the branch is refused by git (there is no --force here) and comes back as a failure.
     */
    async push({ slug, dir, fromBranch, toBranch } = {}) {
      if (!SLUG.test(String(slug))) return failure('refused', 'That is not a repository name.');
      if (!FACTORY_BRANCH.test(String(toBranch)) || String(toBranch).includes('..')) return failure('refused', `NooblyJS only pushes branches called factory/…, not "${String(toBranch).slice(0, 80)}".`);
      if (typeof dir !== 'string' || !dir || typeof fromBranch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/.test(fromBranch) || fromBranch.includes('..')) return failure('refused', 'A push needs the mirror folder and the branch to push.');
      if (!header && !remote) return failure('not-configured', 'Set BITBUCKET_WRITE_API_TOKEN to let NooblyJS push factory branches.');
      const base = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };
      const head = await run(['rev-parse', '--verify', `refs/heads/${fromBranch}^{commit}`], { cwd: dir, env: base });
      const sha = head.stdout.trim();
      if (head.code !== 0 || !SHA.test(sha)) return failure('failed', `The branch ${fromBranch} is not in the mirror.`);
      const env = header ? { ...base, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: header } : base;
      // "--" ends the options; the refspec names the commit and the full ref, so neither can be read as anything else.
      const pushed = await run(['push', '--no-tags', '--', urlFor(slug), `${sha}:refs/heads/${toBranch}`], { cwd: dir, env });
      if (pushed.code !== 0) {
        const said = scrub(pushed.stderr).trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
        const reason = /non-fast-forward|\[rejected\]|fetch first/i.test(scrub(pushed.stderr)) ? 'conflict' : /Authentication failed|403|401/i.test(said) ? 'unauthorised' : /Could not resolve|unable to access|timed out/i.test(said) ? 'unreachable' : 'failed';
        return failure(reason, `git could not push ${toBranch}: ${said || 'no reason given'}`);
      }
      return { ok: true, result: { sha, branch: toBranch } };
    },
  };
}
