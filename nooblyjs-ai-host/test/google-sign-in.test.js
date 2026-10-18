// Google sign-in (AUTH_METHOD=google): /login and core's sign-in page go to Google, and Google's answer signs the
// person in through the shared nooblyjs-core user store, creating their NooblyJS record on first sign-in. The
// strategy's calls to Google are stubbed, so nothing leaves the machine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import passport from 'passport';
import { startApp } from './helpers.js';

// Who "Google" says signed in, by authorisation code.
const ACCOUNTS = {
  'code-new': { email: 'new.person@example.com', name: 'New Person', verified: true },
  'code-lerato': { email: 'Lerato-M@noobly.local', name: 'Lerato M.', verified: true },
  'code-unverified': { email: 'stevie@noobly.local', name: 'Not Stevie', verified: false },
};

let env;
before(async () => {
  env = await startApp({
    env: { AUTH_METHOD: 'google', GOOGLE_AUTH_CLIENTID: 'test-client.apps.googleusercontent.com', GOOGLE_AUTH_SECRET: 'test-secret', NOOBLY_DEV_LOGIN: 'false' },
  });
  // On the host's Passport, which is where app.js puts the strategy.
  const google = passport._strategy('google');
  google._oauth2.getOAuthAccessToken = (code, params, done) => (ACCOUNTS[code]
    ? done(null, `token-${code}`, undefined, {})
    : done({ statusCode: 400, data: JSON.stringify({ error: 'invalid_grant', error_description: 'Malformed auth code.' }) }));
  google.userProfile = (accessToken, done) => {
    const account = ACCOUNTS[accessToken.replace(/^token-/, '')];
    done(null, { provider: 'google', id: `google-${account.email}`, displayName: account.name, emails: [{ value: account.email, verified: account.verified }] });
  };
});
after(async () => { await env?.stop(); });

/** Starts signing in on the way to `next`, then comes back from Google with `code`. */
async function signInWithGoogle(c, code, next = '/') {
  await c.get(`/services/authservice/openid?returnUrl=${encodeURIComponent(next)}`);
  return c.get(`/services/authservice/openid?code=${code}`);
}

test('/login and core\'s sign-in page send a signed-out person to Google', async () => {
  const c = env.client();
  const login = await c.get('/login?next=%2Fhome');
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/services/authservice/openid?returnUrl=%2Fhome');
  const sso = await c.json('/services/authservice/api/sso-config');
  assert.deepEqual(sso.body.data, { enabled: true, provider: 'google', initiateUrl: '/services/authservice/openid' });

  const start = await c.get('/services/authservice/openid?returnUrl=%2Fhome');
  assert.equal(start.status, 302);
  const google = new URL(start.headers.get('location'));
  assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(google.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
  assert.equal(google.searchParams.get('redirect_uri'), `${env.base}/services/authservice/openid`);
  assert.equal(google.searchParams.get('scope'), 'profile email');
});

test('a first Google sign-in creates the person and returns them to where they were going', async () => {
  const c = env.client();
  const back = await signInWithGoogle(c, 'code-new', '/api/v1/me');
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/api/v1/me');
  const me = await c.json('/api/v1/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.person.email, 'new.person@example.com');
  assert.equal(me.body.person.name, 'New Person');
  const user = await env.noobly.authservice.getUser('new.person@example.com');
  assert.equal(user.googleId, 'google-new.person@example.com');
  assert.equal(user.accessToken, undefined, 'Google\'s tokens are not kept');
});

test('Google signs an existing person in to their own account, whatever the case of the email', async () => {
  const c = env.client();
  await signInWithGoogle(c, 'code-lerato');
  const me = await c.json('/api/v1/me');
  assert.equal(me.body.person.id, 'lerato-m');
  assert.equal(me.body.person.accessRole, 'Approver');
  await assert.rejects(env.noobly.authservice.getUser('Lerato-M@noobly.local'), 'no second account');
});

test('an unverified Google email, a cancelled sign-in or a bad code signs nobody in', async () => {
  for (const query of ['code=code-unverified', 'error=access_denied', 'code=garbage']) {
    const c = env.client();
    const res = await c.get(`/services/authservice/openid?${query}`);
    assert.equal(res.status, 302, query);
    assert.match(res.headers.get('location'), /^\/services\/authservice\/views\/login\.html\?local=1&error=/, query);
    assert.equal((await c.json('/api/v1/me')).status, 401, query);
  }
  const stevie = await env.noobly.authservice.getUser('stevie@noobly.local');
  assert.equal(stevie.googleId, undefined, 'the unverified claim left Stevie\'s account alone');
});
