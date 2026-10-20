// The Design section's seed (Phase 16c): the NFR catalogue, which Design needs to run, and, with sample content, the
// sample story's designs (data/items/: PRD-027's, whose stories the lifecycle engine's seed has as items). PRD-031
// starts Design from its Product handoff, so it has none. The sample's times are written as if "now" were the seed
// story's ANCHOR (as the lifecycle engine's seed, nooblyjs-ai-host src/lifecycle/seed/index.js); seeding moves them all
// by the same amount, so "drafted yesterday" stays true.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const MARKER = ['seed.yaml'];
const ANCHOR = '2026-10-09T10:00:00.000Z';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

/** The sample designs, as path segments under data/ (items/<itemId>/design.md). */
async function sampleFiles() {
  const entries = await fs.readdir(path.join(DATA_DIR, 'items'), { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => path.relative(DATA_DIR, path.join(e.parentPath, e.name)).split(path.sep)).sort();
}

/**
 * Writes the catalogue (and, with `content`, the sample designs) into the store. Without `reset`, a folder that is
 * already seeded is left alone; with it, everything in the folder is removed first (only inside this section's folder:
 * the store refuses any other path).
 */
export async function seed(store, { reset = false, now = () => new Date().toISOString(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, seededAt: existing.seededAt };
  if (reset) for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) await store.remove([name]);
  await store.writeText(['nfr-catalogue.yaml'], await fs.readFile(path.join(DATA_DIR, 'nfr-catalogue.yaml'), 'utf8'));
  const at = now();
  const shift = new Date(at).getTime() - new Date(ANCHOR).getTime();
  const samples = content ? await sampleFiles() : [];
  for (const segments of samples) {
    const text = await fs.readFile(path.join(DATA_DIR, ...segments), 'utf8');
    await store.writeText(segments, text.replace(ISO, (iso) => new Date(new Date(iso).getTime() + shift).toISOString()));
  }
  const marker = { content, seededAt: at, ...(content ? { story: 'PRD-031', sampleData: true } : {}) };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, seededAt: marker.seededAt, files: 1 + samples.length };
}
