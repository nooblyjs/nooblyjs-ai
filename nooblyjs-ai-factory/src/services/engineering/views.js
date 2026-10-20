// @ts-check
// The Engineering, Pull requests and Test pages' data (2026-10-20, CHG-008), as rows of the Factory's route table:
// read-only, `read` for everyone. What the lifecycle engine knows is live (the stories in Engineer, the pull requests
// and their Build and Test approvals, the Test approvals); the application architecture, test analysis, test runs and
// defects are the seed story's sample (samples.js) until Phases 16d, 16e and 20 build them. Every answer says which.
//
//   GET /api/engineering                       stories in Engineer: architecture, test analysis, what the sign-off needs
//   GET /api/engineering/architecture/:id      one story's application architecture, per system
//   GET /api/engineering/test-analysis/:id     one story's test analysis
//   GET /api/pull-requests                     pull requests with their Build and Test approvals and last test run
//   GET /api/test/approvals                    waiting on a tester, in Test, given
//   GET /api/test/runs · /api/test/coverage · /api/test/defects
import { readSamples } from './samples.js';

const SAMPLE = 'Sample data of the seed story.';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

/** One story's architecture in words: "1 of 2 systems accepted". */
function architectureSummary(doc) {
  if (!doc) return { systems: 0, accepted: 0, text: 'No application architecture yet', missing: ['no application architecture yet'] };
  const accepted = doc.systems.filter((s) => s.status === 'accepted');
  const open = doc.systems.filter((s) => s.status !== 'accepted');
  const stale = doc.systems.filter((s) => s.stale);
  return {
    systems: doc.systems.length, accepted: accepted.length,
    text: `${accepted.length} of ${plural(doc.systems.length, 'system')} accepted${stale.length ? ` · ${stale.length} stale` : ''}`,
    missing: [...open.map((s) => `${s.name}'s architecture is ${s.status}`), ...stale.map((s) => `${s.name}'s architecture is stale`)],
  };
}

/** One story's test analysis in words: "1 of 2 criteria have a ready test case". */
function analysisSummary(doc) {
  if (!doc) return { criteria: 0, ready: 0, cases: 0, text: 'No test analysis yet', missing: ['no test analysis yet'] };
  const byId = new Map(doc.cases.map((c) => [c.id, c]));
  const isReady = (id) => byId.get(id)?.status === 'ready';
  const readyCriteria = doc.criteria.filter((c) => c.cases.some(isReady));
  const drafts = doc.cases.filter((c) => c.status !== 'ready');
  const untested = (doc.interfaces ?? []).filter((i) => !i.cases?.length);
  return {
    criteria: doc.criteria.length, ready: readyCriteria.length, cases: doc.cases.length,
    automated: doc.cases.filter((c) => c.automate).length,
    text: `${readyCriteria.length} of ${plural(doc.criteria.length, 'criterion', 'criteria')} ${readyCriteria.length === 1 ? 'has' : 'have'} a ready test case`,
    missing: [...drafts.map((c) => `${c.id} is a draft`), ...untested.map((i) => `${i.id} has no integration test`)],
  };
}

/**
 * @param {{ home: string, host: any }} options   home: the Factory's data folder
 * @returns {Array<[string, string, (ctx: any) => any]>}
 */
