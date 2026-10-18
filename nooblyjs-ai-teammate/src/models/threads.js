// Conversation threads: data/teammates/<id>/threads/<threadId>.md lists the work items (turns) in order.
// The request and response of each turn live in the work item itself.
export const THREAD_ID = /^thr_[\w]+$/;

const file = (teammateId, threadId) => ['teammates', teammateId, 'threads', `${threadId}.md`];

export class ThreadsRepo {
  constructor(store) {
    this.store = store;
  }

  async get(teammateId, threadId) {
    if (!THREAD_ID.test(String(threadId))) return null;
    const doc = await this.store.readDoc(file(teammateId, threadId));
    return doc ? doc.data : null;
  }

  /** Adds a turn, creating the thread on its first turn. */
  async append(teammateId, threadId, { workId, title, project }) {
    let result = null;
    await this.store.updateDoc(file(teammateId, threadId), (doc) => {
      const now = new Date().toISOString();
      const data = doc?.data ?? { id: threadId, teammateId, title, project: project || undefined, createdAt: now, turns: [] };
      data.turns = [...(data.turns ?? []), workId];
      data.updatedAt = now;
      result = data;
      return { data, body: `Conversation with ${teammateId}. Each turn is a work item in ../work/.` };
    });
    return result;
  }
}
