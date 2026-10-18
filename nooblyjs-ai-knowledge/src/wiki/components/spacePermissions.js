/**
 * @fileoverview Per-space authority + template write-access helpers.
 *
 * The space schema (`.application/spaces/spaces.json`) has no per-space admin
 * roster (`createdBy` is typically the literal "system"), so "is this user an
 * admin of this space?" is *computed* from the data that does exist: space
 * visibility/permissions, the `allowedUsers` email list, the creator email, and
 * the user's global role array. This module is the single source of truth for
 * that rule — if a real per-space admins list is added later, only this file
 * changes.
 *
 * Three template tiers depend on these checks:
 *   - Space-level (root) templates  — `<space>/.system/templates/`,
 *     `<space>/.system/continuous-explorations/.templates/` — only a space admin may write.
 *     These reach every folder in the space, so they stay the guarded tier.
 *   - Folder templates — `<space>/<folder>/.system/templates/` — writable by anyone
 *     who may write that folder. A folder template is folder CONTENT: its blast
 *     radius is the subtree that inherits it, and the person who owns that subtree
 *     is the person who should be able to seed it. Gating these behind space admin
 *     would leave the tier unusable by the teams it exists for.
 *   - Personal templates — `<space>/.system/useractivity/<prefix>/templates/`,
 *     `<space>/.system/useractivity/<prefix>/continuousexploration/` — only the owner
 *     (the `<prefix>` = email local-part) may write.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-12
 */

'use strict';

const userStore = require('./userStore');

/** Normalise a user's roles to a lowercased string array. */
function rolesOf(user) {
  if (!user) return [];
  const raw = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
  return raw.map(r => String(r).toLowerCase());
}

/** True when the user can see/use the space (not the same as being able to manage it). */
function isSpaceMember(user, space) {
  if (!space) return false;
  if (space.visibility === 'public') return true;
  if (space.visibility === 'team') return true;
  const email = user && user.email;
  if (email && Array.isArray(space.allowedUsers) && space.allowedUsers.includes(email)) return true;
  return false;
}

/**
 * True when the user may create/edit/delete the space's ROOT (space-level)
 * templates. Computed: the space is writable, the user belongs to it, AND they
 * are either the space creator or carry the global 'admin' role. This keeps the
 * authority "per-space" — a global admin can only manage spaces they belong to.
 */
function isSpaceAdmin(user, space) {
  if (!user || !space) return false;
  if (space.permissions === 'read-only') return false;
  if (!isSpaceMember(user, space)) return false;
  const email = user.email;
  if (email && space.createdBy && space.createdBy === email) return true;
  return rolesOf(user).includes('admin');
}

/**
 * Decide whether a document write (create/edit/delete) to `relPath` inside
 * `space` is permitted for `user`. Only template paths are gated; every other
 * path returns allowed (callers keep their existing behaviour for normal docs).
 *
 *   .system/templates/…                          → space-level: requires isSpaceAdmin
 *   <folder>/.system/templates/…                  → folder:      same rights as the folder
 *   .system/useractivity/<prefix>/templates/…     → personal:    requires prefix === own
 *
 * @returns {{allowed: boolean, reason?: string}}
 */
function templateWriteCheck(user, space, relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');

  if (norm.startsWith('.system/templates/')) {
    return isSpaceAdmin(user, space)
      ? { allowed: true }
      : { allowed: false, reason: 'Only a space administrator can modify space-level templates.' };
  }

  // Folder templates carry the rights of the folder they sit in, so this gate adds
  // nothing beyond the write check the caller already performed for the document
  // path. Stated explicitly rather than left to the permissive default below, so
  // that tightening that default later cannot silently lock the tier out.
  if (/^.+\/\.system\/templates\//.test(norm)) {
    return space && space.permissions === 'read-only'
      ? { allowed: false, reason: 'This space is read-only.' }
      : { allowed: true };
  }

  const personal = norm.match(/^\.system\/useractivity\/([^/]+)\/templates\//);
  if (personal) {
    const owner = personal[1];
    const mine = user && user.email ? userStore.userDir(user.email) : null;
    return owner && owner === mine
      ? { allowed: true }
      : { allowed: false, reason: 'You can only modify your own personal templates.' };
  }

  return { allowed: true };
}

module.exports = {
  rolesOf,
  isSpaceMember,
  isSpaceAdmin,
  templateWriteCheck,
  userDir: userStore.userDir
};
