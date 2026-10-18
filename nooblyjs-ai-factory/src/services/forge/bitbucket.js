// @ts-check
// NooblyJS Phase 13: the BITBUCKET forge, for a run hosted in NooblyJS on a repository that came from Bitbucket.
//
// The factory holds no Bitbucket token. Everything that would change Bitbucket is ASKED of NooblyJS
// (host.service('devtools').forge), which sends it through its write gate: only a factory/…
// branch, only where NooblyJS Platform lets agents push and open pull requests, and only when
// writing is switched on. While NooblyJS records writes instead of sending them, the answers say
// so and nothing leaves the machine.
//
//   issues, comments   the local forge's (a work item from NooblyJS is filed as an issue file)
//   pushBranch         asked of NooblyJS: one commit to factory/<item>/main, never forced
//   openOrUpdatePR     the PR file is written locally as before (it is the record, and what
//                      makes a retried delivery a no-op), then NooblyJS is asked to open or update
//                      the pull request on Bitbucket, with the repository's default reviewers
//   merge              refused, always: in NooblyJS a person merges, in Bitbucket
import { git } from '../exec/workspace/git.js';

/**
 * @param {{ local: any, devtools: () => any, name: string, noobly?: { itemId?: string, workItemId?: string }, runId?: () => string | null }} options
 *   name: the repository's short name on Bitbucket ("web-storefront")
 */
export function createBitbucketForge({ local, devtools, name, noobly = {} }) {
  const ask = () => {
    const forge = devtools()?.forge;
    if (!forge) throw new Error('NooblyJS is not there to ask: a Bitbucket repository is only worked on when the factory is hosted in NooblyJS.');
    return forge;
  };
  const about = (runId) => ({ itemId: noobly.itemId ?? null, workItemId: noobly.workItemId ?? null, runId: runId ?? null });

  return {
    ...local,
    name: 'bitbucket',
    repoName: name,

    /** The control plane's push, through NooblyJS. Resolves with the pushed commit, also when NooblyJS only recorded it. */
    async pushBranch(mirrorDir, fromBranch, toBranch) {
      const r = await ask().pushBranch({ slug: name, dir: mirrorDir, fromBranch, toBranch, ...about(noobly.runId) });
      if (!r.ok) throw new Error(`NooblyJS did not push ${toBranch} to ${name}: ${r.message ?? r.state}`);
      return git(['rev-parse', `refs/heads/${fromBranch}`], { cwd: mirrorDir });
    },

    /**
     * @param {string} slug  the factory's own name for the repository (its local PR file lives under it)
     * @param {import('./forge.js').PullRequest} pr
     */
    async openOrUpdatePR(slug, pr) {
      const record = local.openOrUpdatePR(slug, pr);
      const r = await ask().openOrUpdatePullRequest({ slug: name, pr: { title: pr.title, head: pr.head, base: pr.base, status: pr.status, body: pr.body }, ...about(String(pr.meta?.run ?? noobly.runId ?? '')) });
      if (!r.ok) throw new Error(`NooblyJS did not open the pull request on ${name}: ${r.message ?? r.state}`);
      return {
        path: r.url ?? record.path, number: r.id ?? undefined, recorded: r.recorded === true,
        action: r.sent ? (r.action === 'updated' ? /** @type {const} */ ('updated') : /** @type {const} */ ('created')) : record.action,
      };
    },

    /** Merging is a person's, in Bitbucket. This forge has no way to do it. */
    async merge() {
      return { merged: false, reason: 'hosted in NooblyJS an agent never merges: a person merges the pull request in Bitbucket' };
    },
  };
}
