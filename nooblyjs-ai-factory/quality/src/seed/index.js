// The Test section's seed (Phase 16d): the test policy, which the section needs to run, and, with sample content, the
// seed story's test analysis of STORY-027-1 (it was CHG-008's sample). Its times are written as if "now" were the seed
// story's ANCHOR (as the lifecycle engine's seed has it) and moved to now when seeded.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const MARKER = ['seed.yaml'];
const ANCHOR = '2026-10-09T10:00:00.000Z';
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

/** Writes the policy (and, with `content`, the sample). Without `reset`, a seeded folder is left alone. */
export async function seed(store, { reset = false, now = () => new Date().toISOString(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, seededAt: existing.seededAt };
  if (reset) for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) await store.remove([name]);
  await store.writeText(['test-policy.yaml'], await fs.readFile(path.join(DATA_DIR, 'test-policy.yaml'), 'utf8'));
  const at = now();
  const shift = new Date(at).getTime() - new Date(ANCHOR).getTime();
  const samples = content ? (await fs.readdir(path.join(DATA_DIR, 'test-analysis')).catch(() => [])).filter((n) => n.endsWith('.md')) : [];
  for (const name of samples) {
    const text = await fs.readFile(path.join(DATA_DIR, 'test-analysis', name), 'utf8');
    await store.writeText(['test-analysis', name], text.replace(ISO, (iso) => new Date(new Date(iso).getTime() + shift).toISOString()));
  }
  await store.writeYaml(MARKER, { content, seededAt: at, ...(content ? { sampleData: true } : {}) });
  return { seeded: true, seededAt: at, files: 1 + samples.length };
}
