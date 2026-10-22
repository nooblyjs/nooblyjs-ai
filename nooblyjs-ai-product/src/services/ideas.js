// Stage 1 writes for ideas: turning a signal into one, creating one by hand, and editing and scoring it
// with RICE. Every change is a new version (If-Match on edits) and an event.
import { validator, invalid } from '../util/validate.js';
import { riceErrors, riceScore } from './rice.js';
import { nextNumbered, isId } from '../util/ids.js';
import { checkIfMatch } from '../util/http.js';
import { conflict, notFound, HttpError } from '../util/errors.js';

// What a person may set. "accepted" (NooblyJS Phase 17) is set only by accepting the idea at the Discover exit (the
// lifecycle engine's decision: markAccepted); it stays on the board until it has a spec.
const STATUSES = ['open', 'closed'];
const FEATURE = /^FEAT-\d{3,}$/;

const riceField = (value) => {
  const errors = riceErrors(value);
  return errors ? { errors } : { value: { reach: value.reach, impact: value.impact, confidence: value.confidence, effort: value.effort } };
};

/** The fields a person may set on an idea. */
function ideaFields(body, { creating }) {
  return validator(body)
    .only(['title', 'product', 'portfolio', 'problem', 'rice', 'signals', 'status', 'feature'])
    .string('title', { required: creating, max: 120 })
    // Labels, not a fixed list: a new product name becomes a product (catalogue.js), in `portfolio` when given.
    .string('product', { max: 40 })
    .string('portfolio', { max: 40 })
    .string('problem', { max: 10000 })
    .custom('rice', riceField)
    .list('signals', (id) => (isId(id) ? id : invalid('not a signal id')), { max: 100 })
    .oneOf('status', STATUSES)
    // NooblyJS Phase 17: the feature of the work hierarchy it belongs to (hierarchy.js), or null.
    .custom('feature', (v) => (v === null || v === '' ? { value: null } : FEATURE.test(String(v)) ? { value: String(v) } : { errors: ['not a feature id (FEAT-001)'] }))
    .result();
}

/** An id from before ideas (OPP-018) as it is now (IDEA-018); anything else as it is. */
export const ideaIdFrom = (id) => (typeof id === 'string' ? id.replace(/^OPP-(\d{3,})$/, 'IDEA-$1') : id);

/**
 * A data folder from before ideas (they were "opportunities", 2026-10-12) is brought up to date at each start:
 * opportunities/OPP-018.md becomes ideas/IDEA-018.md, and what points at one follows (a spec's `opportunity` becomes
 * `idea`; a signal's `opportunity` and its status "opportunity" become `idea`; a draft's item). Does nothing once
 * there is no opportunities/ folder.
 */
export async function migrateFromOpportunities(store, log) {
  if (!(await store.list([], { dirs: true })).includes('opportunities')) return { moved: 0 };
  const old = (await store.list(['opportunities'])).filter((name) => name.endsWith('.md'));
  let moved = 0;
  for (const name of old) {
    const doc = await store.readDoc(['opportunities', name]);
    if (!doc) continue;
    const id = ideaIdFrom(doc.data.id ?? name.replace(/\.md$/, ''));
    await store.writeDoc(['ideas', `${id}.md`], { ...doc.data, id }, doc.body);
    moved += 1;
  }
  const follow = async (folder, change) => {
    for (const name of (await store.list([folder])).filter((n) => n.endsWith('.md'))) {
      const doc = await store.readDoc([folder, name]).catch(() => null);
      const next = doc && change({ ...doc.data });
      if (next) await store.writeDoc([folder, name], next, doc.body);
    }
  };
  await follow('specs', (data) => {
    if (data.opportunity === undefined) return null;
    const { opportunity, ...rest } = data;
    return { ...rest, idea: ideaIdFrom(opportunity) };
  });
  await follow('signals', (data) => {
    if (data.opportunity === undefined && data.status !== 'opportunity') return null;
    const { opportunity, ...rest } = data;
    return { ...rest, ...(opportunity !== undefined ? { idea: ideaIdFrom(opportunity) } : {}), ...(data.status === 'opportunity' ? { status: 'idea' } : {}) };
  });
  await follow('drafts', (data) => (/^OPP-/.test(data.itemId ?? '') ? { ...data, itemId: ideaIdFrom(data.itemId) } : null));
  await store.remove(['opportunities']);
  log?.info?.(`ideas: moved ${moved} opportunities to ideas/ (OPP- ids are IDEA- ids now)`);
  return { moved };
}

