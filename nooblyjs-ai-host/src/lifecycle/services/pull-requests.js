// Pull requests in the lifecycle (Phase 16e, root product.md §3.2c). Each pull request the Software Factory delivers for
// a story is a lifecycle item of its own (type pr, the story's child), so its Build approval and Test approval are
// ordinary approvals: Home · Approvals, reminders, the audit log and approving on someone's behalf work as for any other.
//
//   recordPullRequest   the Factory delivered (or a commit moved the branch): the item, its evidence, and on a new commit
//                       both approvals cleared; then the Build approval opens (not while the commit is being checked)
//   afterDecision       the Build approval moves it to Test and opens the Test approval; a Test approval sent back puts it
//                       in Build again (the Factory hears approval.decided and repairs it)
//   canMerge / pullRequestMerged     a person merges after both approvals, for the commit they were given on
//   pullRequestMergedOutside         a Bitbucket merge: counted with both approvals, else flagged on the story
//   followPullRequests  the story follows its pull requests, and is done when the last one is merged
//   releaseFeature      a feature goes to Release when all its stories are done, without waiting for the item's others
//
// Nobody decides the story's and the feature's moves: they are on record (history, audit) and emit no stage event, like
// the item following its stories (Phase 16c).
import { badRequest, conflict, notFound, refused } from '../errors.js';
import { stageIndex, stageLabel } from '../stages.js';
import { dueFrom } from '../working-days.js';
import { newId } from '../ids.js';

