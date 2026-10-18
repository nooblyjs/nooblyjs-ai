// The seed story: PRD-031 "Same-day delivery slots" (product.md §7, structure.md §7). Everything it writes is
// sample data. NooblyJS calls seed({ reset: false }) on the first start (an empty data/product/); `npm run seed --
// --reset` and POST /api/v1/seed rewrite it.
//
// The story is kept as plain files in src/seed/data/, laid out exactly like data/product/, so it can be read and
// edited as it will appear. seed.yaml records which story is in the folder and when it was written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY = { id: 'PRD-031', title: 'Same-day delivery slots' };
const MARKER = ['seed.yaml'];
/** What the app needs to run with no sample content (NooblyJS: host.sampleData is false). */
const SYSTEM = ['accessibility.yaml', 'standards.yaml', 'templates/portfolio.md', 'templates/value-stream.md'];
const BLANK = {
  'budget.yaml': "# The Product Factory's monthly agent budget when it runs on its own. Hosted in NooblyJS, Platform's budget is used.\nmonthlyUsd: 1500\n",
  'catalogue.yaml': '# Strategic themes, portfolios, value streams and products. Add them on the Portfolios page.\nthemes: []\nportfolios: []\nvalueStreams: []\nproducts: []\n',
};
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

/** Every file of the story, as path segments relative to the story folder. */
async function storyFiles() {
  const entries = await fs.readdir(DATA_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(DATA_DIR, path.join(e.parentPath, e.name)).split(path.sep))
    .sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

/**
 * Writes the seed story into the store.
 * @param {object} store                 the app's FsStore (rooted at its dataDir)
 * @param {{ reset?: boolean, now?: () => string }} [options]
 *   reset: remove everything in the folder first. Without it, a folder that is already seeded is left alone.
 * @returns {Promise<{ seeded: boolean, story: string, seededAt: string, files?: number }>}
 */
export async function seed(store, { reset = false, now = () => new Date().toISOString(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, story: existing.story, seededAt: existing.seededAt };

  if (reset) {
    // Only what is inside this app's folder: the store refuses any path outside it.
    const entries = [...await store.list([], { dirs: true }), ...await store.list([])];
    for (const name of entries) await store.remove([name]);
  }
  const files = (await storyFiles()).filter((segments) => content || SYSTEM.includes(segments.join('/')));
  for (const segments of files) {
    await store.writeText(segments, await fs.readFile(path.join(DATA_DIR, ...segments), 'utf8'));
  }
  if (!content) {
    // No story: the standards, accessibility rules, templates and budget, and an empty catalogue to fill in.
    for (const [name, text] of Object.entries(BLANK)) await store.writeText([name], text);
    const blank = { story: null, content: false, seededAt: now() };
    await store.writeYaml(MARKER, blank);
    return { seeded: true, story: null, seededAt: blank.seededAt, files: files.length + Object.keys(BLANK).length };
  }
  const marker = { story: STORY.id, title: STORY.title, seededAt: now(), sampleData: true };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, story: marker.story, seededAt: marker.seededAt, files: files.length };
}
