// @ts-check
// Phase F15: the GITHUB forge. The same interface as the local forge (src/forge/forge.js),
// so nothing else in the factory changes: issues, comments, branches, PRs, merges.
//
//   issues       exist already (someone labelled one "factory"): getIssue reads it
//   comments     idempotent: each carries a hidden marker <!-- factory:key -->; posting the
//                same key again is skipped (a retry after a crash must not double-post)
//   branches     pushed by the CONTROL PLANE with the token, passed to git through the
//                environment (never the command line, where `ps` would show it)
//   PRs          one per head branch (factory/issue-N/main): created, then updated in place.
//                The body carries <!-- factory-run: <run> <sha> --> so a retried delivery can
//                recognise "this PR already shows this commit" (F05's reconcile).
//                Draft ⇄ ready can't be changed with REST: it takes GraphQL.
//   status       a commit status "factory" (success/failure + a summary), which works with a
//                personal token. (Check runs, the richer UI, need a GitHub App.)
//   merge        PUT /pulls/{n}/merge, for autonomy L3 only (F12)
import { git } from '../../exec/workspace/git.js';

const RUN_MARK = /<!-- factory-run: (\S+) (\S+) -->/;
const keyMark = (key) => `<!-- factory:${key} -->`;

/** Env vars that make git send the token as a header to github.com, without it being in argv. */
export function gitAuthEnv(token, host = 'https://github.com/') {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${host}.extraheader`, GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

/**
 * @param {{ client: ReturnType<typeof import('./client.js').createGitHubClient>, owner: string, name: string, token?: string }} options
 */
export function createGitHubForge({ client, owner, name, token }) {
  const repo = `/repos/${owner}/${name}`;
  const ref = (n) => `${owner}/${name}#${n}`;

  /** The open (or any) PR whose head is our branch. */
  async function prFor(head, state = 'all') {
    const list = await client.request('GET', `${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=${state}&per_page=10`);
    return list?.[0] ?? null;
  }

  const describePR = (pr) => {
    const mark = pr.body?.match(RUN_MARK);
    return { number: pr.number, path: pr.html_url, head: pr.head?.ref, base: pr.base?.ref, draft: Boolean(pr.draft), merged: Boolean(pr.merged_at), body: pr.body, run: mark?.[1], sha: mark?.[2], status: pr.draft ? 'draft' : 'ready' };
  };

  return {
    name: 'github',
    owner,
    repoName: name,

    async getIssue(_slug, number) {
      const i = await client.request('GET', `${repo}/issues/${number}`);
      return { number: i.number, ref: ref(i.number), title: i.title, body: i.body ?? '', labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)), url: i.html_url, author: i.user?.login };
    },

    fileIssue() {
      throw new Error('On GitHub, issues are filed by people; the factory reads them (label one "factory").');
    },

    /** Comment once per key. */
    async comment(_slug, number, markdown, { key } = {}) {
      const mark = keyMark(key ?? `${number}:${hash(markdown)}`);
      const existing = await client.request('GET', `${repo}/issues/${number}/comments?per_page=100`);
      const found = existing?.find((c) => c.body?.includes(mark));
      if (found) return found.html_url;
      const made = await client.request('POST', `${repo}/issues/${number}/comments`, { body: `${markdown.trim()}\n\n${mark}` });
      return made.html_url;
    },

    async comments(_slug, number) {
      const list = await client.request('GET', `${repo}/issues/${number}/comments?per_page=100`);
      return (list ?? []).map((c) => `**${c.user?.login}**\n\n${c.body}`).join('\n\n---\n\n');
    },

    /** Push from the mirror, with the token in git's environment only. */
    async pushBranch(mirrorDir, fromBranch, toBranch) {
      await git(['push', '-q', '--force', 'origin', `refs/heads/${fromBranch}:refs/heads/${toBranch}`], { cwd: mirrorDir, env: gitAuthEnv(token) });
      return git(['rev-parse', `refs/heads/${fromBranch}`], { cwd: mirrorDir });
    },

    /**
     * One PR per head: create, or update in place (body, title, and draft ⇄ ready).
     * @param {string} _slug  @param {import('../forge.js').PullRequest} pr
     */
    async openOrUpdatePR(_slug, pr) {
      const body = `${pr.body.trim()}\n\n<!-- factory-run: ${pr.meta?.run ?? '-'} ${pr.meta?.sha ?? '-'} -->`;
      const existing = await prFor(pr.head, 'open');
      if (!existing) {
        const made = await client.request('POST', `${repo}/pulls`, { title: pr.title, head: pr.head, base: pr.base, body, draft: pr.status === 'draft' });
        return { path: made.html_url, number: made.number, action: /** @type {const} */ ('created') };
      }
      const same = existing.body === body && existing.title === pr.title && Boolean(existing.draft) === (pr.status === 'draft');
      if (same) return { path: existing.html_url, number: existing.number, action: /** @type {const} */ ('unchanged') };
      await client.request('PATCH', `${repo}/pulls/${existing.number}`, { title: pr.title, body });
      // REST can't change draft ⇄ ready. GraphQL can.
      if (existing.draft && pr.status === 'ready') await client.graphql('mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', { id: existing.node_id });
      if (!existing.draft && pr.status === 'draft') await client.graphql('mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', { id: existing.node_id });
      return { path: existing.html_url, number: existing.number, action: /** @type {const} */ ('updated') };
    },

    async findPR(_slug, head) {
      const pr = await prFor(head);
      return pr ? describePR(pr) : null;
    },

    async listPRs() {
      const list = await client.request('GET', `${repo}/pulls?state=all&per_page=100`);
      return (list ?? []).filter((p) => p.head?.ref?.startsWith('factory/')).map(describePR);
    },

    /** A commit status "factory" on the PR's head commit. */
    async setStatus(sha, { state, description, targetUrl }) {
      await client.request('POST', `${repo}/statuses/${sha}`, { state, context: 'factory', description: description.slice(0, 140), ...(targetUrl && { target_url: targetUrl }) });
    },

    /** Autonomy L3 (F12): merge the PR on GitHub. Merging twice is fine. */
    async merge(_repoPath, { head, message }) {
      const pr = await prFor(head);
      if (!pr) return { merged: false, reason: `no PR for ${head}` };
      if (pr.merged_at) return { merged: true, sha: pr.merge_commit_sha, reason: 'already merged' };
      try {
        const out = await client.request('PUT', `${repo}/pulls/${pr.number}/merge`, { merge_method: 'merge', commit_title: message.split('\n')[0], commit_message: message.split('\n').slice(2).join('\n') });
        return { merged: Boolean(out?.merged), sha: out?.sha };
      } catch (error) {
        return { merged: false, reason: `GitHub refused the merge: ${error instanceof Error ? error.message : error}` };
      }
    },
  };
}

function hash(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
