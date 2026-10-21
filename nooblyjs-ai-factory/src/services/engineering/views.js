// @ts-check
// The Engineering and Test pages' data, as rows of the Factory's route table (CHG-008; Phase 16d).
// Engineering is real since Phase 16d: each story's application architecture (architecture.js: draft from the code,
// edit, accept), its test analysis (the Test section, host.service('quality')) and its Engineering sign-off (the
// lifecycle engine's readiness checks, and the sign-off itself). Pull requests and Test approvals are
// src/services/pull-requests/views.js since Phase 16e. Since Phase 20 the test runs, coverage and defects are the Test
// section's (host.service('quality'): runs recorded from the line, coverage per item, defects as lifecycle items), with
// the seed story's sample (samples.js) after them, marked as sample data.
//
//   GET  /api/engineering                                   stories in Engineer: architecture, tests, the sign-off's checks
//   GET  /api/engineering/architecture/:id                  one story's application architecture, per system
//   POST /api/engineering/architecture/:id/systems/:name/draft    an agent drafts it from the code (draft)
//   PUT  /api/engineering/architecture/:id/systems/:name          a person edits it (draft)
//   POST /api/engineering/architecture/:id/systems/:name/accept   a person accepts it (accept-decisions)
//   POST /api/engineering/:id/sign-off                      the Engineering sign-off, with an override reason (draft;
//                                                           the lifecycle engine checks the person)
//   GET  /api/test/runs · /api/test/coverage · /api/test/defects
import { readSamples } from './samples.js';

const SAMPLE = 'Sample data of the seed story.';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ home: string, host: any, architecture: ReturnType<typeof import('./architecture.js').createArchitecture> }} options
 * @returns {Array<[string, string, (ctx: any) => any]>}
 */
