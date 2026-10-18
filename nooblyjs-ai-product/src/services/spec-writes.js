// Stage 1 writes for specs (docs/roadmap-history.md P2): create, edit (every save a new version, If-Match), link knowledge,
// and pass a person's decision to the NooblyJS lifecycle engine. The engine never approves or moves a stage itself: it records
// the outcome when workflows says so (approval.decided).
import { validator, text, invalid } from '../util/validate.js';
import { checkIfMatch, isAgent } from '../util/http.js';
import { nextNumbered } from '../util/ids.js';
import { HttpError, conflict, notFound } from '../util/errors.js';
import { parseSpec, renderSpec } from './spec-format.js';
import { readinessFacts, readinessFromFacts } from './readiness.js';

/** The Product stage's default drafting agent (product.md §2) `[CONFIRM: from nooblyjs-ai-teammate once it shares its roster]`. */
export const PRODUCT_AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };
const PART_FIELDS = ['problem', 'goals', 'stories', 'acceptanceCriteria', 'outOfScope', 'rolloutPlan', 'sections'];
const KNOWN_HEADINGS = ['problem', 'goals', 'user stories', 'acceptance criteria', 'out of scope', 'rollout plan'];
const KNOWLEDGE_KINDS = ['runbook', 'adr', 'customer-insight', 'doc'];
const KNOWLEDGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DECISIONS = ['approve', 'request-changes'];

const goal = (g) => (g && typeof g === 'object' && ['measure', 'today', 'target'].every((k) => typeof g[k] === 'string' && g[k].length <= 200) && g.measure.trim()
  ? { measure: g.measure.trim(), today: g.today.trim(), target: g.target.trim() }
  : invalid('a goal needs measure, today and target (text)'));
const criterion = (c) => {
  if (c && typeof c === 'object' && ['given', 'when', 'then'].every((k) => typeof c[k] === 'string' && c[k].trim() && c[k].length <= 500)) {
    return { given: c.given.trim(), when: c.when.trim(), then: c.then.trim() };
  }
  if (c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim() && c.text.length <= 1000) return { text: c.text.trim() };
  return invalid('a criterion needs given, when and then (or text)');
};

/** Extra `## ` sections (Dependencies, Risks, …) beyond the ones the Spec screen lays out. */
const section = (s) => {
  if (!s || typeof s !== 'object' || typeof s.heading !== 'string' || !s.heading.trim() || s.heading.length > 80) return invalid('a section needs a heading (up to 80 characters)');
  if (KNOWN_HEADINGS.includes(s.heading.trim().toLowerCase())) return invalid(`"${s.heading}" has its own field`);
  if (typeof s.text !== 'string' || s.text.length > 10000) return invalid('a section needs text');
  return { heading: s.heading.trim(), text: s.text.trim() };
};

function specFields(body, { creating }) {
  return validator(body)
    .only(['title', 'product', 'portfolio', 'idea', 'changeNote', ...PART_FIELDS])
    .string('title', { required: creating, max: 120 })
    .string('product', { max: 40 })
    .string('portfolio', { max: 40 })
    .string('idea', { max: 20 })
    .string('changeNote', { max: 300 })
    .string('problem', { max: 10000 })
    .list('goals', goal, { max: 20 })
    .list('stories', text('a story', 1000), { max: 50 })
    .list('acceptanceCriteria', criterion, { max: 50 })
    .string('outOfScope', { max: 5000 })
    .string('rolloutPlan', { max: 10000 })
    .list('sections', section, { max: 20 })
    .result();
}

/** Puts the given fields into the spec's parts (`sections` are the extra headed sections). */
function applyParts(parts, fields) {
  for (const key of PART_FIELDS) {
    if (fields[key] === undefined) continue;
    if (key === 'sections') parts.other = fields.sections;
    else parts[key] = fields[key];
  }
}

