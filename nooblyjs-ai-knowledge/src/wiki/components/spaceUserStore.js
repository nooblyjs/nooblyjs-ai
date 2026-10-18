/**
 * @fileoverview Space-scoped per-user store.
 *
 * Per-user activity is kept *inside the space it relates to*: each space's
 * content repo holds its own `.system/useractivity/<prefix>/` folder. This wraps
 * userStore.js — which already builds `<base>/.system/useractivity/<prefix>/<file>` —
 * by resolving the space's content directory and passing it as the base.
 *
 *   <space.path>/.system/useractivity/<prefix>/{activity,pins,content,chathistory,
 *                                        subscriptions,notifications,...}.json
 *                                       /dashboard.md
 *
 * (Profile preferences are NOT space-scoped — they stay global in
 * <appBaseDir>/.system/useractivity/<prefix>/preferences.json via userStore directly.)
 *
 * Space content dirs come from <appBaseDir>/spaces/spaces.json (`space.path`,
 * documentRoutes/likesRoutes/etc.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const userStore = require('./userStore');

/** Space used when a request carries no space (older callers / fallback). */
const DEFAULT_SPACE_ID = 1;

async function loadSpaces(appBaseDir) {
    const spacesPath = path.join(
        appBaseDir || path.join(process.cwd(), '.application'),
        'spaces', 'spaces.json'
    );
    const parsed = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
}

/** Absolute content directory for a space record (relative paths resolve against cwd, as elsewhere). */
function spaceContentDir(space) {
    const p = space && (space.path || space.configuration?.filing?.baseDir);
    if (!p) return null;
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/**
 * Resolve a space (by name or id) to its RECORD. Falls back to the default
 * space when the identifier is missing/unknown so callers that don't yet pass a
 * space don't fail outright.
 *
 * Exposed as well as resolveSpaceDir because callers increasingly need the
 * record itself, not just the directory: per-user artefacts are scoped by the
 * space's `allowedPaths`/`excludedPaths` rather than by a name stamp (see
 * components/userArtifacts.js), and that needs the whole record.
 *
 * @param {string} appBaseDir
 * @param {string|number} spaceNameOrId
 * @return {Promise<Object>} space record
 */
async function resolveSpace(appBaseDir, spaceNameOrId) {
    const spaces = await loadSpaces(appBaseDir);
    let space = null;
    if (spaceNameOrId != null && spaceNameOrId !== '') {
        const key = String(spaceNameOrId);
        space = spaces.find(s => s.name === spaceNameOrId)
            || spaces.find(s => String(s.id) === key);
    }
    if (!space) {
        space = spaces.find(s => String(s.id) === String(DEFAULT_SPACE_ID)) || spaces[0];
    }
    if (!space) throw new Error('No spaces configured');
    return space;
}

/**
 * Resolve a space (by name or id) to its absolute content directory.
 */
async function resolveSpaceDir(appBaseDir, spaceNameOrId) {
    const space = await resolveSpace(appBaseDir, spaceNameOrId);
    const dir = spaceContentDir(space);
    if (!dir) throw new Error(`Space "${space.name}" has no content path`);
    return dir;
}

async function readJson(appBaseDir, space, identity, fileName, fallback = null) {
    return userStore.readJson(await resolveSpaceDir(appBaseDir, space), identity, fileName, fallback);
}

async function writeJson(appBaseDir, space, identity, fileName, data) {
    return userStore.writeJson(await resolveSpaceDir(appBaseDir, space), identity, fileName, data);
}

async function readText(appBaseDir, space, identity, fileName, fallback = null) {
    return userStore.readText(await resolveSpaceDir(appBaseDir, space), identity, fileName, fallback);
}

async function writeText(appBaseDir, space, identity, fileName, text) {
    return userStore.writeText(await resolveSpaceDir(appBaseDir, space), identity, fileName, text);
}

/** Resolve the "current space" identifier from a request (query or body). */
function spaceOf(req) {
    const q = req.query || {};
    const b = req.body || {};
    return q.space || q.spaceName || q.spaceId
        || b.spaceName || b.space || b.spaceId
        || (b.context && (b.context.spaceName || b.context.space)) // e.g. AI chat sends
        || null;
}

module.exports = {
    DEFAULT_SPACE_ID,
    loadSpaces,
    spaceContentDir,
    resolveSpace,
    resolveSpaceDir,
    readJson,
    writeJson,
    readText,
    writeText,
    spaceOf
};
