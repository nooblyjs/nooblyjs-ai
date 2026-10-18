'use strict';

/**
 * Browser-assisted Entra sign-in for editor extensions (VS Code, Kiro).
 *
 * An extension has no browser and cannot read one's cookie, so SSO happens in
 * the user's real browser and the resulting session is handed back over a
 * custom-scheme redirect. That redirect is NOT a private channel — any
 * application on the machine can register `vscode://` — so the whole design
 * rests on the redirect carrying something useless on its own.
 *
 * The properties under test are the ones whose failure is silent, i.e. the flow
 * still appears to work while the security argument has evaporated:
 *
 *   1. The redirect carries a CODE, never the token. If the token ever appears
 *      in the hand-off URL, interception becomes account takeover and nothing
 *      about the user experience changes to reveal it.
 *   2. A code is worthless without the verifier, which never leaves the
 *      extension. A wrong verifier must be refused.
 *   3. A code is consumed on the FIRST attempt whether or not the verifier
 *      matched. Otherwise an intercepted code can be brute-forced against by an
 *      attacker who keeps guessing while the real user's sign-in still works.
 *   4. An unauthenticated visit redirects into Entra with a SAME-ORIGIN
 *      returnUrl. The core deliberately rejects off-origin return URLs
 *      (authAzure.sanitizeReturnUrl_) — pointing it straight at `vscode://`
 *      would be silently dropped, and "fixing" that would reopen the open
 *      redirect the sanitiser exists to close.
 *   5. Only known editor schemes are echoed into a redirect.
 *
 * The route module is plain Express, so it is exercised here against a stub app
 * that records handlers, rather than by standing up a server.
 */

const path = require('node:path');
const crypto = require('node:crypto');

const ROUTE_MODULE = path.join(
  __dirname, '../../../src/wiki/routes/editorAuthRoutes.js'
);

