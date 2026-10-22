// Objectives and key results (NooblyJS Phase 25b): what the product work is for. An objective (OBJ-04) sits in Now,
// Next or Later, works towards strategic themes, and is served by epics, features, ideas and specs (its links; an item
// serves at most one objective). Its key results each have a measure, a start, a target and a source: the monitor
// (Operations' monitoring adapter, the mock for now) or typed in by a person. Reading from Metrics waits until Metrics
// measures named things for other apps `[CONFIRM]`.
//
// A key result is "met" when its latest reading reaches its target; "behind" when an outcome review of an item serving
// its objective measured it short of its target (Operations' outcome_review.closed); otherwise "on the way" once it has
// a reading, or "not measured yet". Scoring stays RICE: an objective never changes an item's score.
//
// Creating and editing an objective takes `draft`; moving it between horizons takes `approve` (a Product lead), people
// only. Every change is audited and an event.
import { HttpError, notFound, conflict } from '../util/errors.js';
import { nextNumbered } from '../util/ids.js';
import { HORIZONS, HORIZON_WORDS, isHorizon } from './horizons.js';

const SOURCES = { monitor: 'the monitor', typed: 'typed in' };
const LINKABLE = /^(IDEA|PRD|FEAT|EPIC|PEPIC)-\d{3,}$/;
const invalid = (message, details) => new HttpError(422, 'invalid', message, details);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const lower = (s) => String(s ?? '').toLowerCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The number in "18%", "1.8 s", "45": null when there is none. */
export const num = (text) => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(text ?? ''));
  return m ? Number(m[0].replace(',', '.')) : null;
};

/** Has `value` reached the target? Down is better when the target is below the start. */
export function reached(kr, value) {
  const [start, target, v] = [num(kr.start), num(kr.target), num(value)];
  if (start === null || target === null || v === null) return null;
  return target >= start ? v >= target : v <= target;
}

/** A key result's status and words. */
export function keyResultView(kr) {
  const readings = kr.readings ?? [];
  const latest = readings.at(-1) ?? null;
  const met = latest ? reached(kr, latest.value) : null;
  const lastReview = [...readings].reverse().find((r) => r.from === 'outcome-review') ?? null;
  const status = met === true ? 'met'
    : lastReview && reached(kr, lastReview.value) === false && latest === lastReview ? 'behind'
      : latest ? 'on-the-way' : 'not-measured';
  const statusText = { met: 'Met', behind: 'Behind', 'on-the-way': 'On the way', 'not-measured': 'Not measured yet' }[status];
  const from = latest ? { monitor: 'from the monitor', typed: 'typed in', 'outcome-review': `at ${latest.itemId ?? 'an item'}'s outcome review` }[latest.from] ?? latest.from : null;
  return {
    ...kr, now: latest?.value ?? null, status, statusText, sourceText: SOURCES[kr.source] ?? kr.source,
    text: `${kr.measure}: ${kr.start} → ${latest ? `${latest.value} now` : 'not measured yet'}, target ${kr.target}${latest ? ` (${statusText.toLowerCase()}, ${from})` : ''}`,
  };
}

/** "1 of 1 key result behind", "2 of 3 key results met", "No key results yet". */
export function progressText(krs) {
  if (!krs.length) return 'No key results yet';
  const behind = krs.filter((k) => k.status === 'behind').length;
  if (behind) return `${behind} of ${plural(krs.length, 'key result')} behind`;
  const met = krs.filter((k) => k.status === 'met').length;
  return `${met} of ${plural(krs.length, 'key result')} met`;
}

