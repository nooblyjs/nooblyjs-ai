// Phase 6 in the real app: the NooblyJS Teams bot, tested through its messaging endpoint and the simulator's API
// (roadmap Phase 6 test script, steps 4 to 8), with Digital Teammates, the Product Factory and the lifecycle engine
// hosted. No model is configured, so teammates answer from data/teams/scripts.yaml. The steps run in order on one
// data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { startApp, today, eventually } from './helpers.js';
import { loadCards, actionsIn, CARD_NAMES, SUBMIT_ACTIONS } from '../src/teams/cards.js';
import { readActivity, conversationKey } from '../src/teams/activities.js';

const MEETING = 'sim-slot-rollout-sync';
let env;
let stevie;
let lerato;
let viewer;
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const say = (c, text, meeting = MEETING) => post(c, `/api/v1/dev/teams/${meeting}/messages`, { text });
const press = (c, data, meeting = MEETING) => post(c, `/api/v1/dev/teams/${meeting}/actions`, { data });
const view = async (c, meeting = MEETING) => (await c.json(`/api/v1/dev/teams/${meeting}`)).body;
const teammates = () => env.noobly.hosted.apps.find((a) => a.name === 'teammates').internals;
const billedTo = async (id) => (await teammates().repos.timesheets.listRange(id, '2000-01-01', '2999-12-31')).filter((e) => e.workId && e.callerType === 'user');
/** The text a card shows, in reading order. */
const textOf = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => textOf(n, out));
  else if (node && typeof node === 'object') {
    for (const key of ['text', 'title', 'value']) if (typeof node[key] === 'string') out.push(node[key]);
    for (const value of Object.values(node)) if (value && typeof value === 'object') textOf(value, out);
  }
  return out;
};
/** A Bot Framework activity as Teams would post it, straight at the endpoint. */
const activity = (from, extra = {}) => ({
  type: 'message', id: `act-${Math.random()}`, timestamp: new Date().toISOString(), channelId: 'msteams', serviceUrl: 'urn:test',
  conversation: { id: MEETING, name: 'Slot rollout sync' }, from: { id: `29:${from}`, name: from, aadObjectId: from }, recipient: { id: 'noobly-bot', name: 'NooblyJS' }, ...extra,
});
const deliver = (body, authorization = `Bearer dev:${env.noobly.devKey}`) => fetch(`${env.base}/api/teams/messages`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
});

before(async () => {
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0', PUBLIC_BASE_URL: 'https://noobly.example' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    ],
  });
  [stevie, lerato, viewer] = [env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await viewer.signIn('naledi-k');
});
after(async () => { await env?.stop(); });

test('the endpoint is closed to everyone but the bot: no token, a wrong token and a browser session all get 401', async () => {
  const body = activity('stevie', { text: '<at>NooblyJS</at>', entities: [{ type: 'mention', mentioned: { id: 'noobly-bot', name: 'NooblyJS' } }] });
  assert.equal((await deliver(body, null)).status, 401);
  assert.equal((await deliver(body, 'Bearer dev:not-the-key')).status, 401);
  assert.equal((await deliver(body, 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.x')).status, 401);
  // A signed-in person's cookie is not the bot's proof either.
  assert.equal((await post(stevie, '/api/teams/messages', body)).status, 401);
  assert.deepEqual((await view(stevie)).transcript, []);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'teams.activity_refused' && r.status === 401)));
  // Something that isn't an activity is a 400, with the bot's key.
  assert.equal((await deliver({ hello: 'world' })).status, 400);
});

test('the simulator shows the meeting: who is in it, what was said before anyone joined, and nothing from the bot yet', async () => {
  const list = (await stevie.json('/api/v1/dev/teams')).body.meetings;
  assert.deepEqual(list.map((m) => m.title), ['Slot rollout sync', 'Checkout stand-up']);
  const v = await view(stevie);
  assert.deepEqual([v.meeting.title, v.meeting.people.length, v.meeting.teamId, v.meeting.itemId], ['Slot rollout sync', 5, 'delivery-squad', 'PRD-031']);
  assert.deepEqual(v.earlier.map((m) => m.from.name), ['Lerato M.', 'Stevie']);
  assert.deepEqual([v.transcript, v.session, v.working], [[], null, null]);
});

test('what is said before a teammate joins is never kept for one: there is no session, and no session file', async () => {
  const res = await say(lerato, 'The pilot date is a secret until Friday.');
  assert.deepEqual((await res.json()), { did: 'ignored', reason: 'no teammate in this chat' });
  assert.equal(await fs.stat(path.join(env.dataDir, 'teams', 'sessions')).catch(() => null), null);
});

