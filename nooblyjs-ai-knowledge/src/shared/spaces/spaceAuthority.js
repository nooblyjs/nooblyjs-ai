/**
 * @fileoverview Who may READ and who may MANAGE a space RECORD.
 *
 * This is about the spaces.json entry itself — its name, brand, filing root and
 * path curation — not about the documents inside it (that is spaceVisibility.js)
 * and not about writing template files (that is wiki/components/spacePermissions.js).
 *
 * WHY IT EXISTS. The datasources spaces routes decided authority inline, from
 * two facts that are both empty in a real install:
 *
 *   const userRole = securityManager?.getUserRole(userEmail) || 'user';
 *   const isAdmin  = userRole === 'admin';
 *   const isCreator = space.createdBy === userId;
 *
 * `getUserRole` answers from `<APP_BASE_DIR>/data/security/admins.json`, a list
 * nothing populates — it is `[]` on this install, so `isAdmin` was false for
 * EVERY user including real administrators. And `createdBy` is the literal
 * string "system" on every space (spaces.json ships that way), so `isCreator`
 * was false for everyone too. The result: the whole Spaces admin UI answered
 * 403 to everybody, with "Access denied" and no indication of why.
 *
 * Meanwhile the wiki had already solved this. `wiki/components/spacePermissions.js`
 * says it outright — "the space schema has no per-space admin roster
 * (`createdBy` is typically the literal 'system'), so 'is this user an admin of
 * this space?' is *computed*" — and it computes it from the user record's own
 * `roles` array, which IS populated (`roles: ['admin']`). So the platform had
 * two parallel role systems and the datasources routes consulted the empty one.
 *
 * This module is the shared rule. It lives under shared/spaces (beside
 * contentRoot.js and spaceVisibility.js) rather than under wiki/, because the
 * datasources module must not reach into wiki internals.
 *
 * IDENTITY IS CHECKED AS A SET, NOT A SINGLE VALUE. The routes used
 * `req.user?.id || req.user?.email` and compared that ONE value against
 * `allowedUsers`, which holds EMAILS — so whenever a user record had an `id`,
 * the email list could never match and membership silently failed. Every check
 * here compares against every identity the user has.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-05
 */

'use strict';

/**
 * The user's roles, lowercased. Accepts both shapes the platform stores:
 * `roles: ['admin']` (authservice records) and a bare `role: 'admin'`.
 *
 * @param {Object} user
 * @return {Array<string>}
 */
function rolesOf(user) {
  if (!user) return [];
  const raw = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
  return raw.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
}

/**
 * Every string that identifies this user, lowercased and deduped — id, email
 * and username. `allowedUsers` and `createdBy` are written by hand and by three
 * different code paths, so which of these they hold is not predictable.
 *
 * @param {Object} user
 * @return {Array<string>}
 */
function identitiesOf(user) {
  if (!user) return [];
  const out = new Set();
  for (const value of [user.id, user.email, user.username]) {
    if (value == null) continue;
    const s = String(value).toLowerCase().trim();
    if (s) out.add(s);
  }
  return [...out];
}

/**
 * True when the user is a platform administrator.
 *
 * Consults BOTH sources, because either may be the populated one: the user
 * record's `roles` (what the wiki trusts, and what real installs have) and
 * SecurityManager's admins.json (what these routes used to check exclusively).
 *
 * @param {Object} user
 * @param {Object=} securityManager
 * @return {boolean}
 */
function isGlobalAdmin(user, securityManager) {
  if (!user) return false;
  if (rolesOf(user).includes('admin')) return true;

  if (securityManager && typeof securityManager.getUserRole === 'function') {
    for (const identity of identitiesOf(user)) {
      try {
        if (securityManager.getUserRole(identity) === 'admin') return true;
      } catch (_) { /* a broken roster must not deny a legitimate admin */ }
    }
  }
  return false;
}

/**
 * True when the user created the space. Compared across every identity, and
 * never satisfied by the placeholder "system" — that is the absence of a
 * creator, not a user who happens to be called system.
 *
 * @param {Object} user
 * @param {Object} space
 * @return {boolean}
 */
function isSpaceCreator(user, space) {
  if (!user || !space || !space.createdBy) return false;
  const creator = String(space.createdBy).toLowerCase().trim();
  if (!creator || creator === 'system') return false;
  return identitiesOf(user).includes(creator);
}

/**
 * True when the user is named on the space's allowedUsers list.
 *
 * @param {Object} user
 * @param {Object} space
 * @return {boolean}
 */
function isListedUser(user, space) {
  if (!space || !Array.isArray(space.allowedUsers)) return false;
  const identities = identitiesOf(user);
  return space.allowedUsers.some(
    (entry) => identities.includes(String(entry || '').toLowerCase().trim())
  );
}

/**
 * May the user VIEW this space record?
 *
 * Public spaces are readable by anyone, authenticated or not. Everything else
 * needs an authenticated user who is an admin, the creator, or on the list.
 *
 * @param {Object} user Authenticated user, or null.
 * @param {Object} space
 * @param {Object=} securityManager
 * @return {boolean}
 */
function canReadSpace(user, space, securityManager) {
  if (!space) return false;
  if (space.visibility === 'public') return true;
  if (!user) return false;
  return isGlobalAdmin(user, securityManager) || isSpaceCreator(user, space) || isListedUser(user, space);
}

/**
 * May the user CHANGE this space record — edit, delete, archive, restore?
 *
 * Deliberately stricter than reading: being listed on `allowedUsers` grants
 * access to the space's CONTENT, not the right to repoint its filing root or
 * rename it (which breaks every open tab — see spaces-json boot state). Only an
 * administrator or the creator may do that.
 *
 * Note this does NOT consider `permissions: 'read-only'`. That flag governs
 * writes to the space's DOCUMENTS; if it gated the record too, a space could
 * never be switched back to read-write.
 *
 * @param {Object} user
 * @param {Object} space
 * @param {Object=} securityManager
 * @return {boolean}
 */
function canManageSpace(user, space, securityManager) {
  if (!user || !space) return false;
  return isGlobalAdmin(user, securityManager) || isSpaceCreator(user, space);
}

/**
 * Why a decision went the way it did — for logging when a request is refused.
 * An "Access denied" with no reason is what made the original bug so opaque.
 *
 * @param {Object} user
 * @param {Object} space
 * @param {Object=} securityManager
 * @return {Object}
 */
function explain(user, space, securityManager) {
  return {
    identities: identitiesOf(user),
    roles: rolesOf(user),
    isGlobalAdmin: isGlobalAdmin(user, securityManager),
    isCreator: isSpaceCreator(user, space),
    isListedUser: isListedUser(user, space),
    spaceVisibility: space && space.visibility,
    spaceCreatedBy: space && space.createdBy
  };
}

module.exports = {
  rolesOf,
  identitiesOf,
  isGlobalAdmin,
  isSpaceCreator,
  isListedUser,
  canReadSpace,
  canManageSpace,
  explain
};
