// npm run metrics:reconcile
// Recomputes Home · Metrics from the raw events in DATA_DIR/events, ignoring the roll-ups, and compares every tile,
// chart value and table cell with what the metrics service serves (GET /api/v1/home/metrics), for each range and at
// the same moment. Prints "0 differences" or each difference, and exits 1 when there is one (roadmap Phase 10).
// It reads the data folder directly, so NooblyJS may be running or not.
import { createRequire } from 'node:module';
import { loadConfig, ConfigError } from '../src/config.js';
import { createClock } from '../src/services/clock.js';
import { createPeople } from '../src/services/people.js';
import { createActivity } from '../src/services/activity.js';
import { createMetrics, differences, RANGES } from '../src/services/metrics/index.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

try {
  const config = loadConfig();
  const store = new FsStore(config.dataDir);
  const clock = await createClock({ store, movable: config.devLogin });
  const activity = createActivity({ store, people: createPeople({ store }), clock });
  const metrics = createMetrics({ store, activity, clock, log: console });
  const now = clock.now();
  console.log(`Reconciling Metrics in ${config.dataDir} at ${new Date(now).toISOString()}`);
  let total = 0;
  for (const range of Object.values(RANGES)) {
    const [served, recomputed] = [await metrics.get(range.key, { now }), await metrics.fromEvents(range.key, { now })];
    const found = differences(served, recomputed);
    total += found.length;
    const t = recomputed.tiles;
    console.log(`${range.label.padEnd(8)} ${found.length} difference${found.length === 1 ? '' : 's'}`
      + `  (idea → merge ${t.ideaToMerge.days ?? '—'} d · ${t.prsMerged.count} PRs merged · first pass ${t.firstPass.percent ?? '—'}% · spend $${recomputed.spend.totalUsd})`);
    for (const line of found) console.log(`  ${line}`);
  }
  console.log(total ? `${total} difference${total === 1 ? '' : 's'}: the served numbers do not match the events.` : '0 differences: every number is what the events say.');
  process.exit(total ? 1 : 0);
} catch (err) {
  console.error(err instanceof ConfigError ? `Refused: ${err.message}` : err);
  process.exit(2);
}