test('step 4: @NooblyJS gets the pick-a-teammate card: each teammate with role, status and rate, Add on those who can work', async () => {
  assert.deepEqual(await (await say(stevie, '@NooblyJS')).json(), { did: 'offered', reason: null });
  const v = await view(stevie);
  const out = v.transcript.at(-1);
  assert.deepEqual([out.dir, out.kind, out.card.type, out.card.version], ['out', 'pick-teammate', 'AdaptiveCard', '1.5']);
  const lines = textOf(out.card.body);
  assert.ok(lines.includes("Hi, I'm NooblyJS."));
  assert.ok(lines.includes('Which teammate would you like to add to this meeting?'));
  // The meeting's own team first, then everyone else.
  const names = lines.filter((l) => /^(Ada|Rhea|Juno|Otis|Milo|Sable|Pip|Rook|Wren) /.test(l));
  assert.deepEqual(names.slice(0, 2), ['Ada Quill', 'Rhea Voss']);
  assert.equal(names.length, 9);
  assert.ok(lines.includes('Research Analyst · On a task · $48/hr'));
  assert.ok(lines.includes('Architect · On a task · $52/hr'));
  assert.ok(lines.includes('Copywriter · Paused · $16/hr'));
  assert.ok(lines.includes('The teammate sees messages from the moment they join, not before. Time is billed to Delivery squad.'));
  // Add only where the teammate can take work: not Sable (paused) or Rook (off shift).
  const adds = actionsIn(out.card).filter((a) => a.type === 'Action.Submit').map((a) => a.data);
  assert.equal(adds.length, 7);
  assert.ok(adds.every((d) => d.noobly === 'add'));
  assert.ok(!adds.some((d) => ['sable-reyes', 'rook-vale'].includes(d.teammateId)));
});

test('a Viewer can\'t add a teammate, and a paused teammate can\'t be added: the bot says why, and nothing is billed', async () => {
  assert.deepEqual(await (await press(viewer, { noobly: 'add', teammateId: 'ada-quill' })).json(), { did: 'refused', reason: 'forbidden' });
  assert.match((await view(stevie)).transcript.at(-1).text, /^You can't add a teammate to this chat: it needs the "draft" permission \(Contributor and up\), and your access role is Viewer\./);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'naledi-k' && r.permission === 'draft')));

  assert.deepEqual(await (await press(stevie, { noobly: 'add', teammateId: 'sable-reyes' })).json(), { did: 'refused', reason: 'teammate_paused' });
  assert.equal((await view(stevie)).transcript.at(-1).text, "Sable Reyes can't join: Sable Reyes is paused. Resume them to assign work.");
  assert.equal((await view(stevie)).session, null);
});

test('step 5: Add on Ada: the "joined" line, who added her and how to ask, her introduction, and a session billed to Delivery squad', async () => {
  const before = (await billedTo('ada-quill')).length;
  assert.equal((await (await press(stevie, { noobly: 'add', teammateId: 'ada-quill' })).json()).did, 'added');
  const v = await view(stevie);
  const [line, joined, intro] = v.transcript.slice(-3);
  assert.deepEqual([line.kind, line.text], ['system-line', 'Ada Quill joined the chat']);
  assert.equal(joined.kind, 'teammate-joined');
  assert.deepEqual(textOf(joined.card.body), ['**Ada Quill** was added by Stevie. Mention **@Ada** to ask a question.', 'Ada sees messages from now on, not earlier ones. Time is billed to Delivery squad.']);
  assert.deepEqual(joined.card.actions, [{ type: 'Action.Submit', title: 'Choose someone else', data: { noobly: 'choose-someone-else' } }]);
  // One bot: the teammate speaks through a card that carries its name and the "NooblyJS teammate" label.
  assert.deepEqual([intro.kind, intro.as], ['intro', { id: 'ada-quill', name: 'Ada Quill' }]);
  assert.deepEqual(textOf(intro.card.body), ['AQ', 'Ada Quill', 'NooblyJS teammate', "Hi all, I'm Ada. I've loaded PRD-031 and the Delivery squad's latest activity from NooblyJS. Mention @Ada to ask me where things stand."]);

  // The MeetingSession file.
  const file = await fs.readFile(path.join(env.dataDir, 'teams', 'sessions', `${MEETING}.md`), 'utf8');
  const session = yaml.load(file.split('---')[1], { schema: yaml.CORE_SCHEMA });
  assert.deepEqual(
    [session.conversationId, session.teammate, session.addedBy, session.billedTeam, session.itemId, session.leftAt],
    [MEETING, { id: 'ada-quill', name: 'Ada Quill' }, { id: 'stevie', name: 'Stevie' }, { id: 'delivery-squad', name: 'Delivery squad' }, 'PRD-031', null],
  );
  assert.ok(!Number.isNaN(Date.parse(session.joinedAt)));
  assert.equal(v.session.joinedAt, session.joinedAt);
  // Joining and introducing herself is not work: nothing went on her timesheet.
  assert.equal((await billedTo('ada-quill')).length, before);
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'teams.teammate_joined' && e.actor === 'stevie' && /added Ada Quill to the Slot rollout sync chat · billed to Delivery squad/.test(e.payload.summary)));
});

