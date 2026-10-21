// Budgets per NooblyJS system and the spend ledger (tech.md §6, Platform · Settings · Budgets).
//
// budgets.yaml   the month's total, a monthly limit per system (the Software Factory: a daily cap), pauseOnLimit, and
//                (Phase 17) a monthly budget per portfolio: portfolios: { Digital: { monthly: 5000 } }. A portfolio's
//                budget pauses nothing: it is what Metrics sets its value streams' agent and cloud spend against
// spend/YYYY-MM.yaml   { days: { 'YYYY-MM-DD': { systems: { product: 12.4 }, routes: { <route id>: 12.4 } } },
//                        reached: { 'product:2026-10': <when> } }
//
// The ledger is added to as costed agent work finishes, by business day (host.clock). It can be rebuilt from the
// event stream. `reached` remembers which limits were reached in which period, so budget.reached is said once.
import { HttpError } from '../../util/errors.js';

const FILE = ['platform', 'budgets.yaml'];
const ledgerFile = (month) => ['platform', 'spend', `${month}.yaml`];
const MONTH = /^\d{4}-\d{2}$/;
const MAX = 10_000_000;

// The cloud budget (Phase 9a): what Infrastructure's environments cost, from its own cost ledger. It is not agent
// model spend, so it never counts in the month's agent total. A data folder from before Phase 9a gets it from here.
export const CLOUD = { key: 'cloud', label: 'Cloud (Infrastructure)', monthly: 6000, source: 'infrastructure' };

/** The budget a system's spend counts against. Chat, Teams and Home answers are Digital Teammates' work. */
export function systemKey(system) {
  const s = String(system ?? '').toLowerCase();
  if (s === 'cloud') return 'cloud';
  if (s === 'product') return 'product';
  if (s === 'factory' || s === 'software-factory') return 'factory';
  if (s === 'knowledge' || s === 'wiki') return 'knowledge';
  return 'teammates';
}

