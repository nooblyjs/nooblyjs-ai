// This app's records over host.store (.claude/steering/structure.md). A record is its front matter plus `body`. A file
// someone edited by hand into something unreadable is skipped with a warning, so one bad file can't take a screen down.
import { isReleaseId } from '../util/ids.js';

const split = ({ body = '', ...data }) => [data, body];

/** Markdown documents in one folder, one per id. */
function docs(store, folder, isValid, log) {
  const file = (id) => [folder, `${id}.md`];
  async function read(segments) {
    const doc = await store.readDoc(segments);
    return doc && { ...doc.data, body: doc.body };
  }
  return {
    async list() {
      const out = [];
      for (const name of (await store.list([folder])) ?? []) {
        if (!name.endsWith('.md')) continue;
        try {
          const record = await read([folder, name]);
          if (record?.id) out.push(record);
        } catch (err) {
          log.warn(`skipped ${folder}/${name}: ${err.message}`);
        }
      }
      return out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    },
    get: async (id) => (isValid(id) ? read(file(id)) : null),
    async write(record) {
      if (!isValid(record.id)) throw new Error(`not a valid ${folder} id: ${record.id}`);
      const [data, body] = split(record);
      await store.writeDoc(file(record.id), data, body);
      return record;
    },
    /** Read-modify-write under the record's lock. `fn(current)` returns the new record (or nothing, to leave it). */
    async update(id, fn) {
      if (!isValid(id)) return null;
      return store.withLock(file(id), async () => {
        const next = await fn(await read(file(id)));
        if (next) {
          const [data, body] = split(next);
          await store.writeDoc(file(id), data, body);
        }
        return next;
      });
    },
  };
}

export function createRepos(store, { log }) {
  const releases = docs(store, 'releases', isReleaseId, log);
  return {
    releases: {
      ...releases,
      /** A new release with the next id (REL-001, REL-002…), under one lock. */
      async create(record) {
        return store.withLock(['releases', 'next-id'], async () => {
          const n = (await releases.list()).reduce((max, r) => Math.max(max, Number(r.id.slice(4))), 0) + 1;
          const made = { ...record, id: `REL-${String(n).padStart(3, '0')}` };
          await releases.write(made);
          return made;
        });
      },
    },
    config: {
      policies: async () => (await store.readYaml(['policies.yaml'])) ?? {},
    },
  };
}
