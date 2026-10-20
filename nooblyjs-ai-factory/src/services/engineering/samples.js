// @ts-check
// Sample content for the Engineering and Test pages (2026-10-20, CHG-008): the seed story's application architecture
// and test analysis of STORY-027-1, and its test runs and defects. Phases 16d, 16e and 20 build these for real (drafted
// from the code, edited, signed off, recorded from the line); until then the pages show the sample, and say so.
//
//   seedSamples(home, { now })   copies examples/noobly/samples/ into the Factory's folder, times moved to now
//   readSamples(home)            what is there: { architecture, analysis, runs, defects }
//
// The files are Markdown with YAML front matter and YAML, under data/factory/engineering/ and data/factory/testing/,
// so a person can read and change them. Whatever is already there is left alone.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const SAMPLES = fileURLToPath(new URL('../../../examples/noobly/samples/', import.meta.url));
// The seed story's "now", as the lifecycle engine's seed has it (nooblyjs-ai-host src/lifecycle/seed/index.js).
const ANCHOR = '2026-10-09T10:00:00.000Z';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

/** Every file under a folder, as paths relative to it. */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

/**
 * Copies the sample files that are missing into the Factory's folder, each time moved by the same amount so the
 * sample reads as recent ("tested yesterday") whenever it is seeded.
 * @param {string} home   the Factory's data folder (FACTORY_HOME)
 * @param {{ now?: () => number }} [options]
 * @returns {string[]} the files written
 */
export function seedSamples(home, { now = () => Date.now() } = {}) {
  const shift = now() - Date.parse(ANCHOR);
  const wrote = [];
  for (const rel of filesUnder(SAMPLES)) {
    const to = path.join(home, rel);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const text = fs.readFileSync(path.join(SAMPLES, rel), 'utf8');
    fs.writeFileSync(to, text.replace(ISO, (iso) => new Date(Date.parse(iso) + shift).toISOString()));
    wrote.push(rel);
  }
  return wrote;
}

/** One folder of Markdown documents, by their front matter's `key`. */
async function docs(store, folder, key) {
  const out = new Map();
  for (const name of (await store.list(folder)).filter((n) => n.endsWith('.md'))) {
    const doc = await store.readDoc([...folder, name]).catch(() => null);
    if (doc?.data?.[key]) out.set(doc.data[key], { ...doc.data, body: String(doc.body ?? '').trim() });
  }
  return out;
}

/**
 * What the Engineering and Test pages read, fresh on every call so an edit to a file shows at once.
 * @param {string} home
 */
export async function readSamples(home) {
  const store = new FsStore(home);
  const [architecture, analysis, defects, runsDoc] = await Promise.all([
    docs(store, ['engineering', 'architecture'], 'storyId'),
    docs(store, ['engineering', 'test-analysis'], 'storyId'),
    docs(store, ['testing', 'defects'], 'id'),
    store.readYaml(['testing', 'runs.yaml']).catch(() => null),
  ]);
  const runs = (/** @type {any} */ (runsDoc)?.runs ?? []).filter((r) => r?.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { architecture, analysis, defects: [...defects.values()].sort((a, b) => a.id.localeCompare(b.id)), runs };
}
