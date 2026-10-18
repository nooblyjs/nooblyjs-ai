// Phase 12's test script, offline: the real Teams bot endpoint with Microsoft's side played by a fake `fetch` and a
// test signing key standing in for the Bot Framework's. Signed tokens are checked (step 6), the pick-a-teammate card
// goes out through the Bot Connector (step 3), Ada answers with sources and cost (step 4), meeting notes reach the
// item (step 5), approvals reach Teams and Outlook (step 2), and a Microsoft sign-in records the person's Entra id and
// job title (step 1). Nothing here reaches Microsoft.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp, today, eventually } from './helpers.js';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SERVICE = 'https://smba.trafficmanager.net/emea/';
const KID = 'test-key-1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token({ key = privateKey, kid = KID, alg = 'RS256', iss = 'https://api.botframework.com', aud = APP_ID, exp = Math.floor(Date.now() / 1000) + 3600, serviceurl = SERVICE } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64({ iss, aud, exp, nbf: Math.floor(Date.now() / 1000) - 10, serviceurl });
  const sig = alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `Bearer ${head}.${body}.${sig || 'x'}`;
}

// ---------- Microsoft, played here ----------
const calls = [];
const sent = []; // what the bot posted to conversations
const mails = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function microsoft(href, init = {}) {
  calls.push({ href, method: init.method ?? 'GET', authorization: init.headers?.authorization ?? null });
  const url = new URL(href);
  if (href === 'https://login.botframework.com/v1/.well-known/openidconfiguration') return json({ jwks_uri: 'https://login.botframework.com/v1/.well-known/keys' });
  if (href === 'https://login.botframework.com/v1/.well-known/keys') return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig' }] });
  if (url.host === 'login.microsoftonline.com') return json({ access_token: `token-for-${new URLSearchParams(init.body).get('scope')}`, expires_in: 3600 });
  if (url.host === 'smba.trafficmanager.net' && url.pathname === '/emea/v3/conversations') return json({ id: 'a:personal-stevie' });
  if (url.host === 'smba.trafficmanager.net') {
    sent.push({ conversation: decodeURIComponent(url.pathname.split('/')[4]), body: JSON.parse(init.body), authorization: init.headers.authorization });
    return json({ id: `act-${sent.length}` });
  }
  if (url.host === 'graph.microsoft.com' && url.pathname.endsWith('/sendMail')) {
    mails.push({ sender: decodeURIComponent(url.pathname.split('/')[3]), body: JSON.parse(init.body), authorization: init.headers.authorization });
    return new Response(null, { status: 202 });
  }
  if (url.host === 'graph.microsoft.com' && url.pathname === '/v1.0/me') return json({ id: 'entra-priya', jobTitle: 'Solution Architect', displayName: 'Priya S.' });
  return json({ error: `not faked: ${href}` }, 404);
}

let env;
let stevie;
before(async () => {
  env = await startApp({
    teamsFetch: microsoft,
    graphFetch: microsoft,
    env: {
      CHAT_MOCK_REPLY_MS: '0', PUBLIC_BASE_URL: 'https://noobly.example', AZURE_AD_READ_PROFILE: 'true',
      TEAMS_BOT_APP_ID: APP_ID, TEAMS_BOT_APP_SECRET: 'bot-secret', TEAMS_BOT_TENANT_ID: TENANT,
      MS_GRAPH_TENANT_ID: TENANT, MS_GRAPH_CLIENT_ID: 'graph-client', MS_GRAPH_CLIENT_SECRET: 'graph-secret', MS_GRAPH_SENDER: 'noobly@example.com',
    },
    hostedApps: [{ package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }],
  });
  // Stevie has signed in to NooblyJS with Microsoft: his Entra object id is on his record.
  await env.noobly.people.setFromEntra('stevie', { entraId: 'entra-stevie' });
  await env.noobly.people.setFromEntra('naledi-k', { entraId: 'entra-naledi' });
  stevie = env.client();
  await stevie.signIn('stevie');
});
after(async () => { await env?.stop(); });

