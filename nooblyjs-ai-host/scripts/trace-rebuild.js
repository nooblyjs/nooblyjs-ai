// npm run trace:rebuild
// Builds the trace again from every app's trace service (root design.md §4) and compares it with the index NooblyJS
// keeps (data/trace/index.yaml), item by item. Prints "0 differences" or each difference, writes the fresh index, and
// exits 1 when there was a difference (roadmap Phase 16f). It starts NooblyJS on the data folder without serving it,
// and without the Software Factory working its queue (FACTORY_SCHEDULE=off).
import { createApp } from '../app.js';
import { loadConfig, ConfigError } from '../src/config.js';

process.env.FACTORY_SCHEDULE = 'off';
let noobly;
try {
  const config = loadConfig();
  noobly = await createApp({ config });
  console.log(`Rebuilding the trace in ${config.dataDir}`);
  const { items, compared, differences } = await noobly.trace.rebuild();
  for (const line of differences) console.log(`  ${line}`);
  console.log(`${items} item${items === 1 ? '' : 's'} built, ${compared} compared with the index. ${differences.length ? `${differences.length} difference${differences.length === 1 ? '' : 's'}: the index was out of date (it is rewritten).` : '0 differences: the index is what the apps say.'}`);
  await noobly.close();
  process.exit(differences.length ? 1 : 0);
} catch (err) {
  console.error(err instanceof ConfigError ? `Refused: ${err.message}` : err);
  await noobly?.close?.().catch(() => {});
  process.exit(2);
}