test('step 6: Lerato asks @Ada what is blocking: an answer card with the facts, Open in NooblyJS, sources and the cost; nothing decides in Teams', async () => {
  const before = (await billedTo('ada-quill')).length;
  assert.equal((await (await say(lerato, "@Ada what's still blocking the slot pilot?")).json()).did, 'answered');
  const v = await view(lerato);
  const [question, answer] = v.transcript.slice(-2);
  assert.deepEqual([question.dir, question.from.name, question.text], ['in', 'Lerato M.', "@Ada what's still blocking the slot pilot?"]);
  assert.deepEqual([answer.kind, answer.as.name, v.working], ['answer', 'Ada Quill', null]);
  const lines = textOf(answer.card.body);
  assert.deepEqual(lines.slice(0, 3), ['AQ', 'Ada Quill', 'NooblyJS teammate']);
  assert.match(lines[3], /^Here is where PRD-031 stands\. It is in Specify\. Waiting on: /);
  assert.ok(lines.includes('PRD-031 · Same-day delivery slots'));
  // The facts are NooblyJS as it is now, not a second seeded state.
  const facts = answer.card.body.find((b) => b.type === 'Container').items.find((i) => i.type === 'FactSet').facts;
  assert.deepEqual(facts.map((f) => f.title), ['Stage', 'Readiness', 'Waiting on', 'Pilot stores']);
  assert.deepEqual([facts[0].value, facts[1].value], ['Specify', '6 of 7 checks']);
  assert.match(facts[3].value, /^\[PLACEHOLDER/);
  assert.equal(lines.at(-1), 'Sources: PRD-031, ADR-014 · this answer cost $0.06 · billed to Delivery squad');
  // Both actions open NooblyJS. "Ask Thabo to decide" goes to Approvals: the decision is taken there, by a person.
  const actions = actionsIn(answer.card);
  assert.deepEqual(actions.map((a) => [a.type, a.title, a.url]), [
    ['Action.OpenUrl', 'Open in NooblyJS', 'https://noobly.example/home/lifecycle/PRD-031'],
    ['Action.OpenUrl', 'Ask Thabo to decide', 'https://noobly.example/home/approvals'],
  ]);

  // Billed to the session's team, for the person who asked.
  const entries = await billedTo('ada-quill');
  assert.equal(entries.length, before + 1);
  assert.deepEqual([entries.at(-1).costCentre, entries.at(-1).caller, entries.at(-1).apiCost], ['Delivery squad', 'Lerato M.', 0.06]);
  const work = await teammates().repos.work.get('ada-quill', entries.at(-1).workId);
  assert.deepEqual([work.workType, work.itemId, work.system], ['meeting.answer', 'PRD-031', 'teammates']);
});

test('every message in and out of the session is in the item\'s thread and the audit log, and Activity counts the answer once', async () => {
  const { messages } = (await lerato.json('/api/v1/chat/thread?kind=item&id=PRD-031')).body;
  assert.deepEqual(messages.map((m) => [m.author.name, m.via?.channel]), [['Ada Quill', 'teams'], ['Lerato M.', 'teams'], ['Ada Quill', 'teams']]);
  const answer = messages.at(-1);
  assert.deepEqual([answer.costUsd, answer.modelRoute, answer.cards[0].type, answer.cards[0].link.href], [0.06, 'mock/claude-sonnet-5-5', 'facts', '/home/lifecycle/PRD-031']);
  assert.equal(answer.via.where, 'the Slot rollout sync meeting');
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'teams.teammate_added' && r.actor === 'stevie' && r.billedTeam === 'delivery-squad'));
    assert.ok(audit.some((r) => r.action === 'teams.message_received' && r.actor === 'lerato-m' && r.itemId === 'PRD-031'));
    assert.ok(audit.some((r) => r.action === 'teams.message_sent' && r.actor === 'ada-quill' && r.kind === 'answer' && r.costUsd === 0.06));
    assert.ok(audit.some((r) => r.action === 'agent.meeting.answer' && r.actor === 'ada-quill' && r.team === 'Delivery squad'));
  });
  const rows = (await lerato.json('/api/v1/activity?limit=100')).body.rows;
  assert.equal(rows.filter((r) => r.costUsd === 0.06).length, 1);
  assert.ok(!rows.some((r) => r.type === 'teams.activity_sent'));
});

