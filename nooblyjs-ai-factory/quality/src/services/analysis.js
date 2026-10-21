// Phase 16d: TEST ANALYSIS, the Test section's first part (root product.md §3.2b). For each story in Engineer, a test
// agent drafts the test cases from its acceptance criteria, interfaces, journey and NFRs under the test policy; a test
// analyst edits, adds and removes them and marks each ready. Before the Engineering sign-off every criterion needs a
// ready test case and every interface a ready integration test (readinessFacts()); a work item carries the cases that
// run against its system (casesFor()).
//
// One file per story, data/factory/quality/test-analysis/<storyId>.md. The story is the Design section's; its stage the
// lifecycle engine's. Case ids are TC-<item number>-<story number>-<n>, never given out twice.
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { draftAnalysis } from './drafts.js';

const STORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEVELS = new Set(['unit', 'contract', 'integration', 'e2e', 'performance', 'manual']);
const USUAL = { id: 'ada-quill', name: 'Ada Quill' };
const WORK_TYPE = 'test-analysis';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s, n = 80) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
/** STORY-031-1 → TC-031-1-<n>. */
const caseId = (storyId, n) => `TC-${String(storyId).replace(/^STORY-/, '')}-${n}`;

function text(value, max, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`, { [field]: 'text' });
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw badRequest(`Keep ${field} under ${max} characters.`, { [field]: `max ${max}` });
  return t;
}

export function createAnalysis({ host, log }) {
  const store = host.store;
  const file = (id) => ['test-analysis', `${id}.md`];
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'factory', section: 'quality', ...payload }, { actor: actor?.id ?? null });
  const by = (actor) => ({ id: actor.id, name: actor.name ?? actor.id });

  async function get(storyId) {
    if (!STORY.test(storyId ?? '')) return null;
    const doc = await store.readDoc(file(storyId)).catch(() => null);
    return doc?.data?.storyId ? { ...doc.data, cases: doc.data.cases ?? [], criteria: doc.data.criteria ?? [] } : null;
  }
  async function save(doc) {
    const body = doc.cases.map((c) => `- ${c.id} (${c.level}, ${c.status}): ${c.title}`).join('\n');
    await store.writeDoc(file(doc.storyId), doc, `\n# Test analysis of ${doc.storyId}\n\n${body}\n`);
    return doc;
  }

  /** The story, as Design wrote it, and where it is. */
  async function storyOf(storyId) {
    const item = await host.service?.('workflows')?.item?.({ itemId: storyId });
    if (!item || item.type !== 'story') throw notFound(`There is no story ${storyId}.`);
    const design = item.parentId ? await host.service?.('design')?.designFor?.(item.parentId) : null;
    const story = design?.stories?.find((s) => s.id === storyId) ?? null;
    return {
      item, design, story,
      title: story?.title ?? item.title,
      criteria: story?.criteria ?? [],
      systems: story?.systems ?? [],
      interfaces: (design?.interfaces ?? []).filter((i) => (story?.interfaces ?? []).includes(i.id)),
      nfrs: (design?.nfrs ?? []).filter((n) => (story?.nfrs ?? []).includes(n.id)),
      featureTitle: design?.features?.find((f) => f.id === story?.feature)?.title ?? item.feature?.title ?? null,
    };
  }

  /** Coverage in words, and what the sign-off still needs. */
  function summary(doc, ctx) {
    const criteria = ctx?.criteria?.length ? ctx.criteria : doc?.criteria?.map((c) => c.text) ?? [];
    const cases = doc?.cases ?? [];
    const readyFor = (i) => cases.some((c) => c.criterion === i && c.status === 'ready');
    const ready = criteria.filter((_, i) => readyFor(i)).length;
    const interfaces = (ctx?.interfaces ?? []).map((i) => i.id);
    const tested = interfaces.filter((id) => cases.some((c) => c.interface === id && c.status === 'ready' && ['contract', 'integration'].includes(c.level)));
    return {
      criteria: criteria.length, ready, cases: cases.length, automated: cases.filter((c) => c.automate).length,
      readyCases: cases.filter((c) => c.status === 'ready').length,
      text: `${ready} of ${plural(criteria.length, 'criterion', 'criteria')} ${ready === 1 ? 'has' : 'have'} a ready test case`,
      untestedInterfaces: interfaces.filter((id) => !tested.includes(id)),
      notReady: criteria.map((t, i) => ({ t, i })).filter(({ i }) => !readyFor(i)).map(({ t }) => t),
    };
  }

  async function view(storyId) {
    const ctx = await storyOf(storyId);
    const doc = await get(storyId);
    const s = summary(doc, ctx);
    return {
      storyId, itemId: ctx.item.parentId ?? null, title: ctx.title, stage: ctx.item.stage,
      writable: ctx.item.status === 'active' && ctx.item.stage === 'engineer',
      drafted: Boolean(doc), sample: doc?.sampleData === true,
      criteria: ctx.criteria.map((t, i) => ({ text: t, cases: (doc?.cases ?? []).filter((c) => c.criterion === i).map((c) => c.id), ready: (doc?.cases ?? []).some((c) => c.criterion === i && c.status === 'ready') })),
      interfaces: ctx.interfaces.map((i) => ({ id: i.id, name: i.name, cases: (doc?.cases ?? []).filter((c) => c.interface === i.id).map((c) => c.id), tested: !s.untestedInterfaces.includes(i.id) })),
      cases: doc?.cases ?? [],
      summary: s,
      draftedBy: doc?.draftedBy ?? null, draftedAt: doc?.draftedAt ?? null,
      href: `/home/lifecycle/${encodeURIComponent(storyId)}`,
      designHref: ctx.item.parentId ? `/factory/design/stories/${encodeURIComponent(ctx.item.parentId)}` : null,
    };
  }

  /** The stories in Engineer, each with its coverage in words. */
  async function stories() {
    const list = (await host.service?.('workflows')?.items?.({ stage: 'engineer' }).catch(() => [])) ?? [];
    const out = [];
    for (const item of list.filter((i) => i.type === 'story' && i.status === 'active')) {
      const ctx = await storyOf(item.id).catch(() => null);
      const doc = await get(item.id);
      out.push({ id: item.id, ref: item.ref ?? item.id, title: ctx?.title ?? item.title, parentId: item.parentId ?? null, drafted: Boolean(doc), summary: summary(doc, ctx) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }

  async function writable(storyId) {
    const ctx = await storyOf(storyId);
    if (ctx.item.status !== 'active' || ctx.item.stage !== 'engineer') throw conflict('wrong_stage', `${storyId} is ${ctx.item.status !== 'active' ? ctx.item.status : `in ${ctx.item.stage}`}: its test analysis is worked out in Engineer.`);
    return ctx;
  }
  async function peopleOnly(actor, what) {
    if (actor?.kind !== 'agent') return;
    await host.audit.record({ actor: actor.id, action: 'access.refused', target: what, reason: `agents propose, people decide: an agent can't ${what}` });
    throw new HttpError(403, 'people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${what}.`);
  }
  const policy = async () => (await store.readYaml(['test-policy.yaml']).catch(() => null)) ?? {};

  /** The test agent's teammate: Ada Quill when hired, else the only hired one; the usual name without Teammates. */
  async function drafter() {
    const t = host.service?.('teammates');
    if (typeof t?.roster !== 'function') return { teammate: { ...USUAL, kind: 'agent' }, standalone: true };
    const roster = (await t.roster().catch(() => [])) ?? [];
    const pick = roster.find((a) => a.id === USUAL.id) ?? (roster.length === 1 ? roster[0] : null);
    if (!pick) throw new HttpError(409, 'no_teammate', `${USUAL.name} drafts test analysis and isn't hired here. Hire them in Teammates, or write the cases yourself.`);
    return { teammate: { id: pick.id, name: pick.name ?? pick.id, kind: 'agent' }, standalone: false };
  }

  /** The test agent drafts the cases a story is missing; a person's cases and their state are kept. */
  async function draft(storyId, actor) {
    const ctx = await writable(storyId);
    if (!ctx.criteria.length) throw conflict('no_criteria', `${storyId} has no acceptance criteria in its design, so there is nothing to test yet.`);
    const scripted = draftAnalysis({ story: { title: ctx.title, criteria: ctx.criteria, systems: ctx.systems, featureTitle: ctx.featureTitle }, interfaces: ctx.interfaces, nfrs: ctx.nfrs, policy: await policy() });
    const { teammate, standalone } = await drafter();
    let output = scripted;
    let costUsd = 0;
    let modelRoute = 'mock';
    if (!standalone) {
      const task = await host.service('teammates').runTask({
        slug: teammate.id, workType: WORK_TYPE, itemId: storyId, system: 'factory',
        caller: actor?.id ? { type: 'user', id: actor.id, name: actor.name ?? actor.id } : null,
        input: { task: `Write the test analysis of ${storyId} (${ctx.title}): test cases from its acceptance criteria (given/when/then), a contract test per interface, an E2E test for its journey, and what a person checks by hand. Answer as JSON { "cases" }.`, context: JSON.stringify({ criteria: ctx.criteria, interfaces: ctx.interfaces, nfrs: ctx.nfrs }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      if (!task.scripted) {
        try {
          const parsed = typeof task.output === 'object' ? task.output : JSON.parse(String(task.output).replace(/^[\s\S]*?```(?:json)?\s*|```[\s\S]*$/g, ''));
          if (Array.isArray(parsed?.cases)) output = parsed;
        } catch { log?.warn?.(`quality: ${teammate.name}'s analysis of ${storyId} wasn't JSON; the scripted one is used`); }
      }
      costUsd = Number(task.costUsd) || 0;
      modelRoute = task.modelRoute ?? WORK_TYPE;
    } else if (process.env.NODE_ENV === 'production') {
      throw new HttpError(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
    }
    const doc = (await get(storyId)) ?? { storyId, itemId: ctx.item.parentId ?? null, title: ctx.title, counter: 0, cases: [] };
    const same = (a, b) => (a.criterion !== undefined && a.criterion === b.criterion && a.level === b.level) || (a.interface && a.interface === b.interface) || (a.journey && a.journey === b.journey) || (a.nfr && a.nfr === b.nfr);
    for (const c of output.cases ?? []) {
      if (!c?.title || doc.cases.some((x) => same(x, c))) continue;
      doc.counter = (doc.counter ?? 0) + 1;
      doc.cases.push({ id: caseId(storyId, doc.counter), ...c, level: LEVELS.has(c.level) ? c.level : 'integration', automate: c.automate !== false, status: 'draft', draftedBy: teammate });
    }
    doc.criteria = ctx.criteria.map((t, i) => ({ text: t, cases: doc.cases.filter((c) => c.criterion === i).map((c) => c.id) }));
    Object.assign(doc, { title: ctx.title, draftedBy: teammate, draftedAt: now() });
    delete doc.sampleData;
    await save(doc);
    await emit('quality.analysis_drafted', { itemId: storyId, storyId, cases: doc.cases.length, teammateId: teammate.id, summary: `${teammate.name} drafted the test analysis of ${storyId}: ${plural(doc.cases.length, 'test case')}` }, teammate);
    await emit('agent.action', { actor: teammate.id, teammateId: teammate.id, itemId: storyId, system: 'factory', modelRoute, costUsd, at: now(), action: 'quality.test-analysis' }, teammate);
    return view(storyId);
  }

  function caseFields(body, { partial }) {
    const out = {};
    for (const [key, max] of [['title', 200], ['given', 400], ['when', 400], ['then', 400]]) {
      if (!partial || key in body) out[key] = text(body[key], max, key) ?? '';
    }
    if (!partial && !out.title) throw badRequest('A test case needs a title.', { title: 'required' });
    if (partial && 'title' in out && !out.title) throw badRequest('A test case needs a title.', { title: 'required' });
    if (!partial || 'level' in body) {
      out.level = body.level ?? 'integration';
      if (!LEVELS.has(out.level)) throw badRequest(`A test case's level is one of ${[...LEVELS].join(', ')}.`, { level: [...LEVELS].join(' | ') });
    }
    if ('automate' in body) out.automate = body.automate === true;
    else if (!partial) out.automate = out.level !== 'manual';
    if ('criterion' in body) out.criterion = Number.isInteger(body.criterion) ? body.criterion : undefined;
    if ('systems' in body) out.systems = Array.isArray(body.systems) ? body.systems.map(String).slice(0, 10) : [];
    return out;
  }

  async function change(storyId, fn) {
    await writable(storyId);
    const doc = await get(storyId);
    if (!doc) throw notFound(`${storyId} has no test analysis yet: ask for a draft first.`);
    const result = fn(doc);
    doc.criteria = (doc.criteria ?? []).map((c, i) => ({ ...c, cases: doc.cases.filter((x) => x.criterion === i).map((x) => x.id) }));
    await save(doc);
    return result;
  }

  async function addCase(storyId, body, actor) {
    const fields = caseFields(body ?? {}, { partial: false });
    // A case added with no systems runs against the story's (a work item carries the cases of its own system).
    if (!fields.systems?.length) fields.systems = (await storyOf(storyId)).systems;
    const id = await change(storyId, (doc) => {
      doc.counter = (doc.counter ?? doc.cases.length) + 1;
      const c = { id: caseId(storyId, doc.counter), ...fields, status: 'draft', editedBy: by(actor) };
      doc.cases.push(c);
      return c.id;
    });
    await emit('quality.case_changed', { itemId: storyId, storyId, caseId: id, change: 'added', summary: `added the test case ${id} to ${storyId}` }, actor);
    return { ...(await view(storyId)), caseId: id };
  }

  async function editCase(storyId, id, body, actor) {
    const fields = caseFields(body ?? {}, { partial: true });
    await change(storyId, (doc) => {
      const c = doc.cases.find((x) => x.id === id);
      if (!c) throw notFound(`${storyId} has no test case ${id}.`);
      Object.assign(c, fields, { status: 'draft', editedBy: by(actor) });
      delete c.readyBy;
      delete c.readyAt;
    });
    await emit('quality.case_changed', { itemId: storyId, storyId, caseId: id, change: 'edited', summary: `edited the test case ${id} of ${storyId}: it is a draft again` }, actor);
    return view(storyId);
  }

  async function removeCase(storyId, id, actor) {
    await change(storyId, (doc) => {
      if (!doc.cases.some((x) => x.id === id)) throw notFound(`${storyId} has no test case ${id}.`);
      doc.cases = doc.cases.filter((x) => x.id !== id);
    });
    await emit('quality.case_changed', { itemId: storyId, storyId, caseId: id, change: 'removed', summary: `removed the test case ${id} from ${storyId}` }, actor);
    return view(storyId);
  }

  /** A test analyst marks a case ready (people only). */
  async function markReady(storyId, id, actor) {
    await peopleOnly(actor, 'mark a test case ready');
    await change(storyId, (doc) => {
      const c = doc.cases.find((x) => x.id === id);
      if (!c) throw notFound(`${storyId} has no test case ${id}.`);
      Object.assign(c, { status: 'ready', readyBy: by(actor), readyAt: now() });
    });
    await emit('quality.case_ready', { itemId: storyId, storyId, caseId: id, summary: `marked the test case ${id} of ${storyId} ready` }, actor);
    return view(storyId);
  }

  /** The sign-off's test checks for a story: every criterion with a ready case, every interface with a ready test. */
  async function readinessFacts(storyId) {
    const ctx = await storyOf(storyId).catch(() => null);
    if (!ctx) return null;
    const doc = await get(storyId);
    if (!doc) {
      return { storyId, facts: { 'criteria-ready': { value: false, detail: 'there is no test analysis yet' }, 'interfaces-tested': { value: !ctx.interfaces.length, ...(ctx.interfaces.length ? { detail: 'there is no test analysis yet' } : {}) } } };
    }
    const s = summary(doc, ctx);
    return {
      storyId,
      facts: {
        'criteria-ready': s.criteria
          ? { value: !s.notReady.length, ...(s.notReady.length ? { detail: s.notReady.map((t) => `"${clip(t)}" has no ready test case`).join('; ') } : {}) }
          : { value: false, detail: 'the story has no acceptance criteria' },
        'interfaces-tested': { value: !s.untestedInterfaces.length, ...(s.untestedInterfaces.length ? { detail: `${s.untestedInterfaces.join(', ')} ${s.untestedInterfaces.length === 1 ? 'has' : 'have'} no ready integration test` } : {}) },
      },
    };
  }

  /** The cases a work item on one repository carries: those that run against its system. */
  async function casesFor(storyId, repo) {
    const doc = await get(storyId).catch(() => null);
    const short = String(repo ?? '').split('/').pop();
    return (doc?.cases ?? []).filter((c) => !c.systems?.length || c.systems.includes(short));
  }

  return { view, stories, draft, addCase, editCase, removeCase, markReady, readinessFacts, casesFor, policy, summaryOf: async (id) => summary(await get(id), await storyOf(id).catch(() => null)) };
}
