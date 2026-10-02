// Things waiting for a person's approval, in data/approvals/<id>.md: tasks estimated over a threshold (id = the work
// id the task runs under, wk_…) and tool calls with side effects (kind: action, act_…). The body is the task text
// or a summary of the action.
export const APPROVAL_ID = /^(wk|act)_[\w]+$/;
const file = (id) => ['approvals', `${id}.md`];

export class ApprovalsRepo {
  constructor(store) {
    this.store = store;
  }

  async list({ status } = {}) {
    const files = (await this.store.list(['approvals'])).filter((f) => f.endsWith('.md'));
    const items = await Promise.all(files.map((f) => this.get(f.slice(0, -3))));
    return items.filter((a) => a && (!status || a.status === status)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async get(id) {
    if (!APPROVAL_ID.test(String(id))) return null;
    const doc = await this.store.readDoc(file(id));
    return doc ? { ...doc.data, task: doc.body.trim() } : null;
  }

  async create({ task, ...data }) {
    await this.store.writeDoc(file(data.id), data, task);
    return { ...data, task };
  }

  /**
   * Read-modify-write under the file lock. `fn(current)` returns a patch, or throws to refuse the change.
   * Resolves with the updated approval, or null when it does not exist.
   */
  async update(id, fn) {
    if (!APPROVAL_ID.test(String(id))) return null;
    let result = null;
    await this.store.updateDoc(file(id), (doc) => {
      if (!doc) return null;
      const patch = fn({ ...doc.data, task: doc.body.trim() });
      result = { ...doc.data, ...patch, task: doc.body.trim() };
      const { task, ...data } = result;
      return { data, body: task };
    });
    return result;
  }
}
