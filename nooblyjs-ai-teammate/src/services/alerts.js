// Cap and budget warnings. After every new timesheet entry we check the teammate's monthly cap and the
// weekly/monthly/quarterly budgets. Crossing the warning share (default 80%) or 100% raises an alert once per
// period: it is shown on screen (an `alert` live event) and sent to webhooks subscribed to it.
import { sumEntries } from './team.js';
import { monthName, periodRange } from '../util/dates.js';

const STATE = ['system', 'alerts.md'];
const KEEP_SENT = 300;

const usd = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
const levelOf = (pct, warnAt) => (pct >= 100 ? 'reached' : pct >= warnAt ? 'warning' : null);

export const DEFAULT_WARN_PCT = 80;

export class AlertService {
  constructor({ repos, team, store, events = null, webhooks = null, log = console }) {
    this.repos = repos;
    this.team = team;
    this.store = store;
    this.events = events;
    this.webhooks = webhooks;
    this.log = log;
  }

  async settings() {
    const s = (await this.repos.config.getSettings()).alerts ?? {};
    return { warnAtPct: s.warnAtPct ?? DEFAULT_WARN_PCT };
  }

  capAlert(t, used, warnAt, month) {
    if (!t.monthlyCap) return null;
    const pct = Math.round((used / t.monthlyCap) * 100);
    const level = levelOf(pct, warnAt);
    if (!level) return null;
    return {
      kind: 'cap', level, id: t.id, period: month, pct, used, limit: t.monthlyCap,
      label: `${t.name}'s monthly cap`,
      message: level === 'reached'
        ? `${t.name} has reached the ${usd(t.monthlyCap)} monthly cap. New work is refused until the cap is raised.`
        : `${t.name} has used ${pct}% of the ${usd(t.monthlyCap)} monthly cap (${usd(used)}).`,
    };
  }

  async budgetAlerts(warnAt) {
    const out = [];
    for (const period of ['week', 'month', 'quarter']) {
      const b = await this.team.budgetFor(period);
      const level = b.budget ? levelOf(b.pct, warnAt) : null;
      if (!level) continue;
      const name = period === 'week' ? 'This week’s budget' : `${b.label} budget`;
      out.push({
        kind: 'budget', level, id: period, period: periodRange(period, 0, this.team.today()).start, pct: b.pct, used: b.used, limit: b.budget,
        label: name,
        message: level === 'reached'
          ? `${name} is used up: ${usd(b.used)} of ${usd(b.budget)}${b.pending ? `, including ${usd(b.pending)} still pending approval` : ''}.`
          : `${name} is ${b.pct}% used: ${usd(b.used)} of ${usd(b.budget)}${b.pending ? `, including ${usd(b.pending)} pending` : ''}.`,
      });
    }
    return out;
  }

  /** Every cap and budget currently over the warning share, most urgent first. */
  async current() {
    const { warnAtPct } = await this.settings();
    const today = this.team.today();
    const month = today.slice(0, 7);
    const teammates = await this.repos.teammates.list();
    const caps = await Promise.all(teammates.map(async (t) => this.capAlert(t, sumEntries(await this.repos.timesheets.listRange(t.id, `${month}-01`, today)).amount, warnAtPct, month)));
    const items = [...(await this.budgetAlerts(warnAtPct)), ...caps.filter(Boolean)];
    return { warnAtPct, items: items.sort((a, b) => (a.level === b.level ? b.pct - a.pct : a.level === 'reached' ? -1 : 1)) };
  }

  /** Called after a timesheet entry is logged. Raises each newly crossed threshold once. */
  async check(teammateId) {
    try {
      const { warnAtPct } = await this.settings();
      const today = this.team.today();
      const month = today.slice(0, 7);
      const t = await this.repos.teammates.get(teammateId);
      const candidates = await this.budgetAlerts(warnAtPct);
      if (t) {
        const used = sumEntries(await this.repos.timesheets.listRange(t.id, `${month}-01`, today)).amount;
        const cap = this.capAlert(t, used, warnAtPct, month);
        if (cap) candidates.push(cap);
      }
      for (const alert of candidates) {
        // A "reached" alert also covers the warning: crossing 80% and 100% in one task raises only "reached".
        const key = `${alert.kind}:${alert.id}:${alert.period}:${alert.level}`;
        if (await this.markSent(key, alert.level === 'reached' ? `${alert.kind}:${alert.id}:${alert.period}:warning` : null)) await this.raise(alert);
      }
    } catch (err) {
      this.log.warn?.(`[alerts] check failed: ${err.message}`);
    }
  }

  /** Records `key` as sent. Returns false when it was already sent. */
  async markSent(key, alsoKey) {
    let fresh = false;
    await this.store.updateDoc(STATE, (doc) => {
      const data = doc?.data ?? {};
      const sent = data.sent ?? [];
      if (sent.some((s) => s.key === key)) return null;
      fresh = true;
      const at = new Date().toISOString();
      const add = [{ key, at }, ...(alsoKey && !sent.some((s) => s.key === alsoKey) ? [{ key: alsoKey, at }] : [])];
      return { data: { ...data, sent: [...sent, ...add].slice(-KEEP_SENT) }, body: 'Alerts already raised (one per threshold per period).' };
    });
    return fresh;
  }

  async raise(alert) {
    this.events?.publish('alert', alert);
    const event = `${alert.kind}.${alert.level}`;
    const data = alert.kind === 'cap'
      ? { teammate: alert.id, label: alert.label, month: alert.period, used: alert.used, cap: alert.limit, pct: alert.pct }
      : { period: alert.id, label: alert.label, periodStart: alert.period, used: alert.used, budget: alert.limit, pct: alert.pct };
    await this.webhooks?.emit(event, { ...data, message: alert.message });
  }
}

export const monthLabel = (month) => `${monthName(`${month}-01`)} ${month.slice(0, 4)}`;
