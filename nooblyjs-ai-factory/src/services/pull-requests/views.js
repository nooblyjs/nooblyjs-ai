// @ts-check
// NooblyJS Phase 16e: Build · Pull requests and Test · Test approvals, as rows of the Factory's route table. Every pull
// request is a lifecycle item (its Build and Test approvals are the lifecycle's); one the line delivered for a story has
// its evidence (the required tests by test case id, the checks, what a person checks) and a page of its own where an
// engineer gives the Build approval or asks for changes, a tester gives the Test approval or sends it back, and a person
// merges it after both. The seed's pull requests (before 16e) show with their approvals and sample test runs.
//
//   GET  /api/pull-requests                    every pull request: stage, approvals in words, evidence
//   GET  /api/pull-requests/:id                one: its evidence, test cases, approvals (who gave each, for whom), what
//                                              stops a merge, and what this person may do
//   POST /api/pull-requests/:id/decision       { approval: build | test, decision: approve | request-changes, reason, for }
//   POST /api/pull-requests/:id/merge          a person merges it, after both approvals (merge)
//   GET  /api/test/approvals                   waiting on a tester, in Test, given
import { readSamples } from '../engineering/samples.js';

const TYPE = { build: 'build-approval', test: 'test-approval' };
const LABEL = { 'build-approval': 'Build approval', 'test-approval': 'Test approval' };
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * @param {{ home: string, host: any, store: any, bridge: ReturnType<typeof import('./bridge.js').createBridge>, mountPath?: string }} options
 * @returns {Array<[string, string, (ctx: any) => any]>}
 */
