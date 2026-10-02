// Knowledge documents: data/teammates/<id>/knowledge/<docId>.md — title, optional project tag and source file name
// in front matter, the document text as the body.
import { newId } from '../util/ids.js';

const dir = (teammateId) => ['teammates', teammateId, 'knowledge'];
export const DOC_ID = /^doc_[\w]+$/;

export class KnowledgeRepo {
  constructor(store) {
    this.store = store;
  }

  /** Every document with its content, newest first. */
  async list(teammateId) {
    const files = (await this.store.list(dir(teammateId))).filter((f) => f.startsWith('doc_') && f.endsWith('.md'));
    const docs = await Promise.all(files.map((f) => this.store.readDoc([...dir(teammateId), f])));
    return docs
      .filter(Boolean)
      .map(({ data, body }) => ({ ...data, content: body.trim() }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async get(teammateId, docId) {
    if (!DOC_ID.test(docId)) return null;
    const doc = await this.store.readDoc([...dir(teammateId), `${docId}.md`]);
    return doc ? { ...doc.data, content: doc.body.trim() } : null;
  }

  async create(teammateId, { title, content, project, filename }) {
    const now = new Date().toISOString();
    const data = { id: newId('doc'), teammateId, title, project: project || undefined, filename: filename || undefined, chars: content.length, createdAt: now, updatedAt: now };
    await this.store.writeDoc([...dir(teammateId), `${data.id}.md`], data, content);
    return { ...data, content };
  }

  async update(teammateId, docId, patch) {
    let result = null;
    await this.store.updateDoc([...dir(teammateId), `${docId}.md`], (doc) => {
      if (!doc) return null;
      const content = patch.content ?? doc.body.trim();
      const data = { ...doc.data, ...patch, content: undefined, chars: content.length, updatedAt: new Date().toISOString() };
      if ('project' in patch && !patch.project) data.project = undefined;
      result = { ...data, content };
      return { data, body: content };
    });
    return result;
  }

  async remove(teammateId, docId) {
    await this.store.remove([...dir(teammateId), `${docId}.md`]);
  }
}
