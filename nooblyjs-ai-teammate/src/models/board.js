// The Team board's files (.claude/specs/team-board/design.md §2), under data/teammates/board/:
//   posts/YYYY-MM/<postId>.md      one post: its state in the front matter, its body (never rewritten)
//   threads/YYYY-MM/<postId>.yaml  its replies, only ever appended to (a reply's `hidden` is the one change)
//   signals/YYYY-MM/<postId>.yaml  who gave which signal
//   limits/<YYYY-MM-DD>.yaml       agent writes per teammate that day (the daily caps)
//   state.md                       the last stand-up and digest, so they run once
// An in-memory index of every post's front matter, a preview of its body and its counts answers lists, counts and
// the briefing without opening files. It is built on first use and kept up to date by every write here.
import yaml from 'js-yaml';
import { newId } from '../utils/ids.js';

export const POST_ID = /^pst_[a-z0-9]+_[a-f0-9]+$/;
export const REPLY_ID = /^rpl_[a-z0-9]+_[a-f0-9]+$/;
const PREVIEW = 400;

const postFile = (month, id) => ['board', 'posts', month, `${id}.md`];
const threadFile = (month, id) => ['board', 'threads', month, `${id}.yaml`];
const signalFile = (month, id) => ['board', 'signals', month, `${id}.yaml`];
const limitFile = (day) => ['board', 'limits', `${day}.yaml`];
const STATE_FILE = ['board', 'state.md'];

const readYaml = (text, fallback) => (text ? yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? fallback : fallback);
const dumpYaml = (value) => yaml.dump(value, { schema: yaml.CORE_SCHEMA, lineWidth: 120, noRefs: true });
const counts = (signals) => Object.fromEntries(Object.entries(signals).map(([k, who]) => [k, who.length]));

export class BoardRepo {
  constructor(store) {
    this.store = store;
    this.index = null; // id -> entry
    this.loading = null;
  }

  // ---------- The index ----------

  async load() {
    if (this.index) return this.index;
    this.loading ??= (async () => {
      const index = new Map();
      for (const month of await this.store.list(['board', 'posts'], { dirs: true })) {
        const files = (await this.store.list(['board', 'posts', month])).filter((f) => f.endsWith('.md'));
        await Promise.all(files.map(async (f) => {
          const id = f.slice(0, -3);
          if (!POST_ID.test(id)) return;
          const doc = await this.store.readDoc(postFile(month, id));
          if (!doc) return;
          const [replies, signals] = await Promise.all([this.replies(month, id), this.signals(month, id)]);
          index.set(id, this.entry(month, doc, replies, signals));
        }));
      }
      this.index = index;
      return index;
    })();
    return this.loading;
  }

  entry(month, doc, replies, signals) {
    const body = doc.body.trim();
    const shown = replies.filter((r) => !r.hidden);
    return {
      ...doc.data,
      month,
      preview: body.length > PREVIEW ? `${body.slice(0, PREVIEW - 1)}…` : body,
      replyCount: shown.length,
      lastActivityAt: shown.at(-1)?.at ?? doc.data.createdAt,
      signals: counts(signals),
      signalHolders: signals, // who gave which signal (actor keys); the API shows only counts and the viewer's own
      takenBy: signals.take ?? [],
    };
  }

  async refresh(id) {
    const index = await this.load();
    const month = index.get(id)?.month;
    if (!month) return null;
    const doc = await this.store.readDoc(postFile(month, id));
    if (!doc) return null;
    const [replies, signals] = await Promise.all([this.replies(month, id), this.signals(month, id)]);
    const entry = this.entry(month, doc, replies, signals);
    index.set(id, entry);
    return entry;
  }

