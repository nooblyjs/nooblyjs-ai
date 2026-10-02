// @ts-check
// Phase F20: noticing MERGES in local repos, and measuring how much people changed first.
//
// On GitHub, a merge arrives as a webhook (F15). On the local forge a person just runs
// `git merge factory/issue-3/main`, and nothing tells the factory. So, when metrics are
// wanted, look: is the factory's branch head now part of the base branch?
//
//   merged?       git merge-base --is-ancestor <head> <base>
//   human edit    lines the factory wrote:   git diff --numstat <start>..<head>
//                 lines people then changed:  git diff --numstat <head>..<base tip>, only in the files
//                                             the factory touched (other work on main isn't "editing")
//
// Recorded as run.merged { by: 'detected', humanEdit }, an event like any other, so it's
// counted once and survives a rebuild. The edit count is an upper bound: later, unrelated
// commits to the same files count too. The earlier you look, the closer it is.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout.trim());

const numstat = (text) => text.split('\n').filter(Boolean).reduce((sum, l) => {
  const [a, d] = l.split('\t');
  return sum + (Number(a) || 0) + (Number(d) || 0);
}, 0);

/**
 * Delivered, not-yet-merged runs on local repos → run.merged, when their branch was merged.
 * @param {import('../store/events.js').Store} store
 * @returns {Promise<Array<{ runId: string, humanEdit: { factoryLines: number, editedLines: number } }>>}
 */
export async function detectMerges(store) {
  const found = [];
  for (const r of store.list('runs')) {
    if (r.status !== 'delivered' || !r.head || r.request?.forge?.kind === 'github') continue;
    const repo = r.request?.repo;
    const base = r.request?.base ?? 'main';
    try {
      const head = await git(repo, 'rev-parse', `refs/heads/${r.head}`);
      const merged = await git(repo, 'merge-base', '--is-ancestor', head, base).then(() => true, () => false);
      if (!merged) continue;
      const build = r.steps?.build?.result ?? {};
      const start = build.prBaseSha ?? build.workspace?.baseSha;
      if (!start) continue; // no record of where the factory started: can't tell its lines from anyone's
      const files = (await git(repo, 'diff', '--name-only', start, head)).split('\n').filter(Boolean);
      const factoryLines = numstat(await git(repo, 'diff', '--numstat', start, head));
      const editedLines = files.length ? numstat(await git(repo, 'diff', '--numstat', head, base, '--', ...files)) : 0;
      const tip = await git(repo, 'rev-parse', base);
      store.append(`run:${r.id}`, 'run.merged', { runId: r.id, itemId: r.itemId, sha: tip, by: 'detected', humanEdit: { factoryLines, editedLines } }, { key: `run:${r.id}:merged` });
      found.push({ runId: r.id, humanEdit: { factoryLines, editedLines } });
    } catch {
      // the repo moved or the branch is gone: nothing to measure
    }
  }
  return found;
}
