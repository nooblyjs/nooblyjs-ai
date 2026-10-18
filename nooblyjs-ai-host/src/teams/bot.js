// The NooblyJS Teams bot (product.md §5.10, tech.md §7.3): it brings agent teammates into a Teams chat or meeting.
// Mention @NooblyJS and it asks who to add; a person adds one; the teammate introduces itself and answers when
// mentioned, with a card that carries the facts, links into NooblyJS, the sources and what the answer cost.
//
// The rules this file enforces:
//   - One NooblyJS bot. A teammate speaks through cards that carry its name and the "NooblyJS teammate" label.
//   - Only a person NooblyJS knows, with the `draft` permission, can add a teammate or ask one a question.
//   - A teammate is given only what was said at or after it joined. The bot never fetches chat history.
//   - Nothing is decided in Teams: an action that decides is a link into NooblyJS (cards.js).
//   - Every message in and out of a session is audited, logged to the linked item's thread, and the teammate's
//     time is billed to the session's team.
import { HttpError } from '../util/errors.js';
import { readReply } from '../services/chat-reply.js';
import { botMessage, typing } from './activities.js';

const ANSWER_RULES = [
  'You are in a Microsoft Teams meeting chat as an NooblyJS teammate. Answer the person who mentioned you.',
  'Keep it to two or three sentences. Say what you know from the context given, and say so when you do not know.',
  'Never invent numbers, dates, people or sources. Use "[PLACEHOLDER: what is missing]" for a fact you do not have.',
  'You cannot approve, change a status, merge or grant access, and you must not say that you did. A decision is made by a person, in NooblyJS.',
  'You have only seen what was said since you joined. If asked about something earlier, say you joined after it.',
  'When a few key facts help, end with ONE fenced block like this:',
  '```noobly-card',
  'type: facts',
  'title: PRD-031 · status',
  'rows:',
  '  - { label: Stage, value: Architect }',
  '```',
].join('\n');

// "post meeting notes to PRD-031", "post the meeting notes to IDEA-020" (Phase 12).
const NOTES = /\bpost\s+(?:the\s+)?(?:meeting\s+)?notes\s+(?:to|on)\s+([A-Za-z][A-Za-z0-9._-]{1,40})\b/i;
const NOTES_RULES = [
  'You are an NooblyJS teammate in a Microsoft Teams meeting. Write the meeting notes from what was said, below.',
  'Use short lines: what was decided (by whom), what is still open, and who does what next. No more than ten lines.',
  'Write only what was said. Never invent a decision, a date or a name. A decision is a person\'s, never yours.',
].join('\n');

const initials = (name) => String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const first = (name) => String(name ?? '').split(/\s+/)[0];
const money = (usd) => `$${(Number(usd) || 0).toFixed(2)}`;

