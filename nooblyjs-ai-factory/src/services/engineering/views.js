// @ts-check
// The Engineering and Test pages' data, as rows of the Factory's route table (CHG-008; Phase 16d).
// Engineering is real since Phase 16d: each story's application architecture (architecture.js: draft from the code,
// edit, accept), its test analysis (the Test section, host.service('quality')) and its Engineering sign-off (the
// lifecycle engine's readiness checks, and the sign-off itself). Pull requests and Test approvals are
// src/services/pull-requests/views.js since Phase 16e; the test runs, coverage and defects are the seed story's sample
// (samples.js) until Phase 20.
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
      designHref: item.parentId ? `/factory/design/stories/${encodeURIComponent(item.parentId)}` : null,
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

  async function runs() {
    const { runs: list } = await readSamples(home);
    const failed = list.filter((r) => r.status === 'failed').length;
    return { json: { sample: SAMPLE, runs: list, text: list.length ? `${plural(list.length, 'run')} · ${failed} failed · ${list.filter((r) => r.status === 'running').length} running` : 'No test runs yet' } };
  }

  async function coverage() {
    const samples = await readSamples(home);
    const stories = ((await quality()?.stories?.().catch(() => [])) ?? []).map((s) => ({ id: s.id, itemId: s.parentId, title: s.title, ...s.summary, href: `/factory/quality/test-analysis/${encodeURIComponent(s.id)}` }));
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
    ['GET', '/api/engineering/architecture/:id', async ({ params }) => ({ json: await architecture.view(params.id) })],
    ['POST', '/api/engineering/architecture/:id/systems/:name/draft', async ({ params, req }) => ({ json: await architecture.draft(params.id, params.name, person(req)) })],
    ['PUT', '/api/engineering/architecture/:id/systems/:name', async ({ params, body, req }) => ({ json: await architecture.edit(params.id, params.name, body, person(req)) })],
    ['POST', '/api/engineering/architecture/:id/systems/:name/accept', async ({ params, req }) => ({ json: await architecture.accept(params.id, params.name, person(req)) })],
    ['POST', '/api/engineering/:id/sign-off', signOff],
    ['GET', '/api/test/runs', runs],
    ['GET', '/api/test/coverage', coverage],
    ['GET', '/api/test/defects', defects],
  ];
}

/** The permission each write of these routes needs (the Factory's PERMISSIONS table). */
export const ENGINEERING_PERMISSIONS = {
  'POST /api/engineering/architecture/:id/systems/:name/draft': 'draft',
  'PUT /api/engineering/architecture/:id/systems/:name': 'draft',
  'POST /api/engineering/architecture/:id/systems/:name/accept': 'accept-decisions',
  'POST /api/engineering/:id/sign-off': 'draft',
};