export function createIdeaService({ repos, host, catalogue, hierarchy = null }) {
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor.id });

  /**
   * Creates IDEA-<next>. The folder lock keeps two creates from taking the same number. `extra` is what the ideas
   * portal (Phase 25a) adds: status "suggested", who put it forward, its followers.
   */
  async function create(fields, actor, extra = {}) {
    return repos.ideas.withFolderLock(async () => {
      const id = nextNumbered('IDEA', (await repos.ideas.list()).map((o) => o.id));
      const at = now();
      const product = (await catalogue.productFor(fields, actor)) ?? null;
      // Where it will be built starts as its product's (NooblyJS Phase 11); the item's Architecture narrows it later.
      const { repositories, jiraProject } = await catalogue.defaultsFor(product);
      const record = {
        id,
        title: fields.title,
        product,
        repositories,
        jiraProject,
        owner: actor.id,
        status: 'open',
        version: 1,
        signals: fields.signals ?? [],
        rice: fields.rice ?? null,
        ...(fields.feature ? { feature: fields.feature } : {}),
        ...extra,
        createdAt: at,
        createdBy: actor.id,
        updatedAt: at,
        body: fields.problem ?? '',
      };
      await repos.ideas.write(record);
      await emit('idea.created', { ideaId: id, title: record.title, product: record.product, signals: record.signals, ...(record.status !== 'open' ? { status: record.status } : {}) }, actor);
      if (record.rice) await emit('idea.scored', { ideaId: id, rice: record.rice, score: riceScore(record.rice) }, actor);
      return record;
    });
  }

  return {
    /** NooblyJS Phase 25a: an idea a colleague puts forward in the portal: status "suggested", off the board until promoted. */
    async createSuggested(body, actor) {
      const fields = validator(body).only(['title', 'product', 'problem']).string('title', { required: true, max: 120 }).string('product', { required: true, max: 40 }).string('problem', { max: 4000 }).result();
      const known = ((await repos.catalogue.get())?.products ?? []).find((p) => String(p.name).toLowerCase() === fields.product.toLowerCase());
      if (!known) throw new HttpError(422, 'invalid', `There is no product ${fields.product}: choose one from the list.`, { product: 'one of the products' });
      return create({ ...fields, product: known.name }, actor, { status: 'suggested', submittedBy: actor.id, owner: null, followers: [actor.id], votes: [], comments: [] });
    },

    /** POST /ideas */
    async createFromBody(body, actor) {
      const fields = ideaFields(body, { creating: true });
      if (fields.feature) await hierarchy?.requireFeature(fields.feature);
      for (const signalId of fields.signals ?? []) {
        if (!(await repos.signals.get(signalId))) throw notFound(`There is no signal ${signalId}.`);
      }
      return create(fields, actor);
    },

    /** POST /signals/:id/idea: the signal moves on from the Signals column to Ideas. */
    async fromSignal(signalId, body, actor) {
      const fields = ideaFields(body ?? {}, { creating: false });
      let opp = null;
      // Under the signal's lock, so two people converting the same signal at once get one idea, not two.
      await repos.signals.update(signalId, async (signal) => {
        if (!signal) throw notFound(`There is no signal ${signalId}.`);
        if (signal.idea) throw conflict(`This signal is already ${signal.idea}.`, { idea: signal.idea });
        opp = await create({
          title: fields.title ?? signal.title,
          product: fields.product ?? signal.product ?? null,
          portfolio: fields.portfolio,
          problem: fields.problem ?? `${signal.title}: ${signal.count} ${signal.unit ?? 'signals'} from ${signal.sourceLabel ?? signal.source}.`,
          rice: fields.rice,
          signals: [signal.id],
        }, actor);
        return { ...signal, status: 'idea', idea: opp.id, updatedAt: now() };
      });
      if (!opp) throw notFound(`There is no signal ${signalId}.`);
      return opp;
    },

    /** PUT /ideas/:id with If-Match. */
    async update(id, body, actor, { ifMatch } = {}) {
      const fields = ideaFields(body, { creating: false });
      if (fields.feature) await hierarchy?.requireFeature(fields.feature);
      // Filed before the record's lock is taken: naming a new product makes it.
      const product = await catalogue.productFor(fields, actor);
      let scored = false;
      const updated = await repos.ideas.update(id, (current) => {
        if (!current) throw notFound(`There is no idea ${id}.`);
        checkIfMatch(ifMatch, { ...current, version: current.version ?? 1 });
        const { problem, portfolio, product: _typed, ...rest } = fields;
        scored = fields.rice !== undefined && JSON.stringify(fields.rice) !== JSON.stringify(current.rice);
        return {
          ...current,
          ...rest,
          ...(product !== undefined ? { product } : {}),
          ...(problem !== undefined ? { body: problem } : {}),
          version: (current.version ?? 1) + 1,
          updatedAt: now(),
          updatedBy: actor.id,
        };
      });
      if (!updated) throw notFound(`There is no idea ${id}.`);
      await emit('idea.updated', { ideaId: id, fields: Object.keys(fields), version: updated.version }, actor);
      if (scored) await emit('idea.scored', { ideaId: id, rice: updated.rice, score: riceScore(updated.rice) }, actor);
      return updated;
    },

    /** NooblyJS Phase 17: a person accepted it at the Discover exit (the lifecycle engine recorded the decision). */
    async markAccepted(id, actor) {
      const updated = await repos.ideas.update(id, (current) => (current && current.status !== 'accepted' ? { ...current, status: 'accepted', acceptedAt: now(), acceptedBy: actor.id, version: (current.version ?? 1) + 1, updatedAt: now() } : null));
      if (updated) await emit('idea.accepted', { ideaId: id, itemId: id, summary: `accepted the idea ${id} · ${updated.title}` }, actor);
      return updated;
    },
  };
}
