// npm run perf                 the performance check (roadmap Phase 13, test step 4): NooblyJS on TEN TIMES the seed volume,
// npm run perf -- --times 10   and how long the key pages' APIs take. Exits 1 when one is slower than the target.
// npm run perf -- --target 1000 --keep
//
// It works on a temporary data folder (never DATA_DIR): starts NooblyJS once so every app writes its seed, stops it,
// multiplies the lifecycle items and approvals, the Product Factory's specs, ideas and signals, and every day
// of events and audit records, then starts NooblyJS again and times each API as the Owner: one warm-up, then the median
// of five. Offline: no model, no Jira, no Bitbucket.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { loadConfig } from '../src/config.js';
import { seedFiles } from '../src/seed/index.js';
import { client } from '../test/helpers.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const TIMES = Math.max(Number(arg('times', 10)) || 10, 1);
const TARGET_MS = Math.max(Number(arg('target', 1000)) || 1000, 1);
const KEEP = process.argv.includes('--keep');
// The Software Factory brings its Product section (/factory/product).
const HOSTED = [
  { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
  { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
  { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
];
/** The APIs behind the pages people open most (product.md §5.2, §5.3, §5.7). */
const PAGES = [
  ['The frame (every page)', '/api/v1/shell'],
  ['Home · Overview', '/api/v1/home/overview'],
  ['Home · For you', '/api/v1/home/for-you'],
  ['Home · Lifecycle', '/workflows/api/v1/items'],
  ['Home · Approvals', '/workflows/api/v1/approvals'],
  ['Home · Activity', '/api/v1/activity'],
  ['Home · Metrics', '/api/v1/home/metrics'],
  ['An item', '/workflows/api/v1/items/PRD-028'],
  ['Product · Board', '/factory/product/api/v1/board'],
  ['Product · Ideas', '/factory/product/api/v1/ideas'],
  ['Platform · Audit log', '/api/v1/platform/audit'],
  ['Platform · Settings', '/api/v1/platform/settings'],
  ['Teammates', '/teammates/api/v1/teammates'],
  ['Infrastructure · Environments', '/infrastructure/api/v1/environments'],
];
const ENTITY_DIRS = ['workflows/items', 'workflows/approvals', 'factory/product/specs', 'factory/product/ideas', 'factory/product/signals'];
const STREAM_DIRS = ['events', 'audit'];

const config = (dataDir) => loadConfig({ DATA_DIR: dataDir, NODE_ENV: 'test', NOOBLY_DEV_LOGIN: 'true', LOG_LEVEL: 'error', PORT: '0', AI_PROVIDER: 'mock' });
async function listen(dataDir) {
  const noobly = await createApp({ config: config(dataDir) });
  const server = noobly.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  return { noobly, base: `http://127.0.0.1:${server.address().port}`, stop: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await noobly.close(); } };
}
async function files(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) out.push(...await files(path.join(dir, e.name)));
    else out.push(path.join(dir, e.name));
  }
  return out;
}
const count = async (dataDir, dirs) => Object.fromEntries(await Promise.all(dirs.map(async (d) => [d, (await files(path.join(dataDir, d))).length])));

