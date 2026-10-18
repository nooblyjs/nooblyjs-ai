/**
 * @fileoverview Tests for BearerTokenMiddleware personal-access-token (dtk_) support.
 *
 * Verifies the Phase 4 integration: a dtk_ token issued by the core auth service
 * authenticates as the owning user (with live roles), is not cached locally
 * (so revocation is immediate), and does not disturb the existing session-token
 * fallback for non-dtk_ tokens.
 */

'use strict';

const BearerTokenMiddleware = require('../../../src/wiki/auth/bearerTokenMiddleware');

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
}

function makeReq(token, authservice) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method: 'GET',
    path: '/applications/wiki/api/documents',
    app: { get: jest.fn((key) => (key === 'authservice' ? authservice : undefined)) }
  };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('BearerTokenMiddleware — dtk_ personal access tokens', () => {
  const DTK = 'dtk_' + 'a'.repeat(64);
  let logger;
  let mw;
  let next;

  beforeEach(() => {
    logger = makeLogger();
    mw = new BearerTokenMiddleware(logger).middleware();
    next = jest.fn();
  });

  test('authenticates as the owning user with live roles', async () => {
    const authservice = {
      validateApiToken: jest.fn().mockResolvedValue({
        email: 'alice@example.com',
        roles: ['user', 'Datasources Administrator'],
        user: { id: 'u-1', email: 'alice@example.com', fullName: 'Alice Example' },
        token: { id: 'tok_1' }
      }),
      validateSession: jest.fn()
    };
    const req = makeReq(DTK, authservice);

    await mw(req, makeRes(), next);

    expect(authservice.validateApiToken).toHaveBeenCalledWith(DTK);
    expect(authservice.validateSession).not.toHaveBeenCalled(); // dtk_ never falls back to session
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: 'u-1',
      username: 'alice@example.com',
      email: 'alice@example.com',
      name: 'Alice Example',
      roles: ['user', 'Datasources Administrator']
    });
    expect(req.isAuthenticated()).toBe(true);
  });

  test('does not cache the token locally (revocation is immediate)', async () => {
    const instance = new BearerTokenMiddleware(logger);
    const authservice = {
      validateApiToken: jest.fn().mockResolvedValue({
        email: 'bob@example.com',
        roles: ['user'],
        user: { id: 'u-2', email: 'bob@example.com', fullName: 'Bob' },
        token: { id: 'tok_2' }
      })
    };

    await instance.middleware()(makeReq(DTK, authservice), makeRes(), jest.fn());

    expect(instance.getTokenCount()).toBe(0);
  });

  test('passes through unauthenticated when the token is invalid/revoked/expired', async () => {
    const authservice = {
      validateApiToken: jest.fn().mockRejectedValue(new Error('Invalid API token'))
    };
    const req = makeReq(DTK, authservice);

    await mw(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('passes through when the auth service cannot validate API tokens', async () => {
    const req = makeReq(DTK, { /* no validateApiToken */ });

    await mw(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('non-dtk_ tokens still use the session fallback (no regression)', async () => {
    const sessionToken = 'f'.repeat(64);
    const authservice = {
      validateApiToken: jest.fn(),
      validateSession: jest.fn().mockResolvedValue({
        userId: 'u-9', username: 'carol@example.com', expiresAt: Date.now() + 3600_000
      })
    };
    const req = makeReq(sessionToken, authservice);

    await mw(req, makeRes(), next);

    expect(authservice.validateApiToken).not.toHaveBeenCalled();
    expect(authservice.validateSession).toHaveBeenCalledWith(sessionToken);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'u-9', username: 'carol@example.com', email: 'carol@example.com' });
  });
});
