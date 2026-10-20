// The Design section's seed (Phase 16c): the NFR catalogue, which Design needs to run, with or without sample content.
// No item has a design until someone asks for one: the PRD-031 story starts Design from its Product handoff.
import fs from 'node:fs/promises';

const CATALOGUE = new URL('./data/nfr-catalogue.yaml', import.meta.url);
const MARKER = ['seed.yaml'];

/**
 * Writes the catalogue into the store. Without `reset`, a folder that is already seeded is left alone; with it,
 * everything in the folder is removed first (only inside this section's folder: the store refuses any other path).
 */
export async function seed(store, { reset = false, now = () => new Date().toISOString(), content = true } = {}) {
  const existing = await store.readYaml(MARKER);
  if (existing && !reset) return { seeded: false, seededAt: existing.seededAt };
  if (reset) for (const name of [...await store.list([], { dirs: true }), ...await store.list([])]) await store.remove([name]);
  await store.writeText(['nfr-catalogue.yaml'], await fs.readFile(CATALOGUE, 'utf8'));
  const marker = { content, seededAt: now() };
  await store.writeYaml(MARKER, marker);
  return { seeded: true, seededAt: marker.seededAt, files: 1 };
}
