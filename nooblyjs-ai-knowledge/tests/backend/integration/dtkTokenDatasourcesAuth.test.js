/**
 * @fileoverview Composition test: dtk_ personal access tokens on the datasources/workflow API.
 *
 * Proves the two middlewares that guard `/api/*` chain correctly for a dtk_ token:
 *   1. BearerTokenMiddleware (wiki) validates the dtk_ token against the core auth
 *      service and sets req.user (with the owner's LIVE roles) + req.isAuthenticated().
 *      In the running app this runs via the global `/api/` mount in app.js.
 *   2. RoleValidationMiddleware.requireDataSourcesAdmin (datasources) then authorises
 *      based on those roles — exactly as datasources/initialize.js gates
 *      /api/workflows, /api/spaces, /api/connections, /api/settings, /api/agents.
 *
 * So a token from a user with the `admin` or `Datasources Administrator` role both
 * authenticates AND authorises the datasources APIs; a valid token without that role
 * is denied (403); no/invalid token is unauthenticated (401).
 */

'use strict';

const BearerTokenMiddleware = require('../../../src/wiki/auth/bearerTokenMiddleware');
const RoleValidationMiddleware = require('../../../src/datasources/middleware/roleValidationMiddleware');

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
}

/** authservice stub: maps a known dtk_ token to a user carrying the given live roles. */
function makeAuthservice(usersByToken) {
  return {
    validateApiToken: jest.fn(async (token) => {
      const u = usersByToken[token];
      if (!u) throw new Error('Invalid API token');
      return { email: u.email, roles: u.roles, user: { id: u.id, email: u.email, fullName: u.email } };
    })
  };
}

function makeReq(token, authservice) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method: 'POST',
    path: '/api/workflows/start', // API path → role gate returns JSON (not an HTML redirect)
    ip: '127.0.0.1',
    get: () => 'jest',
    app: { get: (key) => (key === 'authservice' ? authservice : undefined) }
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    redirectedTo: undefined,
    status: jest.fn(function (c) { this.statusCode = c; return this; }),
    json: jest.fn(function (b) { this.body = b; return this; }),
    redirect: jest.fn(function (u) { this.redirectedTo = u; return this; })
  };
  return res;
}

/** Run bearer auth then the datasources role gate, the way the app chains them. */
async function authenticateThenAuthorise(token, authservice) {
  const bearer = new BearerTokenMiddleware(makeLogger()).middleware();
  const roleValidator = new RoleValidationMiddleware(makeLogger());
  const req = makeReq(token, authservice);
  const res = makeRes();

  await new Promise((resolve) => bearer(req, res, resolve)); // sets req.user + req.isAuthenticated()

  let authorised = false;
  roleValidator.requireDataSourcesAdmin(req, res, () => { authorised = true; });
  return { req, res, authorised };
}

describe('dtk_ token → datasources/workflow API authorisation', () => {
  const ADMIN = 'dtk_' + 'a'.repeat(64);
  const DS_ADMIN = 'dtk_' + 'b'.repeat(64);
  const PLAIN = 'dtk_' + 'c'.repeat(64);

  const authservice = makeAuthservice({
    [ADMIN]: { email: 'admin@example.com', id: 'u-admin', roles: ['admin'] },
    [DS_ADMIN]: { email: 'ds@example.com', id: 'u-ds', roles: ['Datasources Administrator'] },
    [PLAIN]: { email: 'user@example.com', id: 'u-user', roles: ['user'] }
  });

  test('global admin role: authenticated AND authorised', async () => {
    const { req, res, authorised } = await authenticateThenAuthorise(ADMIN, authservice);
    expect(req.isAuthenticated()).toBe(true);
    expect(req.user.email).toBe('admin@example.com');
    expect(req.user.roles).toEqual(['admin']);
    expect(authorised).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('Datasources Administrator role: authorised', async () => {
    const { authorised, res } = await authenticateThenAuthorise(DS_ADMIN, authservice);
    expect(authorised).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('valid token but insufficient role: denied with 403', async () => {
    const { authorised, res } = await authenticateThenAuthorise(PLAIN, authservice);
    expect(authorised).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body.success).toBe(false);
  });

  test('no token: unauthenticated with 401', async () => {
    const { authorised, res } = await authenticateThenAuthorise(undefined, authservice);
    expect(authorised).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('invalid/revoked token: unauthenticated with 401', async () => {
    const { authorised, res } = await authenticateThenAuthorise('dtk_' + 'z'.repeat(64), authservice);
    expect(authorised).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
