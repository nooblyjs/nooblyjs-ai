// Repositories over the host's store (NooblyJS tech.md §3.2): one per entity, each a folder of Markdown files with YAML
// front matter under this app's data folder (data/workflows/). Routes never touch the store; services use these.
import { conflict } from './errors.js';

export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const APPROVAL_ID = /^apr_[a-z0-9]{1,40}$/;
export const HANDOFF_ID = /^hof_[a-z0-9]{1,40}$/;

function entity(store, folder, idPattern) {
  const file = (id) => [folder, `${id}.md`];
  const toRecord = (doc) => (doc ? { ...doc.data, body: (doc.body ?? '').trim() } : null);
  const toDoc = ({ body = '', ...data }) => ({ data, body: body ? `\n${body.trim()}\n` : '' });

  async function get(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) return null;
    return toRecord(await store.readDoc(file(id)));
  }

  return {
    get,
    async list() {
      const names = (await store.list([folder])).filter((n) => n.endsWith('.md'));
      return (await Promise.all(names.map((n) => get(n.slice(0, -3))))).filter(Boolean);
    },
    /** Writes a new record; 409 when one with that id exists. */
    async create(record) {
      if (!idPattern.test(record.id ?? '')) throw new Error(`Not a valid ${folder} id: ${record.id}`);
      return store.withLock(file(record.id), async () => {
        if (await store.exists(file(record.id))) throw conflict('exists', `${record.id} already exists.`);
        const doc = toDoc(record);
        await store.writeDoc(file(record.id), doc.data, doc.body);
        return record;
      });
    },
    /**
     * Read-modify-write under the file's lock. `fn(current)` returns the new record, or null to change nothing.
     * Resolves with the new record, or null (unknown id, or nothing changed).
     */
    async update(id, fn) {
      if (!idPattern.test(id ?? '')) return null;
      let result = null;
      await store.updateDoc(file(id), async (doc) => {
        if (!doc) return null;
        const next = await fn(toRecord(doc));
        if (!next) return null;
        result = next;
        return toDoc(next);
      });
      return result;
    },
  };
}

export function createRepos(store) {
  return {
    items: entity(store, 'items', ITEM_ID),
    approvals: entity(store, 'approvals', APPROVAL_ID),
    handoffs: entity(store, 'handoffs', HANDOFF_ID),
    readYaml: (name) => store.readYaml([name]),
  };
}
