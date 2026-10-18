// Stage 3 · UX design (docs/roadmap-history.md P5, product.md §5.4): the journey (steps × Doing / Feeling / Pain / Opportunity),
// flows (screens and decisions), research studies and open questions with "Run a quick test". Files:
// data/product/ux/<PRD>/journey.md, flows/<flow>.md, research/<study>.md, questions.md. The structured parts live
// in front matter so people can read and edit them in the file; each change is a new version (If-Match).
import { validator, invalid } from '../util/validate.js';
import { checkIfMatch, etagOf, isAgent } from '../util/http.js';
import { isId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';

/** The UX stage's default drafting agent (product.md §2 names none) `[CONFIRM name, from nooblyjs-ai-teammate]`. */
export const DESIGN_AGENT = { id: 'design-agent', name: 'Design agent', kind: 'agent' };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ROWS = ['doing', 'feeling', 'pain', 'opportunity'];
const STUDY_KINDS = ['usability', 'preference', 'interview', 'quick-test', 'survey'];
const ref = (actor) => (isAgent(actor) ? { id: actor.id, name: actor.name, kind: 'agent' } : { id: actor.id, kind: 'person' });
const short = (v, max = 300) => typeof v === 'string' && v.length <= max;
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';

// ---------- field checks ----------

const step = (s) => {
  if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) return invalid('a step needs a name');
  for (const row of ROWS) if (s[row] != null && !short(s[row])) return invalid(`${row} must be short text`);
  if (s.outOfScope != null && !(typeof s.outOfScope === 'string' && isId(s.outOfScope))) return invalid('outOfScope names another item, e.g. PRD-033');
  return { name: s.name.trim(), ...Object.fromEntries(ROWS.map((r) => [r, s[r]?.trim() || null])), outOfScope: s.outOfScope ?? null };
};
const flowNode = (n) => (n && typeof n === 'object' && SLUG.test(n.id ?? '') && ['screen', 'decision'].includes(n.kind) && typeof n.label === 'string' && n.label.trim() && n.label.length <= 80
  ? { id: n.id, kind: n.kind, label: n.label.trim() }
  : invalid('a flow node needs an id (a-z, 0-9, -), kind screen or decision, and a label'));
const flowEdge = (e) => (e && typeof e === 'object' && SLUG.test(e.from ?? '') && SLUG.test(e.to ?? '') && (e.label == null || short(e.label, 40))
  ? { from: e.from, to: e.to, label: e.label?.trim() || null }
  : invalid('an edge needs from and to (node ids) and an optional short label'));
const study = (s) => {
  if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 120) return invalid('a study needs a title');
  if (!STUDY_KINDS.includes(s.kind)) return invalid(`kind must be one of ${STUDY_KINDS.join(', ')}`);
  if (s.participants != null && !(Number.isInteger(s.participants) && s.participants >= 0 && s.participants < 100000)) return invalid('participants must be a whole number');
  if (s.headline != null && !short(s.headline, 80)) return invalid('headline must be short text');
  if (s.finding != null && !short(s.finding, 2000)) return invalid('finding must be text');
  return {
    id: SLUG.test(s.id ?? '') ? s.id : slugify(s.title),
    kind: s.kind, title: s.title.trim(), participants: s.participants ?? null,
    headline: s.headline?.trim() || null, finding: s.finding?.trim() || null,
  };
};
const question = (q) => {
  if (!q || typeof q !== 'object' || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 300) return invalid('a question needs text');
  if (q.status != null && !['open', 'answered'].includes(q.status)) return invalid('status is open or answered');
  return { id: SLUG.test(q.id ?? '') ? q.id : slugify(q.text), text: q.text.trim(), status: q.status ?? 'open', answer: typeof q.answer === 'string' ? q.answer.trim().slice(0, 1000) : null };
};

