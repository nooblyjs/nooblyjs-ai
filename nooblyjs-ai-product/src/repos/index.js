// The engine's records over host.store (structure.md §4). A record is its front matter plus `body`. Files people
// edited by hand into something unreadable are skipped with a warning, so one bad file can't take the board down.
import { isId } from '../util/ids.js';

const split = ({ body = '', ...data }) => [data, body];

/** Markdown documents in one folder, one per id. */
function docs(store, folder, log) {
  async function read(segments) {
    const doc = await store.readDoc(segments);
    return doc && { ...doc.data, body: doc.body };
  }
  const path = (id) => [folder, `${id}.md`];
  return {
    async list() {
      const out = [];
      for (const name of await store.list([folder])) {
        if (!name.endsWith('.md')) continue;
        try {
          const record = await read([folder, name]);
          if (record?.id) out.push(record);
        } catch (err) {
          log.warn(`skipped ${folder}/${name}: ${err.message}`);
        }
      }
      return out;
    },
    async get(id) {
      if (!isId(id)) return null;
      return read(path(id));
    },
    /** Writes the whole record (front matter + body). */
    async write(record) {
      if (!isId(record.id)) throw new Error(`not a valid id: ${record.id}`);
      const [data, body] = split(record);
      await store.writeDoc(path(record.id), data, body);
      return record;
    },
    /**
     * Read-modify-write under the record's lock, so two saves of the same record run one after the other.
     * `fn(current)` returns the new record, or throws.
     */
    async update(id, fn) {
      if (!isId(id)) return null;
      return store.withLock(path(id), async () => {
        const current = await read(path(id));
        const next = await fn(current);
        if (next) {
          const [data, body] = split(next);
          await store.writeDoc(path(id), data, body);
        }
        return next;
      });
    },
    /** Removes the record's file. */
    async remove(id) {
      if (!isId(id)) return;
      await store.withLock(path(id), () => store.remove(path(id)));
    },
    /** Runs `fn` while holding the folder's lock: for creating a record with the next number. */
    withFolderLock: (fn) => store.withLock([folder], fn),
  };
}

/** The templates (templates/<kind>.md) that portfolios' and value streams' documents start from. */
function templates(store) {
  const path = (kind) => {
    if (!['portfolio', 'value-stream', 'portfolio-epic', 'epic', 'feature'].includes(kind)) throw new Error(`not a template: ${kind}`);
    return ['templates', `${kind}.md`];
  };
  const read = async (kind) => {
    const doc = await store.readDoc(path(kind));
    return doc && { ...doc.data, body: doc.body };
  };
  return {
    get: read,
    /** Read-modify-write under the template's lock; `fn(current)` returns the new template, or throws. */
    update: (kind, fn) => store.withLock(path(kind), async () => {
      const next = await fn(await read(kind));
      const [data, body] = split(next);
      await store.writeDoc(path(kind), data, body);
      return next;
    }),
  };
}

export function createRepos(store, { log }) {
  const specs = docs(store, 'specs', log);
  return {
    signals: docs(store, 'signals', log),
    ideas: docs(store, 'ideas', log),
    drafts: docs(store, 'drafts', log),
    /** A portfolio's and a value stream's document, by its id (services/documents.js). */
    portfolios: docs(store, 'portfolios', log),
    valueStreams: docs(store, 'value-streams', log),
    /** NooblyJS Phase 17: the work hierarchy's documents, and the business cases of ideas and epics. */
    portfolioEpics: docs(store, 'portfolio-epics', log),
    epics: docs(store, 'epics', log),
    features: docs(store, 'features', log),
    businessCases: docs(store, 'business-cases', log),
    /** NooblyJS Phase 18: each spec's elicitation (stakeholders, sessions, candidates, requirements, the NFR walk, questions). */
    elicitation: docs(store, 'elicitation', log),
    templates: templates(store),
    specs: {
      ...specs,
      /** The earlier versions of a spec (the current one is the spec itself), oldest first. */
      async versions(id) {
        if (!isId(id)) return [];
        const out = [];
        for (const name of await store.list(['specs', id, 'versions'])) {
          const match = /^v(\d+)\.md$/.exec(name);
          if (!match) continue;
          try {
            const doc = await store.readDoc(['specs', id, 'versions', name]);
            out.push({ ...doc.data, version: Number(doc.data.version ?? match[1]), body: doc.body });
          } catch (err) {
            log.warn(`skipped specs/${id}/versions/${name}: ${err.message}`);
          }
        }
        return out.sort((a, b) => a.version - b.version);
      },
      /** Keeps a version that is being replaced: specs/<id>/versions/v<N>.md with who made it, when and why. */
      async keepVersion(id, { version, by, at, note, body }) {
        await store.writeDoc(['specs', id, 'versions', `v${version}.md`], { version, by, at, note: note ?? null }, body ?? '');
      },
    },
    roadmap: {
      get: async () => (await store.readYaml(['roadmap.yaml'])) ?? null,
    },
    /** Strategic themes, portfolios, value streams and products (catalogue.yaml), one file. `update(fn)`: fn(doc) returns { doc, answer } under its lock. */
    catalogue: {
      get: async () => (await store.readYaml(['catalogue.yaml'])) ?? null,
      write: (doc) => store.writeYaml(['catalogue.yaml'], doc),
      update: (fn) => store.withLock(['catalogue.yaml'], async () => {
        const { doc, answer } = await fn(await store.readYaml(['catalogue.yaml']));
        await store.writeYaml(['catalogue.yaml'], doc);
        return answer;
      }),
    },
    /**
     * An item's artefacts beyond the spec (architecture/<id>/…, ux/<id>/…), each a Markdown document. Callers pass
     * path segments; the store refuses anything that would leave the data folder.
     */
    artefacts: {
      async get(segments) {
        const doc = await store.readDoc(segments);
        return doc && { ...doc.data, body: doc.body };
      },
      async write(segments, record) {
        const [data, body] = split(record);
        await store.writeDoc(segments, data, body);
        return record;
      },
      /** Read-modify-write under the document's lock; `fn(current)` returns the new record, or throws. */
      update: (segments, fn) => store.withLock(segments, async () => {
        const doc = await store.readDoc(segments);
        const next = await fn(doc && { ...doc.data, body: doc.body });
        if (next) {
          const [data, body] = split(next);
          await store.writeDoc(segments, data, body);
        }
        return next;
      }),
      /** The documents in a folder, each with its file name as `file`; unreadable ones are skipped. */
      async list(segments) {
        const out = [];
        for (const name of await store.list(segments)) {
          if (!name.endsWith('.md')) continue;
          try {
            const doc = await store.readDoc([...segments, name]);
            out.push({ ...doc.data, body: doc.body, file: name });
          } catch (err) {
            log.warn(`skipped ${[...segments, name].join('/')}: ${err.message}`);
          }
        }
        return out;
      },
      folders: (segments) => store.list(segments, { dirs: true }),
      remove: (segments) => store.remove(segments),
      readYaml: async (segments) => (await store.readYaml(segments)) ?? null,
      withLock: (segments, fn) => store.withLock(segments, fn),
    },
    /** The flow history (data/product/flow/history.yaml): an append-only stream of handoffs and send-backs. */
    flow: {
      append: (record) => store.appendYaml(['flow', 'history.yaml'], record),
      list: () => store.readYamlStream(['flow', 'history.yaml']),
    },
    /** The development budget (data/product/budget.yaml), used until the platform shares one. */
    budget: {
      get: async () => (await store.readYaml(['budget.yaml'])) ?? null,
      set: (value) => store.writeYaml(['budget.yaml'], value),
    },
  };
}
