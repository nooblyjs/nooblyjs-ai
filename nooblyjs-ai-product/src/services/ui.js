// Stage 4 · UI design (docs/roadmap-history.md P6, product.md §5.5): screens per device with their status, design-system reuse,
// the accessibility checks (data/product/accessibility.yaml, D6), the handoff preview (work items per repo, the repo
// count worked out from them (D5), a cost range) and Send to Software Factory, which a person decides and
// the NooblyJS lifecycle engine carries out: this engine never creates the handoff itself.
import { validator, invalid } from '../util/validate.js';
import { checkIfMatch, etagOf, isAgent } from '../util/http.js';
import { isId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';

/** The UI stage's default drafting agent (product.md §2 names none) `[CONFIRM name, from nooblyjs-ai-teammate]`. */
export const UI_AGENT = { id: 'ui-agent', name: 'UI agent', kind: 'agent' };

const DEVICES = [['mobile', 'Mobile'], ['web', 'Web'], ['store-console', 'Store console']];
const SCREEN_STATUS = { draft: 'Draft', 'in-review': 'In review', approved: 'Approved' };
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const REPO = /^[a-z0-9][a-z0-9._-]{0,62}$/;
const DEFAULT_ESTIMATE = { low: 3, high: 4.33 }; // per work item, USD `[CONFIRM with the Software Factory's run costs]`
const ref = (actor) => (isAgent(actor) ? { id: actor.id, name: actor.name, kind: 'agent' } : { id: actor.id, kind: 'person' });
const dollars = (n) => `$${Math.round(n)}`;

export function createUiService({ repos, host, log, flow }) {
  const A = repos.artefacts;
  const now = () => new Date().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });
  const paths = {
    screens: (id) => ['ui', id, 'screens'],
    screen: (id, s) => ['ui', id, 'screens', `${s}.md`],
    design: (id) => ['ui', id, 'design.md'],
    handoff: (id) => ['ui', id, 'handoff.md'],
  };

  async function specOr404(itemId) {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  }

  // ---------- screens ----------

  const screenView = (s) => ({
    id: s.id, itemId: s.itemId, device: s.device, title: s.title, order: s.order ?? 0,
    status: s.status, statusText: SCREEN_STATUS[s.status] ?? s.status,
    elements: s.elements ?? [], components: s.components ?? [], version: s.version ?? 1,
    etag: etagOf({ id: `${s.itemId}.screen.${s.id}`, version: s.version ?? 1 }),
    by: s.draftedBy ?? s.editedBy ?? null, updatedAt: s.updatedAt ?? null,
  });

  async function screens(itemId, { device } = {}) {
    await specOr404(itemId);
    const all = (await A.list(paths.screens(itemId))).filter((s) => SLUG.test(s.id ?? '')).map((s) => screenView({ ...s, itemId }));
    all.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return {
      itemId,
      devices: DEVICES.map(([key, label]) => {
        const list = all.filter((s) => s.device === key);
        return { key, label, count: list.length, approved: list.filter((s) => s.status === 'approved').length };
      }),
      screens: device ? all.filter((s) => s.device === device) : all,
    };
  }

  const screenFields = (body, { creating }) => validator(body)
    .only(['title', 'device', 'status', 'elements', 'components', 'order'])
    .string('title', { required: creating, max: 80 })
    .oneOf('device', DEVICES.map(([k]) => k), { required: creating })
    .oneOf('status', Object.keys(SCREEN_STATUS))
    .list('elements', (e) => (typeof e === 'string' && e.trim() && e.length <= 200 ? e.trim() : invalid('an element is a short line of text')), { max: 40 })
    .list('components', (c) => (typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(c) ? c : invalid('a component is a name like SlotChip')), { max: 40 })
    .custom('order', (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? { value: v } : { errors: { value: 'a whole number' } }))
    .result();

  /** Creates or changes one screen (If-Match on its ETag; a new screen is version 0). */
  async function saveScreen(itemId, screenId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    if (!SLUG.test(screenId)) throw new HttpError(422, 'invalid', 'A screen id is lower-case letters, digits and -.', { screen: 'invalid id' });
    let changed;
    await A.update(paths.screen(itemId, screenId), (current) => {
      const f = screenFields(body, { creating: !current });
      const version = current?.version ?? 0;
      checkIfMatch(ifMatch, { id: `${itemId}.screen.${screenId}`, version });
      changed = { ...(current ?? { elements: [], components: [], status: 'draft' }), ...f, id: screenId, itemId, version: version + 1, updatedAt: now(), [isAgent(actor) ? 'draftedBy' : 'editedBy']: ref(actor), body: current?.body ?? '' };
      return changed;
    });
    await emit('ui.screen_updated', { itemId, screenId, status: changed.status, version: changed.version }, actor);
    return screenView(changed);
  }

  // ---------- design system and accessibility ----------

  async function designSystem(itemId) {
    await specOr404(itemId);
    const ds = (await A.get(paths.design(itemId)))?.designSystem ?? null;
    if (!ds) return { itemId, version: null, reused: 0, total: 0, text: 'Not checked yet', newComponents: [] };
    return { itemId, version: ds.version ?? null, reused: ds.reused ?? 0, total: ds.total ?? 0, text: `${ds.reused} of ${ds.total}`, newComponents: ds.newComponents ?? [] };
  }

  async function accessibility(itemId) {
    await specOr404(itemId);
    const [rules, design] = await Promise.all([A.readYaml(['accessibility.yaml']), A.get(paths.design(itemId))]);
    const results = design?.accessibility?.results ?? {};
    const notes = design?.accessibility?.notes ?? {};
    const checks = (rules?.checks ?? []).map((c) => {
      const passed = results[c.key] ?? null;
      return { key: c.key, label: c.label, passed, text: passed === false ? notes[c.key] ?? `${c.label}: not met` : passed === true ? c.label : `${c.label}: not checked yet` };
    });
    const passed = checks.filter((c) => c.passed === true).length;
    return { itemId, passed, total: checks.length, text: `${passed} of ${checks.length}`, checkedAt: design?.accessibility?.checkedAt ?? null, checks };
  }

  // ---------- handoff ----------

  /**
   * Which of the item's repositories a work item's `repo` is (NooblyJS Phase 11): a full name ("acme/x") or the
   * short one ("x"). Null when the item has repositories and this is not one of them. An item with none (the seed
   * story) takes any repo, as before.
   */
  const repositoryOf = (spec, repo) => {
    const list = spec.repositories ?? [];
    if (!list.length) return String(repo);
    return list.find((name) => name === repo || name.split('/').pop() === repo) ?? null;
  };

  async function handoffPreview(itemId) {
    const spec = await specOr404(itemId);
    const doc = await A.get(paths.handoff(itemId));
    const items = doc?.workItems ?? [];
    const repoNames = [...new Set(items.map((w) => w.repo))];
    const outside = repoNames.filter((r) => repositoryOf(spec, r) === null);
    const per = doc?.estimatePerItemUsd ?? DEFAULT_ESTIMATE;
    const low = items.length * per.low;
    const high = items.length * per.high;
    const sent = doc?.requested ?? null;
    return {
      itemId,
      version: doc?.version ?? 0,
      workItems: items.map((w) => ({ ...w, text: `${w.repo} · ${w.title}` })),
      count: items.length,
      repos: repoNames.map((name) => ({ name, workItems: items.filter((w) => w.repo === name).length })),
      repoCount: repoNames.length,
      // Where the item may be built, and any work item planned somewhere else (it can't be sent until that changes).
      repositories: spec.repositories ?? [],
      outside,
      estimate: { lowUsd: Math.round(low), highUsd: Math.round(high) },
      title: items.length ? `${items.length} work item${items.length === 1 ? '' : 's'} for the Software Factory` : 'No work items yet',
      text: items.length ? `Estimated ${dollars(low)}–${dollars(high)} · ${repoNames.length} repo${repoNames.length === 1 ? '' : 's'}` : 'No work items planned yet',
      status: doc?.status ?? 'draft',
      statusText: { draft: 'Not sent yet', requested: 'Sent · waiting for the Software Factory', 'handed-off': 'Handed off to the Software Factory' }[doc?.status ?? 'draft'],
      requested: sent,
    };
  }

  /** Send to Software Factory: a person's decision, passed to the NooblyJS lifecycle engine, which creates the handoff. */
  async function sendToFactory(itemId, body, actor) {
    const f = validator(body ?? {}).only(['note']).string('note', { max: 1000 }).result();
    const preview = await handoffPreview(itemId);
    if (!preview.count) throw new HttpError(409, 'no_work_items', `${itemId} has no work items to hand off yet. Plan the handoff first.`);
    if (preview.status !== 'draft') throw new HttpError(409, 'already_sent', `${itemId} was already sent to the Software Factory.`);
    if (preview.outside.length) {
      throw new HttpError(422, 'outside_repositories', `${preview.outside.join(', ')} ${preview.outside.length === 1 ? 'is' : 'are'} not among ${itemId}'s repositories (${preview.repositories.map((r) => r.split('/').pop()).join(', ')}). Change the work items, or the repositories in Architecture.`, { outside: preview.outside });
    }
    const spec = await specOr404(itemId);
    const workflows = host.service('workflows');
    if (typeof workflows?.handoff !== 'function') {
      throw new HttpError(503, 'workflows_unavailable', 'The NooblyJS lifecycle engine is not running here, so the handoff can\'t be created. Nothing was sent.');
    }
    const a11y = await accessibility(itemId);
    const at = now();
    // Marked as requested before the NooblyJS lifecycle engine is called: it may emit handoff.created during the call, and that must
    // land on top of this, not under it. The lock also stops a second Send from going out twice.
    await A.update(paths.handoff(itemId), (current) => {
      if ((current?.status ?? 'draft') !== 'draft') throw new HttpError(409, 'already_sent', `${itemId} was already sent to the Software Factory.`);
      return { ...current, status: 'requested', requested: { by: actor.id, at, note: f.note ?? null }, version: (current.version ?? 1) + 1 };
    });
    let result;
    try {
      result = await workflows.handoff({
        itemId, system: 'product', from: 'ui', to: 'build',
        // Each work item names its repository in full when the item has a list, and the list goes with them, so the
        // Software Factory starts runs only there.
        workItems: preview.workItems.map(({ repo, title }) => ({ repo: spec.repositories?.length ? repositoryOf(spec, repo) : repo, title })),
        ...(spec.repositories?.length ? { repositories: spec.repositories } : {}),
        estimate: preview.estimate, repoCount: preview.repoCount,
        openChecks: a11y.checks.filter((c) => c.passed === false).map((c) => c.text),
        note: f.note ?? null, actor: { id: actor.id, kind: 'person' },
      });
    } catch (err) {
      // Nothing was sent: back to draft, so it can be sent again.
      await A.update(paths.handoff(itemId), (current) => (current?.status === 'requested' ? { ...current, status: 'draft', requested: null } : null));
      if (err.status >= 400 && err.status < 500) throw err;
      log.error(`workflows.handoff for ${itemId} failed: ${err.message}`);
      throw new HttpError(502, 'workflows_failed', 'The lifecycle service could not create the handoff. Nothing was sent; try again.');
    }
    await emit('ui.handoff_requested', { itemId, workItems: preview.count, repoCount: preview.repoCount, estimate: preview.estimate }, actor);
    await flow?.record({ itemId, kind: 'handoff', from: 'ui', to: 'build', by: actor.id, at, note: `${preview.count} work items · ${preview.repoCount} repos` });
    return {
      itemId, sent: true, workItems: preview.count, repoCount: preview.repoCount,
      text: `Sent ${preview.count} work items across ${preview.repoCount} repos to the Software Factory. The NooblyJS lifecycle engine creates them.`,
      openChecks: a11y.checks.filter((c) => c.passed === false).map((c) => c.text),
      workflows: result ?? null,
    };
  }

  /** handoff.created from the NooblyJS lifecycle engine: the work items exist; the handoff is done. */
  async function onHandoffCreated(event) {
    const p = event?.payload ?? {};
    if ((p.system && p.system !== 'product') || !isId(p.itemId ?? '')) return;
    try {
      await A.update(paths.handoff(p.itemId), (current) => (current ? { ...current, status: 'handed-off', handedOffAt: event.at ?? now(), workItemIds: p.workItemIds ?? null } : null));
    } catch (err) {
      log.error(`handoff.created for ${p.itemId}: ${err.message}`);
    }
  }

  /** Replaces the planned work items (people or the UI agent). If-Match on the handoff's version. */
  async function saveHandoffPlan(itemId, body, actor, { ifMatch } = {}) {
    await specOr404(itemId);
    const { workItems } = validator(body).only(['workItems']).list('workItems', (w) => (w && REPO.test(w.repo ?? '') && typeof w.title === 'string' && w.title.trim() && w.title.length <= 120
      ? { repo: w.repo, title: w.title.trim() }
      : invalid('a work item needs a repo (e.g. slots-api) and a title')), { max: 60 }).result();
    if (!workItems) throw new HttpError(422, 'invalid', 'Send the full list as workItems.', { workItems: 'workItems is required' });
    await A.update(paths.handoff(itemId), (current) => {
      checkIfMatch(ifMatch, { id: `${itemId}.handoff`, version: current?.version ?? 0 });
      if (current?.status && current.status !== 'draft') throw new HttpError(409, 'already_sent', `${itemId} was already sent; its work items can't change here.`);
      return { ...(current ?? {}), itemId, workItems, status: 'draft', version: (current?.version ?? 0) + 1, updatedAt: now(), [isAgent(actor) ? 'draftedBy' : 'editedBy']: ref(actor), body: current?.body ?? '' };
    });
    return handoffPreview(itemId);
  }

  async function overview(itemId) {
    const spec = await specOr404(itemId);
    const design = await A.get(paths.design(itemId));
    return { itemId, title: spec.title, lead: design?.body?.trim() || null, canvasUrl: design?.canvasUrl ?? null };
  }

  async function items() {
    const specs = await repos.specs.list();
    const withWork = new Set(await A.folders(['ui']));
    const out = [];
    for (const spec of specs.filter((s) => withWork.has(s.id)).sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }))) {
      const [s, h, a] = await Promise.all([screens(spec.id), handoffPreview(spec.id), accessibility(spec.id)]);
      out.push({ itemId: spec.id, title: spec.title, product: spec.product ?? null, text: `${s.screens.length} screens · accessibility ${a.text} · ${h.statusText}`, handoff: h.status });
    }
    return out;
  }

  return { screens, saveScreen, designSystem, accessibility, handoffPreview, sendToFactory, onHandoffCreated, saveHandoffPlan, overview, items };
}