export function engineeringRoutes({ home, host, architecture }) {
  const workflows = () => host.service?.('workflows') ?? null;
  const quality = () => host.service?.('quality') ?? null;
  const items = async (stage) => (await workflows()?.items?.(stage ? { stage } : {})) ?? [];
  const approvals = async (type) => (await workflows()?.approvals?.({ type })) ?? [];
  const nameOf = async (id) => (id ? (await host.people?.get?.(id))?.name ?? id : null);
  const lifecycle = (id) => `/home/lifecycle/${encodeURIComponent(id)}`;
  const person = (req) => req?.person ?? null;
  const testSection = () => {
    const q = quality();
    if (typeof q?.raiseDefect !== 'function') throw Object.assign(new Error('The Test section is not running here, so no defect can be recorded.'), { status: 503 });
    return q;
  };

  async function storyRow(item, signoffs) {
    const parent = item.parentId ? await workflows()?.item?.({ itemId: item.parentId }) : null;
    const arch = await architecture.view(item.id).catch(() => null);
    const tests = (await quality()?.summaryFor?.(item.id).catch(() => null)) ?? null;
    const readiness = await workflows()?.readinessOf?.({ itemId: item.id }).catch(() => null);
    const open = signoffs.find((a) => a.itemId === item.id && a.status === 'open');
    return {
      id: item.id, ref: item.ref ?? item.id, title: item.title, type: item.type, stageEnteredAt: item.stageEnteredAt ?? null,
      parent: parent ? { id: parent.id, ref: parent.ref ?? parent.id, title: parent.title } : null,
      feature: item.feature ?? null,
      architecture: arch ? { ...arch.summary, systemsList: arch.systems.map((s) => ({ name: s.name, status: s.status, statusText: s.statusText })) } : { systems: 0, accepted: 0, text: 'No impacted systems in its design' },
      testAnalysis: tests ?? { criteria: 0, ready: 0, cases: 0, text: quality() ? 'No test analysis yet' : 'The Test section is not running here' },
      signOff: {
        checks: readiness?.checks ?? [], passed: readiness?.passed ?? 0, total: readiness?.total ?? 0,
        ready: Boolean(readiness && readiness.passed === readiness.total),
        text: !readiness?.total ? 'No Engineering checks for this item' : readiness.passed === readiness.total ? 'Ready for the Engineering sign-off' : `${readiness.passed} of ${readiness.total} checks pass`,
        waitingOn: open ? await Promise.all((open.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => nameOf(r.id))) : [],
      },
      sample: arch?.sample === true,
      href: lifecycle(item.id),
      designHref: item.parentId ? `/design/stories/${encodeURIComponent(item.parentId)}` : null,
    };
  }

  async function engineering() {
    const live = Boolean(workflows());
    const [inEngineer, signoffs] = await Promise.all([items('engineer'), approvals('engineering-signoff')]);
    const rows = await Promise.all(inEngineer.filter((i) => i.status === 'active').map((i) => storyRow(i, signoffs)));
    return { json: { live, stories: rows.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })) } };
  }

  async function signOff({ params, body, req }) {
    const w = workflows();
    if (typeof w?.signOffEngineering !== 'function') throw Object.assign(new Error('The lifecycle engine is not running here, so nothing can be signed off.'), { status: 503 });
    const reason = typeof body?.override?.reason === 'string' ? body.override.reason.trim().slice(0, 500) : '';
    const result = await w.signOffEngineering({ itemId: params.id, ...(reason ? { override: { reason } } : {}), comment: typeof body?.comment === 'string' ? body.comment.slice(0, 500) : null, actor: person(req) });
    return { json: { outcome: result.outcome, text: result.text, item: { id: result.item?.id, stage: result.item?.stage }, handoff: result.handoff ? { id: result.handoff.id, workItems: result.handoff.workItems.length } : null } };
  }

  /** A recorded test run as the Test runs page lists it (the sample's shape, with what Phase 20 adds). */
  const recordedRow = (r) => (r.kind === 'environment' ? envRow(r) : {
    id: r.id, at: r.at, itemId: r.storyId ?? r.itemId, ref: `${r.repo}${r.sha ? ` @ ${String(r.sha).slice(0, 7)}` : ''}`, kind: r.kind ?? 'gates',
    suite: r.gates.map((g) => g.name).join(' · '), environment: r.environment, status: r.status,
    passed: r.gates.filter((g) => g.status === 'passed').length, failed: r.gates.filter((g) => !['passed', 'skipped'].includes(g.status)).length, skipped: r.gates.filter((g) => g.status === 'skipped').length,
    durationS: null, failures: r.failures, cases: r.cases, requirements: r.requirements, defects: r.defects ?? [], text: r.text, runId: r.runId, storyId: r.storyId,
    href: r.runId ? `/factory/runs/${encodeURIComponent(r.runId)}` : null, recorded: true,
  });
  /** Phase 21: a run of an environment's suites. */
  const envRow = (r) => {
    const ran = (r.suites ?? []).filter((x) => !x.skipped);
    return {
      id: r.id, at: r.at, itemId: r.storyIds?.[0] ?? null, ref: r.prId ? `${r.prId} · preview` : (r.storyIds ?? []).join(', '), kind: 'environment',
      suite: ran.map((x) => x.label ?? x.suite).join(' · '), environment: r.environment, status: r.status,
      passed: ran.reduce((n, x) => n + x.passed, 0), failed: ran.reduce((n, x) => n + (x.total - x.passed), 0), skipped: (r.suites ?? []).length - ran.length,
      durationS: null, failures: ran.flatMap((x) => (x.failing ?? []).map((f) => `${x.label ?? x.suite}: ${f.name}${f.criterionRef ? ` (${f.criterionRef})` : ''}`)),
      cases: [], requirements: [], defects: r.defects ?? [], text: r.text, storyId: r.storyIds?.[0] ?? null, recorded: true,
    };
  };

  async function runs() {
    const { runs: sample } = await readSamples(home);
    const recorded = ((await quality()?.testRuns?.({}).catch(() => [])) ?? []).map(recordedRow);
    const list = [...recorded, ...sample.map((r) => ({ ...r, sample: true }))];
    const failed = list.filter((r) => r.status === 'failed').length;
    return { json: { sample: sample.length ? SAMPLE : null, recorded: recorded.length, runs: list, text: list.length ? `${plural(list.length, 'run')} · ${failed} failed · ${list.filter((r) => r.status === 'running').length} running` : 'No test runs yet' } };
  }

  async function coverage() {
    const samples = await readSamples(home);
    const items = (await quality()?.coverage?.().catch(() => [])) ?? [];
    const stories = ((await quality()?.stories?.().catch(() => [])) ?? []).map((s) => ({ id: s.id, itemId: s.parentId, title: s.title, ...s.summary, href: `/factory/quality/test-analysis/${encodeURIComponent(s.id)}` }));
    const byItem = new Map();
    for (const r of samples.runs.filter((x) => x.itemId)) {
      const row = byItem.get(r.itemId) ?? { itemId: r.itemId, ref: r.ref, runs: 0, last: null, openDefects: 0 };
      row.runs += 1;
      row.last ??= { id: r.id, status: r.status, suite: r.suite };
      byItem.set(r.itemId, row);
    }
    for (const d of samples.defects) if (byItem.has(d.itemId) && d.status === 'open') byItem.get(d.itemId).openDefects += 1;
    return { json: { sample: SAMPLE, items, stories, pullRequests: [...byItem.values()] } };
  }

  async function defects() {
    const { defects: sample } = await readSamples(home);
    const recorded = ((await quality()?.defects?.({}).catch(() => [])) ?? []).map((d) => ({ ...d, status: d.state, itemId: d.storyId, recorded: true }));
    const list = [...recorded, ...sample.map((d) => ({ ...d, sample: true }))];
    const open = list.filter((d) => d.status === 'open');
    return { json: { sample: sample.length ? SAMPLE : null, recorded: recorded.length, defects: list, text: list.length ? `${plural(list.length, 'defect')} · ${open.length} open` : 'No defects recorded' } };
  }

  return [
    ['GET', '/api/engineering', engineering],
    ['GET', '/api/engineering/architecture/:id', async ({ params }) => ({ json: await architecture.view(params.id) })],
    ['POST', '/api/engineering/architecture/:id/systems/:name/draft', async ({ params, req }) => ({ json: await architecture.draft(params.id, params.name, person(req)) })],
    ['PUT', '/api/engineering/architecture/:id/systems/:name', async ({ params, body, req }) => ({ json: await architecture.edit(params.id, params.name, body, person(req)) })],
    ['POST', '/api/engineering/architecture/:id/systems/:name/accept', async ({ params, req }) => ({ json: await architecture.accept(params.id, params.name, person(req)) })],
    ['POST', '/api/engineering/:id/sign-off', signOff],
    ['GET', '/api/test/runs', runs],
    ['GET', '/api/test/coverage', coverage],
    ['GET', '/api/test/defects', defects],
    // Phase 20: a defect raised from a failing test run, and a decision on one (the Test section's, which the lifecycle checks).
    ['POST', '/api/test/runs/:id/defects', async ({ params, body, req }) => ({ status: 201, json: await testSection().raiseDefect({ testRunId: params.id, ...(body ?? {}), actor: person(req) }) })],
    ['POST', '/api/test/defects/:id/decision', async ({ params, body, req }) => ({ json: await testSection().decideDefect({ defectId: params.id, ...(body ?? {}), actor: person(req) }) })],
  ];
}

/** The permission each write of these routes needs (the Factory's PERMISSIONS table). */
export const ENGINEERING_PERMISSIONS = {
  'POST /api/engineering/architecture/:id/systems/:name/draft': 'draft',
  'PUT /api/engineering/architecture/:id/systems/:name': 'draft',
  'POST /api/engineering/architecture/:id/systems/:name/accept': 'accept-decisions',
  'POST /api/engineering/:id/sign-off': 'draft',
  'POST /api/test/runs/:id/defects': 'draft',
  'POST /api/test/defects/:id/decision': 'draft',
};