export function pullRequestRoutes({ home, host, store, bridge, mountPath = '/factory' }) {
  const workflows = () => host.service?.('workflows') ?? null;
  const nameOf = async (id) => (id ? (await host.people?.get?.(id))?.name ?? id : null);
  const lifecycle = (id) => `/home/lifecycle/${encodeURIComponent(id)}`;
  const page = (id) => `${mountPath}/pull-requests/${encodeURIComponent(id)}`;
  const person = (req) => req?.person ?? null;

  /** An approval in words: who gave it (and for whom), or whom it waits on. */
  async function words(a) {
    if (!a) return { status: 'none', text: 'Not asked yet' };
    const r = (a.reviewers ?? []).find((x) => x.status === 'approved' || x.status === 'changes-requested');
    const by = await nameOf(r?.by ?? r?.id ?? a.decidedBy);
    const forText = r?.by && r.by !== r.id ? ` for ${await nameOf(r.id)}` : '';
    if (a.status === 'approved') return { status: 'approved', text: `Given by ${by}${forText}`, at: a.decidedAt ?? null };
    if (a.status === 'open') return { status: 'waiting', text: `Waiting on ${(await Promise.all((a.reviewers ?? []).filter((x) => x.status === 'waiting').map((x) => nameOf(x.id)))).join(', ')}` };
    if (a.status === 'changes-requested') return { status: 'changes-requested', text: `${a.type === 'test-approval' ? 'Sent back' : 'Changes asked for'} by ${by}${forText}` };
    if (a.status === 'cleared') return { status: 'cleared', text: 'Cleared by a new commit' };
    return { status: a.status, text: 'Withdrawn' };
  }

  const latest = (list, itemId, types) => list.filter((a) => a.itemId === itemId && types.includes(a.type)).sort((x, y) => String(y.requestedAt).localeCompare(String(x.requestedAt)))[0] ?? null;

  async function list() {
    const w = workflows();
    if (!w) return { json: { live: false, pullRequests: [] } };
    await bridge.syncPushes().catch(() => []);
    const [items, approvals, samples] = await Promise.all([w.items({}), w.approvals({}), readSamples(home)]);
    const rows = await Promise.all(items.filter((i) => i.type === 'pr' && i.status !== 'withdrawn').map(async (i) => {
      const story = i.parentId ? items.find((x) => x.id === i.parentId) : null;
      const last = samples.runs.find((r) => r.itemId === i.id) ?? null;
      return {
        id: i.id, ref: i.ref ?? i.id, title: i.title, stage: i.stage, status: i.status, owner: await nameOf(i.owner),
        story: story ? { id: story.id, ref: story.ref ?? story.id, title: story.title } : null,
        build: await words(latest(approvals, i.id, ['build-approval', 'merge'])), test: await words(latest(approvals, i.id, ['test-approval'])),
        evidence: i.pr?.checking ? 'The Factory is checking a new commit' : i.pr?.evidence?.text ?? null,
        mergedEarly: i.mergedEarly ? `Merged in Bitbucket by ${i.mergedEarly.by} before ${i.mergedEarly.missing.join(' and ')}: not counted` : null,
        lastRun: last ? { id: last.id, status: last.status, text: `${last.suite}: ${last.status}`, sample: true } : null,
        href: i.pr ? page(i.id) : lifecycle(i.id),
      };
    }));
    const order = { build: 0, test: 1 };
    return { json: { live: true, pullRequests: rows.sort((a, b) => (a.status === 'completed') - (b.status === 'completed') || (order[a.stage] ?? 2) - (order[b.stage] ?? 2) || a.ref.localeCompare(b.ref, 'en', { numeric: true })) } };
  }

  async function one({ params, req }) {
    const w = workflows();
    if (typeof w?.pullRequest !== 'function') throw httpError(503, 'unavailable', 'The lifecycle engine is not running here.');
    await bridge.syncPushes().catch(() => []);
    const view = await w.pullRequest({ prId: params.id });
    const { item } = view;
    const run = item.pr?.runId ? store.get('runs', item.pr.runId) : null;
    const story = item.parentId ? await w.item({ itemId: item.parentId }) : null;
    const me = person(req);
    const mayApprove = Boolean(me && me.accessRole !== 'Viewer' && me.kind !== 'agent');
    const mayMerge = Boolean(me && me.kind !== 'agent' && (await host.can?.(me.accessRole, 'merge')));
    const open = (type) => view.approvals.find((a) => a.type === type && a.status === 'open') ?? null;
    // NooblyJS Phase 21: the pull request's preview (Infrastructure) and the suites that ran there (the Test section).
    const preview = await Promise.resolve(host.service?.('infrastructure')?.previewForPr?.(item.id)).catch(() => null) ?? null;
    const [envRun] = (await Promise.resolve(host.service?.('quality')?.environmentRuns?.({ prId: item.id })).catch(() => [])) ?? [];
    const decision = (type) => {
      const a = open(type);
      if (!a || !mayApprove || item.status !== 'active') return null;
      const waiting = a.reviewers.filter((r) => r.status === 'waiting');
      const mine = waiting.some((r) => r.id === me.id);
      return { approvalId: a.id, mine, for: (mine ? waiting.filter((r) => r.id === me.id) : waiting).map((r) => ({ id: r.id, name: r.name })) };
    };
    return {
      json: {
        item: {
          id: item.id, ref: item.ref, title: item.title, stage: item.stage, status: item.status, href: lifecycle(item.id),
          mergedAt: item.mergedAt ?? null, mergedBy: item.mergedBy?.name ?? null, mergedEarly: item.mergedEarly ?? null,
        },
        story: story ? { id: story.id, ref: story.ref ?? story.id, title: story.title, stage: story.stage, href: lifecycle(story.id) } : null,
        pr: item.pr ?? null,
        run: run ? { id: run.id, status: run.status, href: `${mountPath}/runs/${run.id}`, cases: run.request?.noobly?.testCases ?? [] } : null,
        approvals: view.approvals.map((a) => ({ ...a, label: LABEL[a.type] ?? a.type })),
        given: await Promise.all(view.given.map(async (g) => ({ ...g, label: LABEL[g.type], byName: await nameOf(g.by), forName: g.for && g.for !== g.by ? await nameOf(g.for) : null }))),
        blockers: view.blockers,
        preview: preview ? { ...preview, text: preview.status === 'destroyed' ? `${preview.name} was destroyed when it merged` : preview.status === 'live' ? `${preview.name} is live: verify the pull request there` : `${preview.name} is ${preview.status}` } : null,
        evidence: evidenceList(item, envRun, preview),
        can: {
          build: decision('build-approval'), test: decision('test-approval'),
          merge: mayMerge && item.status === 'active' && !view.blockers.length,
        },
        mergeText: item.status === 'completed' ? `Merged by ${item.mergedBy?.name ?? 'a person'}` : view.blockers.length ? `It can't merge yet: it needs ${view.blockers.join(', ')}.` : 'Both approvals are given for this commit, and its checks passed: a person may merge it.',
      },
    };
  }

  /**
   * NooblyJS Phase 21: the tester's evidence in one list: the AI's required tests on the commit (Build), what a person
   * checks by hand, and each suite that ran in the preview (function, accessibility, security).
   */
  function evidenceList(item, envRun, preview) {
    const ev = item.pr?.evidence;
    const RESULT = { passing: 'Passing', failing: 'Failing', unproven: 'Present, not proven', missing: 'Missing' };
    const rows = (ev?.cases ?? []).map((c) => ({ where: 'Build · the AI\'s tests', id: c.id, title: c.title, level: c.level, result: c.status, text: RESULT[c.status] ?? c.status }));
    for (const c of ev?.manual ?? []) rows.push({ where: 'A person checks', id: c.id, title: c.title, level: 'manual', result: 'manual', text: 'The tester checks it' });
    for (const s of envRun?.suites ?? []) {
      rows.push({
        where: `Preview · ${envRun.environment}`, id: s.suite, title: s.text ?? `${s.passed} of ${s.total} ${s.label ?? s.suite}`, level: s.label ?? s.suite,
        result: s.skipped ? 'skipped' : s.passed >= s.total ? 'passing' : 'failing', text: s.skipped ? 'Did not run' : `${s.passed} of ${s.total}${s.failing?.length ? ` · ${s.failing.map((f) => f.name).join('; ')}` : ''}`,
        ...(s.findings?.length ? { findings: s.findings } : {}),
      });
    }
    const failing = rows.filter((r) => r.result === 'failing' || r.result === 'missing').length;
    return {
      rows, testRunId: envRun?.id ?? null,
      text: `${rows.filter((r) => r.result === 'passing').length} passing of ${rows.length}${failing ? ` · ${failing} failing or missing` : ''}${envRun ? ` (with ${envRun.environment})` : preview ? ' (the preview\'s suites have not run yet)' : ' (no preview)'}`,
    };
  }

  async function decide({ params, body, req }) {
    const w = workflows();
    if (typeof w?.decideApproval !== 'function') throw httpError(503, 'unavailable', 'The lifecycle engine is not running here, so nothing can be decided.');
    const type = TYPE[body?.approval];
    if (!type) throw httpError(400, 'bad_request', 'approval must be "build" or "test".');
    const { approvals } = await w.pullRequest({ prId: params.id });
    const a = approvals.find((x) => x.type === type && x.status === 'open');
    if (!a) throw httpError(409, 'no_open_approval', `${params.id} has no ${LABEL[type]} waiting.`);
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 2000) : undefined;
    const result = await w.decideApproval({
      approvalId: a.id, decision: body?.decision, reason, comment: reason, actor: person(req),
      ...(typeof body?.for === 'string' && body.for ? { for: body.for } : {}),
      ...(typeof body?.override?.reason === 'string' && body.override.reason.trim() ? { override: { reason: body.override.reason.trim().slice(0, 500) } } : {}),
    });
    return { json: { outcome: result.outcome, text: result.text, item: { id: result.item?.id, stage: result.item?.stage } } };
  }

  async function merge({ params, req }) {
    const result = await bridge.merge(params.id, person(req));
    return { json: { text: result.text, sha: result.sha, item: { id: result.item?.id, status: result.item?.status } } };
  }

  async function testApprovals() {
    const w = workflows();
    if (!w) return { json: { live: false, waiting: [], inTest: [], given: [] } };
    const samples = await readSamples(home);
    const [given, inTest] = await Promise.all([w.approvals({ type: 'test-approval' }), w.items({ stage: 'test' })]);
    const row = async (a) => {
      const item = await w.item({ itemId: a.itemId });
      const r = (a.reviewers ?? []).find((x) => x.status === 'approved' || x.status === 'changes-requested');
      return {
        id: a.id, itemId: a.itemId, ref: item?.ref ?? a.itemId, title: item?.title ?? a.title, status: a.status, body: a.body ?? null,
        decidedBy: await nameOf(r?.by ?? r?.id ?? a.decidedBy), decidedFor: r?.by && r.by !== r.id ? await nameOf(r.id) : null, decidedAt: a.decidedAt ?? null,
        reason: r?.reason ?? a.clearedReason ?? null,
        waitingOn: await Promise.all((a.reviewers ?? []).filter((x) => x.status === 'waiting').map((x) => nameOf(x.id))),
        href: item?.pr ? page(a.itemId) : `/home/approvals?id=${a.id}`,
      };
    };
    return {
      json: {
        live: true,
        waiting: await Promise.all(given.filter((a) => a.status === 'open').map(row)),
        inTest: inTest.filter((i) => i.status === 'active' && i.type === 'pr').map((i) => {
          const last = samples.runs.find((r) => r.itemId === i.id);
          const waiting = given.some((a) => a.itemId === i.id && a.status === 'open');
          const approved = Boolean(i.pr) && given.some((a) => a.itemId === i.id && a.status === 'approved' && a.sha === i.pr.sha);
          return {
            id: i.id, ref: i.ref ?? i.id, title: i.title, href: i.pr ? page(i.id) : lifecycle(i.id),
            text: approved ? 'Test approval given: a person may merge it' : waiting ? 'Waiting on a tester' : last?.status === 'running' ? `The automated tests are running (${last.id}); then a tester gives the Test approval` : 'The tester gives the Test approval from its page',
          };
        }),
        given: await Promise.all(given.filter((a) => a.status !== 'open').sort((a, b) => String(b.decidedAt ?? b.clearedAt).localeCompare(String(a.decidedAt ?? a.clearedAt))).map(row)),
      },
    };
  }

  return [
    ['GET', '/api/pull-requests', list],
    ['GET', '/api/pull-requests/:id', one],
    ['POST', '/api/pull-requests/:id/decision', decide],
    ['POST', '/api/pull-requests/:id/merge', merge],
    ['GET', '/api/test/approvals', testApprovals],
  ];
}

/** The permission each write of these routes needs (the Factory's PERMISSIONS table). The lifecycle checks the person. */
export const PULL_REQUEST_PERMISSIONS = {
  'POST /api/pull-requests/:id/decision': 'draft',
  'POST /api/pull-requests/:id/merge': 'merge',
};