const CONVERSATION = '19:meeting_slots@thread.v2';
function activity(over = {}) {
  return {
    type: 'message', id: crypto.randomUUID(), timestamp: new Date().toISOString(), channelId: 'msteams', serviceUrl: SERVICE,
    from: { id: '29:stevie', name: 'Stevie', aadObjectId: 'entra-stevie' },
    recipient: { id: `28:${APP_ID}`, name: 'NooblyJS' },
    conversation: { id: CONVERSATION, name: 'Slot rollout sync', conversationType: 'groupChat', tenantId: TENANT },
    channelData: { tenant: { id: TENANT } },
    ...over,
  };
}
const mention = (text) => ({ text: `<at>NooblyJS</at> ${text}`, entities: [{ type: 'mention', mentioned: { id: `28:${APP_ID}`, name: 'NooblyJS' }, text: '<at>NooblyJS</at>' }] });
async function post(body, authorization = token()) {
  const res = await fetch(`${env.base}/api/teams/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body) });
  await env.noobly.teamsBot.settled();
  return res;
}
const cardOf = (m) => m.body.attachments?.[0]?.content;

test('step 6: a forged, expired, misaddressed or missing token gets 401, and each refusal is logged', async () => {
  const cases = [
    ['signed with another key', token({ key: other.privateKey })],
    ['for another bot', token({ aud: '99999999-9999-9999-9999-999999999999' })],
    ['expired', token({ exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['issued by someone else', token({ iss: 'https://evil.example' })],
    ['for another service address', token({ serviceurl: 'https://smba.trafficmanager.net/amer/' })],
    ['with no algorithm', token({ alg: 'none' })],
    ['the simulator key guessed', 'Bearer dev:guess'],
    ['none at all', null],
  ];
  for (const [what, auth] of cases) {
    const res = await post(activity(mention('hello')), auth);
    assert.equal(res.status, 401, what);
  }
  assert.equal(sent.length, 0, 'nothing was said to anyone');
  await eventually(async () => {
    const refused = (await today(env.store, 'audit')).filter((a) => a.action === 'teams.activity_refused');
    assert.ok(refused.length >= cases.length);
    assert.ok(refused.some((a) => /signature is wrong/.test(a.reason)));
    assert.ok(refused.some((a) => /another bot/.test(a.reason)));
  });
});

test('step 3: @NooblyJS in a meeting chat: acknowledged at once, then the pick-a-teammate card goes out through the Bot Connector', async () => {
  const res = await post(activity(mention('who can help?')));
  assert.equal(res.status, 200);
  const card = sent.at(-1);
  assert.equal(card.conversation, CONVERSATION);
  assert.equal(card.authorization, 'Bearer token-for-https://api.botframework.com/.default');
  assert.deepEqual([card.body.from.id, card.body.recipient.id, card.body.type], [`28:${APP_ID}`, '29:stevie', 'message']);
  assert.match(JSON.stringify(cardOf(card)), /Which teammate would you like to add/);
  // The bot's token was asked for its own tenant, and only ever sent to the Bot Connector.
  assert.ok(calls.some((c) => c.href === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`));
  assert.ok(calls.filter((c) => c.authorization?.startsWith('Bearer token-for-https://api.botframework.com')).every((c) => new URL(c.href).host === 'smba.trafficmanager.net'));
});

test('step 4: Stevie adds Ada; she answers @Ada with a card that has her sources and what it cost; it is in Activity and the audit log', async () => {
  await post(activity({ text: '', value: { noobly: 'add', teammateId: 'ada-quill' } }));
  assert.ok(sent.some((m) => m.body.text === 'Ada Quill joined the chat'));
  const before = sent.length;
  await post(activity({ text: '@Ada what is blocking us?', timestamp: new Date(Date.now() + 1000).toISOString() }));
  const answer = sent.slice(before).find((m) => JSON.stringify(cardOf(m) ?? {}).includes('this answer cost'));
  assert.ok(answer, JSON.stringify(sent.slice(before).map((m) => m.body.text ?? m.body.attachments?.[0]?.contentType)));
  assert.match(JSON.stringify(cardOf(answer)), /NooblyJS teammate/);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((a) => a.action === 'teams.teammate_added' && a.actor === 'stevie'));
    assert.ok(audit.some((a) => a.action === 'teams.message_sent' && a.actor === 'ada-quill'));
    assert.ok((await today(env.store, 'events')).some((e) => e.type === 'teams.teammate_joined'));
  });
});

test('step 5: "@NooblyJS post meeting notes to PRD-031" puts the notes on the item and says so in the chat', async () => {
  const before = sent.length;
  await post(activity({ ...mention('post meeting notes to PRD-031'), timestamp: new Date(Date.now() + 2000).toISOString() }));
  const confirmation = sent.slice(before).find((m) => /posted the meeting notes to PRD-031/.test(m.body.text ?? ''));
  assert.ok(confirmation, JSON.stringify(sent.slice(before).map((m) => m.body.text)));
  assert.match(confirmation.body.text, /https:\/\/noobly\.example\/home\/lifecycle\/PRD-031/);
  const { body } = await stevie.json('/api/v1/chat/thread?kind=item&id=PRD-031');
  const notes = body.messages.find((m) => m.kind === 'meeting-notes');
  assert.ok(notes, 'a notes entry is on the item');
  assert.match(notes.text, /^Meeting notes from Slot rollout sync/);
  assert.match(notes.text, /Stevie: @Ada what is blocking us\?/);
  assert.equal(notes.author.id, 'ada-quill');
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'teams.meeting_notes_posted' && e.payload.itemId === 'PRD-031'));
  // Naming an item that doesn't exist is said in the chat, and nothing is posted.
  await post(activity({ ...mention('post meeting notes to PRD-999'), timestamp: new Date(Date.now() + 3000).toISOString() }));
  assert.match(sent.at(-1).body.text, /There is no item PRD-999/);
});

