// The roadmap from the items themselves (NooblyJS Phase 25b; it replaces roadmap.yaml). Each spec and idea can be
// placed in Now, Next or Later (horizons.js) by a person with `draft`; the roadmap shows them in those columns with the
// objective they serve, their team (the lifecycle item's), their days, their release (Operations) and Design's features
// with what each depends on. Grouped by portfolio, theme, objective or team. Capacity in Now: each NooblyJS team's
// people-days against the days of its items in Now, said in words. Next and Later show their days, unchecked.
//
// An item's days: its business case's people-days estimate when it has one (Phase 17), else the days planned for it on
// the roadmap (the seed's are sample data), else "not estimated".
//
// Saved views (roadmap-views.yaml) are shared: a name, a grouping and filters; each has a read-only page.
import { HttpError, notFound } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { horizons, isHorizon, HORIZON_WORDS, HORIZONS } from './horizons.js';
import { specStatusText } from './views.js';
import { stageFor, stageLabel } from './stages.js';

export const GROUPS = ['none', 'portfolio', 'theme', 'objective', 'team'];
const GROUP_WORDS = { none: 'Everything', portfolio: 'Portfolio', theme: 'Strategic theme', objective: 'Objective', team: 'Team' };
const invalid = (message, details) => new HttpError(422, 'invalid', message, details);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => String(s ?? '').toLowerCase();
const r1 = (n) => Math.round(n * 10) / 10;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function createPlanning({ repos, host, log, objectives }) {
  const nowMs = () => Number(host.clock?.now?.() ?? Date.now());
  const svc = (name) => host.service?.(name);
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });

  /**
   * roadmap.yaml (the seed's, before Phase 25b) moves onto the specs once: each item in it goes to Now with its stage
   * spans as its plan and its days. The file is then renamed roadmap.yaml.moved. Does nothing when there is no file.
   */
  async function migrate() {
    const doc = await repos.roadmap.get().catch(() => null);
    if (!doc) return { moved: 0 };
    let moved = 0;
    for (const entry of doc.items ?? []) {
      const updated = await repos.specs.update(entry.id, (spec) => (spec && !spec.horizon ? {
        ...spec, horizon: 'now',
        plan: { spans: (entry.spans ?? []).map((s) => ({ stage: s.stage, from: s.from, to: s.to })), days: Number.isFinite(Number(entry.days)) ? Number(entry.days) : null, ...(doc.sampleData !== false ? { sampleData: true } : {}) },
      } : null)).catch(() => null);
      if (updated) moved += 1;
    }
    await repos.roadmap.retire().catch((err) => log?.warn?.(`product: roadmap.yaml was not renamed: ${err.message}`));
    log?.info?.(`product: moved ${moved} roadmap item${moved === 1 ? '' : 's'} from roadmap.yaml onto their specs (Phase 25b)`);
    return { moved };
  }

  /** An item's days: { value, source, text }. */
  async function daysOf(record, cases) {
    const ideaId = /^IDEA-/.test(record.id) ? record.id : record.idea;
    const c = ideaId ? cases.get(ideaId) : null;
    const estimated = Number(c?.estimate?.peopleDays);
    if (Number.isFinite(estimated) && estimated > 0) return { value: estimated, source: 'business-case', text: `${r1(estimated)} days (business case)` };
    const planned = Number(record.plan?.days);
    if (Number.isFinite(planned) && planned > 0) return { value: planned, source: 'planned', text: `${r1(planned)} days planned` };
    return { value: null, source: null, text: 'Not estimated' };
  }

  /** Everything the roadmap needs, read once. */
  async function gather() {
    const [specs, ideas, catalogueDoc, caseList, teamsList, releases, objectiveIndex] = await Promise.all([
      repos.specs.list(), repos.ideas.list(), repos.catalogue.get(), repos.businessCases.list().catch(() => []),
      Promise.resolve(svc('teams')?.list?.()).catch(() => []),
      Promise.resolve(svc('operations')?.releases?.()).catch(() => []),
      objectives.index(),
    ]);
    const products = new Map((catalogueDoc?.products ?? []).map((p) => [lower(p.name), p]));
    const portfolios = new Map((catalogueDoc?.portfolios ?? []).map((p) => [lower(p.name), p]));
    const cases = new Map(caseList.map((c) => [c.owner ?? c.id, c]));
    return { specs, ideas, products, portfolios, cases, teams: teamsList ?? [], releases: releases ?? [], objectiveIndex };
  }

  /** One item as the roadmap shows it. */
  async function itemView(record, g, ctx, { withFeatures = false } = {}) {
    const isSpec = /^PRD-/.test(record.id);
    const product = record.product ? g.products.get(lower(record.product)) : null;
    const portfolio = product?.portfolio ?? null;
    const themes = portfolio ? g.portfolios.get(lower(portfolio))?.themes ?? [] : [];
    const life = await Promise.resolve(svc('workflows')?.item?.({ itemId: record.id })).catch(() => null);
    const team = life?.team ? g.teams.find((t) => t.id === life.team) ?? { id: life.team, name: life.team } : null;
    const objective = g.objectiveIndex.of(record.id, record.idea, record.feature);
    const days = await daysOf(record, g.cases);
    const release = g.releases.filter((r) => r.itemId === record.id).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0] ?? null;
    const horizon = isHorizon(record.horizon) ? record.horizon : null;
    const current = isSpec ? stageFor('spec', record.status) : stageFor('idea');
    let features = [];
    if (withFeatures && isSpec) {
      const d = await Promise.resolve(svc('design')?.designFor?.(record.id)).catch(() => null);
      features = (d?.features ?? []).map((f) => ({ id: f.id, title: f.title ?? f.id, dependsOn: f.dependsOn ?? [], text: f.dependsOn?.length ? `depends on ${f.dependsOn.join(', ')}` : 'depends on nothing' }));
    }
    const mismatch = horizon && objective && HORIZONS.indexOf(objective.horizon) > HORIZONS.indexOf(horizon)
      ? `${record.id} is in ${HORIZON_WORDS[horizon]}, but ${objective.id} is in ${HORIZON_WORDS[objective.horizon]}` : null;
    return {
      id: record.id, kind: isSpec ? 'spec' : 'idea', title: record.title, product: record.product ?? null, portfolio, valueStream: product?.valueStream ?? null, themes,
      horizon, horizonText: horizon ? HORIZON_WORDS[horizon] : 'Not placed',
      objective: objective ? { id: objective.id, title: objective.title, horizon: objective.horizon, horizonText: HORIZON_WORDS[objective.horizon] } : null,
      team, days, status: record.status ?? 'open', statusText: isSpec ? specStatusText(ctx, record) : record.status === 'accepted' ? 'Accepted' : 'Idea',
      current: current ? { key: current.key ?? null, label: current.label ?? null } : null,
      release: release ? { id: release.id, name: release.name, version: release.version ?? null, statusText: release.statusText, inProduction: Boolean(release.inProduction), href: release.href } : null,
      spans: (record.plan?.spans ?? []).map((s) => ({ ...s, label: stageLabel(s.stage), current: s.stage === current?.key })),
      features, mismatch,
    };
  }

  /** Which items the roadmap considers: specs, and ideas that have no spec and are on the board (not suggested, merged or closed). */
  function candidates(g) {
    const specced = new Set(g.specs.map((s) => s.idea).filter(Boolean));
    return [...g.specs, ...g.ideas.filter((i) => !specced.has(i.id) && !['suggested', 'merged', 'closed'].includes(i.status ?? 'open'))];
  }

  /** Capacity in Now, per team that has items there or a capacity: [{ team, capacity, planned, unestimated, over, text }]. */
  function capacityOf(items, teams) {
    const out = [];
    const inNow = items.filter((i) => i.horizon === 'now');
    const ids = new Set([...inNow.map((i) => i.team?.id).filter(Boolean), ...teams.filter((t) => Number(t.capacityDays) > 0).map((t) => t.id)]);
    for (const id of ids) {
      const team = teams.find((t) => t.id === id) ?? { id, name: id };
      const mine = inNow.filter((i) => i.team?.id === id);
      const planned = r1(mine.reduce((n, i) => n + (i.days.value ?? 0), 0));
      const unestimated = mine.filter((i) => i.days.value == null).length;
      const capacity = Number(team.capacityDays) > 0 ? Number(team.capacityDays) : null;
      const over = capacity != null && planned > capacity;
      const text = capacity == null
        ? `${team.name}: ${planned} days planned in Now; its capacity isn't set (Teams & roles)`
        : `${team.name}: ${planned} of ${capacity} days planned in Now${over ? `, ${r1(planned - capacity)} over` : ''}`;
      out.push({ team: { id, name: team.name }, capacity, planned, unestimated, over, text: `${text}${unestimated ? ` · ${plural(unestimated, 'item')} not estimated` : ''}`, items: mine.map((i) => i.id) });
    }
    return out.sort((a, b) => Number(b.over) - Number(a.over) || a.team.name.localeCompare(b.team.name));
  }

  /** The value(s) of an item for a grouping: a portfolio, its themes, its objective, its team. */
  const groupValues = (item, by) => {
    if (by === 'portfolio') return [item.portfolio ?? 'In no portfolio'];
    if (by === 'theme') return item.themes.length ? item.themes : ['No strategic theme'];
    if (by === 'objective') return [item.objective ? `${item.objective.id} ${item.objective.title}` : 'Serves no objective'];
    if (by === 'team') return [item.team?.name ?? 'No team'];
    return ['Everything'];
  };

  const matches = (item, filter) => (!filter.portfolio || lower(item.portfolio) === lower(filter.portfolio))
    && (!filter.theme || item.themes.some((t) => lower(t) === lower(filter.theme)))
    && (!filter.objective || item.objective?.id === filter.objective)
    && (!filter.team || item.team?.id === filter.team || lower(item.team?.name) === lower(filter.team));

  /**
   * The roadmap: { horizons, lanes [{ label, columns { now, next, later } }], unplaced, capacity, timeline, filter,
   * groupBy, mismatches, choices }.
   */
  async function roadmap(ctx, { groupBy = 'none', filter = {} } = {}) {
    if (!GROUPS.includes(groupBy)) throw invalid(`Group by one of: ${GROUPS.join(', ')}.`, { groupBy: GROUPS.join(', ') });
    const g = await gather();
    const all = await Promise.all(candidates(g).map((r) => itemView(r, g, ctx, { withFeatures: r.horizon === 'now' })));
    const shown = all.filter((i) => matches(i, filter));
    const placed = shown.filter((i) => i.horizon);
    const laneNames = [...new Set(placed.flatMap((i) => groupValues(i, groupBy)))].sort();
    const lanes = laneNames.map((label) => ({
      label,
      columns: Object.fromEntries(HORIZONS.map((h) => [h, placed.filter((i) => i.horizon === h && groupValues(i, groupBy).includes(label))])),
    }));
    const hs = horizons(nowMs());
    const totals = Object.fromEntries(HORIZONS.map((h) => {
      const list = placed.filter((i) => i.horizon === h);
      return [h, { items: list.length, days: r1(list.reduce((n, i) => n + (i.days.value ?? 0), 0)) }];
    }));
    const nowWindow = hs[0];
    return {
      horizons: hs.map((x) => ({ ...x, ...totals[x.key], totalText: `${plural(totals[x.key].items, 'item')} · ${totals[x.key].days} days` })),
      groupBy, groupText: GROUP_WORDS[groupBy], filter,
      lanes,
      unplaced: shown.filter((i) => !i.horizon).map(({ id, kind, title, product, statusText, days }) => ({ id, kind, title, product, statusText, days })),
      // Capacity is over the whole of Now, whatever the filter shows.
      capacity: capacityOf(all, g.teams),
      mismatches: shown.map((i) => i.mismatch).filter(Boolean),
      timeline: {
        quarter: 'Now', from: nowWindow.from, to: nowWindow.to,
        items: placed.filter((i) => i.horizon === 'now' && i.spans.length).map((i) => ({ id: i.id, title: i.title, current: i.current, spans: i.spans, release: i.release })),
      },
      choices: {
        groups: GROUPS.map((key) => ({ key, label: GROUP_WORDS[key] })),
        portfolios: [...new Set(all.map((i) => i.portfolio).filter(Boolean))].sort(),
        themes: [...new Set(all.flatMap((i) => i.themes))].sort(),
        objectives: (await objectives.list()).map((o) => ({ id: o.id, title: o.title })),
        teams: g.teams.map((t) => ({ id: t.id, name: t.name })),
      },
    };
  }

  /**
   * The Now timeline alone, for the Product board: the specs in Now with their planned stage spans, in the shape the
   * board's roadmap card has always drawn ({ quarter, from, to, items }). Lighter than roadmap(): no other app is asked.
   */
  async function timeline(ctx) {
    const nowWindow = horizons(nowMs())[0];
    const specs = (await repos.specs.list()).filter((s) => s.horizon === 'now' && s.plan?.spans?.length).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    return {
      quarter: 'Now', from: nowWindow.from, to: nowWindow.to,
      items: specs.map((s) => {
        const current = stageFor('spec', s.status);
        const spans = s.plan.spans.map((x) => ({ stage: x.stage, label: stageLabel(x.stage), from: x.from, to: x.to, current: x.stage === current?.key }));
        return { id: s.id, title: s.title, product: s.product ?? null, status: s.status, statusText: specStatusText(ctx, s), current, from: spans.map((x) => x.from).sort()[0] ?? null, to: spans.map((x) => x.to).sort().at(-1) ?? null, spans };
      }),
    };
  }

  /** A person moves an item (a spec or an idea) to Now, Next or Later, or takes it off the roadmap (null). */
  async function move(id, horizon, actor) {
    if (horizon !== null && !isHorizon(horizon)) throw invalid('Move it to now, next or later (or null to take it off the roadmap).', { horizon: 'now, next, later or null' });
    const repo = /^PRD-\d{3,}$/.test(String(id)) ? repos.specs : /^IDEA-\d{3,}$/.test(String(id)) ? repos.ideas : null;
    if (!repo) throw notFound(`There is no spec or idea ${String(id).slice(0, 20)}.`);
    let from = null;
    const updated = await repo.update(id, (r) => {
      if (!r) throw notFound(`There is no spec or idea ${id}.`);
      if (['merged', 'closed', 'suggested'].includes(r.status)) throw new HttpError(409, 'conflict', `${id} is ${r.status}: put it on the board first.`);
      from = r.horizon ?? null;
      return { ...r, horizon, horizonChangedAt: new Date(nowMs()).toISOString(), horizonChangedBy: actor.id };
    });
    const words = (h) => (h ? HORIZON_WORDS[h] : 'off the roadmap');
    await host.audit?.record?.({ actor: actor.id, action: 'roadmap.moved', target: id, system: 'product', from, to: horizon });
    await emit('roadmap.moved', { itemId: id, from, to: horizon, summary: `moved ${id} · ${updated.title} from ${words(from)} to ${words(horizon)}` }, actor);
    return { id, from, horizon, text: `${id} is in ${words(horizon)} now.` };
  }

  /** Days an item plans to take, typed by a person when it has no business case: { days } (or null). */
  async function setDays(id, days, actor) {
    const value = days === null ? null : Number(days);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 2000)) throw invalid('Days are a number from 0 to 2,000.', { days: 'a number' });
    const repo = /^PRD-/.test(String(id)) ? repos.specs : /^IDEA-/.test(String(id)) ? repos.ideas : null;
    if (!repo) throw notFound(`There is no spec or idea ${String(id).slice(0, 20)}.`);
    await repo.update(id, (r) => {
      if (!r) throw notFound(`There is no spec or idea ${id}.`);
      return { ...r, plan: { ...(r.plan ?? {}), days: value } };
    });
    await host.audit?.record?.({ actor: actor.id, action: 'roadmap.days_planned', target: id, system: 'product', days: value });
    await emit('roadmap.days_planned', { itemId: id, days: value, summary: `planned ${value ?? 'no'} days for ${id}` }, actor);
    return { id, days: value };
  }

  // ---------------------------------------------------------------------------- saved views

  const cleanFilter = (f = {}) => Object.fromEntries(['portfolio', 'theme', 'objective', 'team'].map((k) => [k, typeof f[k] === 'string' && f[k].trim() ? f[k].trim().slice(0, 80) : null]).filter(([, v]) => v));

  async function views() {
    return repos.roadmapViews.list();
  }

  async function saveView(body = {}, actor) {
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!name) throw invalid('Give the view a name.', { name: 'a name' });
    const groupBy = GROUPS.includes(body.groupBy) ? body.groupBy : 'none';
    const view = { id: newId('rmv', 8), name, groupBy, filter: cleanFilter(body.filter), createdBy: actor.id, createdAt: new Date(nowMs()).toISOString() };
    await repos.roadmapViews.update((list) => ({ views: [...list, view], answer: null }));
    await host.audit?.record?.({ actor: actor.id, action: 'roadmap.view_saved', target: view.id, system: 'product', name });
    await emit('roadmap.view_saved', { viewId: view.id, name, summary: `saved the roadmap view "${name}"` }, actor);
    return view;
  }

  async function view(id) {
    const v = (await repos.roadmapViews.list()).find((x) => x.id === id);
    if (!v) throw notFound(`There is no saved roadmap view ${String(id).slice(0, 30)}.`);
    return v;
  }

  async function removeView(id, actor) {
    await view(id);
    await repos.roadmapViews.update((list) => ({ views: list.filter((x) => x.id !== id), answer: null }));
    await host.audit?.record?.({ actor: actor.id, action: 'roadmap.view_removed', target: id, system: 'product' });
    return { removed: id };
  }

  /** Planned days by objective and by horizon (Metrics' Product reports). */
  async function plannedDays(ctx) {
    const r = await roadmap(ctx);
    const items = r.lanes.flatMap((l) => HORIZONS.flatMap((h) => l.columns[h]));
    const byObjective = new Map();
    for (const i of items) {
      const key = i.objective ? `${i.objective.id} ${i.objective.title}` : 'Serves no objective';
      byObjective.set(key, r1((byObjective.get(key) ?? 0) + (i.days.value ?? 0)));
    }
    return {
      byObjective: [...byObjective].map(([label, days]) => ({ label, days })).sort((a, b) => b.days - a.days),
      byHorizon: r.horizons.map((h) => ({ label: h.label, days: h.days, items: h.items })),
    };
  }

  /** The Product reports for Metrics: feedback by month and by portfolio, planned days, every key result's progress. */
  async function reports(ctx) {
    const [notes, catalogueDoc] = await Promise.all([repos.notes.list(), repos.catalogue.get()]);
    const portfolioOf = new Map((catalogueDoc?.products ?? []).map((p) => [lower(p.name), p.portfolio ?? null]));
    const byMonth = new Map();
    const byPortfolio = new Map();
    for (const n of notes) {
      const month = String(n.createdAt ?? '').slice(0, 7);
      if (month) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      const p = (n.product && portfolioOf.get(lower(n.product))) || 'No portfolio';
      byPortfolio.set(p, (byPortfolio.get(p) ?? 0) + 1);
    }
    return {
      feedback: {
        total: notes.length,
        byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, label: `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`, count })),
        byPortfolio: [...byPortfolio].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      },
      plannedDays: await plannedDays(ctx),
      keyResults: await objectives.progress(),
    };
  }

  return { migrate, roadmap, timeline, reports, move, setDays, views, saveView, view, removeView, plannedDays, daysOf };
}