const round = (n) => Math.round(n * 100) / 100;
/** $1,500, or $414.50 when there are cents. */
export const money = (n) => `$${Number(n).toLocaleString('en-US', Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * `external(source)`: this month's spend for a budget whose spend is another app's (the cloud budget's is
 * Infrastructure's), or null when that app isn't running.
 */
export function createBudgets({ files, external = async () => null }) {
  async function read() {
    const doc = (await files.yaml(FILE)) ?? {};
    const given = { ...(doc.systems ?? {}) };
    if (!given.cloud) given.cloud = { label: CLOUD.label, monthly: CLOUD.monthly, source: CLOUD.source };
    const systems = Object.entries(given).map(([key, s]) => ({
      key,
      label: s?.label ?? key,
      period: s?.daily != null ? 'day' : 'month',
      limit: Number(s?.daily ?? s?.monthly ?? 0) || null,
      source: s?.source ?? null,
    }));
    const portfolios = Object.entries(doc.portfolios ?? {}).map(([name, p]) => ({ name, monthly: Number(p?.monthly) || null })).filter((p) => p.monthly);
    return { total: Number(doc.total) || null, pauseOnLimit: doc.pauseOnLimit !== false, systems, portfolios };
  }

  async function ledger(month) {
    return (await files.yaml(ledgerFile(month))) ?? { month, days: {}, reached: {} };
  }

  /** Adds one costed piece of work to the ledger. */
  async function addSpend({ system, costUsd, routeId = null, at }) {
    const cost = Number(costUsd);
    if (!(cost > 0)) return;
    const day = at.slice(0, 10);
    const key = systemKey(system);
    await files.updateYaml(ledgerFile(day.slice(0, 7)), (doc) => {
      const next = doc ?? { month: day.slice(0, 7), days: {}, reached: {} };
      next.days ??= {};
      const d = (next.days[day] ??= { systems: {}, routes: {} });
      d.systems ??= {};
      d.routes ??= {};
      d.systems[key] = round((d.systems[key] ?? 0) + cost);
      if (routeId) d.routes[routeId] = round((d.routes[routeId] ?? 0) + cost);
      return next;
    });
  }

  /** Each budget with this period's spend and whether it is reached, at business time `at`. */
  async function status(at) {
    const b = await read();
    const month = at.slice(0, 7);
    const day = at.slice(0, 10);
    const l = await ledger(month);
    const monthBy = {};
    for (const d of Object.values(l.days ?? {})) for (const [k, v] of Object.entries(d.systems ?? {})) monthBy[k] = (monthBy[k] ?? 0) + Number(v);
    const todayBy = l.days?.[day]?.systems ?? {};
    const systems = await Promise.all(b.systems.map(async (s) => {
      if (s.source) {
        const outside = await external(s.source).catch(() => null);
        const spent = round(Number(outside) || 0);
        return { ...s, spent, monthSpent: spent, available: outside !== null, reached: outside !== null && s.limit != null && spent >= s.limit, periodKey: month };
      }
      const spent = round(s.period === 'day' ? Number(todayBy[s.key] ?? 0) : monthBy[s.key] ?? 0);
      return { ...s, spent, monthSpent: round(monthBy[s.key] ?? 0), reached: s.limit != null && spent >= s.limit, periodKey: s.period === 'day' ? day : month };
    }));
    const spent = round(Object.values(monthBy).reduce((a, v) => a + v, 0));
    return {
      pauseOnLimit: b.pauseOnLimit,
      total: { limit: b.total, spent, reached: b.total != null && spent >= b.total, periodKey: month },
      systems,
      portfolios: b.portfolios,
      month,
    };
  }

  /** Spend per route over the 30 days up to `at` (Settings · Models). */
  async function routeSpend(at) {
    const end = new Date(at);
    const start = new Date(end.getTime() - 29 * 86_400_000);
    const months = [...new Set([start.toISOString().slice(0, 7), end.toISOString().slice(0, 7)])];
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    const by = {};
    for (const m of months) {
      for (const [day, d] of Object.entries((await ledger(m)).days ?? {})) {
        if (day < from || day > to) continue;
        for (const [r, v] of Object.entries(d.routes ?? {})) by[r] = round((by[r] ?? 0) + Number(v));
      }
    }
    return by;
  }

  /**
   * Why agent work for `system` must wait, or null. Only refuses with pauseOnLimit on; the month's total pauses
   * every system.
   */
  async function refusal(system, at) {
    const s = await status(at);
    if (!s.pauseOnLimit) return null;
    const key = systemKey(system);
    const own = s.systems.find((x) => x.key === key);
    if (own?.reached) {
      const what = own.period === 'day' ? `its ${money(own.limit)} daily cap (${money(own.spent)} spent today)` : `its ${money(own.limit)} budget (${money(own.spent)} spent this month)`;
      const paused = key === 'cloud' ? 'New provisioning is paused' : 'Agents are paused';
      return { code: 'budget_reached', message: `${paused}: ${own.label} has reached ${what}. An Owner can raise it in Platform · Settings · Budgets.`, budget: own.key };
    }
    // The month's agent total doesn't pause cloud provisioning: that is the cloud budget's job.
    if (s.total.reached && key !== 'cloud') {
      return { code: 'budget_reached', message: `Agents are paused: this month's total budget of ${money(s.total.limit)} is reached (${money(s.total.spent)} spent). An Owner can raise it in Platform · Settings · Budgets.`, budget: 'total' };
    }
    return null;
  }

  /**
   * The limits reached in this period that haven't been said yet. Marks them said, so each is returned once.
   * `again` names budgets whose limit just changed: they may be said again.
   */
  async function newlyReached(at, { again = [] } = {}) {
    const s = await status(at);
    const reached = [
      ...s.systems.filter((x) => x.reached).map((x) => ({ key: x.key, label: x.label, limit: x.limit, spent: x.spent, period: x.period, periodKey: x.periodKey })),
      ...(s.total.reached ? [{ key: 'total', label: 'All systems', limit: s.total.limit, spent: s.total.spent, period: 'month', periodKey: s.total.periodKey }] : []),
    ];
    const fresh = [];
    await files.updateYaml(ledgerFile(s.month), (doc) => {
      const next = doc ?? { month: s.month, days: {}, reached: {} };
      next.reached ??= {};
      for (const key of again) for (const k of Object.keys(next.reached)) if (k.startsWith(`${key}:`)) delete next.reached[k];
      for (const r of reached) {
        const k = `${r.key}:${r.periodKey}`;
        if (next.reached[k]) continue;
        next.reached[k] = at;
        fresh.push(r);
      }
      return fresh.length || again.length ? next : undefined;
    });
    return { fresh, pauseOnLimit: s.pauseOnLimit };
  }

  /** Changes limits or pauseOnLimit. `patch`: { total?, pauseOnLimit?, systems?: { <key>: number } }. */
  async function update(patch) {
    let before;
    let after;
    const changed = [];
    await files.updateYaml(FILE, (doc) => {
      const next = doc ?? { systems: {} };
      next.systems ??= {};
      before = structuredClone(next);
      if (patch.total !== undefined) {
        next.total = amount(patch.total, 'The total budget');
        changed.push('total');
      }
      if (patch.pauseOnLimit !== undefined) {
        if (typeof patch.pauseOnLimit !== 'boolean') throw new HttpError(400, 'invalid_budget', 'pauseOnLimit is true or false.');
        next.pauseOnLimit = patch.pauseOnLimit;
      }
      for (const [key, value] of Object.entries(patch.systems ?? {})) {
        if (key === 'cloud' && !next.systems.cloud) next.systems.cloud = { label: CLOUD.label, monthly: CLOUD.monthly, source: CLOUD.source };
        const s = next.systems[key];
        if (!s) throw new HttpError(404, 'budget_not_found', `No budget for "${key}".`);
        if (s.daily != null) s.daily = amount(value, `${s.label}'s daily cap`);
        else s.monthly = amount(value, `${s.label}'s budget`);
        changed.push(key);
      }
      after = next;
      return next;
    });
    return { before, after, changed };
  }

  /** A portfolio's monthly budget (Phase 17): set, changed, or removed with null. Returns { before, after }. */
  async function setPortfolio(name, monthly) {
    const key = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!key || key.length > 40) throw new HttpError(400, 'invalid_budget', 'Name the portfolio (at most 40 characters).');
    let before = null;
    let after = null;
    await files.updateYaml(FILE, (doc) => {
      const next = doc ?? { systems: {} };
      next.portfolios ??= {};
      before = next.portfolios[key]?.monthly ?? null;
      if (monthly === null) delete next.portfolios[key];
      else next.portfolios[key] = { monthly: amount(monthly, `${key}'s budget`) };
      after = next.portfolios[key]?.monthly ?? null;
      return next;
    });
    return { portfolio: key, before, after };
  }

  /** Recomputes one month's ledger from the events (teammate.task_finished and run.finished with a cost). */
  async function rebuild(month, { eventsOfDay, routeOf }) {
    if (!MONTH.test(month)) throw new HttpError(400, 'invalid_month', 'A month is YYYY-MM.');
    const days = {};
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    for (let i = 1; i <= last; i++) {
      const day = `${month}-${String(i).padStart(2, '0')}`;
      for (const e of await eventsOfDay(day)) {
        const cost = Number(e.payload?.costUsd);
        // The Metrics sample history is not this month's spend.
        if (!(cost > 0) || !SPEND_EVENTS.includes(e.type) || e.payload?.sampleHistory === true) continue;
        const d = (days[day] ??= { systems: {}, routes: {} });
        const key = systemKey(e.payload.system);
        d.systems[key] = round((d.systems[key] ?? 0) + cost);
        const r = await routeOf(e.payload.workType);
        if (r) d.routes[r] = round((d.routes[r] ?? 0) + cost);
      }
    }
    const current = await ledger(month);
    await files.writeYaml(ledgerFile(month), { month, days, reached: current.reached ?? {} });
    return days;
  }

  return { read, status, addSpend, routeSpend, refusal, newlyReached, update, setPortfolio, rebuild };
}

/** The events that carry spend. */
export const SPEND_EVENTS = ['teammate.task_finished', 'run.finished'];

function amount(value, what) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n) || n < 0 || n > MAX) throw new HttpError(400, 'invalid_budget', `${what} is a number of US dollars, 0 or more.`);
  return round(n);
}
