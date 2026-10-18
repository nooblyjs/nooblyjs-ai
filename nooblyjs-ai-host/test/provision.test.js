// Someone who signs in (an nooblyjs-core account, e.g. from Microsoft Entra ID) without a NooblyJS record gets one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

const PASSWORD = 'Correct-horse-battery-9';
let env;

before(async () => {
  env = await startApp({ env: { NOOBLY_OWNERS: 'Boss.Person@example.com' } });
  const auth = env.noobly.authservice;
  for (const [email, fullName] of [
    ['new.joiner@example.com', 'New Joiner'],
    ['boss.person@example.com', 'Boss Person'],
    ['stevie@other.example', 'Another Stevie'],
    ['gone@example.com', 'Gone Person'],
  ]) await auth.createUser({ email, fullName, password: PASSWORD, role: 'user' });
  // A record that exists but is switched off.
  await env.store.writeDoc(['people', 'gone', 'PERSON.md'], { id: 'gone', name: 'Gone Person', email: 'gone@example.com', accessRole: 'Viewer', active: false });
});
after(async () => { await env?.stop(); });

async function signInToCore(email) {
  const c = env.client();
  const res = await c.request('/services/authservice/api/login', { method: 'POST', json: { email, password: PASSWORD } });
  assert.equal(res.status, 200, `core sign-in for ${email}`);
  return c;
}

test('first sign-in creates the person as a Viewer, with no profile yet, audited and evented', async () => {
  const c = await signInToCore('new.joiner@example.com');
  const { status, body } = await c.json('/api/v1/me');
  assert.equal(status, 200);
  assert.deepEqual(
    { id: body.person.id, name: body.person.name, email: body.person.email, accessRole: body.person.accessRole, hasProfile: body.person.hasProfile },
    { id: 'new-joiner', name: 'New Joiner', email: 'new.joiner@example.com', accessRole: 'Viewer', hasProfile: false },
  );
  const doc = await env.store.readDoc(['people', 'new-joiner', 'PERSON.md']);
  assert.equal(doc.data.source, 'sign-in');
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'person.created' && r.target === 'new-joiner' && r.accessRole === 'Viewer'));
  });
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'person.created' && e.payload.personId === 'new-joiner'));
});

test('an NOOBLY_OWNERS email starts as Owner, and five requests at once still make one record', async () => {
  const c = await signInToCore('boss.person@example.com');
  const answers = await Promise.all(Array.from({ length: 5 }, () => c.json('/api/v1/me')));
  assert.ok(answers.every((a) => a.status === 200 && a.body.person.id === 'boss-person' && a.body.person.accessRole === 'Owner'));
  const folders = (await fs.readdir(path.join(env.dataDir, 'people'))).filter((n) => n.startsWith('boss-person'));
  assert.deepEqual(folders, ['boss-person']);
});

test('an id already taken by someone else gets a suffix', async () => {
  const c = await signInToCore('stevie@other.example');
  const { body } = await c.json('/api/v1/me');
  assert.equal(body.person.id, 'stevie-2');
  assert.equal((await env.store.readDoc(['people', 'stevie', 'PERSON.md'])).data.email, 'stevie@noobly.local', 'the seeded Stevie is untouched');
});

test('a switched-off record is never replaced: that person stays out', async () => {
  const c = await signInToCore('gone@example.com');
  const { status, body } = await c.json('/api/v1/me');
  assert.equal(status, 403);
  assert.equal(body.error.code, 'person_inactive');
  const folders = (await fs.readdir(path.join(env.dataDir, 'people'))).filter((n) => n.startsWith('gone'));
  assert.deepEqual(folders, ['gone']);
});

test('the seeded people still sign in through the dev picker unchanged', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  assert.equal((await c.json('/api/v1/me')).body.person.accessRole, 'Approver');
});

test("after signing in on core's login page you land on NooblyJS's home, not core's /services", async () => {
  const c = env.client();
  const res = await c.request('/services/authservice/api/login', { method: 'POST', json: { email: 'new.joiner@example.com', password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).redirectUrl, '/');
  // A deep link still wins: the person lands where they were heading.
  const deep = await env.client().request('/services/authservice/api/login', { method: 'POST', json: { email: 'new.joiner@example.com', password: PASSWORD, returnUrl: '/teammates/team' } });
  assert.equal((await deep.json()).redirectUrl, '/teammates/team');
});