export function createObjectives({ repos, host }) {
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });
  const audit = (entry) => host.audit?.record?.(entry);

  async function getOr404(id) {
    const o = /^OBJ-\d{2,}$/.test(String(id)) ? await repos.objectives.get(id) : null;
    if (!o) throw notFound(`There is no objective ${String(id).slice(0, 20)}.`);
    return o;
  }

  /** Reads a monitor key result's measure today (Operations), or null. */
  async function readMonitor(kr) {
    const ops = host.service?.('operations');
    if (typeof ops?.measure !== 'function') return null;
    const r = await Promise.resolve(ops.measure({ measure: kr.measure, today: kr.start, target: kr.target })).catch(() => null);
    return r?.value ?? null;
  }

  /** What an item's objective is: Map-like { of(itemId, ideaId, featureId) } → the objective, or null. */
  async function index() {
    const all = await repos.objectives.list();
    const by = new Map();
    for (const o of all) for (const id of o.links ?? []) if (!by.has(id)) by.set(id, { id: o.id, title: o.title, horizon: o.horizon });
    return { of: (...ids) => ids.filter(Boolean).map((id) => by.get(id)).find(Boolean) ?? null, all };
  }

  /** An objective as its page shows it. */
  async function view(o) {
    const [specs, ideas, catalogueDoc] = await Promise.all([repos.specs.list(), repos.ideas.list(), repos.catalogue.get()]);
    const titles = new Map([...specs, ...ideas].map((r) => [r.id, r.title]));
    for (const e of catalogueDoc?.epics ?? []) titles.set(e.id, e.name);
    for (const f of catalogueDoc?.features ?? []) titles.set(f.id, f.name);
    const krs = (o.keyResults ?? []).map(keyResultView);
    const served = (o.links ?? []).map((id) => {
      const record = specs.find((s) => s.id === id) ?? ideas.find((i) => i.id === id) ?? null;
      const h = record?.horizon ?? null;
      const mismatch = h && HORIZONS.indexOf(o.horizon) > HORIZONS.indexOf(h) ? `${id} is in ${HORIZON_WORDS[h]}, but ${o.id} is in ${HORIZON_WORDS[o.horizon]}` : null;
      return { id, title: titles.get(id) ?? id, horizon: h, horizonText: h ? HORIZON_WORDS[h] : null, mismatch };
    });
    return {
      id: o.id, title: o.title, description: String(o.body ?? '').trim(), horizon: o.horizon, horizonText: HORIZON_WORDS[o.horizon],
      themes: o.themes ?? [], links: served, keyResults: krs, progressText: progressText(krs),
      mismatches: served.map((s) => s.mismatch).filter(Boolean), owner: o.owner ?? null, version: o.version ?? 1,
      sampleData: o.sampleData === true, createdAt: o.createdAt ?? null,
    };
  }

  async function list() {
    const all = (await repos.objectives.list()).sort((a, b) => HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    return Promise.all(all.map(view));
  }

  const get = async (id) => view(await getOr404(id));

  async function checkThemes(themes) {
    if (themes === undefined) return undefined;
    if (!Array.isArray(themes) || themes.length > 10) throw invalid('Themes are a list of strategic themes.', { themes: 'a list' });
    const known = ((await repos.catalogue.get())?.themes ?? []).map((t) => t.name);
    const out = [];
    for (const t of themes) {
      const found = known.find((k) => lower(k) === lower(t));
      if (!found) throw invalid(`There is no strategic theme "${String(t).slice(0, 40)}".`, { themes: known.join(', ') });
      if (!out.includes(found)) out.push(found);
    }
    return out;
  }

  /** Each id must be an idea, spec, feature or epic that exists, and serve no other objective. */
  async function checkLinks(links, selfId = null) {
    if (links === undefined) return undefined;
    if (!Array.isArray(links) || links.length > 100) throw invalid('Links are a list of ids (IDEA-019, PRD-031, FEAT-001, EPIC-001).', { links: 'a list' });
    const [specs, ideas, c, objectives] = await Promise.all([repos.specs.list(), repos.ideas.list(), repos.catalogue.get(), repos.objectives.list()]);
    const exists = new Set([...specs.map((s) => s.id), ...ideas.map((i) => i.id), ...(c?.features ?? []).map((f) => f.id), ...(c?.epics ?? []).map((e) => e.id)]);
    const out = [];
    for (const raw of links) {
      const id = String(raw ?? '').trim().toUpperCase();
      if (!LINKABLE.test(id) || !exists.has(id)) throw invalid(`There is no idea, spec, feature or epic ${id.slice(0, 20)}.`, { links: id.slice(0, 20) });
      const other = objectives.find((o) => o.id !== selfId && (o.links ?? []).includes(id));
      if (other) throw conflict(`${id} serves ${other.id} already: an item serves one objective. Take it off ${other.id} first.`, { links: id, objective: other.id });
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  /** A person with draft creates one: { title, horizon?, description?, themes?, links? }. */
  async function create(body = {}, actor) {
    const title = clean(body.title, 120);
    if (!title) throw invalid('Say what the objective is.', { title: 'what it is' });
    const horizon = body.horizon ?? 'now';
    if (!isHorizon(horizon)) throw invalid('Put it in now, next or later.', { horizon: HORIZONS.join(', ') });
    const themes = (await checkThemes(body.themes)) ?? [];
    const links = (await checkLinks(body.links)) ?? [];
    const o = await repos.objectives.withFolderLock(async () => {
      const id = nextNumbered('OBJ', (await repos.objectives.list()).map((x) => x.id), 2);
      const record = { id, title, horizon, themes, links, keyResults: [], owner: actor.id, version: 1, createdAt: now(), createdBy: actor.id, body: clean(body.description, 2000) };
      await repos.objectives.write(record);
      return record;
    });
    await audit({ actor: actor.id, action: 'objective.created', target: o.id, system: 'product', horizon });
    await emit('objective.created', { objectiveId: o.id, horizon, summary: `set the objective ${o.id} · ${title} in ${HORIZON_WORDS[horizon]}` }, actor);
    return get(o.id);
  }

  /** { title?, description?, themes?, links? } (draft). The horizon moves with move() (approve). */
  async function update(id, body = {}, actor) {
    if (body.horizon !== undefined) throw new HttpError(400, 'bad_request', 'Move an objective between horizons with POST /objectives/:id/move (a Product lead).');
    const themes = await checkThemes(body.themes);
    const links = await checkLinks(body.links, id);
    const fields = [];
    await repos.objectives.update(id, (o) => {
      if (!o) throw notFound(`There is no objective ${id}.`);
      const next = { ...o, version: (o.version ?? 1) + 1, updatedAt: now(), updatedBy: actor.id };
      if (body.title !== undefined) { const t = clean(body.title, 120); if (!t) throw invalid('Say what the objective is.', { title: 'what it is' }); next.title = t; fields.push('title'); }
      if (body.description !== undefined) { next.body = clean(body.description, 2000); fields.push('description'); }
      if (themes !== undefined) { next.themes = themes; fields.push('themes'); }
      if (links !== undefined) { next.links = links; fields.push('links'); }
      return next;
    });
    await audit({ actor: actor.id, action: 'objective.updated', target: id, system: 'product', fields });
    await emit('objective.updated', { objectiveId: id, fields, summary: `changed ${id}'s ${fields.join(', ') || 'nothing'}` }, actor);
    return get(id);
  }

  /** A Product lead moves it to another horizon (the route checks approve and that it is a person). */
  async function move(id, horizon, actor) {
    if (!isHorizon(horizon)) throw invalid('Move it to now, next or later.', { horizon: HORIZONS.join(', ') });
    let from = null;
    await repos.objectives.update(id, (o) => {
      if (!o) throw notFound(`There is no objective ${id}.`);
      from = o.horizon;
      return { ...o, horizon, version: (o.version ?? 1) + 1, movedAt: now(), movedBy: actor.id };
    });
    await audit({ actor: actor.id, action: 'objective.moved', target: id, system: 'product', from, to: horizon });
    await emit('objective.moved', { objectiveId: id, from, to: horizon, summary: `moved ${id} from ${HORIZON_WORDS[from]} to ${HORIZON_WORDS[horizon]}` }, actor);
    return get(id);
  }

  /** A key result: { measure, start, target, source: monitor | typed, now? }. A monitor one is read at once. */
  async function addKeyResult(id, body = {}, actor) {
    const kr = { measure: clean(body.measure, 160), start: clean(body.start, 40), target: clean(body.target, 40), source: body.source ?? 'typed' };
    if (!kr.measure) throw invalid('Name the measure.', { measure: 'what is measured' });
    if (!kr.start || !kr.target) throw invalid('Give where it starts and its target, like 18% and 45%.', { start: 'where it starts', target: 'its target' });
    if (num(kr.start) === null || num(kr.target) === null) throw invalid('The start and the target need a number in them.', { start: 'a number', target: 'a number' });
    if (!Object.hasOwn(SOURCES, kr.source)) throw invalid('Read it from the monitor, or type it in. Metrics can\'t be read yet.', { source: Object.keys(SOURCES).join(', ') });
    const first = kr.source === 'monitor' ? await readMonitor(kr) : clean(body.now, 40) || null;
    let made;
    await repos.objectives.update(id, (o) => {
      if (!o) throw notFound(`There is no objective ${id}.`);
      const n = (o.keyResults ?? []).length + 1;
      made = { id: `KR-${id.slice(4)}-${n}`, ...kr, readings: first ? [{ value: first, at: now(), from: kr.source }] : [], createdBy: actor.id };
      return { ...o, keyResults: [...(o.keyResults ?? []), made], version: (o.version ?? 1) + 1 };
    });
    await audit({ actor: actor.id, action: 'objective.key_result_added', target: id, system: 'product', keyResult: made.id, source: kr.source });
    await emit('objective.updated', { objectiveId: id, fields: ['keyResults'], summary: `added the key result ${made.id} to ${id}: ${kr.measure}, ${kr.start} → ${kr.target}` }, actor);
    return get(id);
  }

  /** A reading: typed by a person ({ value }), or read again from the monitor ({ refresh: true }). */
  async function measure(id, krId, body = {}, actor) {
    const o = await getOr404(id);
    const kr = (o.keyResults ?? []).find((k) => k.id === krId);
    if (!kr) throw notFound(`${id} has no key result ${String(krId).slice(0, 20)}.`);
    const value = body.refresh === true ? (kr.source === 'monitor' ? await readMonitor(kr) : null) : clean(body.value, 40);
    if (!value) throw invalid(body.refresh === true ? 'This key result is typed in, or the monitor has nothing for it.' : 'Give the value today, like 31.5%.', { value: 'the value today' });
    if (num(value) === null) throw invalid('The value needs a number in it.', { value: 'a number' });
    const from = body.refresh === true ? 'monitor' : 'typed';
    await recordReading(id, krId, { value, from }, actor);
    return get(id);
  }

  async function recordReading(id, krId, reading, actor) {
    await repos.objectives.update(id, (o) => o && { ...o, keyResults: o.keyResults.map((k) => (k.id === krId ? { ...k, readings: [...(k.readings ?? []), { ...reading, at: now() }].slice(-50) } : k)) });
    await audit({ actor: actor?.id ?? 'product', action: 'objective.key_result_measured', target: id, system: 'product', keyResult: krId, value: reading.value, from: reading.from });
    await emit('objective.key_result_measured', { objectiveId: id, keyResult: krId, value: reading.value, from: reading.from, summary: `${krId} of ${id} is ${reading.value} (${reading.from === 'outcome-review' ? `${reading.itemId}'s outcome review` : reading.from})` }, actor ?? null);
  }

  /**
   * Operations' outcome_review.closed: each measured goal moves the key results with the same measure, on the
   * objectives the item (or its idea or feature) serves.
   */
  async function onOutcomeReviewed(event) {
    const p = event?.payload ?? {};
    const measured = Array.isArray(p.measured) ? p.measured : [];
    if (!p.itemId || !measured.length) return 0;
    const spec = await repos.specs.get(p.itemId).catch(() => null);
    const ids = new Set([p.itemId, spec?.idea, spec?.feature].filter(Boolean));
    let moved = 0;
    for (const o of await repos.objectives.list()) {
      if (!(o.links ?? []).some((id) => ids.has(id))) continue;
      for (const kr of o.keyResults ?? []) {
        const goal = measured.find((g) => lower(g.measure) === lower(kr.measure));
        if (!goal?.now) continue;
        await recordReading(o.id, kr.id, { value: String(goal.now), from: 'outcome-review', itemId: p.itemId, outcomeId: p.outcomeId ?? null }, null);
        moved += 1;
      }
    }
    return moved;
  }

  /** Every key result's progress (Metrics' Product reports). */
  async function progress() {
    const all = await list();
    return all.flatMap((o) => o.keyResults.map((k) => ({ objective: `${o.id} ${o.title}`, horizon: o.horizonText, keyResult: k.id, text: k.text, status: k.status, statusText: k.statusText })));
  }

  return { index, list, get, create, update, move, addKeyResult, measure, onOutcomeReviewed, progress };
}
