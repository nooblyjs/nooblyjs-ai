// MeetingSessions (product.md §7, tech.md §7.3): which agent teammate is in a Teams chat or meeting, who added
// them, which team pays, when they joined and which item they loaded. One file per conversation:
// data/teams/sessions/<conversation>.md, with what was said since the join in data/teams/sessions/<conversation>/.
//
// The join time is the rule that matters: a teammate is only ever given messages stamped at or after it. Nothing
// here can fetch chat history, and nothing older is ever written to the session's stream.
import { daySegments } from '../util/dates.js';

const MAX_CONTEXT = 30;

export function createSessions({ store, clock = Date }) {
  const now = () => new Date(clock.now()).toISOString();
  const file = (key) => ['teams', 'sessions', `${key}.md`];

  /** The conversation's record, or null. `teammate` is null when nobody is in the chat. */
  async function get(key) {
    return (await store.readDoc(file(key)))?.data ?? null;
  }

  /** The team and item a conversation belongs to (data/teams/links.yaml), or {} when it isn't linked. */
  async function linkFor(conversationId) {
    const links = (await store.readYaml(['teams', 'links.yaml']))?.conversations ?? {};
    return links[conversationId] ?? {};
  }

  /** A teammate joins. The session before it, if any, moves to `previous`. */
  async function open(key, { conversationId, conversationName, teammate, addedBy, billedTeam, itemId = null }) {
    const joinedAt = now();
    let session;
    await store.updateDoc(file(key), (doc) => {
      const earlier = doc?.data ?? {};
      session = {
        conversationId, conversationName: conversationName ?? earlier.conversationName ?? null,
        teammate, addedBy, billedTeam, joinedAt, leftAt: null, itemId,
        previous: [...(earlier.previous ?? []), ...(earlier.teammate ? [past(earlier, joinedAt)] : [])],
      };
      return { data: session, body: doc?.body ?? '\nA teammate reads only what is said after `joinedAt`. Its time is billed to `billedTeam`.\n' };
    });
    return session;
  }

  const past = (s, leftAt) => ({ teammate: s.teammate, addedBy: s.addedBy, billedTeam: s.billedTeam, joinedAt: s.joinedAt, leftAt: s.leftAt ?? leftAt, itemId: s.itemId ?? null });

  /** The teammate leaves ("Choose someone else"). Resolves with the session that ended, or null. */
  async function leave(key) {
    const leftAt = now();
    let ended = null;
    await store.updateDoc(file(key), (doc) => {
      if (!doc?.data?.teammate) return null;
      ended = past(doc.data, leftAt);
      return { ...doc, data: { ...doc.data, teammate: null, addedBy: null, joinedAt: null, leftAt, previous: [...(doc.data.previous ?? []), ended] } };
    });
    return ended;
  }

  /** Keeps one line of the conversation for the teammate's context. The caller has checked it is after the join. */
  async function record(key, { at, from, text, kind = 'said' }) {
    const entry = { at, from, text, kind };
    await store.appendYaml(['teams', 'sessions', key, daySegments(at)[2]], entry);
    return entry;
  }

  /** What was said since the teammate joined, oldest first: all the teammate is ever given. */
  async function context(key, joinedAt) {
    const days = (await store.list(['teams', 'sessions', key])).filter((n) => n.endsWith('.yaml') && n.slice(0, 10) >= joinedAt.slice(0, 10)).sort();
    const lines = [];
    for (const day of days) lines.push(...(await store.readYamlStream(['teams', 'sessions', key, day])));
    return lines.filter((line) => line.at >= joinedAt).slice(-MAX_CONTEXT);
  }

  return { get, linkFor, open, leave, record, context, now };
}
