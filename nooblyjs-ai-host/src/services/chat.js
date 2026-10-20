// Team chat (product.md §5.9, tech.md §7.2): people and agent teammates talk in a thread next to the work.
// A thread belongs to an item, a repository or a channel. Messages are append-only daily YAML streams and are
// never edited; a card that can be acted on keeps its state in its own file.
//
// Governance (product.md §3): agents may draft and answer here, but a status change, an approval or a permission
// grant is always a person's action. An agent's reply can only append messages: nothing in this file lets a
// reply reach an item, an approval or a permission, and every decision refuses an agent before any other check.
//
// An agent's reply is a task run as that teammate by Digital Teammates (services/agents.js), so it is checked,
// billed and attributed like any other agent work. With a model configured the model answers; with none, the
// teammate plays the scripted reply from data/chat/scripts.yaml.
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { SEED_DIR } from '../seed/index.js';
import { HttpError } from '../util/errors.js';
import { daySegments } from '../util/dates.js';
import { newId } from '../util/ids.js';
import { REPLY_RULES, readReply } from './chat-reply.js';

const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const THREAD_ID = /^thr_[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const CARD_ID = /^card_[a-z0-9]{6,20}$/;
const ITEM_KINDS = new Set(['item', 'spec', 'architecture', 'ux', 'ui']);
const MAX_TEXT = 4000;
const MAX_MESSAGES = 100;
const MAX_DAYS_READ = 60;
const HISTORY_FOR_AGENT = 20; // the messages before a mention that the teammate is given
const SCRIPTS = ['chat', 'scripts.yaml'];
const CHIPS = {
  item: [{ action: 'summarise', label: 'Summarise thread' }, { action: 'related-adrs', label: 'Find related ADRs' }],
  repo: [{ action: 'summarise', label: 'Summarise thread' }, { action: 'gate-failed', label: 'Why did a gate fail?' }],
  channel: [{ action: 'summarise', label: 'Summarise thread' }],
};
const SYSTEM = { id: 'system', name: 'NooblyJS', kind: 'system' };
const STAGE_LABELS = { discover: 'Discover', specify: 'Specify', architect: 'Architect', ux: 'UX design', ui: 'UI design', build: 'Build', verify: 'Verify', release: 'Release', operate: 'Operate', ship: 'Ship' };

const forbidden = (code, message) => new HttpError(403, code, message);
const short = (text, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The thread for what is on screen, or null when that kind of page has none. */
export function threadFor(kind, id) {
  if (typeof id !== 'string' || !SCOPE_ID.test(id)) return null;
  if (ITEM_KINDS.has(kind)) return { id: `thr_${id}`, scope: { kind: 'item', id } };
  if (kind === 'repository' || kind === 'repo') return { id: `thr_repo-${id}`, scope: { kind: 'repo', id } };
  if (kind === 'channel') return { id: `thr_channel-${id}`, scope: { kind: 'channel', id } };
  return null;
}

export function createChat({ store, events, auditLog, people, agents, roles, services, clock = Date, replyDelayMs = 1500, log }) {
  const now = () => new Date(clock.now()).toISOString();
  const working = new Map(); // threadId → Map<agentId, name>
  const timers = new Set();
  const pending = new Set(); // replies in flight, so close() and tests can wait for them

  // ---------------------------------------------------------------------------- who is who

  /** People and agent teammates, with the handles they can be mentioned by. */
  async function directory() {
    const everyone = (await people.list()).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, kind: 'person' }));
    const teammates = (await agents.roster()).map((a) => ({ id: a.id, name: a.name, kind: 'agent' }));
    const all = [...everyone, ...teammates];
    const first = (name) => name.split(/\s+/)[0].toLowerCase();
    const counts = new Map();
    for (const p of all) counts.set(first(p.name), (counts.get(first(p.name)) ?? 0) + 1);
    // "@Ada" when the first name is unique, otherwise the id ("@thabo-n").
    return all.map((p) => ({ ...p, handle: counts.get(first(p.name)) === 1 ? p.name.split(/\s+/)[0] : p.id }));
  }

  function mentionsIn(text, dir) {
    const found = new Map();
    for (const [, token] of text.matchAll(/(?:^|[^\w@])@([A-Za-z][\w.-]{0,40})/g)) {
      const t = token.replace(/[.,-]+$/, '').toLowerCase();
      const who = dir.find((p) => p.id === t || p.handle.toLowerCase() === t);
      if (who) found.set(who.id, { id: who.id, name: who.name, kind: who.kind });
    }
    return [...found.values()];
  }

  // ---------------------------------------------------------------------------- threads and messages

  async function itemOf(scope) {
    if (scope.kind !== 'item') return null;
    return (await services.get('workflows')?.item?.({ itemId: scope.id })) ?? null;
  }

  async function describe(thread) {
    const saved = (await store.readDoc(['chat', 'threads', `${thread.id}.md`]))?.data;
    const item = await itemOf(thread.scope);
    const title = item ? `${item.ref ?? item.id} · ${item.title}` : thread.scope.kind === 'repo' ? thread.scope.id.replace('__', '/') : thread.scope.kind === 'channel' ? `#${thread.scope.id}` : thread.scope.id;
    return {
      id: thread.id, scope: thread.scope, title, exists: Boolean(saved), participants: saved?.participants ?? [],
      itemId: item?.id ?? (thread.scope.kind === 'item' ? thread.scope.id : null), system: item?.system ?? (thread.scope.kind === 'repo' ? 'platform' : 'product'),
      itemHref: thread.scope.kind === 'item' ? `/home/lifecycle/${encodeURIComponent(thread.scope.id)}` : null,
    };
  }

  /** The thread by id (thr_PRD-031, thr_repo-…, thr_channel-…), or a 404. */
  function parse(threadId) {
    if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) throw new HttpError(404, 'not_found', 'There is no such thread.');
    const rest = threadId.slice(4);
    if (rest.startsWith('repo-')) return { id: threadId, scope: { kind: 'repo', id: rest.slice(5) } };
    if (rest.startsWith('channel-')) return { id: threadId, scope: { kind: 'channel', id: rest.slice(8) } };
    return { id: threadId, scope: { kind: 'item', id: rest } };
  }

  async function cardState(id) {
    return CARD_ID.test(id ?? '') ? (await store.readDoc(['chat', 'cards', `${id}.md`]))?.data ?? null : null;
  }

  /** The last messages of a thread, oldest first, each card carrying its current state. */
  async function messages(threadId, { limit = MAX_MESSAGES } = {}) {
    const days = (await store.list(['chat', 'messages', threadId])).filter((n) => n.endsWith('.yaml')).sort().slice(-MAX_DAYS_READ);
    let out = [];
    for (let i = days.length - 1; i >= 0 && out.length < limit; i--) {
      out = [...(await store.readYamlStream(['chat', 'messages', threadId, days[i]])), ...out];
    }
    out = out.slice(-limit);
    for (const m of out) {
      for (const card of m.cards ?? []) {
        const state = card.id ? await cardState(card.id) : null;
        if (state) Object.assign(card, { status: state.status, decidedByName: state.decidedByName ?? null, decidedAt: state.decidedAt ?? null, appliedVersion: state.appliedVersion ?? null });
      }
    }
    return out;
  }

  async function touchThread(thread, participantId) {
    const info = await describe(thread);
    await store.updateDoc(['chat', 'threads', `${thread.id}.md`], (doc) => {
      const data = doc?.data ?? { id: thread.id, scope: thread.scope, title: info.title, participants: [], createdAt: now(), teamsChannel: '[PLACEHOLDER]' };
      if (data.participants.includes(participantId) && doc) return null;
      return { data: { ...data, title: info.title, participants: [...new Set([...data.participants, participantId])] }, body: doc?.body ?? '\nTeams-channel mirroring is not built yet (product.md §12 Q10).\n' };
    });
    return info;
  }

  /** Appends one message, emits it and returns it. The only way anything is written to a thread. */
  async function append(thread, { author, text, mentions = [], cards = [], citations = [], costUsd = null, modelRoute = null, replyTo = null, kind = null, via = null }) {
    const info = await touchThread(thread, author.id);
    const at = now();
    const message = {
      id: newId('msg'), threadId: thread.id, at, author, text,
      ...(mentions.length ? { mentions } : {}), ...(cards.length ? { cards } : {}), ...(citations.length ? { citations: citations.map((c, i) => ({ n: i + 1, ...c })) } : {}),
      ...(costUsd !== null ? { costUsd } : {}), ...(modelRoute ? { modelRoute } : {}), ...(replyTo ? { replyTo } : {}), ...(kind ? { kind } : {}), ...(via ? { via } : {}),
    };
    await store.appendYaml(['chat', 'messages', thread.id, daySegments(at)[2]], message);
    const where = info.itemId ? `the ${info.itemId} thread` : `the ${info.title} thread`;
    await events.emit('chat.message_posted', {
      threadId: thread.id, messageId: message.id, itemId: info.itemId, system: info.system, authorKind: author.kind,
      ...(author.kind !== 'person' ? { actorKind: author.kind, actorName: author.name } : {}),
      ...(costUsd ? { costUsd, modelRoute, teammateId: author.id } : {}),
      summary: author.kind === 'system' ? `noted in ${where}: ${short(text)}` : `said in ${via ? `${via.where ?? via.channel}, kept in ` : ''}${where}: ${short(text)}`,
    }, { actor: author.id });
    return message;
  }

  async function thread(kind, id, person) {
    const t = threadFor(kind, id);
    if (!t) throw new HttpError(404, 'no_thread', 'This page has no thread.');
    const [info, list, dir] = await Promise.all([describe(t), messages(t.id), directory()]);
    return {
      now: now(),
      thread: info,
      messages: list,
      chips: CHIPS[t.scope.kind] ?? [],
      mentionable: dir.filter((p) => p.id !== person.id).map(({ id: pid, name, kind: k, handle }) => ({ id: pid, name, kind: k, handle })),
      working: [...(working.get(t.id) ?? new Map())].map(([agentId, name]) => ({ id: agentId, name })),
      canPost: await roles.can(person.accessRole, 'draft'),
    };
  }

  /** A person posts. Mentions are resolved, and each agent mentioned (two at most) is asked to reply. */
  async function post(threadId, body, person) {
    const t = parse(threadId);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, 'bad_request', 'Write a message first.');
    if (text.length > MAX_TEXT) throw new HttpError(400, 'bad_request', `Keep a message under ${MAX_TEXT} characters.`);
    const dir = await directory();
    const mentions = mentionsIn(text, dir);
    const message = await append(t, { author: { id: person.id, name: person.name, kind: 'person' }, text, mentions });
    for (const agent of mentions.filter((m) => m.kind === 'agent').slice(0, 2)) queueReply(t, agent, message);
    return message;
  }

  // ---------------------------------------------------------------------------- scripted agent replies

  async function scripts() {
    const own = await store.readYaml(SCRIPTS);
    if (own?.replies) return own;
    return yaml.load(await fs.readFile(path.join(SEED_DIR, ...SCRIPTS), 'utf8'), { schema: yaml.CORE_SCHEMA });
  }

  /** What NooblyJS knows about the thread's item: where it is and who it is waiting on. */
  async function factsOf(t) {
    const item = await itemOf(t.scope);
    let waitingOn = 'no one';
    if (item) {
      const snap = await services.get('workflows')?.snapshot?.({ id: SYSTEM.id, accessRole: 'Viewer' });
      const names = [...new Set((snap?.approvals ?? []).filter((a) => a.itemId === item.id).flatMap((a) => a.waitingOnNames))];
      if (names.length) waitingOn = names.join(', ');
    }
    // Readiness is the Product Factory's to say: how many of the spec's checks pass.
    let readiness = 'see the spec';
    try {
      const checks = Object.values((await services.get('product')?.readinessFacts?.(t.scope.id))?.facts ?? {});
      if (checks.length) readiness = `${checks.filter((c) => c.value === true).length} of ${checks.length} checks`;
    } catch { /* the Product Factory isn't running here */ }
    return {
      item: item ? `${item.ref ?? item.id}` : t.scope.id, itemId: t.scope.id, title: item?.title ?? null, team: item?.team ?? null,
      stage: STAGE_LABELS[item?.stage] ?? 'Not in the lifecycle', waitingOn, readiness,
    };
  }

  /** {item}, {stage}… in a script, filled from the thread's item. */
  async function fill(value, t) {
    const vars = await factsOf(t);
    const walk = (v) => (typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, key) => vars[key] ?? m)
      : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
    return walk(value);
  }

  /** Saves the state file of a card that can be acted on, and returns the card as it goes into the message. */
  async function makeCard(card, t, agent, info) {
    const id = newId('card', 10);
    const actionable = card.type === 'approval' || (card.type === 'plan' && card.apply);
    if (actionable) {
      await store.writeDoc(['chat', 'cards', `${id}.md`], {
        id, type: card.type, threadId: t.id, itemId: info.itemId, title: card.title, status: 'open',
        requestedBy: { id: agent.id, name: agent.name, kind: 'agent' }, createdAt: now(),
        ...(card.type === 'approval' ? { requires: card.requires, resource: card.resource ?? null } : { apply: { ...card.apply, text: (card.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n') } }),
      }, `\n${card.text ?? card.title}\n`);
    }
    return { ...card, id, ...(actionable ? { status: 'open' } : {}) };
  }

  /** The scripted reply to a message: the first whose agent, scope and pattern fit, else the fallback. */
  async function scriptFor(t, agent, to) {
    const all = await scripts();
    return (all.replies ?? []).find((r) => {
      if (r.agent !== agent.id || (r.scope && r.scope !== t.scope.kind)) return false;
      try { return new RegExp(r.match, 'i').test(to.text); } catch { return false; }
    }) ?? all.fallback ?? { text: 'I have no answer for that yet.' };
  }

  /**
   * What the teammate reads from Jira and Bitbucket for this question (Phase 11), through the devtools service, which
   * checks Platform and audits each read. Null when the question is about neither, or the tools are not here.
   */
  async function readsFor(t, agent, to) {
    const devtools = services.get('devtools');
    if (typeof devtools?.agentReads !== 'function') return null;
    try {
      return await devtools.agentReads({
        agentId: agent.id, question: to.text, system: 'lifecycle',
        itemId: t.scope.kind === 'item' ? t.scope.id : null,
        repo: t.scope.kind === 'repo' ? t.scope.id.replace('__', '/') : null,
      });
    } catch (err) {
      log?.warn?.(`chat: Jira and Bitbucket were not read for ${agent.id}: ${err.message}`);
      return null;
    }
  }

  /** The answer from what was read, when no script fits the question and no model is configured. */
  function answerFromReads(reads, t) {
    const where = t.scope.kind === 'item' ? t.scope.id : 'this repository';
    const open = reads.jira.filter((i) => i.statusCategory !== 'done');
    const text = reads.jira.length
      ? `${open.length ? `${open.length} of the ${reads.jira.length} Jira issue${reads.jira.length === 1 ? '' : 's'} linked to ${where} ${open.length === 1 ? 'is' : 'are'} open` : `None of the Jira issues linked to ${where} is open`}. I read them from Jira just now; NooblyJS only reads Jira.`
      : reads.lines.join(' ');
    const rows = reads.jira.map((i) => ({ label: i.key, value: `${i.status} · ${i.assignee ?? 'unassigned'} · ${i.summary}` }));
    return { text, cards: rows.length ? [{ type: 'facts', title: `Jira · ${where}`, rows }] : [], citations: reads.citations, costUsd: 0 };
  }

  /** What the teammate is given with the mention: the rules for answering here, the item's facts, the thread so far. */
  async function briefFor(t, to, reads = null) {
    const facts = await factsOf(t);
    const known = t.scope.kind === 'item'
      ? [`Item: ${facts.item}${facts.title ? ` · ${facts.title}` : ''}`, `Stage: ${facts.stage}`, `Readiness: ${facts.readiness}`, `Waiting on: ${facts.waitingOn}`]
      : [`Thread: ${(await describe(t)).title}`];
    // Read from Jira and Bitbucket just now (never written to).
    if (reads) known.push(...reads.lines);
    const earlier = (await messages(t.id, { limit: HISTORY_FOR_AGENT + 1 })).filter((m) => m.id !== to.id).slice(-HISTORY_FOR_AGENT);
    return {
      task: to.text,
      context: `${REPLY_RULES}\n\nWhat NooblyJS has on record:\n${known.map((line) => `- ${line}`).join('\n')}`,
      history: earlier.map((m) => ({ author: m.author.kind === 'agent' ? `${m.author.name} (agent)` : m.author.name, text: m.text })),
      team: facts.team,
    };
  }

  /** A line from NooblyJS in place of an agent's reply: the agent did no work, so nothing is billed. */
  async function noReply(t, agent, to, info, text, reason) {
    const message = await append(t, { author: SYSTEM, kind: 'no-reply', text, replyTo: to.id });
    await auditLog.record({ actor: agent.id, action: 'agent.chat_reply_refused', target: t.id, itemId: info.itemId, system: info.system, teammateId: agent.id, modelRoute: null, costUsd: 0, reason, messageId: message.id });
  }

  /**
   * An agent's reply to a mention. A teammate who can't take work gets a line saying why, and nothing is billed.
   * Otherwise: "working…" for everyone on the thread, the task run as that teammate, then the message(s). This
   * only ever appends messages. Each carries actor, item, system, model route and cost (tech.md §2.1).
   */
  function queueReply(t, agent, to) {
    const run = (async () => {
      const info = await describe(t);
      const can = await agents.availability(agent.id);
      if (!can.ok) {
        const why = can.code === 'teammates_unavailable' ? can.message : `${can.message} Nothing was billed.`;
        return noReply(t, agent, to, info, `${agent.name} didn't pick this up. ${why}`, can.code);
      }
      if (!working.has(t.id)) working.set(t.id, new Map());
      working.get(t.id).set(agent.id, agent.name);
      await events.emit('chat.agent_working', { threadId: t.id, agentId: agent.id, agentName: agent.name, actorKind: 'agent' }, { actor: agent.id });
      try {
        // The pause is the script's "working" time; a model takes its own.
        if (agents.provider() === 'mock') {
          await new Promise((resolve) => {
            const timer = setTimeout(() => { timers.delete(timer); resolve(); }, replyDelayMs);
            timers.add(timer);
          });
        }
        const reads = await readsFor(t, agent, to);
        const { team, ...input } = await briefFor(t, to, reads);
        let result;
        try {
          result = await agents.runTask({
            slug: agent.id, workType: 'chat.reply', itemId: info.itemId, system: info.system, input,
            // On a repository's page the thread is the repository's: Platform checks the agent may read it.
            repo: t.scope.kind === 'repo' ? t.scope.id.replace('__', '/') : null,
            caller: { type: 'user', id: to.author.id, name: to.author.name },
            billTo: await agents.teamFor(agent.id, team),
            scripted: async () => {
              let script = await scriptFor(t, agent, to);
              // Only the fallback fits (it names no agent), but the question was about Jira or the code: answer
              // from what was read.
              if (reads && !script.agent) script = answerFromReads(reads, t);
              return { output: script, costUsd: [script, ...(script.then ?? [])].reduce((sum, part) => sum + (Number(part.costUsd) || 0), 0) };
            },
          });
        } catch (err) {
          // The teammate's own refusal (paused a moment ago, at the monthly cap) or a provider that failed.
          log?.warn?.(`chat reply by ${agent.id} did not run: ${err.message}`);
          return noReply(t, agent, to, info, `${agent.name} couldn't answer. ${err.status ? err.message : 'The model provider returned an error.'} Nothing was posted on their behalf.`, err.code ?? 'failed');
        }
        // A script is its parts, each with the cost it names; a model's answer is one message with what it used.
        const parts = result.scripted
          ? await Promise.all([result.output, ...(result.output.then ?? [])].map(async (part) => ({ ...(await fill({ text: part.text, cards: part.cards ?? [], citations: part.citations ?? [] }, t)), costUsd: Number(part.costUsd) || 0 })))
          : [{ ...readReply(result.output, { maxText: MAX_TEXT }), citations: reads?.citations ?? [], costUsd: result.costUsd }];
        for (const part of parts) {
          const cards = [];
          for (const card of part.cards) cards.push(await makeCard(card, t, agent, info));
          const message = await append(t, { author: { id: agent.id, name: agent.name, kind: 'agent' }, text: part.text, mentions: [{ id: to.author.id, name: to.author.name, kind: 'person' }], cards, citations: part.citations, costUsd: part.costUsd, modelRoute: result.modelRoute, replyTo: to.id });
          await auditLog.record({ actor: agent.id, action: 'agent.chat_reply', target: t.id, itemId: info.itemId, system: info.system, teammateId: agent.id, modelRoute: result.modelRoute, costUsd: part.costUsd, messageId: message.id, workId: result.workId });
        }
      } finally {
        working.get(t.id)?.delete(agent.id);
      }
    })().catch((err) => log?.error?.(`chat reply by ${agent.id} failed: ${err.message}`));
    pending.add(run);
    run.finally(() => pending.delete(run));
  }

  // ---------------------------------------------------------------------------- cards: a person's decisions

  /** Refuses an agent before anything else, and audits the refusal: agents propose, people decide. */
  async function personOnly(actor, doing, target) {
    if (actor?.kind === 'agent') {
      await auditLog.record({ actor: actor.id, action: 'access.refused', target, reason: `agents propose, people decide: an agent can't ${doing}` });
      throw forbidden('people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${doing}.`);
    }
    const person = actor?.id ? await people.get(actor.id) : null;
    if (!person?.active) throw forbidden('unknown_person', 'Only people with a NooblyJS record can take decisions.');
    return person;
  }

  async function openCard(cardId, type) {
    const card = await cardState(cardId);
    if (!card || card.type !== type) throw new HttpError(404, 'not_found', 'There is no such card.');
    if (card.status !== 'open') throw new HttpError(409, 'already_decided', 'This card was already answered.');
    return card;
  }

  async function closeCard(cardId, fn) {
    let result;
    await store.updateDoc(['chat', 'cards', `${cardId}.md`], (doc) => {
      if (doc.data.status !== 'open') throw new HttpError(409, 'already_decided', 'This card was already answered.');
      result = fn(doc.data);
      return { ...doc, data: result };
    });
    return result;
  }

  /**
   * An approved request to read a repository, applied in Platform · Repositories: read access where agents had
   * none. Returns the words that say what happened.
   */
  async function grantRead(resource, person) {
    const platform = services.get('platform');
    const repo = await platform?.repository(resource);
    if (!repo) return ` ${resource} is not connected in Platform · Repositories, so nothing changed there.`;
    if (repo.access !== 'none') return ` Agents could already read ${repo.name}.`;
    const { before, after } = await platform.repositories.update(repo.id, { access: 'read' });
    await auditLog.record({ actor: person.id, action: 'repo.access_changed', target: after.name, from: { access: before.access }, to: { access: after.access }, reason: 'approved in chat' });
    await events.emit('repo.access_changed', { system: 'platform', repo: after.name, from: { access: before.access }, to: { access: after.access }, summary: `gave agents read access to ${after.name} (approved in chat)` }, { actor: person.id });
    return ` Agents may now read ${after.name} (Platform · Repositories).`;
  }

  /** Approve or decline an approval card. Only a person whose access role has the card's permission. */
  async function decideCard(cardId, body, actor) {
    const person = await personOnly(actor, 'answer an approval card', cardId);
    const decision = body?.decision;
    if (!['approve', 'decline'].includes(decision)) throw new HttpError(400, 'bad_request', 'decision must be "approve" or "decline".');
    const card = await openCard(cardId, 'approval');
    if (!(await roles.can(person.accessRole, card.requires))) {
      throw new HttpError(403, 'forbidden', `You can't answer this: it needs the "${card.requires}" permission, and your access role is ${person.accessRole}.`, { permission: card.requires });
    }
    const at = now();
    const saved = await closeCard(cardId, (data) => ({ ...data, status: decision === 'approve' ? 'approved' : 'declined', decidedBy: person.id, decidedByName: person.name, decidedAt: at }));
    const t = parse(saved.threadId);
    const words = decision === 'approve' ? 'approved' : 'declined';
    const granted = decision === 'approve' && saved.resource && saved.requires === 'change-repo-access' ? await grantRead(saved.resource, person) : '';
    await append(t, { author: SYSTEM, kind: 'decision', text: `${person.name} ${words} ${saved.requestedBy.name}'s request: ${saved.title.toLowerCase()}.${granted}` });
    await events.emit('chat.card_decided', {
      cardId, threadId: saved.threadId, itemId: saved.itemId, system: 'platform', decision, requires: saved.requires, resource: saved.resource, requestedBy: saved.requestedBy.id,
      summary: `${words} ${saved.requestedBy.name}'s request for ${saved.title.toLowerCase()}`,
    }, { actor: person.id });
    return { card: saved, text: `${decision === 'approve' ? 'Approved' : 'Declined'}.` };
  }

  /** Apply to spec: a person with `draft` puts a plan card's text into the spec, through the Product Factory. */
  async function applyCard(cardId, actor) {
    const person = await personOnly(actor, 'apply a draft to the spec', cardId);
    const card = await openCard(cardId, 'plan');
    if (!(await roles.can(person.accessRole, 'draft'))) throw new HttpError(403, 'forbidden', `You can't apply this: it needs the "draft" permission, and your access role is ${person.accessRole}.`, { permission: 'draft' });
    const product = services.get('product');
    if (typeof product?.updateSpec !== 'function') throw new HttpError(503, 'product_unavailable', 'The Product Factory is not running here, so the spec can\'t be changed. Nothing was applied.');
    const section = card.apply?.section ?? 'rolloutPlan';
    const spec = await product.updateSpec({
      itemId: card.itemId, fields: { [section]: card.apply.text },
      changeNote: `${card.title} drafted by ${card.requestedBy.name} in the thread, applied by ${person.name}`,
      actor: { id: person.id, name: person.name, kind: 'person' },
    });
    const at = now();
    const saved = await closeCard(cardId, (data) => ({ ...data, status: 'applied', decidedBy: person.id, decidedByName: person.name, decidedAt: at, appliedVersion: spec.version }));
    await append(parse(saved.threadId), { author: SYSTEM, kind: 'change', text: `${person.name} applied the ${saved.title.toLowerCase()} to the spec · spec v${spec.version}` });
    await events.emit('chat.card_applied', {
      cardId, threadId: saved.threadId, itemId: saved.itemId, system: 'product', version: spec.version,
      summary: `applied ${saved.requestedBy.name}'s ${saved.title.toLowerCase()} to ${saved.itemId} · spec v${spec.version}`,
    }, { actor: person.id });
    return { card: saved, version: spec.version, text: `Applied. The spec is now v${spec.version}.` };
  }

  // ---------------------------------------------------------------------------- quick actions

  async function action(threadId, body, person) {
    const t = parse(threadId);
    const which = body?.action;
    if (!(CHIPS[t.scope.kind] ?? []).some((c) => c.action === which)) throw new HttpError(400, 'bad_request', 'That action is not available on this thread.');
    if (which === 'summarise') {
      const list = (await messages(t.id)).filter((m) => m.kind !== 'summary');
      if (!list.length) return append(t, { author: SYSTEM, kind: 'summary', text: 'Nothing has been said in this thread yet.' });
      const said = list.filter((m) => m.author.kind !== 'system');
      const who = [...new Set(said.map((m) => m.author.name))];
      const changes = list.filter((m) => m.author.kind === 'system').map((m) => m.text);
      const cards = said.flatMap((m) => (m.cards ?? []).map((c) => `${m.author.name}'s ${c.type === 'pr-link' ? 'pull request link' : c.type} card "${c.title}"${c.status && c.status !== 'open' ? ` (${c.status})` : c.status === 'open' ? ' (still open)' : ''}`));
      const cost = said.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
      const lines = [
        `Summary, asked for by ${person.name}: ${said.length} message${said.length === 1 ? '' : 's'} from ${who.join(', ') || 'no one'}.`,
        cards.length ? `Drafted here: ${cards.join('; ')}.` : null,
        changes.length ? `What changed: ${changes.map((c) => (/[.!?]$/.test(c) ? c : `${c}.`)).join(' ')}` : 'Nothing has changed because of this thread yet.',
        cost ? `Agent cost in this thread: $${cost.toFixed(2)}.` : null,
      ].filter(Boolean);
      return append(t, { author: SYSTEM, kind: 'summary', text: lines.join('\n') });
    }
    if (which === 'related-adrs') {
      const snap = await services.get('workflows')?.snapshot?.(person);
      const adrs = (snap?.approvals ?? []).filter((a) => a.type === 'adr' && a.itemId === t.scope.id);
      return append(t, {
        author: SYSTEM, kind: 'facts',
        text: adrs.length ? `${adrs.length} decision${adrs.length === 1 ? ' is' : 's are'} waiting for sign-off on ${t.scope.id}.` : `No decisions are waiting for sign-off on ${t.scope.id}. Accepted ones are on its Architecture page.`,
        cards: adrs.length ? [{ id: newId('card', 10), type: 'facts', title: 'Decisions awaiting sign-off', rows: adrs.map((a) => ({ label: a.subject ?? 'ADR', value: `${a.shortTitle} · waiting on ${a.waitingOnNames.join(', ')}` })), link: { label: 'Open Architecture', href: `/factory/design/architecture/${encodeURIComponent(t.scope.id)}` } }] : [],
      });
    }
    return append(t, { author: SYSTEM, kind: 'facts', text: 'Gate results come from the Software Factory, which joins NooblyJS in Phase 7. Until then there are no gates to explain.' });
  }

  /**
   * A message that was said somewhere else about an item (a Teams meeting with a teammate in it), kept in the
   * item's thread. It only appends: no mention in it asks an agent to reply.
   */
  async function relay(itemId, { author, text, cards = [], costUsd = null, modelRoute = null, via, kind = null }) {
    const t = threadFor('item', itemId);
    if (!t) return null;
    const info = await describe(t);
    const made = [];
    for (const card of cards) made.push(await makeCard(card, t, author, info));
    return append(t, { author, text: String(text ?? '').slice(0, MAX_TEXT), cards: made, costUsd, modelRoute, via, ...(kind ? { kind } : {}) });
  }

  /** A line from NooblyJS in an item's thread about something that happened elsewhere (a Factory run asking a person). */
  async function note(itemId, text) {
    const t = threadFor('item', itemId);
    return t ? append(t, { author: SYSTEM, kind: 'note', text: String(text).slice(0, MAX_TEXT) }) : null;
  }

  return {
    thread, post, action, decideCard, applyCard, messages, relay, note,
    /** What NooblyJS has on record about an item: where it is, its readiness and who it is waiting on. */
    factsFor: (itemId) => factsOf({ id: `thr_${itemId}`, scope: { kind: 'item', id: itemId } }),
    /** Resolves when every reply in flight has been posted (tests, and a clean shutdown). */
    settled: () => Promise.all([...pending]),
    close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
