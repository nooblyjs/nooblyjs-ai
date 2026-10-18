// Platform's files, read fresh on every check: each parsed file is kept with its modification time and size, and
// read again when either changes. So a change saved through the API, or by hand, applies to the next check with
// no restart (roadmap Phase 9 "Done when").
import fs from 'node:fs/promises';

export function createFiles(store) {
  const cache = new Map();

  async function stampOf(segments) {
    try {
      const stat = await fs.stat(store.resolve(segments));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** A YAML file's value (a copy the caller may change), or null when it doesn't exist. */
  async function yaml(segments) {
    const key = segments.join('/');
    const stamp = await stampOf(segments);
    if (stamp === null) {
      cache.delete(key);
      return null;
    }
    const hit = cache.get(key);
    if (hit?.stamp === stamp) return structuredClone(hit.value);
    const value = await store.readYaml(segments);
    cache.set(key, { stamp, value });
    return structuredClone(value);
  }

  /** Writes a YAML file and forgets what was cached for it. */
  async function writeYaml(segments, value) {
    await store.writeYaml(segments, value);
    cache.delete(segments.join('/'));
  }

  /** Read-modify-write of a YAML file under the store's path lock. `fn` gets a copy (or null) and returns the new value. */
  function updateYaml(segments, fn) {
    return store.withLock(segments, async () => {
      const next = await fn(await yaml(segments));
      if (next !== undefined) await writeYaml(segments, next);
      return next;
    });
  }

  return { yaml, writeYaml, updateYaml };
}