const ACTIVE_RUNS = new Set(['queued', 'running', 'parked', 'paused']);
const FACTORY = { id: 'factory', name: 'Software Factory', kind: 'app' };
const short = (repo) => String(repo ?? '').split('/').pop();
const s7 = (sha) => String(sha ?? '').slice(0, 7);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createPullRequests({ repos, host, log, now, emit, audit, personFor, requirePermission, reviewersFor, ruleOr500, itemOr404, storiesOf, followStories, moveStage }) {
  const factory = () => host.service?.('factory') ?? null;
  const nameOf = async (id) => (id ? (await host.people.get(id))?.name ?? id : null);

  /** A story's pull requests (withdrawn ones left out), oldest first. */
  async function prsOf(storyId) {
    return (await repos.items.list()).filter((i) => i.type === 'pr' && i.parentId === storyId && i.status !== 'withdrawn')
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }

  async function nextId(story) {
    const stem = `PR-${String(story.id).replace(/^STORY-/, '')}`;
    const taken = new Set((await repos.items.list()).map((i) => i.id));
    let n = (await prsOf(story.id)).length + 1;
    while (taken.has(`${stem}-${n}`)) n += 1;
    return `${stem}-${n}`;
  }

  /** The pull request's Build and Test approvals, newest first. */
  async function approvalsOf(prId) {
    return (await repos.approvals.list()).filter((a) => a.itemId === prId && ['build-approval', 'test-approval'].includes(a.type))
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  }
  const givenFor = (list, type, sha) => list.find((a) => a.type === type && a.status === 'approved' && a.sha === sha) ?? null;

  /** A pull request moves between Build and Test by itself (a new commit; a Test approval sent back). */
  async function movePr(prId, to, { kind, reason = null, by = 'system' }) {
    const at = now();
    let from = null;
    const item = await repos.items.update(prId, (current) => {
      if (current.status !== 'active' || current.stage === to) return null;
      from = current.stage;
      const history = (current.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      history.push({ stage: to, enteredAt: at, by, kind, from, ...(reason ? { reason } : {}) });
      return { ...current, stage: to, stageEnteredAt: at, history, version: (current.version ?? 0) + 1, updatedAt: at };
    });
    return item ? { item, from } : null;
  }

  function bodyOf(item, type, buildBy = null) {
    const ev = item.pr?.evidence;
    const gates = item.pr?.gates === 'passed' ? 'The checks passed on this commit' : item.pr?.gates === 'failed' ? 'The checks failed on this commit' : 'No checks ran on this commit';
    if (type === 'build-approval') return `${ev?.text ?? 'No required tests recorded'}. ${gates} (${s7(item.pr?.sha)}). Approve the code, or ask for changes.`;
    const manual = (ev?.manual ?? []).map((c) => `${c.id} (${c.title})`);
    return `The AI's tests: ${ev?.text ?? 'none recorded'}. ${manual.length ? `A person checks: ${manual.join('; ')}. ` : ''}${buildBy ? `Build approval given by ${buildBy}. ` : ''}Give the Test approval, or send it back to Build with a reason.`;
  }

  /** Opens a pull request's Build or Test approval, waiting on the people the rule names on the story's team. */
  async function openApproval(item, type) {
    const rule = await ruleOr500(type);
    const reviewers = await reviewersFor(rule, item.team, null);
    if (!reviewers.length) {
      log.warn(`${item.id}: nobody has the "${rule.permission}" permission for its ${rule.label}`);
      return null;
    }
    const at = now();
    const build = type === 'test-approval' ? givenFor(await approvalsOf(item.id), 'build-approval', item.pr.sha) : null;
    const buildBy = build ? `${await nameOf(build.decidedBy)}${build.reviewers?.some((r) => r.by && r.status === 'approved') ? ` for ${await nameOf(build.reviewers.find((r) => r.by && r.status === 'approved').id)}` : ''}` : null;
    const approval = await repos.approvals.create({
      id: newId('apr'), type, itemId: item.id, subject: item.ref, title: item.title, from: item.stage, to: type === 'build-approval' ? 'test' : null,
      requestedBy: FACTORY, requestedAt: at, dueAt: dueFrom(at, rule.target), reviewers, status: 'open', sha: item.pr.sha,
      link: `/factory/pull-requests/${encodeURIComponent(item.id)}`, body: bodyOf(item, type, buildBy),
    });
    await emit('approval.requested', {
      approvalId: approval.id, itemId: item.id, parentId: item.parentId, itemType: 'pr', type, system: 'factory', reviewerIds: reviewers.map((r) => r.id), actorName: FACTORY.name,
      summary: `asked for the ${rule.label.toLowerCase()} of ${item.ref} · ${item.title}`,
    }, FACTORY.id);
    return approval;
  }

  /** A new commit clears both approvals: given ones are cleared, open ones withdrawn, each on record. */
  async function clearApprovals(item, sha, why) {
    const at = now();
    let cleared = 0;
    for (const a of await approvalsOf(item.id)) {
      if (a.status === 'open') {
        await repos.approvals.update(a.id, (cur) => (cur.status === 'open' ? { ...cur, status: 'withdrawn', decidedAt: at, withdrawnReason: why, updatedAt: at } : null));
        await emit('approval.withdrawn', { approvalId: a.id, itemId: item.id, itemType: 'pr', type: a.type, reason: why, summary: `withdrew the ${a.type === 'build-approval' ? 'Build' : 'Test'} approval of ${item.ref}: ${why}` }, 'system');
        cleared += 1;
      } else if (a.status === 'approved' && a.sha !== sha) {
        await repos.approvals.update(a.id, (cur) => (cur.status === 'approved' ? { ...cur, status: 'cleared', clearedAt: at, clearedReason: why, updatedAt: at } : null));
        await audit({ actor: 'system', action: 'approval.cleared', target: a.id, itemId: item.id, type: a.type, reason: why });
        await emit('approval.cleared', { approvalId: a.id, itemId: item.id, itemType: 'pr', type: a.type, reason: why, summary: `cleared the ${a.type === 'build-approval' ? 'Build' : 'Test'} approval of ${item.ref} (given by ${await nameOf(a.decidedBy)}): ${why}` }, 'system');
        cleared += 1;
      }
    }
    return cleared;
  }

  /**
   * The Software Factory delivered a pull request for a story, or its branch moved. A new pull request is an item in
   * Build; a new commit clears both approvals and puts it in Build again. Then, unless the commit is still being checked
   * or the pull request is a draft, its Build approval opens.
   */
  async function recordPullRequest({ itemId, runId, workItemId = null, repo, title, head, sha, href = null, forge = 'local', draft = false, gates = 'none', evidence = null, checking = false, why = null } = {}) {
    if (!runId || !sha || !repo) throw badRequest('A pull request needs its run, repository and commit.');
    const story = await itemOr404(itemId);
    if (story.type !== 'story') throw badRequest(`${story.ref ?? story.id} is not a story: its pull requests keep the item's own Build and Test approvals.`);
    const pr = { runId, workItemId, repo: short(repo), head, sha, forge, href, draft: Boolean(draft), gates, evidence, checking: Boolean(checking) };
    const at = now();
    let item = (await repos.items.list()).find((i) => i.type === 'pr' && i.pr?.runId === runId);
    let cleared = 0;
    if (item?.status === 'completed') return { item, unchanged: true };
    if (!item) {
      const id = await nextId(story);
      item = await repos.items.create({
        id, type: 'pr', ref: `${pr.repo} ${id}`, title: String(title ?? story.title).slice(0, 200), system: 'factory', parentId: story.id, feature: story.feature ?? null,
        stage: 'build', status: 'active', owner: story.owner ?? null, team: story.team ?? null, createdAt: at, stageEnteredAt: at,
        history: [{ stage: 'build', enteredAt: at, by: FACTORY.id }], pr, version: 1, updatedAt: at,
      });
      await emit('pr.recorded', { itemId: item.id, parentId: story.id, itemType: 'pr', system: 'factory', runId, sha, actorName: FACTORY.name, summary: `recorded ${item.ref} · ${item.title} for ${story.ref ?? story.id}: ${evidence?.text ?? 'no required tests recorded'}` }, FACTORY.id);
    } else {
      const newCommit = item.pr?.sha !== sha;
      if (newCommit) {
        const reason = why ?? `a new commit (${s7(sha)}) on the pull request`;
        cleared = await clearApprovals(item, sha, reason);
        if (item.stage !== 'build') await movePr(item.id, 'build', { kind: 'new-commit', reason });
      }
      item = await repos.items.update(item.id, (cur) => ({ ...cur, pr: { ...cur.pr, ...pr }, title: String(title ?? cur.title).slice(0, 200), version: (cur.version ?? 0) + 1, updatedAt: at }));
      if (newCommit) await emit('pr.recorded', { itemId: item.id, parentId: story.id, itemType: 'pr', system: 'factory', runId, sha, actorName: FACTORY.name, summary: `${item.ref} has a new commit (${s7(sha)})${cleared ? `: ${plural(cleared, 'approval')} cleared` : ''}${checking ? '; the Factory is checking it' : `: ${evidence?.text ?? ''}`}` }, FACTORY.id);
    }
    let opened = null;
    if (item.status === 'active' && item.stage === 'build' && !pr.checking && !pr.draft) {
      const list = await approvalsOf(item.id);
      if (!list.some((a) => a.type === 'build-approval' && (a.status === 'open' || (a.status === 'approved' && a.sha === sha)))) opened = await openApproval(item, 'build-approval');
    }
    await followPullRequests(story.id);
    return { item: await repos.items.get(item.id), opened: opened?.id ?? null, cleared };
  }

  /**
   * After a person's decision on a pull request's approval (decideApproval moved it to Test for a Build approval): the
   * Test approval opens; a Test approval sent back puts the pull request in Build again. The story follows.
   */
  async function afterDecision({ approval, outcome, item, person, reason }) {
    if (approval.type === 'build-approval' && outcome === 'approved') {
      const fresh = await repos.items.get(item.id);
      if (fresh?.stage === 'test' && !(await approvalsOf(item.id)).some((a) => a.type === 'test-approval' && a.status === 'open')) await openApproval(fresh, 'test-approval');
    }
    if (approval.type === 'test-approval' && outcome === 'changes-requested') {
      const moved = await movePr(item.id, 'build', { kind: 'sent-back', reason, by: person.id });
      if (moved) {
        await emit('item.sent_back', { itemId: item.id, parentId: item.parentId, itemType: 'pr', system: item.system, from: moved.from, to: 'build', reason, summary: `sent ${item.ref} · ${item.title} back to Build: ${reason}` }, person.id);
      }
    }
    await followPullRequests(item.parentId);
  }

  /** What still stops a pull request from merging, in words (empty: it may merge). */
  async function blockers(item) {
    if (item?.type !== 'pr' || !item.pr) return ['it is not a pull request the Software Factory delivered'];
    if (item.status === 'completed') return ['it is already merged'];
    if (item.status !== 'active') return [`it is ${item.status}`];
    const list = await approvalsOf(item.id);
    const out = [];
    if (item.pr.checking) out.push(`the Factory to finish checking its new commit (${s7(item.pr.sha)})`);
    if (!givenFor(list, 'build-approval', item.pr.sha)) out.push('the Build approval');
    if (!givenFor(list, 'test-approval', item.pr.sha)) out.push('the Test approval');
    if (item.pr.gates !== 'passed') out.push(item.pr.gates === 'failed' ? 'passing checks (they failed on this commit)' : 'passing checks (none ran on this commit)');
    return out;
  }

  /** Who gave each approval for the current commit, and for whom: [{ type, by, for }]. */
  async function givenOf(item) {
    const list = await approvalsOf(item.id);
    const out = [];
    for (const type of ['build-approval', 'test-approval']) {
      const a = givenFor(list, type, item.pr?.sha);
      if (!a) continue;
      const r = (a.reviewers ?? []).find((x) => x.status === 'approved');
      out.push({ type, approvalId: a.id, by: r?.by ?? r?.id ?? a.decidedBy, for: r?.id ?? null, at: a.decidedAt });
    }
    return out;
  }

  /** A person may merge only after both approvals, for the pull request's commit, and passing checks. */
  async function canMerge({ prId, actor } = {}) {
    const person = await personFor(actor, { what: 'merge a pull request', target: `item ${prId}` });
    await requirePermission(person, { permission: 'merge' }, 'merge a pull request');
    const item = await itemOr404(prId);
    const missing = await blockers(item);
    if (missing.length) {
      throw refused('not_mergeable', `${item.ref ?? item.id} can't merge yet: ${item.status === 'active' ? `it needs ${missing.join(', ')}` : missing.join(', ')}.`, { missing });
    }
    return { item, person, given: await givenOf(item) };
  }

  /** A person merged it (the Factory carried it out on the local forge). The story follows. */
  async function pullRequestMerged({ prId, sha = null, actor, via = 'noobly' } = {}) {
    const { item, person, given } = await canMerge({ prId, actor });
    return merged(item, { by: person, sha: sha ?? item.pr.sha, given, via });
  }

  async function merged(item, { by, sha, given, via }) {
    const at = now();
    const done = await repos.items.update(item.id, (cur) => {
      if (cur.status !== 'active') throw conflict('not_active', `${cur.ref ?? cur.id} is ${cur.status}.`);
      const history = (cur.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      return { ...cur, status: 'completed', completedAt: at, mergedAt: at, mergedBy: { id: by.id, name: by.name }, mergedSha: sha, mergedVia: via, history, version: (cur.version ?? 0) + 1, updatedAt: at };
    });
    const words = await Promise.all(given.map(async (g) => `the ${g.type === 'build-approval' ? 'Build' : 'Test'} approval by ${await nameOf(g.by)}${g.for && g.for !== g.by ? ` for ${await nameOf(g.for)}` : ''}`));
    await audit({ actor: by.id, action: 'pr.merged', target: item.id, itemId: item.parentId, sha, via, given });
    await emit('pr.merged', {
      itemId: item.parentId, pullRequestId: item.id, itemType: 'pr', system: 'factory', runId: item.pr.runId, repo: item.pr.repo, sha, mergedBy: by.name, via,
      summary: `merged ${item.ref} · ${item.title}${via === 'bitbucket' ? ' in Bitbucket' : ''}, after ${words.join(' and ')}`,
    }, by.kind === 'person' ? by.id : 'system');
    await followPullRequests(item.parentId);
    return { item: done, text: `${item.ref} is merged.` };
  }

  /**
   * A pull request was merged in Bitbucket. With both approvals for its commit it counts as merged; without them it is
   * flagged on the story and the pull request, in the audit log and Activity, and not counted as done. Null when the
   * work item is not a lifecycle pull request (the caller handles it as before 16e).
   */
  async function pullRequestMergedOutside({ workItemId, mergedBy, url = null } = {}) {
    const item = (await repos.items.list()).find((i) => i.type === 'pr' && i.status === 'active' && i.pr?.workItemId === workItemId);
    if (!item) return null;
    const who = String(mergedBy ?? '').trim().slice(0, 120);
    if (!who) throw badRequest('A merge needs the person who merged it.');
    const missing = (await blockers(item)).filter((m) => !m.startsWith('passing checks'));
    const by = { id: 'bitbucket', name: `${who} (Bitbucket)`, kind: 'system' };
    if (!missing.length) return { counted: true, ...(await merged(item, { by, sha: item.pr.sha, given: await givenOf(item), via: 'bitbucket' })) };
    const at = now();
    const flag = { at, by: who, missing, url };
    await repos.items.update(item.id, (cur) => ({ ...cur, mergedEarly: flag, updatedAt: at }));
    await repos.items.update(item.parentId, (cur) => ({ ...cur, mergedEarly: { ...flag, pullRequests: [item.id] }, updatedAt: at }));
    await audit({ actor: by.id, action: 'pr.merged_before_approval', target: item.id, itemId: item.parentId, mergedBy: who, missing });
    await emit('pr.merged_early', {
      itemId: item.parentId, pullRequestId: item.id, itemType: 'pr', system: 'factory', mergedBy: who, missing, actorName: by.name,
      summary: `${item.ref} · ${item.title} was merged in Bitbucket by ${who} before ${missing.join(' and ')}: not counted as done`,
    }, by.id);
    return { counted: false, missing, item: await repos.items.get(item.id) };
  }

  /** Runs of the story still being built that have no pull request yet (the Factory's), and work items that never started. */
  async function workOf(storyId, prs) {
    const withPr = new Set(prs.map((p) => p.pr?.runId).filter(Boolean));
    const runs = (await Promise.resolve(factory()?.runsForItem?.(storyId)).catch(() => [])) ?? [];
    const waiting = (await Promise.resolve(factory()?.waitingWork?.(storyId)).catch(() => [])) ?? [];
    return { building: runs.filter((r) => ACTIVE_RUNS.has(r.status) && !withPr.has(r.id)), waiting };
  }

  async function moveStory(story, to, kind) {
    const at = now();
    const moved = await repos.items.update(story.id, (cur) => {
      if (cur.status !== 'active' || cur.stage === to) return null;
      const history = (cur.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      history.push({ stage: to, enteredAt: at, by: 'system', kind });
      return { ...cur, stage: to, stageEnteredAt: at, history, version: (cur.version ?? 0) + 1, updatedAt: at };
    });
    if (moved) await audit({ actor: 'system', action: `item.followed_${kind.replace('-', '_')}`, target: story.id, itemId: story.id, from: story.stage, to });
    return moved;
  }

  /**
   * The story follows its pull requests: Build while one is in Build or a run without one is still being built, Test
   * when all are in Test, done (it passed Test) when the last one is merged. Then its feature may go to Release.
   */
  async function followPullRequests(storyId) {
    const story = await repos.items.get(storyId);
    if (!story || story.type !== 'story' || story.status !== 'active' || !['build', 'test'].includes(story.stage) || story.passedTestAt) return null;
    const prs = await prsOf(story.id);
    if (!prs.length) return null;
    const open = prs.filter((p) => p.status === 'active');
    const { building, waiting } = await workOf(story.id, prs);
    if (open.length || building.length) {
      const to = open.some((p) => p.stage === 'build') || building.length ? 'build' : 'test';
      return moveStory(story, to, 'pull-requests');
    }
    if (!prs.every((p) => p.status === 'completed')) return null;
    const at = now();
    const notBuilt = waiting.map((w) => ({ workItemId: w.workItemId, repo: w.repo, reason: w.reason }));
    if (story.stage === 'build') await moveStory(story, 'test', 'pull-requests');
    await repos.items.update(story.id, (cur) => ({ ...cur, passedTestAt: at, ...(notBuilt.length ? { notBuiltHere: notBuilt } : {}), version: (cur.version ?? 0) + 1, updatedAt: at }));
    const last = prs.at(-1);
    await audit({ actor: 'system', action: 'story.passed_test', target: story.id, itemId: story.id, pullRequests: prs.map((p) => p.id), notBuiltHere: notBuilt.map((w) => w.workItemId) });
    await emit('story.passed_test', {
      itemId: story.id, parentId: story.parentId ?? null, feature: story.feature ?? null, system: story.system, pullRequests: prs.map((p) => p.id),
      summary: `${story.ref ?? story.id} · ${story.title} passed Test: its last pull request (${last.ref}) is merged${notBuilt.length ? `; ${plural(notBuilt.length, 'work item')} ${notBuilt.length === 1 ? 'was' : 'were'} not built here (${notBuilt.map((w) => w.repo).join(', ')})` : ''}`,
    }, 'system');
    return releaseFeature(await repos.items.get(story.id));
  }

  /** When every story of a feature has passed Test, they go to Release together; the item's other features don't wait. */
  async function releaseFeature(story) {
    const siblings = story.parentId && story.feature?.id
      ? (await storiesOf(story.parentId)).filter((st) => st.feature?.id === story.feature.id && st.status === 'active')
      : [story];
    if (!siblings.every((st) => st.passedTestAt)) return { released: false, waitingOn: siblings.filter((st) => !st.passedTestAt).map((st) => st.id) };
    for (const st of siblings) if (st.stage === 'test') await moveStory(st, 'release', 'feature');
    const feature = story.feature ?? { id: story.id, title: story.title };
    await emit('feature.in_release', {
      itemId: story.parentId ?? story.id, featureId: feature.id, stories: siblings.map((st) => st.id), system: story.system,
      summary: `${feature.id} · ${feature.title ?? story.title} is in Release: ${siblings.length === 1 ? 'its story' : `all ${siblings.length} of its stories`} passed Test`,
    }, 'system');
    if (story.parentId) await followStories(story.parentId);
    return { released: true, feature: feature.id, stories: siblings.map((st) => st.id) };
  }

  /** An item's features: each with its stories and where it is, in words. */
  async function featuresOf(itemId) {
    const stories = await storiesOf(itemId);
    const byFeature = new Map();
    for (const st of stories) {
      const key = st.feature?.id ?? st.id;
      const row = byFeature.get(key) ?? { id: key, title: st.feature?.title ?? st.title, stories: [] };
      row.stories.push({ id: st.id, ref: st.ref ?? st.id, title: st.title, stage: st.stage, status: st.status, passedTest: Boolean(st.passedTestAt) });
      byFeature.set(key, row);
    }
    return [...byFeature.values()].map((f) => {
      const active = f.stories.filter((st) => st.status === 'active');
      const stage = active.length && active.every((st) => st.stage === 'release') ? 'release'
        : active.map((st) => st.stage).sort((a, b) => stageIndex(a) - stageIndex(b))[0] ?? null;
      const behind = active.filter((st) => st.stage === stage && stage !== 'release').map((st) => st.ref);
      return { ...f, stage, text: !stage ? 'No active story' : stage === 'release' ? 'In Release: all its stories passed Test' : `In ${stageLabel(stage)}${behind.length ? ` (${behind.join(', ')})` : ''}` };
    });
  }

  /** One pull request as the Factory's pages show it: the item, its approvals and who gave them, what stops a merge. */
  async function pullRequestView(prId) {
    const item = await repos.items.get(prId);
    if (!item || item.type !== 'pr') throw notFound(`There is no pull request ${prId}.`);
    const list = await approvalsOf(item.id);
    const rows = await Promise.all(list.map(async (a) => ({
      id: a.id, type: a.type, status: a.status, sha: a.sha ?? null, requestedAt: a.requestedAt, decidedAt: a.decidedAt ?? null,
      reason: a.withdrawnReason ?? a.clearedReason ?? (a.reviewers ?? []).find((r) => r.reason)?.reason ?? null,
      reviewers: await Promise.all((a.reviewers ?? []).map(async (r) => ({ id: r.id, name: await nameOf(r.id), status: r.status, by: r.by ?? null, byName: r.by ? await nameOf(r.by) : null, at: r.at ?? null, reason: r.reason ?? null }))),
    })));
    return { item, approvals: rows, blockers: item.type === 'pr' && item.pr ? await blockers(item) : [], given: await givenOf(item) };
  }

  return { recordPullRequest, afterDecision, canMerge, pullRequestMerged, pullRequestMergedOutside, followPullRequests, featuresOf, prsOf, pullRequestView, blockers };
}
