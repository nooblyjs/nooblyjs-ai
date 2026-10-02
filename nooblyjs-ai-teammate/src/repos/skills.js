// Shared skill library: data/skills/<id>.md — front matter describes the skill, body holds the instructions.
import { slugify } from '../util/ids.js';

export class SkillsRepo {
  constructor(store) {
    this.store = store;
  }

  async list() {
    const files = await this.store.list(['skills']);
    const docs = await Promise.all(files.filter((f) => f.endsWith('.md')).map((f) => this.store.readDoc(['skills', f])));
    return docs.filter(Boolean).map(({ data, body }) => ({ ...data, instructions: body.trim() }));
  }

  async get(id) {
    const doc = await this.store.readDoc(['skills', `${slugify(id)}.md`]);
    return doc ? { ...doc.data, instructions: doc.body.trim() } : null;
  }

  async update(id, { name, description, instructions }) {
    let result = null;
    await this.store.updateDoc(['skills', `${slugify(id)}.md`], (doc) => {
      if (!doc) return null;
      const data = { ...doc.data, ...(name !== undefined && { name }), ...(description !== undefined && { description }) };
      const body = instructions !== undefined ? instructions : doc.body;
      result = { ...data, instructions: body.trim() };
      return { data, body };
    });
    return result;
  }

  async create({ name, description = '', tags = [], instructions = '' }) {
    let id = slugify(name);
    for (let n = 2; await this.store.exists(['skills', `${id}.md`]); n++) id = `${slugify(name)}-${n}`;
    const data = { id, name, description, tags };
    await this.store.writeDoc(['skills', `${id}.md`], data, instructions || `Use this skill when the task involves ${name.toLowerCase()}.`);
    return { ...data, instructions };
  }
}
