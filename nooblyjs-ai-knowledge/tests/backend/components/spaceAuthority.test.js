'use strict';

/**
 * Who may read and who may manage a space RECORD.
 *
 * The Spaces admin UI answered 403 to everybody, with "Access denied" and no
 * reason. Neither of the two facts the routes decided on is populated in a real
 * install:
 *
 *   - `securityManager.getUserRole(email)` reads
 *     `<APP_BASE_DIR>/data/security/admins.json`, which nothing writes — it is
 *     `[]` here, so `isAdmin` was false for every user INCLUDING real
 *     administrators, whose role lives on the authservice user record
 *     (`roles: ['admin']`) that the wiki already trusts;
 *   - `space.createdBy` is the literal string "system" on every space, so
 *     `isCreator` was false for everyone.
 *
 * A third bug hid underneath: `req.user?.id || req.user?.email` produced ONE
 * identity, compared against `allowedUsers`, which holds EMAILS — so as soon as
 * a user record had an `id`, list membership could never match either.
 *
 * These tests are written against the shapes actually on disk in this install.
 */

const auth = require('../../../src/shared/spaces/spaceAuthority');

/** The real admin record from <APP_BASE_DIR>/data/auth/users.json. */
const ADMIN_USER = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  email: 'srbooysen@example.com',
  name: 'Stephen Booysen',
  roles: ['admin']
};

/** A user with no elevated role. */
const PLAIN_USER = { id: 'u-2', email: 'someone@example.com', roles: ['user'] };

/** The real Engineering Space record from <APP_BASE_DIR>/spaces/spaces.json. */
const ENGINEERING_SPACE = {
  id: 1,
  name: 'Engineering Space',
  visibility: 'team',
  permissions: 'read-write',
  allowedUsers: ['srbooysen@example.com'],
  createdBy: 'system'
};

/** SecurityManager as it actually behaves here: an empty roster. */
const EMPTY_SECURITY = { getUserRole: () => null };