export function createUxService({ repos, host }) {
  const A = repos.artefacts;
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });
  const paths = {
    journey: (id) => ['ux', id, 'journey.md'],
    flows: (id) => ['ux', id, 'flows'],
    flow: (id, flow) => ['ux', id, 'flows', `${flow}.md`],
    research: (id) => ['ux', id, 'research'],
    study: (id, s) => ['ux', id, 'research', `${s}.md`],
    questions: (id) => ['ux', id, 'questions.md'],
  };

  async function specOr404(itemId) {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  }

  /** Saves one document as a new version: If-Match on its ETag, who changed it, and a ux.updated event. */
  async function save(segments, etagId, ifMatch, actor, build, { part, itemId }) {
    let version;
    await A.update(segments, (current) => {
      version = current?.version ?? 0;
      checkIfMatch(ifMatch, { id: etagId, version });
      version += 1;
      return { ...(current ?? {}), ...build(current), version, updatedAt: now(), [isAgent(actor) ? 'draftedBy' : 'editedBy']: ref(actor), versionBy: ref(actor) };
    });
    await emit('ux.updated', { itemId, part, version }, actor);
    return version;
  }

  // ---------- journey ----------

  async function journey(itemId) {
    await specOr404(itemId);
    const doc = await A.get(paths.journey(itemId));
    const steps = (doc?.steps ?? []).map((s) => ({ ...s, opportunityText: s.outOfScope ? `Out of scope · ${s.outOfScope}` : s.opportunity ?? null }));
    return {
      id: `${itemId}.journey`, itemId, version: doc?.version ?? 0,
      persona: doc?.persona ?? null, basis: doc?.basis ?? null,
      title: doc?.persona ? `Journey · ${doc.persona}` : 'Journey',
      rows: ROWS.map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1) })),
      steps, notes: doc?.body?.trim() || null,
      statusText: doc?.version ? `v${doc.version}` : 'Awaiting your brief',
      updatedAt: doc?.updatedAt ?? null,
    };
  }

  async function saveJourney(itemId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    const f = validator(body).only(['persona', 'basis', 'steps', 'notes'])
      .string('persona', { max: 80 }).string('basis', { max: 200 }).list('steps', step, { max: 12 }).string('notes', { max: 5000 }).result();
    await save(paths.journey(itemId), `${itemId}.journey`, ifMatch, actor, (current) => ({
      itemId,
      persona: f.persona ?? current?.persona ?? null,
      basis: f.basis ?? current?.basis ?? null,
      steps: f.steps ?? current?.steps ?? [],
      body: f.notes ?? current?.body ?? '',
    }), { part: 'journey', itemId });
    return journey(itemId);
  }

  // ---------- flows ----------

  function flowView(itemId, doc) {
    const nodes = doc.nodes ?? [];
    const screens = nodes.filter((n) => n.kind === 'screen').length;
    const decisions = nodes.filter((n) => n.kind === 'decision').length;
    return {
      id: doc.id, etag: etagOf({ id: `${itemId}.flow.${doc.id}`, version: doc.version ?? 0 }), itemId, title: doc.title,
      version: doc.version ?? 0, nodes, edges: doc.edges ?? [],
      summary: `${screens} screen${screens === 1 ? '' : 's'} · ${decisions} decision${decisions === 1 ? '' : 's'}`,
      updatedAt: doc.updatedAt ?? null,
    };
  }

  async function flows(itemId) {
    await specOr404(itemId);
    return (await A.list(paths.flows(itemId))).filter((f) => SLUG.test(f.id ?? '')).map((f) => flowView(itemId, f));
  }

  async function flow(itemId, flowId) {
    await specOr404(itemId);
    if (!SLUG.test(flowId)) throw notFound(`There is no flow ${flowId}.`);
    const doc = await A.get(paths.flow(itemId, flowId));
    if (!doc) throw notFound(`${itemId} has no flow ${flowId}.`);
    return flowView(itemId, { ...doc, id: flowId });
  }

  async function saveFlow(itemId, flowId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    if (!SLUG.test(flowId)) throw new HttpError(422, 'invalid', 'A flow id is lower-case letters, digits and -.', { flow: 'invalid id' });
    const f = validator(body).only(['title', 'nodes', 'edges'])
      .string('title', { required: true, max: 120 }).list('nodes', flowNode, { max: 40 }).list('edges', flowEdge, { max: 80 }).result();
    const ids = new Set((f.nodes ?? []).map((n) => n.id));
    const loose = (f.edges ?? []).filter((e) => !ids.has(e.from) || !ids.has(e.to));
    if (loose.length) throw new HttpError(422, 'invalid', 'Some edges point at nodes that are not in the flow.', { edges: loose.map((e) => `${e.from} → ${e.to}`).join(', ') });
    await save(paths.flow(itemId, flowId), `${itemId}.flow.${flowId}`, ifMatch, actor, () => ({ id: flowId, itemId, title: f.title, nodes: f.nodes ?? [], edges: f.edges ?? [], body: '' }), { part: `flow:${flowId}`, itemId });
    return flow(itemId, flowId);
  }

  // ---------- research ----------

  async function research(itemId) {
    await specOr404(itemId);
    const studies = (await A.list(paths.research(itemId))).filter((s) => SLUG.test(s.id ?? ''));
    return {
      itemId,
      studies: studies.map((s) => ({ id: s.id, kind: s.kind, title: s.title, participants: s.participants ?? null, headline: s.headline ?? null, finding: s.finding ?? null, by: s.draftedBy ?? s.editedBy ?? null, updatedAt: s.updatedAt ?? null })),
    };
  }

  /** Replaces the item's studies (one file each): studies not in the list are removed. */
  async function saveResearch(itemId, body, actor) {
    await specOr404(itemId);
    const { studies } = validator(body).only(['studies']).list('studies', study, { max: 50 }).result();
    if (!studies) throw new HttpError(422, 'invalid', 'Send the full list as studies.', { studies: 'studies is required' });
    const keep = new Set(studies.map((s) => s.id));
    for (const existing of await A.list(paths.research(itemId))) if (!keep.has(existing.id)) await A.remove(paths.research(itemId).concat(existing.file));
    for (const s of studies) await addStudy(itemId, s, actor, { emitEvent: false });
    await emit('ux.updated', { itemId, part: 'research', studies: studies.length }, actor);
    return research(itemId);
  }

  async function addStudy(itemId, s, actor, { emitEvent = true } = {}) {
    await A.update(paths.study(itemId, s.id), (current) => ({ ...(current ?? {}), ...s, itemId, version: (current?.version ?? 0) + 1, updatedAt: now(), [isAgent(actor) ? 'draftedBy' : 'editedBy']: ref(actor), body: current?.body ?? '' }));
    if (emitEvent) await emit('ux.updated', { itemId, part: 'research', study: s.id }, actor);
    return s;
  }

  // ---------- open questions ----------

  async function questions(itemId) {
    await specOr404(itemId);
    const doc = await A.get(paths.questions(itemId));
    return { id: `${itemId}.questions`, itemId, version: doc?.version ?? 0, questions: doc?.questions ?? [] };
  }

  async function saveQuestions(itemId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    const { questions: list } = validator(body).only(['questions']).list('questions', question, { max: 50 }).result();
    if (!list) throw new HttpError(422, 'invalid', 'Send the full list as questions.', { questions: 'questions is required' });
    await save(paths.questions(itemId), `${itemId}.questions`, ifMatch, actor, (current) => ({
      itemId,
      // A quick test already run for a question stays linked to it.
      questions: list.map((q) => ({ ...q, quickTest: (current?.questions ?? []).find((c) => c.id === q.id)?.quickTest ?? null })),
      body: '',
    }), { part: 'questions', itemId });
    return questions(itemId);
  }

  /** Links a finished quick test to its question (the study it produced). */
  async function linkQuickTest(itemId, questionId, link) {
    await A.update(paths.questions(itemId), (current) => (current
      ? { ...current, questions: (current.questions ?? []).map((q) => (q.id === questionId ? { ...q, quickTest: link } : q)) }
      : null));
  }

  // ---------- the stage ----------

  async function items() {
    const specs = await repos.specs.list();
    const withWork = new Set(await A.folders(['ux']));
    const out = [];
    for (const spec of specs.filter((s) => withWork.has(s.id)).sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }))) {
      const [j, f, r, q] = await Promise.all([journey(spec.id), flows(spec.id), research(spec.id), questions(spec.id)]);
      const open = q.questions.filter((x) => x.status === 'open').length;
      out.push({
        itemId: spec.id, title: spec.title, product: spec.product ?? null,
        text: [j.version ? j.title : 'No journey yet', `${f.length} flow${f.length === 1 ? '' : 's'}`, `${r.studies.length} stud${r.studies.length === 1 ? 'y' : 'ies'}`, `${open} open question${open === 1 ? '' : 's'}`].join(' · '),
      });
    }
    return out;
  }

  return { journey, saveJourney, flows, flow, saveFlow, research, saveResearch, addStudy, questions, saveQuestions, linkQuickTest, items, paths };
}