export function engineeringRoutes({ home, host }) {
  const workflows = () => host.service?.('workflows') ?? null;
  const items = async (stage) => (await workflows()?.items?.(stage ? { stage } : {})) ?? [];
  const approvals = async (type) => (await workflows()?.approvals?.({ type })) ?? [];
  const nameOf = async (id) => (id ? (await host.people?.get?.(id))?.name ?? id : null);
  const lifecycle = (id) => `/home/lifecycle/${encodeURIComponent(id)}`;
  const live = Boolean(workflows());

  async function storyRow(item, samples, signoffs) {
    const parent = item.parentId ? await workflows()?.item?.({ itemId: item.parentId }) : null;
    const arch = architectureSummary(samples.architecture.get(item.id));
    const tests = analysisSummary(samples.analysis.get(item.id));
    const open = signoffs.find((a) => a.itemId === item.id && a.status === 'open');
    const missing = [...arch.missing, ...tests.missing];
    return {
      id: item.id, ref: item.ref ?? item.id, title: item.title, type: item.type, stageEnteredAt: item.stageEnteredAt ?? null,
      parent: parent ? { id: parent.id, ref: parent.ref ?? parent.id, title: parent.title } : null,
      feature: item.feature ?? null,
      architecture: arch, testAnalysis: tests,
      signOff: {
        ready: !missing.length, missing,
        text: missing.length ? `Not ready to sign off: ${missing.join('; ')}` : 'Ready for the Engineering sign-off',
        waitingOn: open ? await Promise.all((open.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => nameOf(r.id))) : [],
      },
      sample: samples.architecture.has(item.id) || samples.analysis.has(item.id),
      href: lifecycle(item.id),
      designHref: item.parentId ? `/factory/design/stories/${encodeURIComponent(item.parentId)}` : null,
    };
  }

  async function engineering() {
    const samples = await readSamples(home);
    const [inEngineer, signoffs] = await Promise.all([items('engineer'), approvals('engineering-signoff')]);
    const rows = await Promise.all(inEngineer.filter((i) => i.status === 'active').map((i) => storyRow(i, samples, signoffs)));
    return { json: { live, sample: SAMPLE, stories: rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })) } };
  }

  async function storyDoc(kind, id) {
    const samples = await readSamples(home);
    const doc = (kind === 'architecture' ? samples.architecture : samples.analysis).get(id);
    if (!doc) throw notFound(`${id} has no ${kind === 'architecture' ? 'application architecture' : 'test analysis'} yet.`);
    const item = await workflows()?.item?.({ itemId: id }) ?? null;
    const people = async (x) => (x?.id ? { ...x, name: x.name ?? await nameOf(x.id) } : x);
    return {
      json: {
        sample: SAMPLE, ...doc,
        stage: item?.stage ?? null, href: lifecycle(id), designHref: `/factory/design/stories/${encodeURIComponent(doc.itemId)}`,
        summary: kind === 'architecture' ? architectureSummary(doc) : analysisSummary(doc),
        ...(kind === 'architecture' ? { systems: await Promise.all(doc.systems.map(async (s) => ({ ...s, acceptedBy: await people(s.acceptedBy) }))) } : {}),
      },
    };
  }

  /** The approvals of one pull request, said in words. */
  async function approvalWords(all, itemId, types) {
    const a = all.filter((x) => x.itemId === itemId && types.includes(x.type)).sort((x, y) => String(y.requestedAt).localeCompare(String(x.requestedAt)))[0];
    if (!a) return { status: 'none', text: 'Not asked yet' };
    if (a.status === 'approved') return { status: 'approved', text: `Given by ${await nameOf(a.decidedBy)}`, at: a.decidedAt ?? null };
    if (a.status === 'open') return { status: 'waiting', text: `Waiting on ${(await Promise.all((a.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => nameOf(r.id)))).join(', ')}` };
    return { status: a.status, text: a.status === 'changes-requested' ? 'Sent back for changes' : 'Withdrawn' };
  }

  async function pullRequests() {
    const samples = await readSamples(home);
    const [all, build, test, merge] = await Promise.all([items(null), approvals('build-approval'), approvals('test-approval'), approvals('merge')]);
    const decided = [...build, ...test, ...merge];
    const prs = all.filter((i) => i.type === 'pr' && i.status !== 'withdrawn');
    const rows = await Promise.all(prs.map(async (i) => {
      const last = samples.runs.find((r) => r.itemId === i.id) ?? null;
      return {
        id: i.id, ref: i.ref ?? i.id, title: i.title, stage: i.stage, status: i.status, owner: await nameOf(i.owner),
        build: await approvalWords(decided, i.id, ['build-approval', 'merge']), test: await approvalWords(decided, i.id, ['test-approval']),
        lastRun: last ? { id: last.id, status: last.status, text: `${last.suite}: ${last.status}`, sample: true } : null,
        href: lifecycle(i.id),
      };
    }));
    const order = { build: 0, test: 1 };
    return { json: { live, pullRequests: rows.sort((a, b) => (order[a.stage] ?? 2) - (order[b.stage] ?? 2) || a.ref.localeCompare(b.ref)) } };
  }

  async function testApprovals() {
    const samples = await readSamples(home);
    const [given, inTest] = await Promise.all([approvals('test-approval'), items('test')]);
    const row = async (a) => {
      const item = await workflows()?.item?.({ itemId: a.itemId });
      return { id: a.id, itemId: a.itemId, ref: item?.ref ?? a.itemId, title: item?.title ?? a.title, status: a.status, decidedBy: await nameOf(a.decidedBy), decidedAt: a.decidedAt ?? null, waitingOn: await Promise.all((a.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => nameOf(r.id))), href: `/home/approvals?id=${a.id}` };
    };
    return {
      json: {
        live,
        waiting: await Promise.all(given.filter((a) => a.status === 'open').map(row)),
        inTest: inTest.filter((i) => i.status === 'active').map((i) => {
          const last = samples.runs.find((r) => r.itemId === i.id);
          return { id: i.id, ref: i.ref ?? i.id, title: i.title, text: given.some((a) => a.itemId === i.id && a.status === 'open') ? 'Waiting on a tester' : last?.status === 'running' ? `The automated tests are running (${last.id}); then a tester gives the Test approval` : 'The tester gives the Test approval from its Lifecycle page', href: lifecycle(i.id) };
        }),
        given: await Promise.all(given.filter((a) => a.status !== 'open').sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).map(row)),
      },
    };
  }

  async function runs() {
    const { runs: list } = await readSamples(home);
    const failed = list.filter((r) => r.status === 'failed').length;
    return { json: { sample: SAMPLE, runs: list, text: list.length ? `${plural(list.length, 'run')} · ${failed} failed · ${list.filter((r) => r.status === 'running').length} running` : 'No test runs yet' } };
  }

  async function coverage() {
    const samples = await readSamples(home);
    const stories = [...samples.analysis.values()].map((doc) => ({ id: doc.storyId, itemId: doc.itemId, title: doc.title, ...analysisSummary(doc), href: `/factory/engineering/test-analysis/${encodeURIComponent(doc.storyId)}` }));
    const byItem = new Map();
    for (const r of samples.runs.filter((x) => x.itemId)) {
      const row = byItem.get(r.itemId) ?? { itemId: r.itemId, ref: r.ref, runs: 0, last: null, openDefects: 0 };
      row.runs += 1;
      row.last ??= { id: r.id, status: r.status, suite: r.suite };
      byItem.set(r.itemId, row);
    }
    for (const d of samples.defects) if (byItem.has(d.itemId) && d.status === 'open') byItem.get(d.itemId).openDefects += 1;
    return { json: { sample: SAMPLE, stories, pullRequests: [...byItem.values()] } };
  }

  async function defects() {
    const { defects: list } = await readSamples(home);
    const open = list.filter((d) => d.status === 'open');
    return { json: { sample: SAMPLE, defects: list, text: list.length ? `${plural(list.length, 'defect')} · ${open.length} open` : 'No defects recorded' } };
  }

  return [
    ['GET', '/api/engineering', engineering],
    ['GET', '/api/engineering/architecture/:id', ({ params }) => storyDoc('architecture', params.id)],
    ['GET', '/api/engineering/test-analysis/:id', ({ params }) => storyDoc('analysis', params.id)],
    ['GET', '/api/pull-requests', pullRequests],
    ['GET', '/api/test/approvals', testApprovals],
    ['GET', '/api/test/runs', runs],
    ['GET', '/api/test/coverage', coverage],
    ['GET', '/api/test/defects', defects],
  ];
}
