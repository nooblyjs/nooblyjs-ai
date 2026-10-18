// What NooblyJS learns from a Microsoft sign-in (src/services/entra.js). The Entra id comes from the sign-in itself. The
// job title needs Microsoft Graph's User.Read, which some tenants only give with admin consent: asking for it stopped
// every sign-in at "Approval required" (2026-10-11), so it is read only when AZURE_AD_READ_PROFILE=true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createEntraSignIn } from '../../src/services/entra.js';
import { loadConfig } from '../../src/config.js';

const require = createRequire(import.meta.url);

function make({ readProfile } = {}) {
  const calls = [];
  const saved = [];
  const entra = createEntraSignIn({
    readProfile,
    authservice: { getUser: async (email) => ({ email, fullName: 'Priya S', azureId: 'entra-priya', accessToken: 'graph-user-token' }) },
    people: {
      getByEmail: async () => ({ id: 'priya-s', email: 'priya@example.com' }),
      setFromEntra: async (id, patch) => { saved.push(patch); return { id, ...patch }; },
    },
    onNewPerson: async () => null,
    fetch: async (url) => { calls.push(url); return new Response(JSON.stringify({ id: 'graph-id', jobTitle: 'Solution Architect' }), { status: 200 }); },
  });
  return { entra, calls, saved };
}

test('by default a sign-in records the Entra id and never calls Microsoft Graph', async () => {
  const t = make();
  const person = await t.entra.signedIn('Priya@Example.com');
  assert.deepEqual(t.calls, [], 'Graph was not asked');
  assert.deepEqual(t.saved, [{ entraId: 'entra-priya', jobTitle: null }]);
  assert.equal(person.entraId, 'entra-priya', 'the Teams bot can still recognise them');
});

test('with AZURE_AD_READ_PROFILE=true the job title is read from Graph /me', async () => {
  const t = make({ readProfile: true });
  await t.entra.signedIn('priya@example.com');
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0], /graph\.microsoft\.com\/v1\.0\/me/);
  assert.deepEqual(t.saved, [{ entraId: 'entra-priya', jobTitle: 'Solution Architect' }]);
});

test('the sign-in asks Microsoft for sign-in alone unless the profile read is switched on', async () => {
  const base = { DATA_DIR: 'data', NODE_ENV: 'test' };
  assert.equal(loadConfig(base).azureReadProfile, false);
  assert.equal(loadConfig({ ...base, AZURE_AD_READ_PROFILE: 'true' }).azureReadProfile, true);
  // nooblyjs-core's default, which every host gets: no Graph permission that could need an admin's consent.
  const core = await fs.readFile(require.resolve('nooblyjs-core/src/authservice/providers/authAzure.js'), 'utf8');
  assert.match(core, /scope: this\.options_\.scope \|\| \['openid', 'profile', 'email'\],/);
  // NooblyJS adds User.Read only behind the setting.
  const app = await fs.readFile(path.resolve('app.js'), 'utf8');
  assert.match(app, /config\.azureReadProfile \? \{ scope: \['openid', 'profile', 'email', 'User\.Read'\] \} : \{\}/);
});