test('step 7: a message from before Ada joined is not in her context, even when Teams delivers it late', async () => {
  const session = await env.noobly.sessions.get(MEETING);
  const late = activity('lerato-m', { text: '@Ada the pilot date is a secret until Friday', timestamp: new Date(Date.parse(session.joinedAt) - 60_000).toISOString() });
  assert.equal((await deliver(late)).status, 200);
  const context = await env.noobly.sessions.context(MEETING, session.joinedAt);
  assert.deepEqual(context.map((l) => [l.from.name, l.kind]), [['Ada Quill', 'intro'], ['Lerato M.', 'said'], ['Ada Quill', 'answer']]);
  // Neither the late message nor what Lerato said before the join is anywhere in the session's files.
  const dir = path.join(env.dataDir, 'teams', 'sessions', MEETING);
  const kept = (await Promise.all((await fs.readdir(dir)).map((f) => fs.readFile(path.join(dir, f), 'utf8')))).join('\n');
  assert.doesNotMatch(kept, /secret until Friday/);
  assert.ok(context.every((l) => l.at >= session.joinedAt));
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'teams.message_ignored' && r.reason === 'sent before the teammate joined')));
  // An activity with no timestamp can't be placed after the join, so it is left out too.
  const undated = activity('lerato-m', { text: '@Ada and this?' });
  delete undated.timestamp;
  await deliver(undated);
  assert.equal((await env.noobly.sessions.context(MEETING, session.joinedAt)).length, 3);
});

test('what people say to each other after the join is context for Ada, and she only answers when mentioned', async () => {
  assert.equal((await (await say(stevie, 'Thabo said he will look at the ADR after lunch.')).json()).did, 'heard');
  const session = await env.noobly.sessions.get(MEETING);
  assert.equal((await env.noobly.sessions.context(MEETING, session.joinedAt)).at(-1).text, 'Thabo said he will look at the ADR after lunch.');
  assert.equal((await view(stevie)).transcript.at(-1).dir, 'in');
  // A Viewer in the meeting can't ask her for work.
  assert.equal((await (await say(viewer, '@Ada draft me a plan')).json()).did, 'refused');
});

test('step 8: Choose someone else swaps Ada for Rhea: Ada leaves, the list is offered again, Rhea joins a new session', async () => {
  assert.equal((await (await press(stevie, { noobly: 'choose-someone-else' })).json()).did, 'left');
  let v = await view(stevie);
  assert.deepEqual(v.transcript.slice(-2).map((l) => [l.kind, l.text]), [['system-line', 'Ada Quill left the chat'], ['pick-teammate', '']]);
  assert.equal(v.session, null);

  assert.equal((await (await press(stevie, { noobly: 'add', teammateId: 'rhea-voss' })).json()).did, 'added');
  v = await view(stevie);
  assert.equal(v.session.teammate.name, 'Rhea Voss');
  assert.equal(v.transcript.at(-1).card.body.at(-1).text, 'Hi, Rhea here. I drafted the slot architecture and ADR-014. Ask me about trade-offs; decisions stay with Thabo.');
  const session = await env.noobly.sessions.get(MEETING);
  assert.deepEqual(session.previous.map((p) => [p.teammate.id, Boolean(p.leftAt)]), [['ada-quill', true]]);
  // Rhea's context starts at her own join: nothing Ada heard carries over.
  assert.deepEqual((await env.noobly.sessions.context(MEETING, session.joinedAt)).map((l) => l.from.name), ['Rhea Voss']);

  assert.equal((await (await say(lerato, '@Rhea can we hit 300 ms without adding Redis?')).json()).did, 'answered');
  const answer = (await view(lerato)).transcript.at(-1);
  assert.equal(answer.as.name, 'Rhea Voss');
  assert.ok(textOf(answer.card.body).includes('ADR-014 · Cache slot availability'));
  assert.deepEqual((await billedTo('rhea-voss')).at(-1).costCentre, 'Delivery squad');
});