test('someone NooblyJS does not know is told to sign in; a Viewer cannot add a teammate', async () => {
  await post(activity({ ...mention('hi'), from: { id: '29:stranger', name: 'Stranger', aadObjectId: 'entra-unknown' }, conversation: { id: '19:other@thread.v2' } }));
  assert.match(sent.at(-1).body.text, /I don't know you in NooblyJS yet/);
  await post(activity({ text: '', value: { noobly: 'add', teammateId: 'ada-quill' }, from: { id: '29:naledi', name: 'Naledi', aadObjectId: 'entra-naledi' }, conversation: { id: '19:third@thread.v2' } }));
  assert.match(sent.at(-1).body.text, /needs the "draft" permission/);
});

test('step 2: an approval request reaches the reviewer in Teams and by email, each with a link that opens it', async () => {
  // Stevie wants approvals in Teams; he has spoken to the bot, so NooblyJS knows where to find him.
  await env.store.updateDoc(['people', 'stevie', 'profile.md'], (doc) => ({ data: { ...doc.data, notifications: { approvalsInTeams: true } }, body: doc.body }));
  const before = sent.length;
  await env.noobly.events.emit('approval.requested', {
    approvalId: 'apr_test1', itemId: 'PRD-031', type: 'spec', reviewerIds: ['stevie'], summary: 'asked for review of PRD-031 · Same-day delivery slots',
  }, { actor: 'lerato-m' });
  await env.noobly.notify.settled();

  const teams = sent.slice(before).find((m) => cardOf(m)?.actions?.[0]?.title === 'Open the approval');
  assert.ok(teams, 'a Teams card was sent');
  assert.equal(teams.conversation, 'a:personal-stevie', 'in a personal chat opened for him');
  assert.equal(cardOf(teams).actions[0].url, 'https://noobly.example/home/approvals?id=apr_test1');
  assert.ok(!JSON.stringify(cardOf(teams)).includes('Action.Submit'), 'nothing in Teams decides');

  const mail = mails.at(-1);
  assert.equal(mail.sender, 'noobly@example.com');
  assert.equal(mail.authorization, 'Bearer token-for-https://graph.microsoft.com/.default');
  assert.deepEqual(mail.body.message.toRecipients.map((r) => r.emailAddress.address), ['stevie@noobly.local']);
  assert.match(mail.body.message.subject, /^Approval waiting: PRD-031 · Same-day delivery slots/);
  assert.match(mail.body.message.body.content, /https:\/\/noobly\.example\/home\/approvals\?id=apr_test1/);
  // Platform · Settings · Integrations says both are set up.
  const row = (await stevie.json('/api/v1/platform/settings')).body.integrations.find((i) => i.key === 'teams');
  assert.deepEqual([row.state, row.stateText], ['connected', 'Connected']);
  assert.match(row.detail, /approval emails, sent from noobly@example.com/);
  await eventually(async () => {
    const audit = (await today(env.store, 'audit')).filter((a) => a.action === 'notify.approval_sent' && a.approvalId === 'apr_test1');
    assert.deepEqual(audit.map((a) => a.channel).sort(), ['email', 'teams']);
  });
});

test('step 1: a Microsoft sign-in records the person\'s Entra id and job title from Graph, and onboarding suggests the role', async () => {
  const email = (await env.noobly.people.get('priya-s')).email;
  await env.noobly.authservice.updateUser(email, { azureId: 'entra-priya', accessToken: 'graph-user-token' });
  const person = await env.noobly.entra.signedIn(email);
  assert.deepEqual([person.entraId, person.jobTitle], ['entra-priya', 'Solution Architect']);
  assert.ok(calls.some((c) => c.href.startsWith('https://graph.microsoft.com/v1.0/me') && c.authorization === 'Bearer graph-user-token'));
  // The bot now knows her from Teams.
  assert.equal((await env.noobly.people.getByEntraId('ENTRA-PRIYA')).id, 'priya-s');
  const priya = env.client();
  await priya.signIn('priya-s');
  const onboarding = (await priya.json('/api/v1/me/onboarding')).body;
  assert.deepEqual([onboarding.person.jobTitle, onboarding.suggested?.role], ['Solution Architect', 'architect']);
});