/** The UI agent's drafts: a screen from a brief, and the handoff plan (work items per repo). Mock content is marked. */
export function uiKinds({ repos, ui, architecture }) {
  const P = (what) => `[PLACEHOLDER: ${what}]`;
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'screen';
  const specFor = async (itemId) => {
    const spec = isId(itemId) ? await repos.specs.get(itemId) : null;
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    return spec;
  };
  return {
    screen: {
      stage: 'ui', label: 'a screen', workType: 'ui-drafting', agent: UI_AGENT, estimateUsd: 0.8, doneEvent: 'ui.screen_drafted',
      async check(itemId, fields) {
        await specFor(itemId);
        if (!fields.brief?.trim()) throw new HttpError(422, 'invalid', 'Say which screen to draft.', { brief: 'brief is required: the screen, e.g. "order tracking map"' });
        return { baseVersion: 0, title: fields.brief.trim() };
      },
      async mock(draft) {
        const title = draft.brief.trim();
        return { costUsd: 0.8, output: { id: slug(title), title: title[0].toUpperCase() + title.slice(1), device: 'mobile', status: 'draft', elements: [P('heading'), P('main content'), P('primary action')], components: [] } };
      },
      async apply(draft, output) {
        const { id, ...body } = output;
        const existing = (await ui.screens(draft.itemId)).screens.find((s) => s.id === id);
        const s = await ui.saveScreen(draft.itemId, id, existing ? { elements: body.elements } : body, draft.teammate, { ifMatch: existing?.etag ?? `"${draft.itemId}.screen.${id}@0"` });
        return { version: s.version, text: `Drafted the screen "${s.title}"`, ref: { screenId: id } };
      },
    },
    'handoff-plan': {
      stage: 'ui', label: 'the handoff plan', workType: 'ui-drafting', agent: UI_AGENT, estimateUsd: 0.6, doneEvent: 'ui.handoff_planned',
      async check(itemId) {
        await specFor(itemId);
        const preview = await ui.handoffPreview(itemId);
        if (preview.status !== 'draft') throw new HttpError(409, 'already_sent', `${itemId} was already sent to the Software Factory.`);
        return { baseVersion: preview.version, title: null };
      },
      async mock(draft) {
        const [d, s, ds] = await Promise.all([architecture.diagram(draft.itemId), ui.screens(draft.itemId), ui.designSystem(draft.itemId)]);
        const repoOf = (n) => (d.contracts.find((c) => c.container === n.id)?.name?.split('.')[0]) ?? n.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const items = [
          ...d.nodes.filter((n) => n.isNew && n.kind === 'container').map((n) => ({ repo: repoOf(n), title: `${n.label}: ${P('endpoints')}` })),
          ...(s.screens.length ? [{ repo: 'web-storefront', title: s.screens.map((x) => x.title).join(', ') }] : []),
          ...(ds.newComponents.length ? [{ repo: 'design-system', title: `publish ${ds.newComponents.length} components` }] : []),
        ];
        return { costUsd: 0.6, output: { workItems: items.length ? items : [{ repo: 'web-storefront', title: P('work item') }] } };
      },
      async apply(draft, output) {
        const h = await ui.saveHandoffPlan(draft.itemId, output, draft.teammate, { ifMatch: `"${draft.itemId}.handoff@${draft.baseVersion}"` });
        return { version: h.version, text: `Planned ${h.count} work items across ${h.repoCount} repos`, ref: { itemId: draft.itemId } };
      },
    },
  };
}