test('a chat with no linked team bills the first team of the person who added the teammate, and has no item', async () => {
  const meeting = 'sim-checkout-standup';
  const priya = env.client();
  await priya.signIn('priya-s');
  await say(priya, '@NooblyJS', meeting);
  assert.ok(textOf((await view(priya, meeting)).transcript.at(-1).card.body).includes('The teammate sees messages from the moment they join, not before. Time is billed to Checkout squad.'));
  assert.equal((await (await press(priya, { noobly: 'add', teammateId: 'juno-park' }, meeting)).json()).did, 'added');
  const session = await env.noobly.sessions.get(meeting);
  assert.deepEqual([session.billedTeam, session.itemId], [{ id: 'checkout-squad', name: 'Checkout squad' }, null]);
  assert.equal((await (await say(priya, '@Juno when will the picker screens be ready?', meeting)).json()).did, 'answered');
  assert.equal((await billedTo('juno-park')).at(-1).costCentre, 'Checkout squad');
  // No item to log to: the answer and its cost reach Activity on their own.
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'teams.question_answered' && e.payload.costUsd === 0.04 && e.actor === 'juno-park'));
  // Reset empties the meeting so the story can be run again.
  const cleared = (await (await post(priya, `/api/v1/dev/teams/${meeting}/reset`)).json());
  assert.deepEqual([cleared.transcript, cleared.session], [[], null]);
});

test('governance: no card template can decide anything. Submit only chooses who is in the chat; the rest are links', async () => {
  const cards = await loadCards();
  assert.deepEqual([...cards.templates.keys()], CARD_NAMES);
  for (const [name, template] of cards.templates) {
    for (const action of actionsIn(template)) {
      assert.ok(['Action.Submit', 'Action.OpenUrl'].includes(action.type), `${name}: ${action.type}`);
      if (action.type === 'Action.Submit') assert.ok(SUBMIT_ACTIONS.includes(action.data?.noobly), `${name}: Submit carries ${JSON.stringify(action.data)}`);
    }
  }
  assert.deepEqual(SUBMIT_ACTIONS, ['add', 'choose-someone-else']);
  // An action the bot doesn't know (an approval sent as a card's data) does nothing.
  assert.deepEqual(await (await press(stevie, { noobly: 'approve', approvalId: 'apr_1' })).json(), { did: 'ignored', reason: 'unknown card action' });
  // And nothing about the item changed because of the meeting.
  const item = (await stevie.json('/workflows/api/v1/items/PRD-031')).body;
  assert.equal((item.item ?? item).stage, 'specify');
});

test('activities are read as Teams sends them: mentions, card data, and conversation ids that are not file names', () => {
  const a = readActivity({
    type: 'message', timestamp: '2026-10-10T12:00:00Z', conversation: { id: '19:meeting_Abc==@thread.v2', name: 'Sync' }, from: { id: '29:x', name: 'Lerato M.', aadObjectId: 'lerato-m' },
    text: '<at>NooblyJS</at> &nbsp;and @Ada <b>what</b> is blocking?', entities: [{ type: 'mention', mentioned: { id: 'noobly-bot', name: 'NooblyJS' } }, { type: 'clientInfo' }],
  });
  assert.deepEqual([a.botMentioned, a.mentioned, a.text, a.at], [true, ['nooblyjs', 'ada'], 'and what is blocking?', '2026-10-10T12:00:00.000Z']);
  assert.match(a.conversationKey, /^c_[0-9a-f]{32}$/);
  assert.equal(conversationKey('sim-slot-rollout-sync'), 'sim-slot-rollout-sync');
  assert.deepEqual(readActivity({ type: 'message', conversation: { id: 'c' }, from: { id: 'u' }, value: { noobly: 'add', teammateId: 'ada-quill' } }).action, { name: 'add', teammateId: 'ada-quill' });
  assert.equal(readActivity({ type: 'conversationUpdate', conversation: { id: 'c' }, from: { id: 'u' }, membersAdded: [{ id: 'noobly-bot' }] }).botAdded, true);
  assert.equal(readActivity({ type: 'message', conversation: { id: 'c' }, from: { id: 'noobly-bot', role: 'bot' } }).from.isBot, true);
  assert.throws(() => readActivity({ type: 'message' }), (err) => err.status === 400);
});
