// SLOS (root product.md §3.7): what an item promised in Design ("availability 99.9% monthly", "p95 < 300 ms") becomes
// an SLO once its first release is in production, each with an error budget over a 30-day window. The monitoring
// adapter says how much is burned; at half the budget and at all of it, whoever is on call is alerted in Teams (once per
// level), and an alert can be raised as an incident.
import { HttpError, notFound } from '../util/errors.js';

const WINDOW_DAYS = 30;
const WINDOW_MIN = WINDOW_DAYS * 24 * 60;
const LEVELS = [{ at: 0.5, level: 'burning', words: 'half its error budget is burned' }, { at: 1, level: 'exhausted', words: 'its error budget is gone' }];
const round1 = (n) => Math.round(n * 10) / 10;

/** The SLOs a quality attribute gives: availability (a percentage) and latency (a p-percentile in ms). */
export function slosFrom(attributes = []) {
  const out = [];
  for (const a of attributes) {
    const name = String(a.attribute ?? a.name ?? '').trim();
    const target = String(a.target ?? '').trim();
    const pct = target.match(/(\d{2}(?:\.\d+)?)\s*%/);
    const ms = target.match(/p(\d{2})\s*<\s*(\d+(?:\.\d+)?)\s*(ms|s)\b/i);
    if (/availab/i.test(name) && pct) {
      const objective = Number(pct[1]);
      out.push({ kind: 'availability', name, scenario: a.scenario ?? null, target, objective, budgetMinutes: round1(((100 - objective) / 100) * WINDOW_MIN), text: `${objective}% of minutes up over ${WINDOW_DAYS} days` });
    } else if (ms) {
      const limit = Number(ms[2]) * (ms[3].toLowerCase() === 's' ? 1000 : 1);
      // A latency SLO's budget: 1% of the window's minutes may be over the target [CONFIRM].
      out.push({ kind: 'latency', name, scenario: a.scenario ?? null, target, percentile: Number(ms[1]), limitMs: limit, budgetMinutes: round1(0.01 * WINDOW_MIN), text: `p${ms[1]} under ${limit} ms for 99% of minutes over ${WINDOW_DAYS} days` });
    }
  }
  return out;
}

export function createSlos({ repos, host, log, monitor, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const svc = (name) => host.service?.(name) ?? null;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });

  async function shape(s) {
    const burned = await monitor.burned(s.id);
    const ratio = s.budgetMinutes ? burned / s.budgetMinutes : 0;
    const left = Math.max(0, round1(s.budgetMinutes - burned));
    const status = ratio >= 1 ? 'exhausted' : ratio >= 0.5 ? 'burning' : 'ok';
    return {
      ...s, body: undefined, burnedMinutes: burned, leftMinutes: left, burnedPercent: Math.round(ratio * 100), status,
      statusText: status === 'exhausted' ? 'Error budget gone' : status === 'burning' ? 'Burning its error budget' : 'Within its error budget',
      budgetText: `${left} of ${s.budgetMinutes} minutes of error budget left (${Math.round(ratio * 100)}% burned)`,
      monitor: { name: monitor.name, real: monitor.real }, href: `${mountPath}/slos/${s.id}`,
    };
  }

  /** The item's first release is in production: its quality attributes become SLOs (once per item and attribute). */
  async function fromRelease(release) {
    const inputs = await Promise.resolve(svc('product')?.designInputs?.(release.itemId)).catch(() => null);
    const made = [];
    const existing = (await repos.slos.list()).filter((s) => s.itemId === release.itemId);
    for (const s of slosFrom(inputs?.qualityAttributes ?? [])) {
      if (existing.some((x) => x.name === s.name)) continue;
      const slo = await repos.slos.create({ ...s, itemId: release.itemId, product: release.product, releaseId: release.id, release: `${release.id} · ${release.name}`, environment: release.production, windowDays: WINDOW_DAYS, alerts: [], createdAt: iso() });
      made.push(slo);
      await emit('slo.created', { sloId: slo.id, itemId: release.itemId, releaseId: release.id, summary: `${release.itemId}'s ${slo.name} is an SLO now: ${slo.text}` });
    }
    return made;
  }

  /** Alerts once per level the burn has reached (Teams through NooblyJS, and an event). */
  async function check(id) {
    const slo = await repos.slos.get(id);
    if (!slo) return null;
    const shaped = await shape(slo);
    const ratio = shaped.burnedPercent / 100;
    for (const l of LEVELS) {
      if (ratio < l.at || (slo.alerts ?? []).some((a) => a.level === l.level)) continue;
      const title = `${slo.name} SLO of ${slo.itemId}: ${l.words}`;
      const text = `${shaped.budgetText}. ${slo.release}, ${slo.environment}.`;
      const sent = await Promise.resolve(svc('oncall')?.alert?.({ title, text, link: `${mountPath}/slos/${id}`, itemId: slo.itemId, source: 'operations' })).catch((err) => ({ sent: false, why: err.message })) ?? { sent: false, why: 'NooblyJS on-call alerts are not available here' };
      const alert = { at: iso(), level: l.level, burnedMinutes: shaped.burnedMinutes, teams: sent.sent === true, where: sent.where ?? null, ...(sent.why ? { why: sent.why } : {}) };
      await repos.slos.update(id, (cur) => ({ ...cur, alerts: [...(cur.alerts ?? []), alert] }));
      await emit('slo.alert', { sloId: id, itemId: slo.itemId, releaseId: slo.releaseId, level: l.level, teams: alert.teams, summary: `alert: ${title}` });
    }
    return shape(await repos.slos.get(id));
  }

  /** The mock only: burn minutes of the budget, then check the alerts. */
  async function burn(id, minutes) {
    if (monitor.real) throw new HttpError(409, 'not_mock', 'Budget is burned by production here, not by a person.');
    if (process.env.NODE_ENV === 'production') throw new HttpError(403, 'forbidden', 'Burning a budget by hand is for development.');
    const slo = await repos.slos.get(id);
    if (!slo) throw notFound(`There is no SLO ${id}.`);
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0 || m > 100_000) throw new HttpError(400, 'bad_request', 'Say how many minutes to burn.');
    await monitor.burn(id, m);
    return check(id);
  }

  const list = async ({ itemId } = {}) => Promise.all((await repos.slos.list()).filter((s) => !itemId || s.itemId === itemId).map(shape));
  async function get(id) {
    const s = await repos.slos.get(id);
    if (!s) throw notFound(`There is no SLO ${id}.`);
    return shape(s);
  }
  return { fromRelease, check, burn, list, get };
}
