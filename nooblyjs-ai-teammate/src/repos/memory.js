// Memory items. Personal memory lives in data/teammates/<id>/memory/, shared team memory in data/team-memory/.
// One Markdown file per item: kind, learnedAt, source work item, optional project and pinned flag in front matter;
// the learned text as the body.
import { newId } from '../util/ids.js';

export const MEMORY_KINDS = ['fact', 'preference', 'source'];
export const MEMORY_ID = /^mem_[\w]+$/;
const TEAM_DIR = ['team-memory'];
const MERGED_MAX = 900;

const dirFor = (teammate) => (teammate.memoryMode === 'team' ? TEAM_DIR : ['teammates', teammate.id, 'memory']);
const newestFirst = (a, b) => (b.learnedAt ?? '').localeCompare(a.learnedAt ?? '');

export class MemoryRepo {
  constructor(store) {
    this.store = store;
  }

  async listDir(dir) {
    const files = (await this.store.list(dir)).filter((f) => f.endsWith('.md'));
    const docs = await Promise.all(files.map((f) => this.store.readDoc([...dir, f])));
    return docs.filter(Boolean).map(({ data, body }) => ({ ...data, pinned: Boolean(data.pinned), text: body.trim() })).sort(newestFirst);
  }

  /** Items visible to the teammate given its memory mode, newest first. Session-only teammates keep nothing. */
  async list(teammate) {
    if (teammate.memoryMode === 'session') return [];
    return this.listDir(dirFor(teammate));
  }

  /** Everything in shared team memory, whoever contributed it. */
  listTeam() {
    return this.listDir(TEAM_DIR);
  }

  async add(teammate, { kind, text, source = null, project, learnedAt = new Date().toISOString() }) {
    if (teammate.memoryMode === 'session') return null;
    if (!MEMORY_KINDS.includes(kind)) kind = 'fact';
    const item = { id: newId('mem'), teammateId: teammate.id, kind, learnedAt, source, project: project || undefined, pinned: false };
    await this.store.writeDoc([...dirFor(teammate), `${item.id}.md`], item, text);
    await this.enforceCap(teammate);
    return { ...item, text };
  }

  async remove(teammate, memoryId) {
    await this.store.remove([...dirFor(teammate), `${memoryId}.md`]);
  }

  removeTeam(memoryId) {
    return this.store.remove([...TEAM_DIR, `${memoryId}.md`]);
  }

  async setPinnedIn(dir, memoryId, pinned) {
    let result = null;
    await this.store.updateDoc([...dir, `${memoryId}.md`], (doc) => {
      if (!doc) return null;
      result = { ...doc.data, pinned: Boolean(pinned), text: doc.body.trim() };
      return { data: { ...doc.data, pinned: Boolean(pinned) }, body: doc.body };
    });
    return result;
  }

  setPinned(teammate, memoryId, pinned) {
    return this.setPinnedIn(dirFor(teammate), memoryId, pinned);
  }

  setTeamPinned(memoryId, pinned) {
    return this.setPinnedIn(TEAM_DIR, memoryId, pinned);
  }

  /** Reset clears the teammate's own memory. In team mode it removes only the items this teammate contributed. */
  async reset(teammate) {
    if (teammate.memoryMode === 'team') {
      const items = await this.list(teammate);
      await Promise.all(items.filter((i) => i.teammateId === teammate.id).map((i) => this.remove(teammate, i.id)));
    } else {
      await this.store.remove(['teammates', teammate.id, 'memory']);
    }
  }

  /**
   * Over the cap, the oldest unpinned items are merged into one note instead of being deleted.
   * Merges stay within one project (and one contributor in team memory) so nothing leaks between them.
   * Pinned items are never merged or removed.
   */
  async enforceCap(teammate) {
    const cap = Number(teammate.memoryCap) || 0;
    if (!cap) return;
    const dir = dirFor(teammate);
    const skipped = new Set();
    for (;;) {
      const items = await this.list(teammate);
      const over = items.length - cap;
      if (over <= 0) return;
      const oldest = items.filter((i) => !i.pinned).reverse();
      const bucketOf = (i) => `${i.project ?? ''}|${i.teammateId ?? ''}`;
      const first = oldest.find((i) => !skipped.has(bucketOf(i)));
      if (!first) return;
      const group = oldest.filter((i) => bucketOf(i) === bucketOf(first)).slice(0, over + 1);
      if (group.length < 2) {
        skipped.add(bucketOf(first));
        continue;
      }
      const kinds = group.map((i) => i.kind);
      const kind = MEMORY_KINDS.reduce((best, k) => (kinds.filter((x) => x === k).length > kinds.filter((x) => x === best).length ? k : best), kinds[0]);
      const merged = group.map((i) => i.text.replace(/\s+/g, ' ').trim()).join(' · ');
      const item = {
        id: newId('mem'), teammateId: first.teammateId, kind, learnedAt: group.at(-1).learnedAt,
        source: group.find((i) => i.source)?.source ?? null, project: first.project || undefined, pinned: false,
        mergedFrom: group.flatMap((i) => i.mergedFrom ?? [i.id]).slice(0, 50),
        sources: [...new Set(group.flatMap((i) => i.sources ?? (i.source ? [i.source] : [])))].slice(0, 50),
      };
      await this.store.writeDoc([...dir, `${item.id}.md`], item, merged.length > MERGED_MAX ? `${merged.slice(0, MERGED_MAX - 1)}…` : merged);
      await Promise.all(group.map((i) => this.store.remove([...dir, `${i.id}.md`])));
    }
  }
}
