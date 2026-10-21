// @ts-check
// NooblyJS Phase 16e: THE PULL REQUEST BRIDGE between the line and NooblyJS's lifecycle. A pull request the line delivers
// for a story is a lifecycle item there, with its Build approval and Test approval (root product.md §3.2c):
//
//   run.finished with a PR, for a story   → workflows.recordPullRequest: the pull request, its commit and its evidence
//   approval.decided: changes requested   → the person's reason is the fixer's brief (pr.changes_requested), and the
//     (a Build approval, or a Test          run goes back to its repair station (F13), like a review on GitHub (F15)
//      approval sent back)
//   a commit pushed to a local PR branch  → recorded at once (both approvals cleared), then checked again: the run
//                                            goes back to verify at that commit (repair.attempted, trigger push)
//   Merge (a person, after both)          → the local forge merges it for them, on record as theirs; a Bitbucket
//                                            pull request is merged in Bitbucket, never by NooblyJS
//
// The lifecycle decides who may approve and merge (people only, never an agent); this only carries it out.
import path from 'node:path';
import { createLocalForge } from '../forge/local.js';
import { git } from '../exec/workspace/git.js';
import { ensureMirror } from '../exec/workspace/mirror.js';
import { requeueFrom } from '../../controllers/api.js';
import { loadLine } from '../../models/line.js';
import { KINDS } from '../line/executor.js';

const ACTIVE = ['queued', 'running', 'parked', 'paused'];
const s7 = (sha) => String(sha ?? '').slice(0, 7);
const httpError = (status, code, message, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });

/**
 * @param {{ store: any, env: NodeJS.ProcessEnv, host: any, mountPath?: string, log?: any }} options
 */
