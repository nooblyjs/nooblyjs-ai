// The seed story: INF-031 "Infrastructure for same-day slots" (product.md §7, structure.md §8). Everything it
// writes is sample data. NooblyJS calls seed({ reset: false }) on the first start (an empty data/infrastructure/);
// `npm run seed -- --reset` and POST /api/v1/seed rewrite it.
//
// The story is kept as plain files in src/seed/data/, laid out exactly like data/infrastructure/. Times in it are
// written relative to the moment of seeding ({{ago:40m}}, {{ago:2d}}, {{month-start}}), so "40 min ago" is true
// on any day. seed.yaml records which story is in the folder and when it was written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORY = { id: 'INF-031', title: 'Infrastructure for same-day slots' };
const MARKER = ['seed.yaml'];
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Replaces the story's relative times with ISO times around `now`. */
export function placeTimes(text, now) {
  return text
    .replace(/\{\{ago:(\d+)([mhd])\}\}/g, (_, n, unit) => new Date(now.getTime() - Number(n) * UNIT_MS[unit]).toISOString())
    .replace(/\{\{month-start\}\}/g, `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`);
}

async function storyFiles() {
  const entries = await fs.readdir(DATA_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(DATA_DIR, path.join(e.parentPath, e.name)).split(path.sep))
    .sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

/**
 * Writes the seed story into the store.
 * @param {object} store   the app's FsStore (rooted at its dataDir)
 * @param {{ reset?: boolean, now?: () => number|Date }} [options]
 *   reset: remove everything in the folder first. Without it, a folder that is already seeded is left alone.
 */
/** What the app needs to run with no sample content (NooblyJS: host.sampleData is false). */
const SYSTEM = ['apply-rules.yaml', 'blueprints.yaml', 'policies.yaml', 'promotion-paths.yaml', 'budget.yaml', 'agent.yaml'];

export async function seed(store, { reset = false, now = () => Date.now(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, story: existing.story, seededAt: existing.seededAt };

  if (reset) {
    // Only what is inside this app's folder: the store refuses any path outside it.
    for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) await store.remove([name]);
  }
  const at = new Date(now());
  const files = (await storyFiles()).filter((segments) => content || SYSTEM.includes(segments.join('/')));
  for (const segments of files) {
    await store.writeText(segments, placeTimes(await fs.readFile(path.join(DATA_DIR, ...segments), 'utf8'), at));
  }
  if (!content) {
    // No story: the rules and blueprints only. Designs, environments, runs, drift and cost come from use.
    await store.writeYaml(MARKER, { story: null, content: false, seededAt: at.toISOString() });
    return { seeded: true, story: null, seededAt: at.toISOString(), files: files.length };
  }
  const marker = { story: STORY.id, title: STORY.title, seededAt: at.toISOString(), sampleData: true };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, story: marker.story, seededAt: marker.seededAt, files: files.length };
}
