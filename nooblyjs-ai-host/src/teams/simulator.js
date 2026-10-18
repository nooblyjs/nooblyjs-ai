// The Teams simulator (tech.md §7.3, development sign-in only): a stand-in meeting chat at /dev/teams, so every bot
// flow can be tested in a browser before it goes near a tenant. It builds the activities Teams would send, hands
// them to the same endpoint code as POST /api/teams/messages (with the dev key in place of Microsoft's signature),
// and is the connector the bot's replies go out through. What was said is kept in data/teams/sim/<meeting>/.
//
// The simulator's own transcript is for drawing the page. A teammate never reads it: its context is the
// MeetingSession's stream (sessions.js), which only holds what the bot received after the teammate joined.
import { daySegments } from '../util/dates.js';
import { newId } from '../util/ids.js';
import { HttpError } from '../util/errors.js';
import { BOT, conversationKey } from './activities.js';

const MAX_LINES = 200;
const initials = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function createSimulator({ store, events, people, sessions, clock = Date }) {
  const now = () => new Date(clock.now()).toISOString();
  const working = new Map(); // meeting id → the teammate the bot said is typing
  const dir = (id) => ['teams', 'sim', conversationKey(id)];

  async function meetings() {
    return (await store.readYaml(['teams', 'sim', 'meetings.yaml']))?.meetings ?? [];
  }

  async function meetingOr404(id) {
    const meeting = (await meetings()).find((m) => m.id === id);
    if (!meeting) throw new HttpError(404, 'not_found', 'There is no such simulated meeting.');
    return meeting;
  }

  async function keep(id, line) {
    const at = now();
    await store.appendYaml([...dir(id), daySegments(at)[2]], { id: newId('sim'), at, ...line });
    await events.emit('teams.activity_sent', { conversationId: id });
  }

  /** The bot's way out. Here the "channel" is the simulator's transcript; with the real bot it is the Bot Connector. */
  const connector = {
    async send(a, activity) {
      if (activity.type === 'typing') {
        working.set(a.conversationId, activity.channelData?.noobly?.as ?? { name: BOT.name });
        await events.emit('teams.activity_sent', { conversationId: a.conversationId });
        return;
      }
      working.delete(a.conversationId);
      await keep(a.conversationId, { dir: 'out', activity });
    },
  };

  /** The activity Teams would send when this person says something, or presses a button on a card. */
  async function activityFor(id, person, { text = '', value = null } = {}) {
    const meeting = await meetingOr404(id);
    const said = String(text ?? '').trim().slice(0, 4000);
    if (!said && !value) throw new HttpError(400, 'bad_request', 'Write a message first.');
    const mentionsBot = /(^|[^\w@])@noobly(?:js)?\b/i.test(said);
    return {
      type: 'message',
      id: newId('act'),
      timestamp: now(),
      channelId: 'msteams',
      serviceUrl: 'urn:noobly:simulator',
      conversation: { id: meeting.id, name: meeting.title, conversationType: 'groupChat' },
      from: { id: `29:${person.id}`, name: person.name, aadObjectId: person.id },
      recipient: { ...BOT },
      ...(value ? { value } : { text: mentionsBot ? said.replace(/@noobly(?:js)?\b/i, `<at>${BOT.name}</at>`) : said }),
      entities: mentionsBot ? [{ type: 'mention', mentioned: { ...BOT }, text: `<at>${BOT.name}</at>` }] : [],
    };
  }

  /** What a person typed, kept for the page before the bot sees it. */
  const said = (id, person, text) => keep(id, { dir: 'in', from: { id: person.id, name: person.name }, text: String(text).trim().slice(0, 4000) });

  /** Everything the page draws: the meeting, what was said before anyone joined, the transcript and who is in it. */
  async function view(id) {
    const meeting = await meetingOr404(id);
    const everyone = new Map((await people.list()).map((p) => [p.id, p]));
    const face = (pid) => ({ id: pid, name: everyone.get(pid)?.name ?? pid, initials: initials(everyone.get(pid)?.name ?? pid) });
    const days = (await store.list(dir(id))).filter((n) => n.endsWith('.yaml')).sort().slice(-7);
    const lines = [];
    for (const day of days) lines.push(...(await store.readYamlStream([...dir(id), day])));
    const session = await sessions.get(conversationKey(id));
    const link = await sessions.linkFor(id);
    return {
      meeting: { id: meeting.id, title: meeting.title, subtitle: meeting.subtitle ?? '', people: (meeting.people ?? []).map(face), teamId: link.teamId ?? null, itemId: link.itemId ?? null },
      earlier: (meeting.earlier ?? []).map((m) => ({ from: face(m.from), time: m.time, text: m.text })),
      transcript: lines.slice(-MAX_LINES).map((l) => (l.dir === 'in'
        ? { id: l.id, at: l.at, dir: 'in', from: { ...l.from, initials: initials(l.from.name) }, text: l.text }
        : { id: l.id, at: l.at, dir: 'out', text: l.activity.text ?? '', card: l.activity.attachments?.[0]?.content ?? null, kind: l.activity.channelData?.noobly?.kind ?? 'bot', as: l.activity.channelData?.noobly?.as ?? null })),
      session: session?.teammate ? { teammate: { ...session.teammate, initials: initials(session.teammate.name) }, addedBy: session.addedBy, billedTeam: session.billedTeam, joinedAt: session.joinedAt, itemId: session.itemId } : null,
      working: working.get(id) ?? null,
    };
  }

  /** Empties a meeting so the story can be run again: the transcript, and the session with its context. */
  async function reset(id) {
    await meetingOr404(id);
    working.delete(id);
    await store.remove(dir(id)).catch(() => {});
    await store.remove(['teams', 'sessions', conversationKey(id)]).catch(() => {});
    await store.remove(['teams', 'sessions', `${conversationKey(id)}.md`]).catch(() => {});
    await events.emit('teams.activity_sent', { conversationId: id });
  }

  return { meetings, view, activityFor, said, reset, connector };
}
