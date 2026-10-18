// The seed story: the lifecycle side of PRD-031 "Same-day delivery slots" (NooblyJS roadmap Phase 2). Thirteen items,
// the four approvals waiting on Stevie, two waiting on others and three decided this week. Everything is sample data.
//
// The story is kept as plain files in src/seed/data/, laid out exactly like data/workflows/. Its times are written
// as if "now" were ANCHOR; seeding moves every time by the same amount, so "26 h · due today" is true whenever the
// seed is written. Due times are then worked out from the rules, as they would be for a new approval.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepos } from '../repos.js';
import { loadRules } from '../config.js';
import { dueFrom } from '../working-days.js';

export const ANCHOR = '2026-10-09T10:00:00.000Z';
const MARKER = ['seed.yaml'];
/** The lifecycle's system files; everything else in the seed is the sample story. */
const SYSTEM = ['approval-rules.yaml', 'readiness.yaml'];
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g;

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
 * @param {{ reset?: boolean, now?: string }} [options]
 *   reset: remove everything in the folder first. Without it, a folder that is already seeded is left alone.
 *   now: the time the story is moved to (ISO; default the real now).
 */
export async function seed(store, { reset = false, now = new Date().toISOString(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, seededAt: existing.seededAt };

  if (reset) {
    // Only what is inside this app's folder: the store refuses any path outside it.
    for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) await store.remove([name]);
  }
  const shift = new Date(now).getTime() - new Date(ANCHOR).getTime();
  const move = (text) => text.replace(ISO, (iso) => new Date(new Date(iso).getTime() + shift).toISOString());
  // Without sample content, only the rules people change at runtime: who approves what, and the readiness checks.
  const files = (await storyFiles()).filter((segments) => content || SYSTEM.includes(segments.join('/')));
  for (const segments of files) {
    await store.writeText(segments, move(await fs.readFile(path.join(DATA_DIR, ...segments), 'utf8')));
  }
  if (!content) {
    await store.writeYaml(MARKER, { story: null, content: false, seededAt: now });
    return { seeded: true, seededAt: now, files: files.length, content: false };
  }

  const repos = createRepos(store);
  const rules = await loadRules(repos);
  for (const approval of await repos.approvals.list()) {
    const due = dueFrom(approval.requestedAt, rules.get(approval.type)?.target);
    if (due && !approval.dueAt) await repos.approvals.update(approval.id, (a) => ({ ...a, dueAt: due }));
  }
  const marker = { story: 'PRD-031', seededAt: now, sampleData: true };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, seededAt: now, files: files.length };
}
