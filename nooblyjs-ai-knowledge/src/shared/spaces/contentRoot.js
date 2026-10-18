/**
 * @fileoverview A space's CONTENT ROOT — the directory its documents live in.
 *
 * A space is a LENS over a directory, not an owner of one. Four of this
 * install's spaces (Engineering, Financial Services, People, Retail) are all
 * rooted at `knowledge-content/engineering` and differ only in the
 * `allowedPaths`/`excludedPaths` slice they show (see spaceVisibility.js). So
 * "which space is this document in?" has no single answer — but "which
 * directory did it come from?" always does, and that is what identifies content.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. The same normalisation was written out
 * three times — `documentService._contentRoot`, `searchIndexer._contentRootKey`
 * and, once the search scoping below was fixed, the search route — and all
 * three must agree or the disagreement is silent. The search route decides
 * which hits belong to the requested space, and the indexer decides which space
 * NAME gets stamped on those hits at index time: if their idea of "same root"
 * ever differs by a trailing slash or a letter case, the route filters out
 * everything the indexer wrote and the space looks empty.
 *
 * That failure was live: `?spaceId=1` (Engineering Space) matched nothing,
 * because the indexer walks each content root ONCE and stamps every document
 * with the LAST space on that root — Retail — while the route kept only hits
 * stamped with the requested space's own name. Three of the four spaces
 * therefore returned zero results for every query. Scoping by root instead of
 * by name is what makes one index serve every lens on it.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-04
 */

'use strict';

const path = require('node:path');

/**
 * Stable key for the directory a space's documents live in.
 *
 * Case-insensitive and trailing-separator-insensitive because the content lives
 * on Windows, where `C:\x\Content` and `c:/x/content/` are one directory. Two
 * spaces that spell the same root differently simply fail to group, which costs
 * a redundant walk rather than returning anything wrong.
 *
 * A space with NO path gets a key unique to itself (`space:<id>`) rather than a
 * shared empty string — otherwise every misconfigured space would collapse into
 * one group and appear to share content.
 *
 * @param {Object} space Space record.
 * @return {string} Normalised key; never empty.
 */
function contentRootKey(space) {
    const raw = (space && (space.path || space.configuration?.filing?.baseDir)) || '';
    if (!raw) return `space:${space && space.id}`;
    return path.normalize(String(raw)).replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Every space that reads from the same directory as `space` — including
 * `space` itself.
 *
 * @param {Object} space The space whose root defines the group.
 * @param {Array<Object>} spaces All known spaces.
 * @return {Array<Object>} Members of the group (at least `space`).
 */
function spacesSharingRoot(space, spaces) {
    if (!space) return [];
    const key = contentRootKey(space);
    const members = (spaces || []).filter(candidate => contentRootKey(candidate) === key);
    return members.length > 0 ? members : [space];
}

/**
 * The set of space NAMES that identify content on the same roots as
 * `requested` — i.e. every name the index could plausibly have stamped on a
 * document those spaces can see.
 *
 * Returns an empty Set when nothing was requested, which callers read as "no
 * space filter" rather than "match nothing".
 *
 * @param {Array<Object>} requested Spaces the caller asked for.
 * @param {Array<Object>} spaces All known spaces.
 * @return {Set<string>} Space names, in the records' own spelling.
 */
function equivalentSpaceNames(requested, spaces) {
    const names = new Set();
    for (const space of requested || []) {
        for (const member of spacesSharingRoot(space, spaces)) {
            if (member && member.name) names.add(member.name);
        }
    }
    return names;
}

module.exports = { contentRootKey, spacesSharingRoot, equivalentSpaceNames };