export function createBot({ agents, teams, people, roles, sessions, cards, connector, notify = null, chat, events, auditLog, store, publicBaseUrl = '', log }) {
  const link = (href) => (/^https?:/.test(href) ? href : `${publicBaseUrl.replace(/\/$/, '')}${href}`);
  const audit = (entry) => auditLog.record(entry).catch((err) => log?.warn?.(`teams audit: ${err.message}`));

  /** Sends one activity to the conversation, and audits it. */
  async function send(a, activity, { as = null, costUsd = null } = {}) {
    await connector.send(a, activity);
    if (activity.type === 'message') await audit({ actor: as?.id ?? 'system', action: 'teams.message_sent', target: a.conversationId, conversation: a.conversationName, kind: activity.channelData?.noobly?.kind ?? null, ...(as ? { teammateId: as.id } : {}), ...(costUsd != null ? { costUsd } : {}) });
  }
  const say = (a, text) => send(a, botMessage({ text, noobly: { kind: 'bot' } }));

  /**
   * The person behind an activity: by the Entra object id Teams sends (recorded when they signed in to NooblyJS with
   * Microsoft), else, for the simulator, by NooblyJS id; in development, the Agents Playground's mock user stands for
   * TEAMS_BOT_DEV_PERSON. Null when NooblyJS has no record of them.
   */
  async function personOf(a) {
    const id = a.from.aadObjectId;
    let person = id ? (await people.getByEntraId?.(id).catch(() => null)) ?? (await people.get(id).catch(() => null)) : null;
    if (!person && a.from.devPerson) person = await people.get(a.from.devPerson).catch(() => null);
    return person?.active ? person : null;
  }

  /** Who pays: the conversation's linked team, else the first team of the person adding the teammate. */
  async function billedTeam(a, person) {
    const all = await teams.list();
    const linked = (await sessions.linkFor(a.conversationId)).teamId;
    const team = all.find((t) => t.id === linked) ?? all.find((t) => t.people.some((p) => p.id === person.id));
    return team ? { id: team.id, name: team.name } : null;
  }

  async function scripts() {
    return (await store.readYaml(['teams', 'scripts.yaml'])) ?? { intros: {}, answers: [], fallback: { text: 'I have no answer for that yet.', costUsd: 0 } };
  }

  /** {item}, {stage}… in a script, filled from NooblyJS as it is now. */
  async function varsFor(session) {
    const facts = session.itemId ? await chat.factsFor(session.itemId) : null;
    return {
      item: facts?.item ?? 'this meeting', itemId: session.itemId ?? '', itemTitle: facts?.title ?? '', stage: facts?.stage ?? 'not linked to an item',
      waitingOn: facts?.waitingOn ?? 'no one', readiness: facts?.readiness ?? 'not known', team: session.billedTeam.name, first: first(session.teammate.name),
    };
  }
  const fill = (value, vars) => (typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m)
    : Array.isArray(value) ? value.map((v) => fill(v, vars)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)])) : value);

  // ---------------------------------------------------------------------------- asking who to add

  async function offerTeammates(a, person) {
    const team = await billedTeam(a, person);
    const roster = await agents.roster();
    if (!agents.running() || !roster.length) return say(a, 'Digital Teammates is not running in NooblyJS, so there is no teammate to add.');
    const mine = new Set((await teams.list()).find((t) => t.id === team?.id)?.agents.map((x) => x.id) ?? []);
    const order = (t) => (mine.has(t.id) ? 0 : 1);
    const list = [...roster].sort((x, y) => order(x) - order(y)).map((t) => ({
      id: t.id, initials: initials(t.name), name: t.name, role: t.role ?? 'Teammate', status: t.statusText ?? 'Unknown', rate: t.rate != null ? `$${t.rate}/hr` : '',
      canWork: t.canWork, cannotWork: !t.canWork,
    }));
    const footnote = team
      ? `The teammate sees messages from the moment they join, not before. Time is billed to ${team.name}.`
      : 'The teammate sees messages from the moment they join, not before. You are on no NooblyJS team, so there is no team to bill: ask an Owner to add you to one first.';
    await send(a, botMessage({ attachment: cards.attachment('pick-teammate', { teammates: list, footnote }), noobly: { kind: 'pick-teammate' } }));
  }

  // ---------------------------------------------------------------------------- a teammate joins and leaves

  /** Refuses with a 403 the caller turns into a reply. Only a person with `draft` spends a team's money here. */
  async function mayDraft(person, doing) {
    if (await roles.can(person.accessRole, 'draft')) return;
    throw new HttpError(403, 'forbidden', `You can't ${doing}: it needs the "draft" permission (Contributor and up), and your access role is ${person.accessRole}.`, { permission: 'draft' });
  }

  async function add(a, person, teammateId) {
    await mayDraft(person, 'add a teammate to this chat');
    const teammate = await agents.get(teammateId ?? '');
    if (!teammate) throw new HttpError(404, 'not_found', 'There is no such teammate.');
    const can = await agents.availability(teammate.id);
    if (!can.ok) throw new HttpError(409, can.code, `${teammate.name} can't join: ${can.message}`);
    const team = await billedTeam(a, person);
    if (!team) throw new HttpError(422, 'no_team', "This chat isn't linked to an NooblyJS team and you are on none, so there is no team to bill. Ask an Owner to add you to a team first.");
    const current = await sessions.get(a.conversationKey);
    if (current?.teammate) await leave(a, person, { quiet: true });

    const { itemId = null } = await sessions.linkFor(a.conversationId);
    const session = await sessions.open(a.conversationKey, {
      conversationId: a.conversationId, conversationName: a.conversationName,
      teammate: { id: teammate.id, name: teammate.name }, addedBy: { id: person.id, name: person.name }, billedTeam: team, itemId,
    });
    await audit({ actor: person.id, action: 'teams.teammate_added', target: a.conversationId, conversation: a.conversationName, teammateId: teammate.id, billedTeam: team.id, itemId, joinedAt: session.joinedAt });
    await events.emit('teams.teammate_joined', {
      conversationId: a.conversationId, teammateId: teammate.id, itemId, system: 'teammates', team: team.name,
      summary: `added ${teammate.name} to the ${a.conversationName ?? 'Teams'} chat · billed to ${team.name}`,
    }, { actor: person.id });

    const who = { id: teammate.id, initials: initials(teammate.name), name: teammate.name };
    await send(a, botMessage({ text: `${teammate.name} joined the chat`, noobly: { kind: 'system-line' } }));
    await send(a, botMessage({ attachment: cards.attachment('teammate-joined', { name: teammate.name, first: first(teammate.name), addedBy: person.name, team: team.name }), noobly: { kind: 'teammate-joined' } }));
    // The introduction is a fixed line, not a task: nobody asked the teammate for work yet, so nothing is billed.
    const all = await scripts();
    const intro = fill(all.intros?.[teammate.id] ?? all.intros?.default ?? 'Hi, {first} here.', await varsFor(session));
    await speak(a, session, { text: intro, card: cards.attachment('teammate-says', { ...who, text: intro }), kind: 'intro' });
    return session;
  }

  async function leave(a, person, { quiet = false } = {}) {
    await mayDraft(person, 'change who is in this chat');
    const ended = await sessions.leave(a.conversationKey);
    if (!ended) return null;
    await audit({ actor: person.id, action: 'teams.teammate_left', target: a.conversationId, conversation: a.conversationName, teammateId: ended.teammate.id, joinedAt: ended.joinedAt, leftAt: ended.leftAt });
    await events.emit('teams.teammate_left', { conversationId: a.conversationId, teammateId: ended.teammate.id, itemId: ended.itemId, system: 'teammates', summary: `took ${ended.teammate.name} out of the ${a.conversationName ?? 'Teams'} chat` }, { actor: person.id });
    await send(a, botMessage({ text: `${ended.teammate.name} left the chat`, noobly: { kind: 'system-line' } }));
    if (!quiet) await offerTeammates(a, person);
    return ended;
  }

  // ---------------------------------------------------------------------------- what is said in a session

  /** The teammate says something: sent to the chat, kept in the session's context and in the item's thread. */
  async function speak(a, session, { text, card, kind, facts = null, costUsd = null, modelRoute = null }) {
    const as = session.teammate;
    await send(a, botMessage({ attachment: card, noobly: { kind, as } }), { as, costUsd });
    await sessions.record(a.conversationKey, { at: sessions.now(), from: { id: as.id, name: as.name, kind: 'agent' }, text, kind });
    if (session.itemId) {
      await chat.relay(session.itemId, {
        author: { id: as.id, name: as.name, kind: 'agent' }, text, costUsd, modelRoute, cards: facts ? [facts] : [],
        via: { channel: 'teams', where: `the ${a.conversationName ?? 'Teams'} meeting`, conversationId: a.conversationId },
      }).catch((err) => log?.warn?.(`teams: could not log to ${session.itemId}: ${err.message}`));
    }
  }

  /** A person's message after the join: kept for the teammate's context and in the item's thread. */
  async function heard(a, session, person) {
    await sessions.record(a.conversationKey, { at: a.at, from: { id: person.id, name: person.name, kind: 'person' }, text: a.said });
    await audit({ actor: person.id, action: 'teams.message_received', target: a.conversationId, conversation: a.conversationName, teammateId: session.teammate.id, itemId: session.itemId });
    if (session.itemId) {
      await chat.relay(session.itemId, {
        author: { id: person.id, name: person.name, kind: 'person' }, text: a.said,
        via: { channel: 'teams', where: `the ${a.conversationName ?? 'Teams'} meeting`, conversationId: a.conversationId },
      }).catch((err) => log?.warn?.(`teams: could not log to ${session.itemId}: ${err.message}`));
    }
  }

  async function answer(a, session, person) {
    await mayDraft(person, `ask ${session.teammate.name} a question`);
    const as = session.teammate;
    const who = { id: as.id, initials: initials(as.name), name: as.name };
    await connector.send(a, typing({ as }));
    const vars = await varsFor(session);
    const said = (await sessions.context(a.conversationKey, session.joinedAt)).slice(0, -1); // all but this question
    let result;
    try {
      result = await agents.runTask({
        slug: as.id, workType: 'meeting.answer', itemId: session.itemId, system: 'teammates',
        caller: { type: 'user', id: person.id, name: person.name },
        billTo: { teamId: session.billedTeam.id, teamName: session.billedTeam.name },
        input: {
          task: a.said,
          context: `${ANSWER_RULES}\n\nWhat NooblyJS has on record:\n- Meeting: ${a.conversationName ?? 'a Teams chat'}\n- Item: ${vars.item}${vars.itemTitle ? ` · ${vars.itemTitle}` : ''}\n- Stage: ${vars.stage}\n- Readiness: ${vars.readiness}\n- Waiting on: ${vars.waitingOn}`,
          history: said.map((line) => ({ author: line.from.kind === 'agent' ? `${line.from.name} (agent)` : line.from.name, text: line.text })),
        },
        scripted: async () => {
          const all = await scripts();
          const hit = (all.answers ?? []).find((r) => {
            if (r.teammate !== as.id) return false;
            try { return new RegExp(r.match, 'i').test(a.said); } catch { return false; }
          }) ?? all.fallback ?? { text: 'I have no answer for that yet.' };
          return { output: hit, costUsd: Number(hit.costUsd) || 0 };
        },
      });
    } catch (err) {
      log?.warn?.(`teams: ${as.id} did not answer: ${err.message}`);
      return say(a, `${as.name} couldn't answer. ${err.status ? err.message : 'The model provider returned an error.'} Nothing was billed.`);
    }

    // A script names its own card and links; a model gives text and, at most, one facts card.
    let reply;
    if (result.scripted) {
      const hit = fill(result.output, vars);
      reply = { text: hit.text, title: hit.card?.title, rows: hit.card?.rows ?? [], primary: hit.card?.primary, secondary: hit.card?.secondary, sources: hit.card?.sources ?? [] };
    } else {
      const read = readReply(result.output);
      const facts = read.cards.find((c) => c.type === 'facts');
      reply = { text: read.text, title: facts?.title, rows: facts?.rows ?? [], sources: [] };
    }
    if (reply.rows.length && !reply.primary) reply.primary = session.itemId ? { label: 'Open in NooblyJS', href: `/home/lifecycle/${encodeURIComponent(session.itemId)}` } : { label: 'Open NooblyJS', href: '/' };
    const action = (x) => (x ? { label: x.label, url: link(x.href) } : null);
    const footer = [reply.sources.length ? `Sources: ${reply.sources.join(', ')}` : null, `this answer cost ${money(result.costUsd)}`, `billed to ${session.billedTeam.name}`].filter(Boolean).join(' · ');
    const card = cards.attachment('answer', { ...who, text: reply.text, title: reply.title ?? '', rows: reply.rows, primary: action(reply.primary), secondary: action(reply.secondary), footer });
    await speak(a, session, {
      text: reply.text, card, kind: 'answer', costUsd: result.costUsd, modelRoute: result.modelRoute,
      facts: reply.rows.length ? { type: 'facts', title: reply.title ?? as.name, rows: reply.rows, ...(reply.primary ? { link: { label: reply.primary.label, href: reply.primary.href } } : {}) } : null,
    });
    // With no item to log to, the answer and its cost still reach Activity.
    if (!session.itemId) {
      await events.emit('teams.question_answered', { conversationId: a.conversationId, teammateId: as.id, system: 'teammates', costUsd: result.costUsd, modelRoute: result.modelRoute, actorKind: 'agent', actorName: as.name, summary: `answered ${person.name} in the ${a.conversationName ?? 'Teams'} chat` }, { actor: as.id });
    }
  }

  // ---------------------------------------------------------------------------- meeting notes, on request

  /**
   * "post meeting notes to <item>": the teammate writes notes from what was said since it joined (a teammate task,
   * billed to the session's team; with no model, the notes are what each person said), and they go to the item's
   * thread as meeting notes. The chat is told where they went.
   */
  async function postNotes(a, session, person, itemId) {
    await mayDraft(person, 'post meeting notes to an item');
    const facts = await chat.factsFor(itemId);
    if (!facts?.title) throw new HttpError(404, 'not_found', `There is no item ${itemId} in NooblyJS to post the notes to.`);
    const as = session.teammate;
    const lines = (await sessions.context(a.conversationKey, session.joinedAt))
      .filter((l) => !(l.from.kind === 'person' && NOTES.test(l.text ?? '')))
      .map((l) => ({ who: l.from.kind === 'agent' ? `${l.from.name} (NooblyJS teammate)` : l.from.name, text: String(l.text ?? '').replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text);
    if (!lines.length) throw new HttpError(409, 'nothing_said', `Nothing has been said since ${as.name} joined, so there are no notes to post.`);
    await connector.send(a, typing({ as }));
    const transcript = lines.map((l) => `${l.who}: ${l.text}`).join('\n');
    let result;
    try {
      result = await agents.runTask({
        slug: as.id, workType: 'meeting.notes', itemId, system: 'teammates',
        caller: { type: 'user', id: person.id, name: person.name },
        billTo: { teamId: session.billedTeam.id, teamName: session.billedTeam.name },
        input: { task: `Write the notes of this meeting for ${facts.item} · ${facts.title}.`, context: `${NOTES_RULES}\n\nWhat was said since ${as.name} joined:\n${transcript}`, history: [] },
        // With no model: the notes are what each person said, in order.
        scripted: async () => ({ output: { text: lines.map((l) => `- ${l.who}: ${l.text}`).join('\n') }, costUsd: 0 }),
      });
    } catch (err) {
      log?.warn?.(`teams: ${as.id} did not write the notes: ${err.message}`);
      return say(a, `${as.name} couldn't write the notes. ${err.status ? err.message : 'The model provider returned an error.'} Nothing was billed.`);
    }
    const body = result.scripted ? String(result.output.text ?? '') : readReply(result.output).text;
    const when = new Date(sessions.now()).toISOString().slice(0, 10);
    const text = `Meeting notes from ${a.conversationName ?? 'a Teams meeting'}, ${when}\n\n${body}`;
    await chat.relay(itemId, {
      author: { id: as.id, name: as.name, kind: 'agent' }, text, kind: 'meeting-notes', costUsd: result.costUsd, modelRoute: result.modelRoute,
      via: { channel: 'teams', where: `the ${a.conversationName ?? 'Teams'} meeting`, conversationId: a.conversationId },
    });
    await audit({ actor: as.id, action: 'teams.meeting_notes_posted', target: itemId, conversation: a.conversationName, requestedBy: person.id, costUsd: result.costUsd, modelRoute: result.modelRoute, lines: lines.length });
    await events.emit('teams.meeting_notes_posted', {
      itemId, conversationId: a.conversationId, teammateId: as.id, system: 'teammates', costUsd: result.costUsd, modelRoute: result.modelRoute, actorKind: 'agent', actorName: as.name,
      summary: `posted the notes of the ${a.conversationName ?? 'Teams'} meeting to ${facts.item}`,
    }, { actor: as.id });
    await say(a, `${as.name} posted the meeting notes to ${facts.item} · ${facts.title}: ${link(`/home/lifecycle/${encodeURIComponent(itemId)}`)}`);
  }

  // ---------------------------------------------------------------------------- one incoming activity

  /**
   * Handles one activity that the endpoint has already verified. Resolves with what it did, for the tests:
   * { did: 'offered' | 'added' | 'left' | 'answered' | 'noted' | 'heard' | 'ignored' | 'refused', reason? }.
   */
  async function handle(a) {
    if (a.from.isBot || !['message', 'conversationUpdate', 'invoke'].includes(a.type)) return { did: 'ignored', reason: 'not a person speaking' };
    const person = await personOf(a);
    if (!person) {
      // Only answer someone who is talking to the bot; other people's chat is none of its business.
      if (a.botMentioned || a.action) await say(a, "I don't know you in NooblyJS yet. Sign in to NooblyJS once, then ask again.");
      return { did: 'refused', reason: 'unknown person' };
    }
    // How to reach this person in Teams later (an approval waiting for them): kept from what they send the bot.
    await notify?.remember?.(person, a).catch((err) => log?.warn?.(`teams: could not keep where ${person.id} is: ${err.message}`));
    try {
      if (a.action?.name === 'add') return { did: 'added', session: await add(a, person, a.action.teammateId) };
      if (a.action?.name === 'choose-someone-else') return (await leave(a, person)) ? { did: 'left' } : (await offerTeammates(a, person), { did: 'offered' });
      if (a.action) return { did: 'ignored', reason: 'unknown card action' };
      if (a.type === 'conversationUpdate') {
        if (!a.botAdded) return { did: 'ignored', reason: 'not about the bot' };
        await offerTeammates(a, person);
        return { did: 'offered' };
      }
      if (a.type !== 'message') return { did: 'ignored', reason: 'nothing to do' };

      const session = await sessions.get(a.conversationKey);
      if (!session?.teammate) {
        // Nobody has joined: what is said now is never kept, so a teammate who joins later can't have seen it.
        if (!a.botMentioned) return { did: 'ignored', reason: 'no teammate in this chat' };
        await offerTeammates(a, person);
        return { did: 'offered' };
      }
      // Teams stamps every message. One from before the join (delivered late, or replayed) never reaches the teammate.
      if (!a.at || a.at < session.joinedAt) {
        await audit({ actor: person.id, action: 'teams.message_ignored', target: a.conversationId, reason: 'sent before the teammate joined', teammateId: session.teammate.id, sentAt: a.at, joinedAt: session.joinedAt });
        return { did: 'ignored', reason: 'before the teammate joined' };
      }
      await heard(a, session, person);
      const notesFor = NOTES.exec(a.said)?.[1];
      if (notesFor && (a.botMentioned || a.mentioned.length)) {
        await postNotes(a, session, person, notesFor.toUpperCase());
        return { did: 'noted', itemId: notesFor.toUpperCase() };
      }
      const name = first(session.teammate.name).toLowerCase();
      const asked = a.mentioned.includes(name) || a.mentioned.includes(session.teammate.name.toLowerCase()) || a.mentioned.includes(session.teammate.id) || a.botMentioned;
      if (!asked || !a.text) return { did: 'heard' };
      await answer(a, session, person);
      return { did: 'answered' };
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      if (err.status === 403) await audit({ actor: person.id, action: 'access.refused', target: a.conversationId, permission: err.details?.permission ?? null, reason: err.message });
      await say(a, err.message);
      return { did: 'refused', reason: err.code };
    }
  }

  return { handle };
}
