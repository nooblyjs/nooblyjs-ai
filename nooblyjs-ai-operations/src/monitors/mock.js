// The mock monitor: it watches nothing. What it reports is kept in data/operations/monitor.yaml: the minutes of each
// SLO's error budget burned (a person burns them on purpose, to see the alerts: `burn`), and each goal's measure today
// (by default halfway from where the goal started to its target, so a review has something honest-looking to compare
// and says it is the mock). Every reading says it came from the mock.
const FILE = ['monitor.yaml'];
const num = (text) => { const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

export function createMockMonitor({ store }) {
  const read = async () => (await store.readYaml(FILE)) ?? { burned: {}, measures: {} };
  return {
    name: 'mock',
    real: false,
    /** Minutes of the SLO's error budget burned in its window. */
    async burned(sloId) {
      return Number((await read()).burned?.[sloId] ?? 0);
    },
    /** The mock only: burn minutes of an SLO's budget (as an outage would). */
    async burn(sloId, minutes) {
      return store.withLock(FILE, async () => {
        const state = await read();
        const next = Math.round((Number(state.burned?.[sloId] ?? 0) + Number(minutes)) * 10) / 10;
        await store.writeYaml(FILE, { ...state, burned: { ...(state.burned ?? {}), [sloId]: next } });
        return next;
      });
    },
    /** A goal's measure today: what was set for it, else halfway from where it started to its target. */
    async measure(goal) {
      const set = (await read()).measures?.[goal.measure];
      if (set !== undefined && set !== null) return String(set);
      // Times are compared in milliseconds ("1.8 s" against "300 ms").
      const timed = /\b(ms|s)\b/i.test(`${goal.today} ${goal.target}`);
      const ms = (text) => { const n = num(text); return n === null ? null : /\bms\b/i.test(String(text)) ? n : n * 1000; };
      if (timed) {
        const [a, b] = [ms(goal.today), ms(goal.target)];
        return a === null || b === null ? null : `${Math.round((a + b) / 2)} ms`;
      }
      const before = num(goal.today);
      const target = num(goal.target);
      if (before === null || target === null) return null;
      const unit = String(goal.target).replace(/^[\s\d.,-]+/, '').trim();
      const mid = Math.round(((before + target) / 2) * 10) / 10;
      return `${mid}${unit ? (unit.startsWith('%') ? unit : ` ${unit}`) : ''}`;
    },
  };
}