describe('the outage: an admin refused by both checks', () => {
  test('the real admin CAN read the real space', () => {
    expect(auth.canReadSpace(ADMIN_USER, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(true);
  });

  test('the real admin CAN manage the real space', () => {
    expect(auth.canManageSpace(ADMIN_USER, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(true);
  });

  test('an empty admins.json no longer strips the admin role', () => {
    // The role is on the user record; the roster is only a second source.
    expect(auth.isGlobalAdmin(ADMIN_USER, EMPTY_SECURITY)).toBe(true);
    expect(auth.isGlobalAdmin(ADMIN_USER, undefined)).toBe(true);
  });

  test('"system" is the ABSENCE of a creator, not a user', () => {
    // Otherwise a user literally named system would inherit every space.
    expect(auth.isSpaceCreator({ email: 'system' }, ENGINEERING_SPACE)).toBe(false);
    expect(auth.isSpaceCreator(ADMIN_USER, ENGINEERING_SPACE)).toBe(false);
  });

  test('list membership matches on EMAIL even when the user has an id', () => {
    // The old code collapsed identity to `id || email` and compared that one
    // value against a list of emails, so an id always lost.
    expect(auth.isListedUser(ADMIN_USER, ENGINEERING_SPACE)).toBe(true);
  });
});

describe('canReadSpace', () => {
  test('public spaces are readable without authentication', () => {
    expect(auth.canReadSpace(null, { visibility: 'public' }, EMPTY_SECURITY)).toBe(true);
  });

  test('non-public spaces are not readable without authentication', () => {
    expect(auth.canReadSpace(null, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(false);
  });

  test('a listed user may read', () => {
    const listed = { id: 'x', email: 'srbooysen@example.com', roles: ['user'] };
    expect(auth.canReadSpace(listed, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(true);
  });

  test('an unrelated user may not read', () => {
    expect(auth.canReadSpace(PLAIN_USER, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(false);
  });

  test('the creator may read', () => {
    const space = Object.assign({}, ENGINEERING_SPACE, { createdBy: 'owner@example.com' });
    const owner = { email: 'owner@example.com', roles: [] };
    expect(auth.canReadSpace(owner, space, EMPTY_SECURITY)).toBe(true);
  });
});

describe('canManageSpace is stricter than reading', () => {
  test('being on allowedUsers does NOT grant management', () => {
    // Membership grants access to the space's CONTENT. Repointing its filing
    // root or renaming it — which breaks every open tab — is a different right.
    const listed = { id: 'x', email: 'srbooysen@example.com', roles: ['user'] };
    expect(auth.canReadSpace(listed, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(true);
    expect(auth.canManageSpace(listed, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(false);
  });

  test('an admin may manage', () => {
    expect(auth.canManageSpace(ADMIN_USER, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(true);
  });

  test('the creator may manage, without any role', () => {
    const space = Object.assign({}, ENGINEERING_SPACE, { createdBy: 'owner@example.com' });
    const owner = { id: 'o-1', email: 'owner@example.com', roles: [] };
    expect(auth.canManageSpace(owner, space, EMPTY_SECURITY)).toBe(true);
  });

  test('an unauthenticated request may never manage', () => {
    expect(auth.canManageSpace(null, ENGINEERING_SPACE, EMPTY_SECURITY)).toBe(false);
  });

  test('a read-only space is still manageable — the flag governs DOCUMENTS', () => {
    // If it gated the record too, a space could never be switched back.
    const readOnly = Object.assign({}, ENGINEERING_SPACE, { permissions: 'read-only' });
    expect(auth.canManageSpace(ADMIN_USER, readOnly, EMPTY_SECURITY)).toBe(true);
  });
});

describe('role and identity normalisation', () => {
  test('accepts both roles: [] and a bare role string', () => {
    expect(auth.rolesOf({ roles: ['Admin'] })).toEqual(['admin']);
    expect(auth.rolesOf({ role: 'ADMIN' })).toEqual(['admin']);
    expect(auth.rolesOf({})).toEqual([]);
    expect(auth.rolesOf(null)).toEqual([]);
  });

  test('collects id, email and username, lowercased and deduped', () => {
    const ids = auth.identitiesOf({ id: 'A', email: 'B@x.com', username: 'a' });
    expect(ids).toEqual(['a', 'b@x.com']);
  });

  test('matching is case-insensitive on both sides', () => {
    const space = { visibility: 'team', allowedUsers: ['SRBooysen@Example.com'] };
    expect(auth.isListedUser(ADMIN_USER, space)).toBe(true);
  });

  test('the SecurityManager roster still works when it IS populated', () => {
    const roster = { getUserRole: (e) => (e === 'someone@example.com' ? 'admin' : null) };
    expect(auth.isGlobalAdmin(PLAIN_USER, roster)).toBe(true);
  });

  test('a throwing roster does not deny a legitimate admin', () => {
    const broken = { getUserRole: () => { throw new Error('roster unreadable'); } };
    expect(auth.isGlobalAdmin(ADMIN_USER, broken)).toBe(true);
    expect(() => auth.isGlobalAdmin(PLAIN_USER, broken)).not.toThrow();
  });
});

describe('explain() makes a refusal diagnosable', () => {
  test('reports every input to the decision', () => {
    const why = auth.explain(PLAIN_USER, ENGINEERING_SPACE, EMPTY_SECURITY);
    expect(why).toMatchObject({
      isGlobalAdmin: false,
      isCreator: false,
      isListedUser: false,
      spaceVisibility: 'team',
      spaceCreatedBy: 'system'
    });
    expect(why.identities).toContain('someone@example.com');
  });
});

describe('the routes use the shared rule, not their own copy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routes = fs.readFileSync(
    path.resolve(__dirname, '../../../src/datasources/routes/spacesRoutes.js'), 'utf8');

  test('no route re-derives admin status inline', () => {
    // Three separate inline copies is how this drifted from the wiki's model.
    expect(routes).not.toMatch(/getUserRole\(userEmail\)\s*\|\|\s*'user'/);
    expect(routes).not.toMatch(/const isCreator = space\.createdBy === userId/);
  });

  test('read and manage decisions both come from spaceAuthority', () => {
    expect(routes).toContain('spaceAuthority.canReadSpace');
    expect(routes).toContain('spaceAuthority.canManageSpace');
  });

  test('every refusal logs why', () => {
    const explains = routes.match(/spaceAuthority\.explain\(/g) || [];
    expect(explains.length).toBeGreaterThanOrEqual(3); // GET, PUT, DELETE
  });
});