/** Minimal Express stand-in that just records route handlers by method+path. */
function makeApp() {
  const routes = new Map();
  const record = (method) => (routePath, handler) => {
    routes.set(`${method} ${routePath}`, handler);
  };
  return {
    get: record('GET'),
    post: record('POST'),
    handler(method, routePath) {
      const found = routes.get(`${method} ${routePath}`);
      if (!found) throw new Error(`No handler registered for ${method} ${routePath}`);
      return found;
    }
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    redirectedTo: undefined,
    _type: undefined,
    status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    type(value) { this._type = value; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    redirect(url) { this.redirectedTo = url; this.statusCode = 302; return this; }
  };
  return res;
}

const USER = {
  id: 'u-1',
  email: 'someone@example.com',
  username: 'someone',
  name: 'Some One',
  roles: ['user']
};

function loadRoutes() {
  // Fresh module each time: the pending-code store is module-level state, and a
  // test that inherits another's codes is testing nothing.
  jest.resetModules();
  const app = makeApp();
  const registered = [];
  global.bearerTokenMiddleware = {
    registerToken: (token, user, ttl) => registered.push({ token, user, ttl })
  };
  require(ROUTE_MODULE)({ app }, { emit() {} }, { log: { info() {}, warn() {}, error() {} } });
  return { app, registered };
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Drive /start as a signed-in user and return the redirect it hands back. */
async function completeStart(app, { challenge, scheme = 'vscode', state = 'st4te-value' }) {
  const res = makeRes();
  await app.handler('GET', '/api/auth/editor/start')(
    { query: { challenge, scheme, state }, isAuthenticated: () => true, user: USER },
    res
  );
  return res;
}

/** Pull the hand-off URI out of the returned HTML page. */
function redirectUriFrom(html) {
  const match = String(html).match(/href="([a-z-]+:\/\/[^"]+)"/i);
  return match ? match[1] : null;
}

afterEach(() => {
  delete global.bearerTokenMiddleware;
  delete process.env.AZURE_AD_CLIENT_ID;
  delete process.env.AZURE_AD_TENANT_ID;
});

describe('editor auth hand-off', () => {
  test('the redirect carries a code, and never the token', async () => {
    const { app, registered } = loadRoutes();
    const { challenge } = pkce();

    const res = await completeStart(app, { challenge });
    const uri = redirectUriFrom(res.body);

    expect(uri).toBeTruthy();
    expect(uri).toContain('vscode://noobly.noobly-knowledge-repository/auth');
    expect(uri).toContain('code=');

    // The token was minted and registered, but must appear nowhere in the page.
    expect(registered).toHaveLength(1);
    const { token } = registered[0];
    expect(token).toBeTruthy();
    expect(String(res.body)).not.toContain(token);
  });

  test('the right verifier exchanges the code for the token', async () => {
    const { app, registered } = loadRoutes();
    const { verifier, challenge } = pkce();

    const start = await completeStart(app, { challenge });
    const code = new URL(redirectUriFrom(start.body)).searchParams.get('code');

    const res = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')({ body: { code, verifier } }, res);

    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe(registered[0].token);
    expect(res.body.user.email).toBe(USER.email);
  });

  test('a wrong verifier is refused', async () => {
    const { app } = loadRoutes();
    const { challenge } = pkce();

    const start = await completeStart(app, { challenge });
    const code = new URL(redirectUriFrom(start.body)).searchParams.get('code');

    const res = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')(
      { body: { code, verifier: crypto.randomBytes(32).toString('base64url') } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.token).toBeUndefined();
  });

  test('a code is consumed by a FAILED attempt, so it cannot be brute-forced', async () => {
    const { app } = loadRoutes();
    const { verifier, challenge } = pkce();

    const start = await completeStart(app, { challenge });
    const code = new URL(redirectUriFrom(start.body)).searchParams.get('code');

    // Wrong guess first.
    const failed = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')(
      { body: { code, verifier: crypto.randomBytes(32).toString('base64url') } },
      failed
    );
    expect(failed.statusCode).toBe(400);

    // The correct verifier must now also fail — the code is spent.
    const retried = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')({ body: { code, verifier } }, retried);

    expect(retried.statusCode).toBe(400);
    expect(retried.body.token).toBeUndefined();
  });

  test('a code cannot be redeemed twice', async () => {
    const { app } = loadRoutes();
    const { verifier, challenge } = pkce();

    const start = await completeStart(app, { challenge });
    const code = new URL(redirectUriFrom(start.body)).searchParams.get('code');

    const first = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')({ body: { code, verifier } }, first);
    expect(first.body.success).toBe(true);

    const second = makeRes();
    await app.handler('POST', '/api/auth/editor/exchange')({ body: { code, verifier } }, second);
    expect(second.statusCode).toBe(400);
    expect(second.body.token).toBeUndefined();
  });

  test('an unauthenticated visit redirects into Entra with a same-origin returnUrl', async () => {
    process.env.AZURE_AD_CLIENT_ID = 'client';
    process.env.AZURE_AD_TENANT_ID = 'tenant';

    const { app } = loadRoutes();
    const { challenge } = pkce();

    const res = makeRes();
    await app.handler('GET', '/api/auth/editor/start')(
      { query: { challenge, scheme: 'vscode', state: 'abc' }, isAuthenticated: () => false },
      res
    );

    expect(res.redirectedTo).toContain('/services/authservice/api/azure');

    // The core rejects any returnUrl that is not a same-origin path, so this
    // must be a relative path — never the vscode:// URI itself.
    const returnUrl = decodeURIComponent(
      res.redirectedTo.split('returnUrl=')[1]
    );
    expect(returnUrl.startsWith('/')).toBe(true);
    expect(returnUrl.startsWith('//')).toBe(false);
    expect(returnUrl).not.toContain('vscode://');
    // The challenge has to survive the round trip, or the code minted on the
    // way back cannot be exchanged by the extension that started it.
    expect(returnUrl).toContain('challenge=');
  });

  test('an unknown editor scheme is refused rather than echoed into a redirect', async () => {
    const { app } = loadRoutes();
    const { challenge } = pkce();

    const res = makeRes();
    await app.handler('GET', '/api/auth/editor/start')(
      {
        query: { challenge, scheme: 'javascript', state: 'abc' },
        isAuthenticated: () => true,
        user: USER
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(String(res.body)).not.toContain('javascript://');
  });

  test('a missing or malformed challenge is refused', async () => {
    const { app } = loadRoutes();

    for (const challenge of [undefined, '', 'short', 'has spaces and punctuation!']) {
      const res = makeRes();
      await app.handler('GET', '/api/auth/editor/start')(
        { query: { challenge, scheme: 'vscode' }, isAuthenticated: () => true, user: USER },
        res
      );
      expect(res.statusCode).toBe(400);
    }
  });

  test('config reports SSO only when Entra is actually configured', async () => {
    const { app } = loadRoutes();

    const off = makeRes();
    app.handler('GET', '/api/auth/editor/config')({}, off);
    expect(off.body.sso.enabled).toBe(false);
    // The password form must stay offered, or a server without Entra has no
    // way in at all.
    expect(off.body.passwordLogin).toBe(true);

    process.env.AZURE_AD_CLIENT_ID = 'client';
    process.env.AZURE_AD_TENANT_ID = 'tenant';

    const on = makeRes();
    app.handler('GET', '/api/auth/editor/config')({}, on);
    expect(on.body.sso.enabled).toBe(true);
    expect(on.body.sso.provider).toBe('azure');
    // Never cached: it decides whether a sign-in button is even shown.
    expect(on.headers['Cache-Control']).toBe('no-store');
  });
});
