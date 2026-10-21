// Home · Metrics (Phase 10, product.md §8): the numbers come from the event log and nowhere else. A day's events
// become that day's facts (facts.js); the facts of a range become the metrics (compute.js). Past days are kept as
// roll-ups in data/metrics/rollups/YYYY-MM-DD.yaml so a request does not read months of events. A roll-up is
// regenerable: it is rebuilt when it is missing or when its day's event file has changed since, and deleting the
// folder changes no number. Today is always read from the events.
import fs from 'node:fs/promises';
import { daySegments } from '../../util/dates.js';
import { HttpError } from '../../util/errors.js';
import { factsOfDay } from './facts.js';
import { compute, windowStart, RANGES, DAY } from './compute.js';
import { createPlaces } from './places.js';

export { RANGES } from './compute.js';

// Raised when a fact changes shape, so roll-ups written by older code are rebuilt.
const ROLLUP_VERSION = 4; // 2: ask and decide facts carry the approval type (Phase 16e); 3: spend facts their item (Phase 17); 4: production's facts (Phase 23)
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * @param {object} deps
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} deps.store  rooted at DATA_DIR
 * @param {{ directory: () => Promise<{ people: Map<string, object>, agents: Set<string> }> }} deps.activity
 * @param {{ now: () => number }} [deps.clock]  business time
 */
export function createMetrics({ store, activity, clock = Date, log, services = null }) {
  // Phase 17: spend placed by value stream and portfolio, and per item (the business case's estimate).
  const places = createPlaces({ services, log });
  const eventFile = (day) => ['events', ...daySegments(day)];
  const rollupFile = (day) => ['metrics', 'rollups', `${day}.yaml`];

  /** "<modified>:<size>" of a day's event file, or null when the day has no events. */
  async function stampOf(day) {
    try {
      const stat = await fs.stat(store.resolve(eventFile(day)));
      return `${Math.round(stat.mtimeMs)}:${stat.size}`;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  const fromEventsOf = async (day, dir) => factsOfDay(await store.readYamlStream(eventFile(day)), dir);

  /** A past day's facts: from its roll-up when that still matches the day's events, else rebuilt and written. */
  async function fromRollup(day, dir) {
    const stamp = await stampOf(day);
    if (!stamp) return [];
    const rollup = await store.readYaml(rollupFile(day)).catch(() => null);
    if (rollup?.version === ROLLUP_VERSION && rollup.source === stamp && Array.isArray(rollup.facts)) return rollup.facts;
    const facts = await fromEventsOf(day, dir);
    try {
      await store.writeYaml(rollupFile(day), { day, version: ROLLUP_VERSION, source: stamp, builtAt: new Date(clock.now()).toISOString(), facts });
    } catch (err) {
      log?.warn?.(`metrics: the roll-up of ${day} was not written: ${err.message}`);
    }
    return facts;
  }

  async function facts(range, now, { raw }) {
    const dir = await activity.directory();
    const today = dayOf(now);
    const days = [];
    for (let t = windowStart(range, now); dayOf(t) <= today; t += DAY) days.push(dayOf(t));
    const perDay = await Promise.all(days.map((day) => (raw || day >= today ? fromEventsOf(day, dir) : fromRollup(day, dir))));
    return perDay.flat();
  }

  function check(range) {
    if (!RANGES[range]) throw new HttpError(400, 'invalid_range', `A range is one of ${Object.keys(RANGES).join(', ')}.`, { range });
  }

  return {
    ranges: Object.values(RANGES).map(({ key, label }) => ({ key, label })),
    /** The metrics of a range ('7d', '30d' or 'quarter'), ending now on the business clock. */
    async get(range = '30d', { now = clock.now() } = {}) {
      check(range);
      const all = await facts(range, now, { raw: false });
      return { ...compute(all, { range, now }), spendByValueStream: await places.byValueStream(all, now) };
    },
    /** The same, recomputed from the raw events without reading or writing a roll-up (npm run metrics:reconcile). */
    async fromEvents(range = '30d', { now = clock.now() } = {}) {
      check(range);
      const all = await facts(range, now, { raw: true });
      return { ...compute(all, { range, now }), spendByValueStream: await places.byValueStream(all, now) };
    },
    /** Agent spend per item (its root item), over the last quarter and before it: { PRD-031: 41.2, … } (Phase 17). */
    async spendByItem({ now = clock.now() } = {}) {
      return places.spendByItem(await facts('quarter', now, { raw: false }));
    },
  };
}

/** Every place two metrics answers differ, as "path: served ≠ recomputed" lines. */
export function differences(served, recomputed, path = '') {
  if (Object.is(served, recomputed)) return [];
  const bothObjects = served && recomputed && typeof served === 'object' && typeof recomputed === 'object';
  if (!bothObjects) return [`${path || '(all)'}: served ${JSON.stringify(served)}, recomputed ${JSON.stringify(recomputed)}`];
  const keys = new Set([...Object.keys(served), ...Object.keys(recomputed)]);
  return [...keys].flatMap((key) => differences(served[key], recomputed[key], path ? `${path}.${key}` : key));
}