/** Copies every entity n-1 more times with new ids, and repeats every event and audit record n-1 more times. */
async function multiply(dataDir, n) {
  // Every id an entity file is named after: a copy's references to another entity point at that entity's copy.
  const ids = [];
  for (const dir of ENTITY_DIRS) for (const f of await files(path.join(dataDir, dir))) if (f.endsWith('.md')) ids.push(path.basename(f, '.md'));
  const longestFirst = [...new Set(ids)].sort((a, b) => b.length - a.length);
  const copyId = (id, k) => (id.startsWith('apr_') ? `${id}c${k}` : `${id}-C${k}`);
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])(${longestFirst.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9_-])`, 'g');
  for (const dir of ENTITY_DIRS) {
    for (const f of await files(path.join(dataDir, dir))) {
      if (!f.endsWith('.md')) continue;
      const text = await fs.readFile(f, 'utf8');
      for (let k = 1; k < n; k++) await fs.writeFile(path.join(path.dirname(f), `${copyId(path.basename(f, '.md'), k)}.md`), text.replace(pattern, (id) => copyId(id, k)));
    }
  }
  for (const dir of STREAM_DIRS) {
    for (const f of await files(path.join(dataDir, dir))) {
      if (!f.endsWith('.yaml')) continue;
      const text = await fs.readFile(f, 'utf8');
      let more = '';
      for (let k = 1; k < n; k++) more += text.replace(/^id: ((?:evt|aud)_[a-z0-9]+)$/gm, (_, id) => `id: ${id}c${k}`).replace(pattern, (id) => copyId(id, k));
      await fs.appendFile(f, more);
    }
  }
}

// NooblyJS starts once per process (nooblyjs-core's shared services stop for good), so the seed is written by a child:
// node scripts/perf.js --seed <folder>
if (process.argv.includes('--seed')) {
  const dir = arg('seed');
  const store = new FsStore(dir);
  await seedFiles(store);
  await store.writeYaml(['config', 'hosted-apps.yaml'], { apps: HOSTED });
  const first = await listen(dir); // every app writes its seed
  await first.stop();
  process.exit(0);
}

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-perf-'));
let failed = 0;
try {
  const seeded = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--seed', dataDir], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180_000 });
  if (seeded.status !== 0) throw new Error('The seed could not be written.');
  const before = await count(dataDir, [...ENTITY_DIRS, ...STREAM_DIRS]);
  const seedBytes = (await Promise.all((await files(dataDir)).map((f) => fs.stat(f)))).reduce((n, s) => n + s.size, 0);
  await multiply(dataDir, TIMES);
  const all = await files(dataDir);
  const bytes = (await Promise.all(all.map((f) => fs.stat(f)))).reduce((n, s) => n + s.size, 0);
  const after = await count(dataDir, ENTITY_DIRS);

  const started = performance.now();
  const app = await listen(dataDir);
  const startMs = Math.round(performance.now() - started);
  try {
    const stevie = client(app.base);
    await stevie.signIn('stevie');
    const items = (await stevie.json('/workflows/api/v1/items')).body;
    const itemCount = (items.items ?? items.rows ?? items).length;
    console.log(`NooblyJS on ${TIMES}× the seed: ${all.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (the seed is ${(seedBytes / 1024 / 1024).toFixed(1)} MB).`);
    console.log(`  ${ENTITY_DIRS.map((d) => `${d} ${before[d]} → ${after[d]}`).join(' · ')}`);
    console.log(`  every day of events and audit records ×${TIMES} · the lifecycle lists ${itemCount} items · started in ${startMs} ms\n`);
    console.log(`${'Page'.padEnd(34)}${'median'.padStart(9)}${'slowest'.padStart(9)}   target ${TARGET_MS} ms`);
    for (const [label, url] of PAGES) {
      const warm = await stevie.request(url);
      if (warm.status !== 200) { console.log(`${label.padEnd(34)}${'—'.padStart(9)}${'—'.padStart(9)}   NOT MEASURED: ${url} answered ${warm.status}`); failed += 1; continue; }
      await warm.arrayBuffer();
      const took = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        const res = await stevie.request(url);
        await res.arrayBuffer();
        took.push(performance.now() - t);
      }
      const m = Math.round(median(took));
      const worst = Math.round(Math.max(...took));
      const ok = m <= TARGET_MS;
      if (!ok) failed += 1;
      console.log(`${label.padEnd(34)}${`${m} ms`.padStart(9)}${`${worst} ms`.padStart(9)}   ${ok ? 'ok' : 'TOO SLOW'}`);
    }
  } finally { await app.stop(); }
  console.log(failed ? `\n${failed} of ${PAGES.length} pages missed the target.` : `\nAll ${PAGES.length} pages answer inside ${TARGET_MS} ms.`);
} finally {
  if (KEEP) console.log(`The data folder is kept: ${dataDir}`);
  else await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
