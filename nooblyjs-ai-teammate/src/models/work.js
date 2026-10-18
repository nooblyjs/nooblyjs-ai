// Work log: one Markdown file per task at data/teammates/<id>/work/YYYY-MM/<workId>.md.
export class WorkRepo {
  constructor(store) {
    this.store = store;
  }

  async save(teammateId, work) {
    const { request, response, ...data } = work;
    const body = `## Request\n\n${request}\n\n## Response\n\n${response || '_No response._'}`;
    await this.store.writeDoc(['teammates', teammateId, 'work', data.startedAt.slice(0, 7), `${data.id}.md`], data, body);
  }

  async get(teammateId, workId) {
    const months = (await this.store.list(['teammates', teammateId, 'work'], { dirs: true })).reverse();
    for (const month of months) {
      const doc = await this.store.readDoc(['teammates', teammateId, 'work', month, `${workId}.md`]);
      if (doc) {
        const [, request = '', response = ''] = /## Request\n\n([\s\S]*?)\n\n## Response\n\n([\s\S]*)$/.exec(doc.body) ?? [];
        return { ...doc.data, request: request.trim(), response: response.trim() };
      }
    }
    return null;
  }

  /** Read-modify-write of one work item's front matter (request and response are kept). */
  async update(teammateId, workId, fn) {
    const w = await this.get(teammateId, workId);
    if (!w) return null;
    const next = { ...w, ...fn(w) };
    await this.save(teammateId, next);
    return next;
  }

  /** Work items started on or after `from` (ISO date), newest first, without their request/response bodies. */
  async list(teammateId, { from = '0000-00-00' } = {}) {
    const months = (await this.store.list(['teammates', teammateId, 'work'], { dirs: true })).filter((m) => m >= from.slice(0, 7));
    const items = [];
    for (const month of months) {
      const files = (await this.store.list(['teammates', teammateId, 'work', month])).filter((f) => f.endsWith('.md'));
      const docs = await Promise.all(files.map((f) => this.store.readDoc(['teammates', teammateId, 'work', month, f])));
      for (const doc of docs.filter(Boolean)) {
        if ((doc.data.startedAt ?? '') < from) continue;
        const request = /## Request\n\n([\s\S]*?)\n\n## Response/.exec(doc.body)?.[1] ?? '';
        items.push({ ...doc.data, title: request.split('\n')[0].slice(0, 120) });
      }
    }
    return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
