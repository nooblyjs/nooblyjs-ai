// Hire drafts saved from the "Save draft" button: data/drafts/<id>.md.
import { newId } from '../util/ids.js';

export class DraftsRepo {
  constructor(store) {
    this.store = store;
  }

  async save(draft) {
    const id = draft.id && /^draft_[\w]+$/.test(draft.id) ? draft.id : newId('draft');
    const data = { ...draft, id, savedAt: new Date().toISOString() };
    await this.store.writeDoc(['drafts', `${id}.md`], data, `Hire draft for ${draft.name || 'an unnamed teammate'}.`);
    return data;
  }

  async get(id) {
    try {
      return (await this.store.readDoc(['drafts', `${id}.md`]))?.data ?? null;
    } catch {
      return null;
    }
  }
}