/** The design agent's drafts: a journey, a flow, and a quick test for an open question (mock content is marked). */
export function uxKinds({ repos, ux }) {
  const P = (what) => `[PLACEHOLDER: ${what}]`;
  const stale = (itemId, err) => (err?.status === 409 && err.code === 'conflict'
    ? new HttpError(409, 'stale_draft', `${itemId}'s UX work changed while the agent was drafting, so the draft was not saved. Nothing you wrote was lost; ask again.`)
    : err);
  const specFor = async (itemId) => {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  };
  return {
    journey: {
      stage: 'ux', label: 'the journey', workType: 'ux-drafting', agent: DESIGN_AGENT, estimateUsd: 1.2, doneEvent: 'ux.journey_drafted',
      async check(itemId) {
        const spec = await specFor(itemId);
        return { baseVersion: (await ux.journey(itemId)).version, title: spec.title };
      },
      async mock(draft) {
        const current = await ux.journey(draft.itemId);
        const steps = current.steps.length
          ? current.steps.map((s) => ({ ...s, feeling: s.feeling ?? P('how they feel') }))
          : ['Before', 'Choose', 'Do', 'After'].map((name) => ({ name, doing: P('what they do'), feeling: P('how they feel'), pain: P('what gets in the way'), opportunity: P('what we could do') }));
        return { costUsd: 1.2, output: { persona: current.persona ?? (draft.brief ?? P('who')), steps } };
      },
      async apply(draft, output) {
        try {
          const j = await ux.saveJourney(draft.itemId, output, draft.teammate, { ifMatch: `"${draft.itemId}.journey@${draft.baseVersion}"` });
          return { version: j.version, text: 'Drafted the journey', ref: { itemId: draft.itemId } };
        } catch (err) {
          throw stale(draft.itemId, err);
        }
      },
    },
    flow: {
      stage: 'ux', label: 'a flow', workType: 'ux-drafting', agent: DESIGN_AGENT, estimateUsd: 0.9, doneEvent: 'ux.flow_drafted',
      async check(itemId, fields) {
        const spec = await specFor(itemId);
        if (!fields.brief?.trim()) throw new HttpError(422, 'invalid', 'Say which flow to draft.', { brief: 'brief is required: the flow to draft, e.g. "choose and hold a slot"' });
        return { baseVersion: 0, title: spec.title };
      },
      async mock(draft) {
        const title = draft.brief.trim();
        return {
          costUsd: 0.9,
          output: {
            id: slugify(title), title: title[0].toUpperCase() + title.slice(1),
            nodes: [{ id: 'start', kind: 'screen', label: P('first screen') }, { id: 'check', kind: 'decision', label: P('the question') }, { id: 'yes', kind: 'screen', label: P('happy path') }, { id: 'no', kind: 'screen', label: P('recovery') }],
            edges: [{ from: 'start', to: 'check' }, { from: 'check', to: 'yes', label: 'yes' }, { from: 'check', to: 'no', label: 'no' }],
          },
        };
      },
      async apply(draft, output) {
        const existing = (await ux.flows(draft.itemId)).find((f) => f.id === output.id);
        const { id, ...body } = output;
        try {
          const f = await ux.saveFlow(draft.itemId, id, body, draft.teammate, { ifMatch: `"${draft.itemId}.flow.${id}@${existing?.version ?? 0}"` });
          return { version: f.version, text: `Drafted the flow "${f.title}"`, ref: { flowId: id } };
        } catch (err) {
          throw stale(draft.itemId, err);
        }
      },
    },
    'quick-test': {
      stage: 'ux', label: 'a quick test', workType: 'ux-research', agent: DESIGN_AGENT, estimateUsd: 0.6, doneEvent: 'ux.quick_test_ran',
      async check(itemId, fields) {
        await specFor(itemId);
        const q = (await ux.questions(itemId)).questions.find((x) => x.id === fields.questionId);
        if (!q) throw new HttpError(422, 'invalid', 'Say which open question to test.', { questionId: 'questionId must name an open question' });
        if (q.status !== 'open') throw new HttpError(409, 'answered', 'That question is already answered.');
        return { baseVersion: null, title: q.text };
      },
      async mock(draft) {
        const q = (await ux.questions(draft.itemId)).questions.find((x) => x.id === draft.questionId);
        return { costUsd: 0.6, output: { id: `quick-test-${draft.questionId}`.slice(0, 63), kind: 'quick-test', title: `Quick test: ${q.text}`, participants: null, headline: P('result'), finding: P('what the quick test found, from unmoderated sessions') } };
      },
      async apply(draft, output) {
        const s = await ux.addStudy(draft.itemId, output, draft.teammate);
        await ux.linkQuickTest(draft.itemId, draft.questionId, { draftId: draft.id, studyId: s.id });
        return { version: null, text: `Ran a quick test: ${s.title}`, ref: { studyId: s.id, questionId: draft.questionId } };
      },
    },
  };
}
