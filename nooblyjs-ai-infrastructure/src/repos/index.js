// This app's records over host.store (structure.md §5). A record is its front matter plus `body`. A file someone
// edited by hand into something unreadable is skipped with a warning, so one bad file can't take a screen down.
import { isDesignId, isEnvName, isGeneratedId } from '../util/ids.js';

const split = ({ body = '', ...data }) => [data, body];

/** Markdown documents in one folder, one per id (`key` is the field that holds it). */
function docs(store, folder, isValid, log, key = 'id') {
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
          if (record?.[key]) out.push(record);
        } catch (err) {
          log.warn(`skipped ${folder}/${name}: ${err.message}`);
        }
      }
      return out;
    },
    async get(id) {
      return isValid(id) ? read(file(id)) : null;
    },
    async write(record) {
      if (!isValid(record[key])) throw new Error(`not a valid ${folder} id: ${record[key]}`);
      const [data, body] = split(record);
      await store.writeDoc(file(record[key]), data, body);
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
    remove: (id) => (isValid(id) ? store.remove(file(id)) : null),
  };
}

/** list() leaves destroyed environments out; listAll() and get() still have them (their history, their name). */
function withoutDestroyed(repo) {
  return { ...repo, listAll: repo.list, list: async () => (await repo.list()).filter((env) => env.status !== 'destroyed') };
}

export function createRepos(store, { log }) {
  const yaml = async (name, fallback) => (await store.readYaml([name])) ?? fallback;
  const designs = docs(store, 'designs', isDesignId, log);
  return {
    designs: {
      ...designs,
      /** Keeps the version that is being replaced: designs/<id>/versions/v<N>.md. An approved version is never rewritten. */
      async keepVersion(design) {
        const [data, body] = split(design);
        const segments = ['designs', design.id, 'versions', `v${design.version}.md`];
        if (!(await store.exists(segments))) await store.writeDoc(segments, data, body);
      },
      async versions(id) {
        if (!isDesignId(id)) return [];
        const out = [];
        for (const name of (await store.list(['designs', id, 'versions'])) ?? []) {
          if (!/^v\d+\.md$/.test(name)) continue;
          const doc = await store.readDoc(['designs', id, 'versions', name]);
          if (doc) out.push({ ...doc.data, body: doc.body });
        }
        return out.sort((a, b) => a.version - b.version);
      },
    },
    environments: withoutDestroyed(docs(store, 'environments', isEnvName, log, 'name')),
    runs: docs(store, 'runs', isGeneratedId, log),
    drift: docs(store, 'drift', isGeneratedId, log),
    config: {
      blueprints: async () => (await yaml('blueprints.yaml', {})).blueprints ?? [],
      policies: async () => (await yaml('policies.yaml', {})).policies ?? [],
      setPolicies: (policies) => store.withLock(['policies.yaml'], () => store.writeYaml(['policies.yaml'], { policies })),
      applyRules: () => yaml('apply-rules.yaml', { kinds: {}, approval: {} }),
      promotionPaths: async () => (await yaml('promotion-paths.yaml', {})).products ?? {},
      budget: () => yaml('budget.yaml', {}),
      agent: () => yaml('agent.yaml', null),
    },
    /** What the environments cost, one record per environment per day (append-only). */
    cost: {
      append: (record) => store.appendYaml(['cost', 'ledger.yaml'], record),
      list: async () => (await store.readYamlStream(['cost', 'ledger.yaml'])) ?? [],
    },
  };
}