/** A reference to whoever made a change: an agent carries its name; a person's comes from people. */
const actorRef = (actor) => (isAgent(actor) ? { id: actor.id, name: actor.name, kind: 'agent' } : { id: actor.id, kind: 'person' });

export function createSpecWriteService({ repos, host, log, flow, catalogue }) {
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });

  /** The readiness to store for these parts: the facts from the content, plus what was recorded. */
  const readinessFor = (parts, spec, at) => readinessFromFacts(readinessFacts(parts, spec), at);

  async function create(body, actor) {
    const fields = specFields(body, { creating: true });
    if (fields.idea) {
      if (!(await repos.ideas.get(fields.idea))) throw notFound(`There is no idea ${fields.idea}.`);
      const taken = (await repos.specs.list()).find((s) => s.idea === fields.idea);
      if (taken) throw conflict(`${fields.idea} already has a spec, ${taken.id}.`, { spec: taken.id });
    }
    const parts = { problem: '', goals: [], stories: [], acceptanceCriteria: [], outOfScope: '', rolloutPlan: '', other: [] };
    applyParts(parts, fields);
    const specBody = renderSpec(parts);
    const hasContent = Boolean(specBody.trim());
    // A spec sits in the product it is given, else in its idea's.
    const idea = fields.idea ? await repos.ideas.get(fields.idea) : null;
    const product = (await catalogue.productFor(fields, actor)) ?? idea?.product ?? null;
    // Where it will be built: its idea's when it has one (people may have changed it there), else its product's.
    const defaults = await catalogue.defaultsFor(product);
    const repositories = idea?.repositories?.length ? idea.repositories : defaults.repositories;
    const jiraProject = idea?.jiraProject ?? defaults.jiraProject;

    return repos.specs.withFolderLock(async () => {
      const id = nextNumbered('PRD', (await repos.specs.list()).map((s) => s.id));
      const at = now();
      const by = actorRef(actor);
      const record = {
        id,
        title: fields.title,
        product,
        repositories,
        jiraProject,
        // Nothing written yet: the spec waits for a person's brief to the agent (D3).
        status: hasContent ? 'drafting' : 'awaiting-brief',
        version: hasContent ? 1 : 0,
        owner: isAgent(actor) ? null : actor.id,
        idea: fields.idea ?? null,
        signals: [],
        agent: PRODUCT_AGENT,
        draftedBy: hasContent && isAgent(actor) ? by : null,
        editedBy: hasContent && !isAgent(actor) ? by : null,
        versionBy: hasContent ? by : null,
        changeNote: fields.changeNote ?? null,
        createdAt: at,
        createdBy: actor.id,
        updatedAt: at,
        reviewers: [],
        knowledge: [],
        readiness: null,
        body: specBody,
      };
      if (hasContent) record.readiness = readinessFor(parts, record, at);
      await repos.specs.write(record);
      await emit('spec.created', { specId: id, title: record.title, idea: record.idea, version: record.version }, actor);
      // The Jira issues linked to its idea are linked to the spec too (NooblyJS keeps the links: devtools).
      if (record.idea) await host.service('devtools')?.links?.inherit?.(record.idea, id, actor).catch?.(() => null);
      return record;
    });
  }

  async function update(id, body, actor, { ifMatch } = {}) {
    const fields = specFields(body, { creating: false });
    if (fields.idea !== undefined) throw new HttpError(422, 'invalid', 'A spec keeps the idea it was created from.', { idea: "idea can't be changed" });
    // undefined: the body didn't mention the product. Naming a new one makes it (catalogue.js).
    const filed = await catalogue.productFor(fields, actor);
    let changed = false;
    const updated = await repos.specs.update(id, async (current) => {
      if (!current) throw notFound(`There is no spec ${id}.`);
      checkIfMatch(ifMatch, current);
      if (current.status === 'approved') {
        throw new HttpError(409, 'approved', `${id} v${current.version} is approved, so it can't be edited. Send it back to Product first.`);
      }
      const parts = parseSpec(current.body);
      applyParts(parts, fields);
      const specBody = renderSpec(parts);
      const title = fields.title ?? current.title;
      const product = filed === undefined ? current.product ?? null : filed;
      changed = specBody !== String(current.body ?? '').trim() || title !== current.title || product !== (current.product ?? null);
      if (!changed) return null; // nothing to save: no new version

      const at = now();
      const by = actorRef(actor);
      // The version being replaced is kept, with who made it.
      if (current.version > 0) {
        await repos.specs.keepVersion(id, {
          version: current.version,
          by: current.versionBy ?? current.editedBy ?? current.draftedBy,
          at: current.updatedAt,
          note: current.changeNote,
          body: current.body,
        });
      }
      return {
        ...current,
        title,
        product,
        status: current.status === 'awaiting-brief' && specBody.trim() ? 'drafting' : current.status,
        version: (current.version ?? 0) + 1,
        ...(isAgent(actor) ? { draftedBy: by } : { editedBy: by }),
        versionBy: by,
        changeNote: fields.changeNote ?? null,
        updatedAt: at,
        readiness: readinessFor(parts, current, at),
        body: specBody,
      };
    });
    if (!changed) {
      const current = await repos.specs.get(id);
      if (!current) throw notFound(`There is no spec ${id}.`);
      return { spec: current, changed: false };
    }
    await emit('spec.updated', { specId: id, version: updated.version, fields: Object.keys(fields), changeNote: updated.changeNote }, actor);
    return { spec: updated, changed: true };
  }

  async function setKnowledge(id, body, actor, { ifMatch } = {}) {
    const { knowledge } = validator(body)
      .only(['knowledge'])
      .list('knowledge', (k) => {
        if (!k || typeof k !== 'object' || !KNOWLEDGE_ID.test(k.id ?? '')) return invalid('a link needs an id (letters, digits, . _ -)');
        if (typeof k.title !== 'string' || !k.title.trim() || k.title.length > 200) return invalid('a link needs a title');
        if (!KNOWLEDGE_KINDS.includes(k.kind)) return invalid(`kind must be one of ${KNOWLEDGE_KINDS.join(', ')}`);
        if (k.detail !== undefined && (typeof k.detail !== 'string' || k.detail.length > 200)) return invalid('detail must be short text');
        return { id: k.id, title: k.title.trim(), kind: k.kind, ...(k.detail ? { detail: k.detail.trim() } : {}) };
      }, { max: 50 })
      .result();
    if (!knowledge) throw new HttpError(422, 'invalid', 'Send the full list of links as knowledge.', { knowledge: 'knowledge is required' });
    const updated = await repos.specs.update(id, async (current) => {
      if (!current) throw notFound(`There is no spec ${id}.`);
      // Optional here: linking knowledge doesn't change the spec's text, so it isn't a new version.
      checkIfMatch(ifMatch, current, { required: false });
      const next = { ...current, knowledge, updatedAt: now() };
      if (current.version > 0) next.readiness = readinessFor(parseSpec(current.body), next, next.updatedAt);
      return next;
    });
    if (!updated) throw notFound(`There is no spec ${id}.`);
    await emit('spec.updated', { specId: id, version: updated.version, change: 'knowledge', links: knowledge.length }, actor);
    return updated;
  }

  /**
   * Send for review: a person asks the NooblyJS lifecycle engine to open the spec's approval (and the lifecycle item, for a spec
   * drafted from a new idea). The reviewers are the lifecycle's choice; the spec shows them and is In review.
   */
  async function requestReview(id, actor) {
    const spec = await repos.specs.get(id);
    if (!spec) throw notFound(`There is no spec ${id}.`);
    if (!spec.version) throw new HttpError(409, 'nothing_to_review', `${id} has no draft yet. Brief the agent or write it first.`);
    if (!['drafting', 'changes-requested'].includes(spec.status)) {
      throw new HttpError(409, 'not_draft', `${id} is ${spec.status === 'in-review' ? 'already in review' : spec.status}, so it can't be sent for review.`);
    }
    const workflows = host.service('workflows');
    if (typeof workflows?.requestApproval !== 'function') {
      throw new HttpError(503, 'workflows_unavailable', 'The NooblyJS lifecycle engine is not running here, so a review can\'t be requested. Nothing was changed.');
    }
    let result;
    try {
      result = await workflows.requestApproval({ itemId: id, type: 'spec', title: spec.title, version: spec.version, actor: { id: actor.id, kind: 'person' } });
    } catch (err) {
      if (err.status >= 400 && err.status < 500) throw err; // workflows refused it: pass its answer on
      log.error(`workflows.requestApproval for ${id} failed: ${err.message}`);
      throw new HttpError(502, 'workflows_failed', 'The lifecycle service could not open the review. Nothing was changed; try again.');
    }
    const at = now();
    const reviewers = (result?.reviewers ?? []).map((r) => ({ id: r.id, role: r.role ?? null, status: 'waiting' }));
    const updated = await repos.specs.update(id, async (current) => (current ? { ...current, status: 'in-review', reviewers, updatedAt: at } : null));
    await emit('spec.updated', { specId: id, version: updated.version, change: 'review-requested', status: 'in-review' }, actor);
    return updated;
  }

  /** A person's decision, passed to the NooblyJS lifecycle engine, which records the approval and moves the stage. */
  async function decide(id, body, actor) {
    const fields = validator(body)
      .only(['decision', 'reason', 'override'])
      .oneOf('decision', DECISIONS, { required: true })
      .string('reason', { max: 2000, required: body?.decision === 'request-changes' })
      // Approve although readiness checks fail: the reason is recorded by the lifecycle engine (readiness.overridden).
      .string('override', { max: 2000 })
      .result();
    const spec = await repos.specs.get(id);
    if (!spec) throw notFound(`There is no spec ${id}.`);
    if (spec.status !== 'in-review') {
      throw new HttpError(409, 'not_in_review', `${id} is not in review (it is ${spec.status}), so there is nothing to decide.`);
    }
    const workflows = host.service('workflows');
    if (typeof workflows?.decide !== 'function') {
      throw new HttpError(503, 'workflows_unavailable', 'The NooblyJS lifecycle engine is not running here, so the decision can\'t be recorded. Nothing was changed.');
    }
    let result;
    try {
      result = await workflows.decide({
        itemId: id,
        system: 'product',
        decision: fields.decision,
        reason: fields.reason ?? null,
        ...(fields.override?.trim() ? { override: { reason: fields.override.trim() } } : {}),
        version: spec.version,
        actor: { id: actor.id, kind: 'person' },
      });
    } catch (err) {
      if (err.status >= 400 && err.status < 500) throw err; // workflows refused it: pass its answer on
      log.error(`workflows.decide for ${id} failed: ${err.message}`);
      throw new HttpError(502, 'workflows_failed', 'The lifecycle service could not record your decision. Nothing was changed; try again.');
    }
    return {
      itemId: id,
      decision: fields.decision,
      version: spec.version,
      sent: true,
      text: fields.decision === 'approve'
        ? `Your approval of v${spec.version} was sent. ${id} moves to Architecture once every reviewer has approved.`
        : `Your request for changes to v${spec.version} was sent.`,
      workflows: result ?? null,
    };
  }

  /**
   * approval.decided from the NooblyJS lifecycle engine: record the reviewer's decision, and the outcome once workflows has one.
   * Payload: { itemId, system?, decision: 'approve' | 'request-changes', outcome?: 'approved' | 'changes-requested' |
   * 'pending', role?, reason? }; the deciding person is the event's actor.
   */
  async function onApprovalDecided(event) {
    const p = event?.payload ?? {};
    if ((p.system && p.system !== 'product') || !p.itemId || !event.actor) return;
    // the NooblyJS lifecycle engine also decides ADRs, UI handoffs and merges for an item; only the spec approval is the spec's.
    if (p.type && p.type !== 'spec') return;
    try {
      const status = { approve: 'approved', 'request-changes': 'changes-requested' }[p.decision];
      if (!status) return;
      const updated = await repos.specs.update(p.itemId, async (spec) => {
        if (!spec) return null;
        const at = event.at ?? now();
        const reviewers = [...(spec.reviewers ?? [])];
        const i = reviewers.findIndex((r) => r.id === event.actor);
        const entry = { ...(reviewers[i] ?? { id: event.actor, role: p.role ?? null }), status, at };
        if (i >= 0) reviewers[i] = entry;
        else reviewers.push(entry);
        const outcome = { approved: 'approved', 'changes-requested': 'changes-requested' }[p.outcome];
        return { ...spec, reviewers, ...(outcome ? { status: outcome } : {}), updatedAt: at };
      });
      if (updated) await emit('spec.updated', { specId: p.itemId, version: updated.version, change: 'review', status: updated.status }, { id: event.actor });
      if (updated?.status === 'approved' && p.outcome === 'approved') {
        await flow?.record({ at: event.at, itemId: p.itemId, kind: 'handoff', from: 'product', to: 'architecture', by: event.actor, note: `v${updated.version} approved` });
      }
    } catch (err) {
      log.error(`approval.decided for ${p.itemId}: ${err.message}`);
    }
  }

  /** The facts behind each readiness check, for the lifecycle engine readiness rules. Null for an unknown item. */
  async function facts(itemId) {
    const spec = await repos.specs.get(itemId);
    if (!spec) return null;
    return { itemId, version: spec.version ?? 0, facts: readinessFacts(parseSpec(spec.body), spec) };
  }

  /** services.updateSpec: sections changed by a person from another app. Agents are refused; no If-Match (the latest wins). */
  async function updateFromHost(id, fields, changeNote, actor) {
    if (!actor?.id || isAgent(actor)) throw new HttpError(403, 'people_only', 'Only a person can apply a change to a spec from outside the Product Factory.');
    const { spec, changed } = await update(id, { ...fields, changeNote: String(changeNote ?? '').slice(0, 300) || undefined }, actor, { ifMatch: '*' });
    if (!changed) throw new HttpError(409, 'no_change', `${id} already says that, so there was nothing to apply.`);
    return { id: spec.id, version: spec.version };
  }

  /**
   * Knowledge links added from outside this app (the wiki's "Add to item" on an answer, and a draft's sources).
   * Links the spec already has are left as they are. Resolves with { added, links }.
   */
  async function linkFromHost(id, links, actor) {
    if (!actor?.id || isAgent(actor)) throw new HttpError(403, 'people_only', 'Only a person can link knowledge to a spec from outside the Product Factory.');
    return linkSources(id, links, actor);
  }

  /**
   * Adds knowledge links a spec does not have yet. Also what a draft does with the knowledge it was given: the
   * agent's sources go on the spec beside its draft, for the person who reviews it. Resolves with { added, links }.
   */
  async function linkSources(id, links, actor) {
    const current = await repos.specs.get(id);
    if (!current) throw notFound(`There is no spec ${id}.`);
    const have = current.knowledge ?? [];
    const add = (Array.isArray(links) ? links : []).filter((l, i, all) => l?.id && !have.some((k) => k.id === l.id) && all.findIndex((o) => o?.id === l.id) === i);
    if (!add.length) return { added: 0, links: have };
    const updated = await setKnowledge(id, { knowledge: [...have, ...add] }, actor);
    return { added: add.length, links: updated.knowledge };
  }

  return { create, update, setKnowledge, requestReview, decide, onApprovalDecided, facts, updateFromHost, linkFromHost, linkSources };
}
