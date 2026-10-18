// Scheduled tasks: data/schedules/<id>.md. Front matter holds the teammate, cadence and run state; the body is the task.
export const SCHEDULE_ID = /^sch_[\w]+$/;
const file = (id) => ['schedules', `${id}.md`];

export class SchedulesRepo {
  constructor(store) {
    this.store = store;
  }

  async list({ teammateId } = {}) {
    const files = (await this.store.list(['schedules'])).filter((f) => f.endsWith('.md'));
    const items = await Promise.all(files.map((f) => this.get(f.slice(0, -3))));
    return items.filter((s) => s && (!teammateId || s.teammateId === teammateId)).sort((a, b) => (a.nextRunAt ?? '~').localeCompare(b.nextRunAt ?? '~'));
  }

  async get(id) {
    if (!SCHEDULE_ID.test(String(id))) return null;
    const doc = await this.store.readDoc(file(id));
    return doc ? { ...doc.data, task: doc.body.trim() } : null;
  }

  async save({ task, ...data }) {
    await this.store.writeDoc(file(data.id), data, task);
    return { ...data, task };
  }

  /** Read-modify-write under the file lock; `fn(current)` returns a patch (or null to leave it). */
  async update(id, fn) {
    if (!SCHEDULE_ID.test(String(id))) return null;
    let result = null;
    await this.store.updateDoc(file(id), (doc) => {
      if (!doc) return null;
      const current = { ...doc.data, task: doc.body.trim() };
      const patch = fn(current);
      if (!patch) {
        result = current;
        return null;
      }
      result = { ...current, ...patch };
      const { task, ...data } = result;
      return { data, body: task };
    });
    return result;
  }

  async remove(id) {
    if (!SCHEDULE_ID.test(String(id))) return;
    await this.store.remove(file(id));
  }
}