export function createBridge({ store, env, host, mountPath = '/factory', log = console }) {
  const workflows = () => host.service?.('workflows') ?? null;
  const stationsOf = (run) => loadLine(run.request?.line ?? 'default', KINDS()).stations.map((s) => ({ id: s.id, kind: s.kind }));

  /** What the lifecycle keeps of a delivered run's pull request. */
  function factsOf(run) {
    const noobly = run.request?.noobly ?? {};
    const deliver = run.steps?.deliver?.result ?? {};
    const verify = run.steps?.verify?.result ?? null;
    return {
      itemId: noobly.itemId, runId: run.id, workItemId: noobly.workItemId ?? null, repo: noobly.repoName ?? run.request?.repo, title: run.title,
      head: run.head ?? deliver.head ?? null, sha: deliver.sha ?? null, href: `${mountPath}/runs/${run.id}`, forge: run.request?.forge?.kind ?? 'local',
      draft: run.status !== 'delivered', gates: verify?.passed === true ? 'passed' : verify?.passed === false ? 'failed' : 'none',
      evidence: deliver.requiredTests ?? null,
    };
  }

  /** The run delivered: tell the lifecycle, when it was for a story. Returns what the lifecycle answered, or null. */
  async function record(run) {
    const facts = factsOf(run);
    if (!facts.itemId || !facts.sha || !run.pr) return null;
    const item = await workflows()?.item?.({ itemId: facts.itemId });
    if (item?.type !== 'story' || typeof workflows()?.recordPullRequest !== 'function') return null;
    return workflows().recordPullRequest(facts);
  }

  /**
   * A person asked for changes on a pull request (its Build approval), or sent its Test approval back: the run goes back
   * to repair with their words. Once per approval decision.
   */
  async function onDecided(payload = {}) {
    if (payload.itemType !== 'pr' || payload.outcome !== 'changes-requested' || !['build-approval', 'test-approval'].includes(payload.type)) return null;
    const item = await workflows()?.item?.({ itemId: payload.itemId });
    const run = item?.pr?.runId ? store.get('runs', item.pr.runId) : null;
    if (!run) return null;
    if (ACTIVE.includes(run.status)) {
      log.warn?.(`factory: ${item.id}: changes were asked for while run ${run.id} is ${run.status}; its next delivery is reviewed again`);
      return null;
    }
    const stations = stationsOf(run);
    const repair = stations.find((s) => s.kind === 'repair');
    if (!repair) return null;
    const who = (await host.people?.get?.(payload.by))?.name ?? payload.by ?? 'a person';
    const what = payload.type === 'build-approval' ? 'asked for changes at the Build approval' : 'sent it back from the Test approval';
    const body = `${who} ${what}: ${payload.reason ?? '(no reason given)'}`;
    store.transaction(() => {
      if (!store.append(`run:${run.id}`, 'pr.changes_requested', { runId: run.id, body, by: who }, { key: `noobly:approval:${payload.approvalId}:changes` })) return;
      requeueFrom(store, run, repair.id, stations);
    });
    log.info?.(`factory: ${item.id}: ${body}; run ${run.id} goes back to repair`);
    return run.id;
  }

  /** The commit a local pull request's branch is at now, or null when it can't be read. */
  async function branchHead(run) {
    const repo = run.request?.repo;
    if (!repo || /^[a-z]+:\/\//i.test(repo) || !run.head) return null;
    return git(['rev-parse', '--verify', '--quiet', `refs/heads/${run.head}`], { cwd: path.resolve(repo) }).catch(() => null);
  }

  /**
   * A commit a person pushed to a pull request's branch: the lifecycle clears both approvals at once (the commit is
   * being checked), and the run goes back to verify at that commit, so the gates, the review and the required tests are
   * worked out again before a fresh Build approval opens.
   */
  async function pushed(item, run, sha) {
    const why = `a commit (${s7(sha)}) was pushed to ${run.head}`;
    await workflows().recordPullRequest({ ...factsOf(run), sha, checking: true, gates: 'none', evidence: null, why });
    const mirror = await ensureMirror(run.request.repo, { env });
    const key = String(run.head).match(/^factory\/([^/]+)\/main$/)?.[1] ?? run.id;
    const branch = `factory/pushed/${key}-${s7(sha)}`;
    await git(['update-ref', `refs/heads/${branch}`, sha], { cwd: mirror.dir });
    const build = run.steps?.build?.result ?? {};
    const base = build.prBaseSha ?? build.workspace?.baseSha;
    const stat = base ? await git(['diff', '--stat', `${base}..${sha}`], { cwd: mirror.dir }).catch(() => '') : '';
    const stations = stationsOf(run);
    const verify = stations.find((s) => s.kind === 'verify');
    store.transaction(() => {
      const attempt = (run.repairs ?? []).length + 1;
      if (!store.append(`run:${run.id}`, 'repair.attempted', { runId: run.id, attempt, signature: `push:${sha}`, trigger: 'push', title: why, outcome: 'success', sha, branch, stat, summary: `A person pushed ${s7(sha)}; the factory checks it again.`, costUsd: 0 }, { key: `noobly:push:${run.id}:${sha}` })) return;
      if (verify) requeueFrom(store, run, verify.id, stations);
    });
    log.info?.(`factory: ${item.id}: ${why}; its approvals are cleared and run ${run.id} checks it again`);
    return sha;
  }

  /** Every open local pull request whose branch moved since it was recorded is checked again. Returns those that moved. */
  async function syncPushes() {
    const list = (await Promise.resolve(workflows()?.pullRequests?.({})).catch(() => [])) ?? [];
    const moved = [];
    for (const item of list.filter((i) => i.status === 'active' && i.pr?.forge === 'local' && !i.pr.checking)) {
      const run = store.get('runs', item.pr.runId);
      if (!run || ACTIVE.includes(run.status)) continue;
      const sha = await branchHead(run);
      if (!sha || sha === item.pr.sha) continue;
      // The line's own delivery, not yet passed on (its run.finished is on its way): record it, it is no push.
      if (sha === run.steps?.deliver?.result?.sha) {
        await record(run).catch((error) => log.warn?.(`factory: ${item.id}: ${/** @type {Error} */ (error).message}`));
        continue;
      }
      try {
        moved.push(await pushed(item, run, sha));
      } catch (error) {
        log.warn?.(`factory: ${item.id}: the pushed commit ${s7(sha)} was not checked: ${/** @type {Error} */ (error).message}`);
      }
    }
    return moved;
  }

  /**
   * A person merges a pull request after both approvals. The lifecycle says whether they may (and why not); a commit
   * pushed since is caught first. On the local forge the factory merges it for them; Bitbucket's is merged there.
   */
  async function merge(prId, person) {
    const w = workflows();
    if (typeof w?.canMerge !== 'function') throw httpError(503, 'unavailable', 'The lifecycle engine is not running here, so nothing can be merged.');
    let { item, given } = await w.canMerge({ prId, actor: person });
    const run = store.get('runs', item.pr.runId);
    if (!run) throw httpError(409, 'no_run', `${item.ref}'s run is not in this factory's log.`);
    if (item.pr.forge === 'bitbucket') {
      throw httpError(409, 'merge_in_bitbucket', `${item.ref} is a Bitbucket pull request: merge it in Bitbucket. NooblyJS never merges there; it counts the merge once both approvals are given.`);
    }
    const sha = await branchHead(run);
    if (sha && sha !== item.pr.sha && sha !== run.steps?.deliver?.result?.sha) {
      await pushed(item, run, sha);
      throw httpError(409, 'new_commit', `A commit (${s7(sha)}) was pushed to ${item.ref} after its approvals: they are cleared, and the factory is checking it again.`);
    }
    const names = await Promise.all(given.map(async (g) => {
      const by = (await host.people?.get?.(g.by))?.name ?? g.by;
      const forName = g.for && g.for !== g.by ? (await host.people?.get?.(g.for))?.name ?? g.for : null;
      return `the ${g.type === 'build-approval' ? 'Build' : 'Test'} approval by ${by}${forName ? ` for ${forName}` : ''}`;
    }));
    const base = run.steps?.build?.result?.workspace?.baseRef ?? 'main';
    const result = await createLocalForge({ env }).merge(path.resolve(run.request.repo), {
      head: run.head, base, author: { name: person.name ?? person.id, email: `${person.id}@noobly.invalid` },
      message: `Merge ${run.head}: ${run.title}\n\nMerged by ${person.name ?? person.id} in NooblyJS (${item.ref}), after ${names.join(' and ')}.`,
    });
    if (!result.merged) throw httpError(409, 'not_merged', `${item.ref} was not merged: ${result.reason}.`);
    store.append(`run:${run.id}`, 'run.merged', { runId: run.id, itemId: run.itemId, sha: result.sha, by: `${person.name ?? person.id} (NooblyJS)` }, { key: `noobly:merged:${run.id}:${item.pr.sha}` });
    ({ item } = await w.pullRequestMerged({ prId, sha: result.sha, actor: person }));
    return { item, sha: result.sha, text: `${item.ref} is merged into ${base} (${s7(result.sha)}).` };
  }

  return { record, onDecided, syncPushes, merge, factsOf };
}