  /** Every post's entry (front matter, preview, counts), newest first. */
  async all() {
    return [...(await this.load()).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async entryOf(id) {
    if (!POST_ID.test(String(id))) return null;
    return (await this.load()).get(id) ?? null;
  }

  // ---------- Posts ----------

  /** Writes a new post. `data` is its front matter (without id and month); returns the index entry. */
  async create(data, body) {
    const index = await this.load();
    const id = data.id ?? newId('pst');
    const month = data.createdAt.slice(0, 7);
    await this.store.writeDoc(postFile(month, id), { id, ...data }, body);
    const entry = this.entry(month, { data: { id, ...data }, body }, [], {});
    index.set(id, entry);
    return entry;
  }

  /** The post with its whole body, its replies and who gave which signal; null when unknown. */
  async get(id) {
    const entry = await this.entryOf(id);
    if (!entry) return null;
    const doc = await this.store.readDoc(postFile(entry.month, id));
    if (!doc) return null;
    const [replies, signals] = await Promise.all([this.replies(entry.month, id), this.signals(entry.month, id)]);
    return { ...entry, body: doc.body.trim(), replies, signalsBy: signals };
  }

  /**
   * Changes a post's front matter under its lock. `fn(data)` returns the fields to change, or null to change nothing.
   * The body is written back as it was read: no change here can reach it. Resolves with the new entry, or null.
   */
  async update(id, fn) {
    const entry = await this.entryOf(id);
    if (!entry) return null;
    let changed = false;
    await this.store.updateDoc(postFile(entry.month, id), (doc) => {
      if (!doc) return null;
      const patch = fn(doc.data);
      if (!patch) return null;
      changed = true;
      const { id: _id, body: _body, ...rest } = patch;
      return { data: { ...doc.data, ...rest }, body: doc.body };
    });
    return changed ? this.refresh(id) : entry;
  }

  // ---------- Threads ----------

  async replies(month, id) {
    return readYaml(await this.store.readText(threadFile(month, id)), []);
  }

  /** Appends a reply to the post's thread. Resolves with the reply (with its id). */
  async appendReply(id, reply) {
    const entry = await this.entryOf(id);
    if (!entry) return null;
    const saved = { id: newId('rpl'), ...reply };
    const file = threadFile(entry.month, id);
    await this.store.withLock(file, async () => {
      const list = readYaml(await this.store.readText(file), []);
      list.push(saved);
      await this.store.writeText(file, dumpYaml(list));
    });
    await this.refresh(id);
    return saved;
  }

  /** Hides one reply (who, when, why). The reply's text stays in the file. */
  async hideReply(id, replyId, hidden) {
    const entry = await this.entryOf(id);
    if (!entry || !REPLY_ID.test(String(replyId))) return null;
    const file = threadFile(entry.month, id);
    let found = null;
    await this.store.withLock(file, async () => {
      const list = readYaml(await this.store.readText(file), []);
      found = list.find((r) => r.id === replyId) ?? null;
      if (!found || found.hidden) return;
      found.hidden = hidden;
      await this.store.writeText(file, dumpYaml(list));
    });
    await this.refresh(id);
    return found;
  }

  // ---------- Signals ----------

  async signals(month, id) {
    return readYaml(await this.store.readText(signalFile(month, id)), {});
  }

  /** Gives (on) or takes back a signal for `who` (an actor key). Resolves with the post's signal map. */
  async setSignal(id, signal, who, on) {
    const entry = await this.entryOf(id);
    if (!entry) return null;
    const file = signalFile(entry.month, id);
    let map = {};
    await this.store.withLock(file, async () => {
      map = readYaml(await this.store.readText(file), {});
      const list = new Set(map[signal] ?? []);
      if (on) list.add(who);
      else list.delete(who);
      if (list.size) map[signal] = [...list];
      else delete map[signal];
      await this.store.writeText(file, dumpYaml(map));
    });
    await this.refresh(id);
    return map;
  }

  /** Removes a post and its thread and signals. Only the seed uses it, to rewrite its own sample posts on a reset. */
  async removeSample(id) {
    const entry = await this.entryOf(id);
    if (!entry?.sample) return;
    await Promise.all([postFile, threadFile, signalFile].map((f) => this.store.remove(f(entry.month, id))));
    this.index.delete(id);
  }

  // ---------- Daily caps and the board's own state ----------

  /** Adds one to `slug`'s count of `what` (posts | replies) on `day` if it is under `max`. Resolves true if it was. */
  async takeAllowance(day, slug, what, max) {
    const file = limitFile(day);
    let ok = false;
    await this.store.withLock(file, async () => {
      const map = readYaml(await this.store.readText(file), {});
      const used = map[slug]?.[what] ?? 0;
      if (used >= max) return;
      map[slug] = { ...(map[slug] ?? {}), [what]: used + 1 };
      await this.store.writeText(file, dumpYaml(map));
      ok = true;
    });
    return ok;
  }

  async state() {
    return (await this.store.readDoc(STATE_FILE))?.data ?? {};
  }

  async setState(patch) {
    await this.store.updateDoc(STATE_FILE, (doc) => ({ data: { ...(doc?.data ?? {}), ...patch }, body: 'When the Team board last posted the stand-ups and the weekly digest.' }));
  }
}
