/**
 * @fileoverview Single source of truth for user profile pictures ("avatars").
 *
 * Avatars live in <appBaseDir>/data/auth/images, keyed by a filesystem-safe form
 * of the user's email so any client can resolve one from an email alone (header
 * badge, comment avatars). This module owns the folder location, the email→key
 * reduction, and reading/writing the image + a small source marker.
 *
 * A picture can arrive two ways:
 *   - 'upload' — the user uploaded it via the profile screen (POST /profile/avatar)
 *   - 'entra'  — it was pulled from Microsoft Graph on Entra (Azure AD) sign-in
 *
 * We persist that provenance in a `<key>.source.json` marker next to the image so
 * an Entra refresh never clobbers a picture the user chose to upload themselves.
 * The marker is NOT one of the served image extensions, so it is invisible to the
 * public avatar endpoint.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

/**
 * Image extensions an avatar may be stored under, in resolution priority order.
 * @const {Array<string>}
 */
const AVATAR_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif'];

/**
 * Absolute path of the avatar images directory for a given app base dir.
 * @param {string} appBaseDir Base directory for application data.
 * @return {string}
 */
function imagesDir(appBaseDir) {
  return path.join(appBaseDir || path.join(process.cwd(), '.application'), 'data', 'auth', 'images');
}

/**
 * Reduces an email to the filesystem-safe key used for its avatar files. No
 * user-supplied path segments survive, so an email alone can never escape the
 * images directory.
 * @param {string} email
 * @return {string} Lowercased email with every non-alphanumeric char turned to '_'.
 */
function keyOf(email) {
  return String(email || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/**
 * Normalizes an extension to a lowercase, dot-prefixed form ('.png').
 * @param {string} ext
 * @return {string}
 */
function normalizeExt(ext) {
  const e = String(ext || '').toLowerCase();
  return e.startsWith('.') ? e : `.${e || 'png'}`;
}

/** Path of the provenance marker for a user's avatar. */
function markerPathFor(appBaseDir, email) {
  return path.join(imagesDir(appBaseDir), `${keyOf(email)}.source.json`);
}

/**
 * Reads the provenance marker, or null when none exists / is unreadable.
 * @return {Promise<?{source:string, ext?:string, etag?:string, updatedAt?:string}>}
 */
async function readMarker(appBaseDir, email) {
  try {
    return JSON.parse(await fs.readFile(markerPathFor(appBaseDir, email), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Writes/overwrites the provenance marker (stamps updatedAt). */
async function writeMarker(appBaseDir, email, marker) {
  if (!keyOf(email)) return;
  await fs.mkdir(imagesDir(appBaseDir), { recursive: true });
  const body = { ...marker, updatedAt: new Date().toISOString() };
  await fs.writeFile(markerPathFor(appBaseDir, email), JSON.stringify(body, null, 2));
}

/**
 * Returns the path of the user's stored avatar image, or null when none exists.
 * Resolves in AVATAR_EXTENSIONS order so the served picture is deterministic.
 * @return {Promise<?string>}
 */
async function resolveAvatarPath(appBaseDir, email) {
  const key = keyOf(email);
  if (!key) return null;
  for (const ext of AVATAR_EXTENSIONS) {
    const p = path.join(imagesDir(appBaseDir), `${key}${ext}`);
    try {
      await fs.access(p);
      return p;
    } catch (_) { /* try next extension */ }
  }
  return null;
}

/** Removes any avatar image stored under an extension other than keepExt. */
async function removeOtherExtensions(appBaseDir, email, keepExt) {
  const key = keyOf(email);
  if (!key) return;
  const keep = normalizeExt(keepExt);
  for (const ext of AVATAR_EXTENSIONS) {
    if (ext === keep) continue;
    try { await fs.unlink(path.join(imagesDir(appBaseDir), `${key}${ext}`)); } catch (_) { /* no stale file */ }
  }
}

/**
 * Writes avatar bytes for a user and records where they came from. Removes any
 * stale copies stored under other extensions so the email-based lookup never
 * resolves to an old image, exactly as the previous inline upload handler did.
 *
 * @param {string} appBaseDir Base directory for application data.
 * @param {string} email User's email (identity key).
 * @param {string} ext Desired image extension (e.g. '.png', 'jpg').
 * @param {Buffer} buffer Image bytes.
 * @param {('upload'|'entra')} source Provenance recorded in the marker.
 * @param {Object=} extra Extra marker fields (e.g. { etag }).
 * @return {Promise<string>} The normalized extension the image was written under.
 */
async function saveAvatar(appBaseDir, email, ext, buffer, source, extra = {}) {
  const key = keyOf(email);
  if (!key) throw new Error('saveAvatar: a valid email is required');
  const dir = imagesDir(appBaseDir);
  await fs.mkdir(dir, { recursive: true });

  const normExt = normalizeExt(ext);
  await fs.writeFile(path.join(dir, `${key}${normExt}`), buffer);
  await removeOtherExtensions(appBaseDir, email, normExt);
  await writeMarker(appBaseDir, email, { source, ext: normExt, ...extra });
  return normExt;
}

module.exports = {
  AVATAR_EXTENSIONS,
  imagesDir,
  keyOf,
  normalizeExt,
  markerPathFor,
  readMarker,
  writeMarker,
  resolveAvatarPath,
  removeOtherExtensions,
  saveAvatar
};
