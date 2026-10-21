// This app's records over host.store (.claude/steering/structure.md). A record is its front matter plus `body`. A file
// someone edited by hand into something unreadable is skipped with a warning, so one bad file can't take a screen down.
import { isFindingId, isThreatModelId } from '../util/ids.js';

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
  const findings = docs(store, 'findings', isFindingId, log);
  return {
    threatModels: docs(store, 'threat-models', isThreatModelId, log),
    findings: {
      ...findings,
      /** A new finding with the next id (FND-001, FND-002…), under one lock so two scans can't take the same one. */
      async create(record) {
        return store.withLock(['findings', 'next-id'], async () => {
          const n = (await findings.list()).reduce((max, f) => Math.max(max, Number(f.id.slice(4))), 0) + 1;
          const made = { ...record, id: `FND-${String(n).padStart(3, '0')}` };
          await findings.write(made);
          return made;
        });
      },
    },
    config: {
      policies: async () => (await store.readYaml(['policies.yaml'])) ?? {},
    },
    /** Every scan, one record each (append-only). */
    scans: {
      append: (record) => store.appendYaml(['scans', 'scans.yaml'], record),
      list: async () => (await store.readYamlStream(['scans', 'scans.yaml'])) ?? [],
    },
  };
}
