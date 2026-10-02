// Teammates: data/teammates/<id>/TEAMMATE.md — configuration in front matter, persona instructions in the body.
import { slugify } from '../util/ids.js';

const file = (id) => ['teammates', id, 'TEAMMATE.md'];

export class TeammatesRepo {
  constructor(store) {
    this.store = store;
  }

  /** Active teammates by default; retired ones stay on disk so their billing history remains. */
  async list({ includeRetired = false } = {}) {
    const ids = await this.store.list(['teammates'], { dirs: true });
    const all = await Promise.all(ids.map((id) => this.get(id)));
    return all.filter((t) => t && (includeRetired || !t.retiredAt)).sort((a, b) => (a.hiredAt ?? '').localeCompare(b.hiredAt ?? '') || a.name.localeCompare(b.name));
  }

  async get(id) {
    let doc;
    try {
      doc = await this.store.readDoc(file(id));
    } catch {
      return null; // invalid id segment
    }
    return doc ? { ...doc.data, instructions: doc.body.trim() } : null;
  }

  async uniqueId(name) {
    const base = slugify(name);
    let id = base;
    for (let n = 2; await this.store.exists(['teammates', id]); n++) id = `${base}-${n}`;
    return id;
  }

  async create(teammate) {
    const { instructions = '', ...data } = teammate;
    await this.store.writeDoc(file(data.id), data, instructions);
    return { ...data, instructions };
  }

  /** Apply `fn(teammate) => patch` atomically and return the updated teammate. */
  async update(id, fn) {
    let result = null;
    await this.store.updateDoc(file(id), async (doc) => {
      if (!doc) return null;
      const current = { ...doc.data, instructions: doc.body.trim() };
      const patch = await fn(current);
      const { instructions = current.instructions, ...data } = { ...current, ...patch };
      result = { ...data, instructions };
      return { data, body: instructions };
    });
    return result;
  }
}
