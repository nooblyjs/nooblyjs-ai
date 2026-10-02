// @ts-check
// Phase F20: `factory metrics [--since 7d] [--json] [--no-detect]`
//
// First looks for local merges (so acceptance and human-edit rates are current), then
// computes everything from the event log. `--no-detect` skips the git look (read-only).
import { parseArgs } from 'node:util';
import { factoryMetrics, formatMetrics } from '../metrics/factory-metrics.js';
import { detectMerges } from '../metrics/merges.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function metricsCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { since: { type: 'string' }, json: { type: 'boolean' }, 'no-detect': { type: 'boolean' } } });
  const store = openStore();
  try {
    if (!values['no-detect']) {
      const merged = await detectMerges(store);
      if (merged.length && !values.json) console.log(`Noticed ${merged.length} merge(s) since last time.\n`);
    }
    const m = factoryMetrics(store.read(), { since: values.since ?? '7d' });
    console.log(values.json ? JSON.stringify(m, null, 2) : formatMetrics(m));
    return 0;
  } finally {
    store.close();
  }
}
