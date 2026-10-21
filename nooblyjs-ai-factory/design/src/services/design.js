// Phase 16c: the Design section (root product.md §3.2a). From an item's Product handoff, Design writes its business
// requirements, its solution architecture (impacted systems, NFRs, the feature landscape), its functional analysis
// (interface and technical requirements) and the stories that build each feature, and hands each story to Engineering
// on its own. Agents draft (drafter.js), people accept and decide: a business requirement is accepted by a person with
// accept-requirement, and a story's Design handoff is the lifecycle engine's design-handoff approval.
//
// The lifecycle engine (host.service('workflows')) owns the items and their stages; this section owns what Design
// writes, in data/factory/design/items/<itemId>/design.md. The stories are both: written here, and lifecycle items of
// their own (syncStories) so they move through Engineer, Build and Test one by one.
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { ITEM, blankDesign } from '../repo.js';
import { PARTS } from './drafter.js';
import { draftRequirements, draftSolution, draftFunctional, draftStories, criterionText } from './drafts.js';

const CHANGES = new Set(['new', 'changed', 'retired']);
const KINDS = new Set(['api', 'event', 'file']);
const LIST_KEYS = { requirements: 'requirements', nfrs: 'nfrs', interfaces: 'interfaces', technical: 'technical', systems: 'systems' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const agent = (actor) => actor?.kind === 'agent';

/** Text a person typed: trimmed, at most `max` characters, or null. */
function text(value, max = 1000, field = 'text') {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`, { [field]: 'text' });
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length > max) throw badRequest(`Keep ${field} under ${max} characters.`, { [field]: `max ${max}` });
  return t || null;
}

/** The number an item's ids carry: PRD-031 → 031. */
const numberOf = (itemId) => /(\d+)$/.exec(itemId)?.[1] ?? itemId.replace(/[^A-Za-z0-9]/g, '');
const ID_SHAPES = { requirement: ['BR', 2], nfr: ['NFR', 2], interface: ['IF', 2], technical: ['TR', 2], feature: ['FEAT', 1], story: ['STORY', 1] };

/** The next id of a kind for the item (BR-031-01, STORY-031-1), never one given out before. */
function nextId(design, kind) {
  const [prefix, pad] = ID_SHAPES[kind];
  const n = (design.counters?.[kind] ?? 0) + 1;
  design.counters = { ...(design.counters ?? {}), [kind]: n };
  return `${prefix}-${numberOf(design.itemId)}-${String(n).padStart(pad, '0')}`;
}

export function createDesignService({ host, repo, catalogue, drafter, log, mountPath }) {
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'factory', section: 'design', ...payload }, { actor: actor?.id ?? null });
  const workflows = () => host.service?.('workflows');
  const product = () => host.service?.('product');
  const by = (actor) => (agent(actor) ? { id: actor.id, name: actor.name ?? actor.id, kind: 'agent' } : { id: actor.id, name: actor.name ?? null, kind: 'person' });

  /** People decide: an agent is refused, and the refusal audited, before anything is changed. */
  async function peopleOnly(actor, what) {
    if (!agent(actor)) return;
    await host.audit.record({ actor: actor.id, action: 'access.refused', target: what, reason: `agents propose, people decide: an agent can't ${what}` });
    throw new HttpError(403, 'people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${what}.`);
  }

  async function itemOr404(itemId) {
    if (!ITEM.test(itemId ?? '')) throw notFound(`There is no item ${itemId}.`);
    const w = workflows();
    if (typeof w?.item !== 'function') throw new HttpError(503, 'lifecycle_unavailable', 'The lifecycle engine is not running here, so there is no item to design.');
    const item = await w.item({ itemId });
    if (!item) throw notFound(`There is no item ${itemId}.`);
    if (item.type === 'story') throw badRequest(`${item.ref ?? item.id} is a story: its design is its item's (${item.parentId}).`);
    return item;
  }

  /** Writing in Design: only while the item is in Design. */
  async function inDesign(itemId) {
    const item = await itemOr404(itemId);
    if (item.status !== 'active' || item.stage !== 'design') {
      throw conflict('wrong_stage', `${item.ref ?? item.id} is ${item.status !== 'active' ? item.status : `in ${stageWord(item.stage)}`}, so its design can't change: Design ${item.stage === 'product' || item.stage === 'discover' ? 'starts with the Product handoff' : 'is done'}.`);
    }
    return item;
  }
  const stageWord = (stage) => ({ discover: 'Discover', product: 'Product', design: 'Design', engineer: 'Engineer', build: 'Build', test: 'Test', release: 'Release', operate: 'Operate' })[stage] ?? stage;

  async function inputsFor(itemId) {
    const p = product();
    const inputs = typeof p?.designInputs === 'function' ? await p.designInputs(itemId) : null;
    if (!inputs) throw conflict('no_spec', `${itemId} has no spec in the Product section, so there is nothing to design from.`);
    return inputs;
  }

  /** The lifecycle's view of the item's stories, by id. */
  async function storyStages(itemId) {
    const list = (await workflows()?.storiesOf?.({ itemId }).catch(() => [])) ?? [];
    return new Map(list.map((s) => [s.id, s]));
  }
  const handedOff = (lifecycle) => Boolean(lifecycle && lifecycle.stage !== 'design');

  // ---------------------------------------------------------------------------- readiness

  /** Design's readiness checks, worked out from the design (null when there is none: no Design work for the item). */
  async function readinessFacts(itemId) {
    const design = await repo.get(itemId);
    if (!design) return null;
    const adrs = (await product()?.designInputs?.(itemId).catch(() => null))?.adrs ?? [];
    const covered = new Set(design.stories.flatMap((s) => s.requirements ?? []));
    const uncovered = design.requirements.filter((r) => !covered.has(r.id)).map((r) => r.id);
    const proposed = adrs.filter((a) => a.status === 'proposed').map((a) => a.id);
    const missing = design.interfaces.filter((i) => !i.from || !i.to).map((i) => `${i.id} has no ${!i.from && !i.to ? 'sides' : `"${i.from ? 'to' : 'from'}" side`}`);
    const join = (list) => list.join('; ');
    return {
      itemId,
      facts: {
        'requirements-covered': design.requirements.length
          ? { value: !uncovered.length, ...(uncovered.length ? { detail: `${uncovered.join(', ')} ${uncovered.length === 1 ? 'has' : 'have'} no story` } : {}) }
          : { value: false, detail: 'there are no business requirements yet' },
        'decisions-decided': { value: !proposed.length, ...(proposed.length ? { detail: `${proposed.join(', ')} ${proposed.length === 1 ? 'is' : 'are'} still proposed` } : {}) },
        'interfaces-complete': { value: !missing.length, ...(missing.length ? { detail: join(missing) } : {}) },
      },
    };
  }

  // ---------------------------------------------------------------------------- views

  /** Each part's state in words, for the lists and the item's page. */
  function partsText(design, stories) {
    const accepted = design.requirements.filter((r) => r.status === 'accepted').length;
    const oneSided = design.interfaces.filter((i) => !i.from || !i.to).length;
    const gone = design.stories.filter((s) => handedOff(stories.get(s.id))).length;
    return {
      requirements: design.requirements.length ? `${plural(design.requirements.length, 'business requirement')} · ${accepted} accepted` : 'No business requirements yet',
      solution: design.systems.length || design.nfrs.length || design.features.length
        ? `${plural(design.systems.length, 'impacted system')} · ${plural(design.nfrs.length, 'NFR')} · ${plural(design.features.length, 'feature')}` : 'No solution architecture yet',
      functional: design.interfaces.length || design.technical.length
        ? `${plural(design.interfaces.length, 'interface')}${oneSided ? ` (${oneSided} with a side missing)` : ''} · ${plural(design.technical.length, 'technical requirement')}` : 'No functional analysis yet',
      stories: design.stories.length ? `${plural(design.stories.length, 'story', 'stories')} · ${gone} handed off` : 'No stories yet',
      handoff: design.stories.length ? `${gone} of ${plural(design.stories.length, 'story', 'stories')} handed off` : 'Nothing to hand off yet',
    };
  }

  /** One item's design, everything on it in words, and its readiness. */
  async function view(itemId) {
    const item = await itemOr404(itemId);
    const design = (await repo.get(itemId)) ?? blankDesign(itemId);
    const stories = await storyStages(itemId);
    const facts = (await readinessFacts(itemId))?.facts ?? null;
    const CHECKS = { 'requirements-covered': 'Every business requirement is covered by a story', 'decisions-decided': 'No decision is still proposed', 'interfaces-complete': 'Every interface has both sides named' };
    const checks = facts ? Object.entries(CHECKS).map(([key, words]) => ({ key, passed: facts[key].value === true, text: facts[key].value ? words : `${words}: no, ${facts[key].detail}` })) : [];
    const featureTitle = (id) => design.features.find((f) => f.id === id)?.title ?? id;
    // NooblyJS Phase 19: the item's threat model is Security's; Solution architecture shows it and asks for one.
    const security = host.service?.('security');
    const tm = typeof security?.threatModelFor === 'function' ? await Promise.resolve(security.threatModelFor(itemId)).catch(() => null) : null;
    return {
      itemId, ref: item.ref ?? item.id, title: item.title, stage: item.stage, stageLabel: stageWord(item.stage), status: item.status,
      writable: item.status === 'active' && item.stage === 'design',
      version: design.version,
      parts: partsText(design, stories),
      requirements: design.requirements.map((r) => ({ ...r, statusText: r.status === 'accepted' ? 'Accepted' : 'Proposed' })),
      systems: design.systems.map((s) => ({ ...s, changeText: { new: 'New', changed: 'Changed', retired: 'Retired' }[s.change] ?? s.change })),
      nfrs: design.nfrs,
      features: design.features.map((f) => ({ ...f, stories: design.stories.filter((s) => s.feature === f.id).map((s) => s.id) })),
      interfaces: design.interfaces.map((i) => ({ ...i, complete: Boolean(i.from && i.to), sidesText: `${i.from || 'no "from" side'} → ${i.to || 'no "to" side'}` })),
      technical: design.technical,
      stories: design.stories.map((s) => {
        const life = stories.get(s.id);
        return {
          ...s, featureTitle: featureTitle(s.feature),
          stage: life?.stage ?? null, stageLabel: life ? stageWord(life.stage) : 'Not in the lifecycle yet', handedOff: handedOff(life),
          href: `/home/lifecycle/${encodeURIComponent(s.id)}`,
        };
      }),
      readiness: { checks, passed: checks.filter((c) => c.passed).length, total: checks.length },
      drafts: design.drafts,
      links: {
        item: `/home/lifecycle/${encodeURIComponent(itemId)}`,
        spec: `/factory/product/specs/${encodeURIComponent(itemId)}`,
        architecture: `${mountPath}/architecture/${encodeURIComponent(itemId)}`,
        infrastructure: '/infrastructure',
      },
      threatModel: tm ? { id: tm.id, version: tm.version, status: tm.status, statusText: tm.statusText, text: tm.text, href: tm.href, threats: tm.threats.length, draftedBy: tm.draftedBy?.name ?? null }
        : { id: null, available: Boolean(security), text: security ? 'No threat model yet: ask for one, and the security agent draws it from the container view.' : 'No threat model: the Security app is not running here.' },
    };
  }

  /** The items in Design, and those whose stories have gone on, each part in words. */
  async function items() {
    const w = workflows();
    const inDesignNow = (await w?.items?.({ stage: 'design' }).catch(() => [])) ?? [];
    const withDesign = await repo.itemIds();
    const ids = [...new Set([...inDesignNow.filter((i) => i.type !== 'story' && i.status === 'active').map((i) => i.id), ...withDesign])].sort();
    const out = [];
    for (const id of ids) {
      const item = await w?.item?.({ itemId: id }).catch(() => null);
      if (!item || item.type === 'story') continue;
      const design = (await repo.get(id)) ?? blankDesign(id);
      out.push({ itemId: id, ref: item.ref ?? id, title: item.title, stage: item.stage, stageLabel: stageWord(item.stage), parts: partsText(design, await storyStages(id)), started: design.version > 0 });
    }
    return out;
  }

  // ---------------------------------------------------------------------------- drafting

  const TASKS = {
    requirements: 'Write the business requirements of this item from its spec: one per goal and per user story, each quoting its source. Answer as JSON { "requirements": [{ "text", "source": { "section", "quote" } }] }.',
    solution: 'Draft the solution architecture: the impacted systems (new, changed or retired, with their owning team), the NFRs from the catalogue and the quality attributes, and the feature landscape. Answer as JSON { "systems", "nfrs", "features" }.',
    functional: 'Draft the functional analysis: the interfaces between the impacted systems (both sides, the contract) and each system\'s technical requirements. Answer as JSON { "interfaces", "technical" }.',
    stories: 'Propose the stories that build each feature, each tracing to its feature, business requirements, systems, interfaces, technical requirements, NFRs and acceptance criteria. Answer as JSON { "stories" }.',
  };

  /** Knowledge's sources for a system (titles and links), when Knowledge runs here. */
  async function knowledgeSources(names) {
    const k = host.service?.('knowledge');
    const out = new Map();
    if (typeof k?.find !== 'function') return out;
    for (const name of names) {
      try {
        const found = await k.find(name, { limit: 3 });
        out.set(name, (found?.files ?? []).slice(0, 3).map((f) => ({ title: f.title ?? f.path, href: f.href ?? null })));
      } catch (err) {
        log?.debug?.(`design: Knowledge had nothing for ${name}: ${err.message}`);
      }
    }
    return out;
  }

  /** What a part's draft adds to the design: new entries only, numbered; nothing a person wrote is overwritten. */
  function apply(part, d, output, drafter) {
    const add = (list, entries, same, kind) => {
      for (const e of entries ?? []) {
        if (!e || d[list].some((x) => same(x, e))) continue;
        d[list].push({ ...(kind ? { id: nextId(d, kind) } : {}), ...e, draftedBy: drafter });
      }
    };
    if (part === 'requirements') {
      for (const r of output.requirements ?? []) {
        const t = typeof r?.text === 'string' ? r.text.trim().slice(0, 1000) : '';
        if (!t || d.requirements.some((x) => x.source?.quote && x.source.quote === r.source?.quote)) continue;
        d.requirements.push({ id: nextId(d, 'requirement'), text: t, source: { section: String(r.source?.section ?? 'Spec'), quote: String(r.source?.quote ?? '').slice(0, 1000) }, status: 'proposed', draftedBy: drafter });
      }
    } else if (part === 'solution') {
      add('systems', (output.systems ?? []).filter((s) => s?.name && CHANGES.has(s.change)), (x, e) => x.name === e.name);
      add('nfrs', (output.nfrs ?? []).filter((n) => n?.requirement), (x, e) => x.requirement === e.requirement, 'nfr');
      add('features', (output.features ?? []).filter((f) => f?.title), (x, e) => x.summary === e.summary || x.title === e.title, 'feature');
    } else if (part === 'functional') {
      add('interfaces', (output.interfaces ?? []).filter((i) => i?.name), (x, e) => x.name === e.name, 'interface');
      add('technical', (output.technical ?? []).filter((t) => t?.system && t?.text), (x, e) => x.system === e.system, 'technical');
    } else if (part === 'stories') {
      const known = { features: new Set(d.features.map((f) => f.id)) };
      add('stories', (output.stories ?? []).filter((s) => s?.title && known.features.has(s.feature)), () => false, 'story');
    }
    d.drafts = [...(d.drafts ?? []).slice(-19), { part, by: drafter, at: now() }];
    return d;
  }

  /**
   * A teammate drafts one part of the item's design (requirements · solution · functional · stories). Asking is
   * drafting (the route checks `draft`); the draft is the teammate's, on their timesheet.
   */
  async function draft(itemId, part, actor) {
    if (!PARTS[part]) throw badRequest(`"${part}" is not a part of the design: one of ${Object.keys(PARTS).join(', ')}.`, { part: Object.keys(PARTS).join(' | ') });
    await inDesign(itemId);
    const inputs = await inputsFor(itemId);
    const current = (await repo.get(itemId)) ?? blankDesign(itemId);
    let scripted;
    if (part === 'requirements') scripted = draftRequirements(inputs);
    else if (part === 'solution') {
      const platform = host.service?.('platform');
      const repositories = (await platform?.repositories?.list?.().catch(() => [])) ?? [];
      const names = (inputs.repositories ?? []).map((r) => String(r).split('/').pop());
      const sources = await knowledgeSources(names);
      scripted = draftSolution(inputs, { repositories, catalogue: await catalogue.read(), knowledgeFor: (name) => sources.get(name) ?? [] });
    } else if (part === 'functional') {
      if (!current.systems.length) throw conflict('needs_solution', 'Draft the solution architecture first: the functional analysis is per impacted system.');
      scripted = draftFunctional(inputs, current);
    } else {
      if (!current.features.length) throw conflict('needs_solution', 'Draft the solution architecture first: the stories are built from its feature landscape.');
      scripted = draftStories(inputs, current);
    }
    const result = await drafter.run(part, { itemId, task: TASKS[part], context: { inputs, design: current }, scripted, actor });
    const before = current;
    const saved = await repo.update(itemId, (d) => {
      const next = apply(part, d, result.output, result.by);
      next.drafts[next.drafts.length - 1] = { ...next.drafts.at(-1), costUsd: result.costUsd, modelRoute: result.modelRoute, askedBy: actor.id };
      return next;
    });
    const added = Object.fromEntries(Object.values(LIST_KEYS).concat(['features', 'stories']).map((k) => [k, saved[k].length - before[k].length]).filter(([, n]) => n > 0));
    if (part === 'stories') await sync(itemId, saved, actor);
    await emit(`design.${part}_drafted`, { itemId, part, added, teammateId: result.by.id, summary: `${result.by.name} drafted ${PARTS[part].what} of ${itemId}${Object.keys(added).length ? ` (${Object.entries(added).map(([k, n]) => `${n} ${k}`).join(', ')})` : ': nothing new'}` }, result.by);
    await emit('agent.action', { actor: result.by.id, teammateId: result.by.id, itemId, system: 'factory', modelRoute: result.modelRoute, costUsd: result.costUsd, at: now(), action: `design.${part}` }, result.by);
    return view(itemId);
  }

  // ---------------------------------------------------------------------------- business requirements

  async function changeRequirement(itemId, brId, fn) {
    let found = false;
    await repo.update(itemId, (d) => {
      const r = d.requirements.find((x) => x.id === brId);
      if (!r) return null;
      found = true;
      fn(r);
      return d;
    });
    if (!found) throw notFound(`${itemId} has no business requirement ${brId}.`);
  }

  /** A person accepts a business requirement (the route checks accept-requirement). Agents are refused and audited. */
  async function acceptRequirement(itemId, brId, actor) {
    await peopleOnly(actor, 'accept a business requirement');
    // The route checks the permission; a call from another app (a person's decision relayed) is checked here.
    const person = await host.people.get(actor.id);
    if (!person || !(await host.can(person.accessRole, 'accept-requirement'))) {
      await host.audit.record({ actor: actor.id, action: 'access.refused', target: `${itemId} ${brId}`, permission: 'accept-requirement' });
      throw new HttpError(403, 'forbidden', `Accepting a business requirement needs the "accept-requirement" permission, and your access role is ${person?.accessRole ?? 'none'}.`);
    }
    await inDesign(itemId);
    await changeRequirement(itemId, brId, (r) => Object.assign(r, { status: 'accepted', acceptedBy: { id: actor.id, name: actor.name ?? null }, acceptedAt: now() }));
    await emit('design.requirement_accepted', { itemId, requirementId: brId, summary: `accepted ${brId} of ${itemId}` }, actor);
    return view(itemId);
  }

  /** A person edits a requirement's statement. An accepted one is proposed again: it says something new. */
  async function editRequirement(itemId, brId, body, actor) {
    await inDesign(itemId);
    const t = text(body?.text);
    if (!t) throw badRequest('Say what the business must get: the text is required.', { text: 'required' });
    await changeRequirement(itemId, brId, (r) => {
      if (r.text === t) return;
      Object.assign(r, { text: t, status: 'proposed', editedBy: by(actor), editedAt: now() });
      delete r.acceptedBy;
      delete r.acceptedAt;
    });
    await emit('design.requirement_changed', { itemId, requirementId: brId, summary: `edited ${brId} of ${itemId}` }, actor);
    return view(itemId);
  }

  // ---------------------------------------------------------------------------- solution architecture

  /** A person sets the impacted systems: each { name, repo?, change, team?, note? }. */
  async function setSystems(itemId, body, actor) {
    await inDesign(itemId);
    const list = Array.isArray(body?.systems) ? body.systems : null;
    if (!list || list.length > 40) throw badRequest('Send the impacted systems as a list (up to 40).', { systems: 'list' });
    const systems = list.map((s, i) => {
      const name = text(s?.name, 120, `systems[${i}].name`);
      if (!name) throw badRequest('Each impacted system needs a name.', { [`systems[${i}].name`]: 'required' });
      const change = s?.change ?? 'changed';
      if (!CHANGES.has(change)) throw badRequest(`A system is new, changed or retired, not "${String(change).slice(0, 20)}".`, { [`systems[${i}].change`]: 'new | changed | retired' });
      return { name, repo: text(s?.repo, 160, 'repo') ?? name, change, team: text(s?.team, 80, 'team'), note: text(s?.note, 300, 'note') ?? '' };
    });
    if (new Set(systems.map((s) => s.name)).size !== systems.length) throw badRequest('Each impacted system is listed once.');
    await repo.update(itemId, (d) => {
      d.systems = systems.map((s) => ({ ...(d.systems.find((x) => x.name === s.name) ?? {}), ...s, editedBy: by(actor) }));
      return d;
    });
    await emit('design.systems_changed', { itemId, systems: systems.map((s) => s.name), summary: `set the impacted systems of ${itemId}: ${systems.map((s) => `${s.name} (${s.change})`).join(', ') || 'none'}` }, actor);
    return view(itemId);
  }

  // ---------------------------------------------------------------------------- functional analysis

  function interfaceFields(body, { partial = false } = {}) {
    const out = {};
    if (!partial || 'name' in body) {
      out.name = text(body.name, 160, 'name');
      if (!out.name) throw badRequest('An interface needs a name.', { name: 'required' });
    }
    if (!partial || 'kind' in body) {
      out.kind = body.kind ?? 'api';
      if (!KINDS.has(out.kind)) throw badRequest('An interface is an api, an event or a file.', { kind: 'api | event | file' });
    }
    for (const side of ['from', 'to']) if (!partial || side in body) out[side] = text(body[side], 120, side) ?? '';
    if (!partial || 'contract' in body) out.contract = text(body.contract, 500, 'contract') ?? '';
    return out;
  }

  async function addInterface(itemId, body, actor) {
    await inDesign(itemId);
    const fields = interfaceFields(body ?? {});
    let id;
    await repo.update(itemId, (d) => {
      id = nextId(d, 'interface');
      d.interfaces.push({ id, ...fields, editedBy: by(actor) });
      return d;
    });
    await emit('design.interface_changed', { itemId, interfaceId: id, change: 'added', complete: Boolean(fields.from && fields.to), summary: `added the interface ${id} (${fields.name}) to ${itemId}` }, actor);
    return { ...(await view(itemId)), interfaceId: id };
  }

  async function updateInterface(itemId, ifId, body, actor) {
    await inDesign(itemId);
    const fields = interfaceFields(body ?? {}, { partial: true });
    let found = null;
    await repo.update(itemId, (d) => {
      found = d.interfaces.find((i) => i.id === ifId);
      if (!found) return null;
      Object.assign(found, fields, { editedBy: by(actor) });
      return d;
    });
    if (!found) throw notFound(`${itemId} has no interface ${ifId}.`);
    await emit('design.interface_changed', { itemId, interfaceId: ifId, change: 'changed', complete: Boolean(found.from && found.to), summary: `changed the interface ${ifId} of ${itemId}` }, actor);
    return view(itemId);
  }

  async function removeInterface(itemId, ifId, actor) {
    await inDesign(itemId);
    let found = false;
    await repo.update(itemId, (d) => {
      const before = d.interfaces.length;
      d.interfaces = d.interfaces.filter((i) => i.id !== ifId);
      found = d.interfaces.length < before;
      if (!found) return null;
      for (const s of d.stories) s.interfaces = (s.interfaces ?? []).filter((x) => x !== ifId);
      return d;
    });
    if (!found) throw notFound(`${itemId} has no interface ${ifId}.`);
    await emit('design.interface_changed', { itemId, interfaceId: ifId, change: 'removed', summary: `removed the interface ${ifId} from ${itemId}` }, actor);
    return view(itemId);
  }

  // ---------------------------------------------------------------------------- stories

  /** The lifecycle keeps the stories as items of their own: new ones are created, merged-away ones withdrawn. */
  async function sync(itemId, design, actor, reason = null) {
    const w = workflows();
    if (typeof w?.syncStories !== 'function') throw new HttpError(503, 'lifecycle_unavailable', 'The lifecycle engine is not running here, so the stories cannot become items.');
    const featureOf = (id) => design.features.find((f) => f.id === id);
    return w.syncStories({ itemId, stories: design.stories.map((s) => ({ id: s.id, title: s.title, feature: { id: s.feature, title: featureOf(s.feature)?.title ?? s.feature } })), reason, actor });
  }

  /** The stories the lifecycle says are still in Design (the only ones that may change). */
  async function openStories(itemId, ids) {
    const stages = await storyStages(itemId);
    const gone = ids.filter((id) => handedOff(stages.get(id)));
    if (gone.length) throw conflict('handed_off', `${gone.join(', ')} ${gone.length === 1 ? 'has' : 'have'} been handed off to Engineering, so ${gone.length === 1 ? 'it' : 'they'} can't change here.`);
  }

  /** Checks a story's traces name things the design has. */
  function traces(d, body) {
    const out = {};
    const lists = { requirements: d.requirements.map((r) => r.id), systems: d.systems.map((s) => s.name), interfaces: d.interfaces.map((i) => i.id), technical: d.technical.map((t) => t.id), nfrs: d.nfrs.map((n) => n.id) };
    for (const [key, known] of Object.entries(lists)) {
      if (!(key in body)) continue;
      if (!Array.isArray(body[key])) throw badRequest(`${key} is a list.`, { [key]: 'list' });
      const unknown = body[key].filter((x) => !known.includes(x));
      if (unknown.length) throw badRequest(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in this design's ${key}.`, { [key]: unknown.join(', ') });
      out[key] = [...new Set(body[key])];
    }
    if ('criteria' in body) {
      if (!Array.isArray(body.criteria) || body.criteria.length > 30) throw badRequest('criteria is a list of up to 30.', { criteria: 'list' });
      out.criteria = body.criteria.map((c) => text(typeof c === 'string' ? c : criterionText(c), 600, 'criteria')).filter(Boolean);
    }
    if ('feature' in body) {
      if (!d.features.some((f) => f.id === body.feature)) throw badRequest(`${String(body.feature).slice(0, 40)} is not one of this design's features.`, { feature: 'a feature id' });
      out.feature = body.feature;
    }
    if ('title' in body) {
      out.title = text(body.title, 200, 'title');
      if (!out.title) throw badRequest('A story needs a title.', { title: 'required' });
    }
    return out;
  }

  /**
   * A person names a feature's title and the features it depends on (the feature landscape). A feature can't depend on
   * itself or on one that depends on it, directly or not. Its stories in Design take the new title.
   */
  async function updateFeature(itemId, featureId, body, actor) {
    await inDesign(itemId);
    const title = body && 'title' in body ? text(body.title, 120, 'title') : undefined;
    if (title === null) throw badRequest('A feature needs a title.', { title: 'required' });
    const deps = body && 'dependsOn' in body ? body.dependsOn : undefined;
    if (deps !== undefined && (!Array.isArray(deps) || deps.length > 20)) throw badRequest('dependsOn is a list of feature ids (up to 20).', { dependsOn: 'list' });
    let found = null;
    const saved = await repo.update(itemId, (d) => {
      found = d.features.find((f) => f.id === featureId);
      if (!found) return null;
      if (deps !== undefined) {
        const ids = [...new Set(deps.map(String))];
        const unknown = ids.filter((id) => !d.features.some((f) => f.id === id));
        if (unknown.length) throw badRequest(`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not one of this design's features.`, { dependsOn: unknown.join(', ') });
        if (ids.includes(featureId)) throw badRequest(`${featureId} can't depend on itself.`, { dependsOn: featureId });
        // Would any feature it depends on lead back to it?
        const after = new Map(d.features.map((f) => [f.id, f.id === featureId ? ids : f.dependsOn ?? []]));
        const seen = new Set();
        const back = (id) => id === featureId || (!seen.has(id) && (seen.add(id), (after.get(id) ?? []).some(back)));
        const loop = ids.find(back);
        if (loop) throw badRequest(`${featureId} can't depend on ${loop}: ${loop} already depends on ${featureId}.`, { dependsOn: loop });
        found.dependsOn = ids;
      }
      if (title) found.title = title;
      found.editedBy = by(actor);
      return d;
    });
    if (!found) throw notFound(`${itemId} has no feature ${featureId}.`);
    if (title && saved.stories.some((s) => s.feature === featureId)) await sync(itemId, saved, actor);
    await emit('design.features_changed', { itemId, featureId, dependsOn: found.dependsOn ?? [], summary: `changed the feature ${featureId} of ${itemId}${found.dependsOn?.length ? `: it depends on ${found.dependsOn.join(', ')}` : ''}` }, actor);
    return view(itemId);
  }

  async function updateStory(itemId, storyId, body, actor) {
    await inDesign(itemId);
    await openStories(itemId, [storyId]);
    let found = null;
    const saved = await repo.update(itemId, (d) => {
      found = d.stories.find((s) => s.id === storyId);
      if (!found) return null;
      Object.assign(found, traces(d, body ?? {}), { editedBy: by(actor) });
      return d;
    });
    if (!found) throw notFound(`${itemId} has no story ${storyId}.`);
    await sync(itemId, saved, actor);
    await emit('design.stories_changed', { itemId, change: 'edited', stories: [storyId], summary: `edited ${storyId} of ${itemId}` }, actor);
    return view(itemId);
  }

  /** Two or more stories become the first: their traces and criteria together, in its feature. The others go. */
  async function mergeStories(itemId, body, actor) {
    await inDesign(itemId);
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))] : [];
    if (ids.length < 2) throw badRequest('Name two or more stories to merge.', { ids: 'two or more story ids' });
    await openStories(itemId, ids);
    const title = text(body?.title, 200, 'title');
    let missing = [];
    const saved = await repo.update(itemId, (d) => {
      const picked = ids.map((id) => d.stories.find((s) => s.id === id));
      missing = ids.filter((id, i) => !picked[i]);
      if (missing.length) return null;
      const [into, ...rest] = picked;
      for (const key of ['requirements', 'systems', 'interfaces', 'technical', 'nfrs', 'criteria']) into[key] = [...new Set(picked.flatMap((s) => s[key] ?? []))];
      if (title) into.title = title;
      into.mergedFrom = [...(into.mergedFrom ?? []), ...rest.map((s) => s.id)];
      into.editedBy = by(actor);
      d.stories = d.stories.filter((s) => !rest.includes(s));
      return d;
    });
    if (missing.length) throw notFound(`${itemId} has no story ${missing.join(', ')}.`);
    await sync(itemId, saved, actor, `merged into ${ids[0]}`);
    await emit('design.stories_changed', { itemId, change: 'merged', stories: ids, summary: `merged ${ids.slice(1).join(', ')} into ${ids[0]}` }, actor);
    return view(itemId);
  }

  /** One story becomes several of the same feature: it keeps the first part, each other part is a new story. */
  async function splitStory(itemId, storyId, body, actor) {
    await inDesign(itemId);
    await openStories(itemId, [storyId]);
    const parts = Array.isArray(body?.parts) ? body.parts : [];
    if (parts.length < 2 || parts.length > 10) throw badRequest('Split a story into two to ten parts, each with a title.', { parts: '2–10' });
    const clean = parts.map((p, i) => {
      const t = text(p?.title, 200, `parts[${i}].title`);
      if (!t) throw badRequest('Each part needs a title.', { [`parts[${i}].title`]: 'required' });
      return { title: t, criteria: Array.isArray(p?.criteria) ? p.criteria.map((c) => text(String(c), 600, 'criteria')).filter(Boolean) : null };
    });
    let made = [];
    let found = false;
    const saved = await repo.update(itemId, (d) => {
      const s = d.stories.find((x) => x.id === storyId);
      if (!s) return null;
      found = true;
      const [first, ...others] = clean;
      const at = d.stories.indexOf(s);
      const copies = others.map((p) => ({ ...structuredClone(s), id: nextId(d, 'story'), title: p.title, criteria: p.criteria ?? [], splitFrom: storyId, mergedFrom: undefined, editedBy: by(actor) }));
      Object.assign(s, { title: first.title, criteria: first.criteria ?? s.criteria, editedBy: by(actor) });
      d.stories.splice(at + 1, 0, ...copies.map((c) => JSON.parse(JSON.stringify(c))));
      made = copies.map((c) => c.id);
      return d;
    });
    if (!found) throw notFound(`${itemId} has no story ${storyId}.`);
    await sync(itemId, saved, actor);
    await emit('design.stories_changed', { itemId, change: 'split', stories: [storyId, ...made], summary: `split ${storyId} into ${[storyId, ...made].join(', ')}` }, actor);
    return { ...(await view(itemId)), made };
  }

  /**
   * One story's Design handoff: the lifecycle engine's design-handoff approval, given by this person with Design's
   * readiness checks (or an override with a reason). The story's work items are one per impacted system it touches.
   */
  async function handoff(itemId, storyId, body, actor) {
    await peopleOnly(actor, 'hand a story to Engineering');
    await itemOr404(itemId);
    const design = await repo.get(itemId);
    const story = design?.stories.find((s) => s.id === storyId);
    if (!story) throw notFound(`${itemId} has no story ${storyId}.`);
    const w = workflows();
    if (typeof w?.handoffStory !== 'function') throw new HttpError(503, 'lifecycle_unavailable', 'The lifecycle engine is not running here, so nothing can be handed off.');
    const override = body?.override?.reason ? { reason: text(body.override.reason, 500, 'override.reason') } : null;
    const result = await w.handoffStory({
      storyId, actor,
      workItems: (story.systems ?? []).map((name) => ({ repo: name, title: story.title })),
      note: text(body?.note, 500, 'note'),
      ...(override ? { override } : {}),
    });
    await emit('design.story_handed_off', { itemId, storyId, outcome: result.outcome, summary: `handed ${storyId} · ${story.title} to Engineering` }, actor);
    return { outcome: result.outcome, text: result.text, story: { id: storyId, stage: result.item?.stage ?? null }, design: await view(itemId) };
  }

  /** For the Factory's status card: how much is in Design. */
  async function status() {
    const list = await items();
    const inDesignNow = list.filter((i) => i.stage === 'design').length;
    let gone = 0;
    for (const i of list) {
      const d = await repo.get(i.itemId);
      const stages = await storyStages(i.itemId);
      gone += (d?.stories ?? []).filter((s) => handedOff(stages.get(s.id))).length;
    }
    return { inDesign: inDesignNow, handedOff: gone, text: `${plural(inDesignNow, 'item')} in Design · ${plural(gone, 'story', 'stories')} handed off` };
  }

  /**
   * NooblyJS Phase 20: a person changes one acceptance criterion of a story (`n` from 1: AC-031-2-1 is n 1), with a
   * reason, also after the story's handoff (until it is done): requirements move while a story is built. Nothing else of
   * a handed-off story changes. The Test section marks the criterion's test cases "criterion changed".
   */
  async function changeCriterion(itemId, storyId, n, body, actor) {
    await peopleOnly(actor, `change ${storyId}'s acceptance criteria`);
    const index = Number(n) - 1;
    const words = text(body?.text, 600, 'text');
    const reason = text(body?.reason, 500, 'reason');
    if (!words) throw badRequest('Say what the criterion is now.', { text: 'required' });
    if (!reason) throw badRequest('Say why it changes.', { reason: 'required' });
    const lifecycle = (await storyStages(itemId)).get(storyId);
    if (lifecycle && lifecycle.status !== 'active') throw conflict('not_active', `${storyId} is ${lifecycle.status}: its criteria don't change any more.`);
    let from = null;
    const saved = await repo.update(itemId, (d) => {
      const story = d.stories.find((x) => x.id === storyId);
      if (!story) return null;
      if (!Number.isInteger(index) || index < 0 || index >= (story.criteria ?? []).length) throw notFound(`${storyId} has no criterion ${n}.`);
      from = story.criteria[index];
      if (from === words) return d;
      story.criteria = story.criteria.map((c, i) => (i === index ? words : c));
      story.criteriaHistory = [...(story.criteriaHistory ?? []), { at: now(), by: by(actor), n: index + 1, from, to: words, reason }];
      return d;
    });
    if (!saved) throw notFound(`${itemId} has no story ${storyId}.`);
    const ref = `AC-${String(storyId).replace(/^STORY-/, '')}-${index + 1}`;
    if (from !== words) {
      await emit('design.criterion_changed', { itemId: storyId, parentId: itemId, storyId, index, ref, from, to: words, reason, summary: `changed ${ref} of ${storyId}: "${words.slice(0, 80)}" (${reason})` }, actor);
    }
    return view(itemId);
  }

  return {
    view, items, draft, readinessFacts, acceptRequirement, editRequirement, setSystems,
    addInterface, updateInterface, removeInterface, updateFeature, updateStory, mergeStories, splitStory, handoff, status, changeCriterion,
  };
}
