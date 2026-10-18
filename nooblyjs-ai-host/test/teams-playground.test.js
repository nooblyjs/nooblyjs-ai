// The Microsoft 365 Agents Playground in development (Phase 12): it posts unsigned activities from this machine with
// a localhost serviceUrl. With TEAMS_BOT_DEV_UNSIGNED=true NooblyJS takes them, acts for the Playground's mock user as
// TEAMS_BOT_DEV_PERSON, and replies to the Playground without a token. Anything unsigned from elsewhere is still 401,
// and the setting is refused in production. Nothing here leaves this machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadConfig, ConfigError } from '../src/config.js';

const PLAYGROUND = 'http://localhost:56150/_connector';
const replies = [];
async function local(href, init = {}) {
  const url = new URL(href);
  if (url.host === 'localhost:56150') {
    replies.push({ href, authorization: init.headers?.authorization ?? null, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: `r${replies.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
}

let env;
before(async () => {
  env = await startApp({ teamsFetch: local, env: { TEAMS_BOT_DEV_UNSIGNED: 'true', TEAMS_BOT_DEV_PERSON: 'lerato-m', CHAT_MOCK_REPLY_MS: '0' }, hostedApps: [{ package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }] });
});
after(async () => { await env?.stop(); });

const activity = (over = {}) => ({
  type: 'message', id: 'a1', timestamp: new Date().toISOString(), channelId: 'msteams', serviceUrl: PLAYGROUND,
  from: { id: 'user-id-0', name: 'Alex Wilber', aadObjectId: '00000000-0000-0000-0000-0000000000020' },
  recipient: { id: '00000000-0000-0000-0000-00000000000011', name: 'Test Bot' },
  conversation: { id: 'personal-chat-id', conversationType: 'personal' },
  text: '@NooblyJS who can help?',
  ...over,
});
const post = async (body) => {
  const res = await fetch(`${env.base}/api/teams/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await env.noobly.teamsBot.settled();
  return res;
};

test('an unsigned Playground activity is handled as TEAMS_BOT_DEV_PERSON, and the reply goes back to the Playground with no token', async () => {
  const res = await post(activity());
  assert.equal(res.status, 200);
  const reply = replies.at(-1);
  assert.equal(reply.href, 'http://localhost:56150/_connector/v3/conversations/personal-chat-id/activities');
  assert.equal(reply.authorization, null, 'no token goes to the Playground');
  assert.match(JSON.stringify(reply.body.attachments?.[0]?.content ?? {}), /Which teammate would you like to add/);
  // Lerato (an Approver, with draft) can add a teammate from the Playground.
  await post(activity({ id: 'a2', text: '', value: { noobly: 'add', teammateId: 'ada-quill' } }));
  assert.ok(replies.some((r) => r.body.text === 'Ada Quill joined the chat'));
});

test('unsigned from anywhere but a localhost Playground is still refused', async () => {
  const res = await post(activity({ serviceUrl: 'https://smba.trafficmanager.net/emea/' }));
  assert.equal(res.status, 401);
});

test('the Playground setting is refused in production and without development sign-in', () => {
  const base = { DATA_DIR: 'x', TEAMS_BOT_DEV_UNSIGNED: 'true' };
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) }), ConfigError);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'development' }), /NOOBLY_DEV_LOGIN/);
  const ok = loadConfig({ ...base, NODE_ENV: 'development', NOOBLY_DEV_LOGIN: 'true' });
  assert.deepEqual([ok.teams.devUnsigned, ok.teams.devPerson], [true, 'stevie']);
});
