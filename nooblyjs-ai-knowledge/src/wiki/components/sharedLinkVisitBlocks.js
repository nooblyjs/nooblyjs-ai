/**
 * @fileoverview Inline shared-link-visit block helpers.
 *
 * A document's deep-link audit trail lives inline in its markdown, inside a
 * SINGLE rolling fenced ```SharedLinkVisits``` block at EOF, one line per
 * visit:
 *
 *   ```SharedLinkVisits
 *   2026-07-22T17:43:51.769Z  someone@example.com  (sharedBy: (direct))
 *   2026-07-22T17:45:15.712Z  someone@example.com  (sharedBy: teams)
 *   ```
 *
 * "Single" is the intent, not a guarantee. A wholesale rewrite by a content
 * workflow, a hand edit, or a merge of two checkouts leaves EXTRA blocks
 * behind, and the reader then sees a stack of identical collapsed "Shared
 * link visits" strips instead of one audit trail — while the duplicated
 * entries feed the search index and AI context as noise.
 *
 * So the writer coalesces rather than appends: every block in the document is
 * folded into one at the position of the first, entries de-duplicated on the
 * whole line. Matching is case-insensitive and CRLF-tolerant because these
 * blocks are written by the backend but EDITED by anything (the content roots
 * are Windows git checkouts) — and a block that fails to match is a block that
 * gets duplicated rather than updated, which is the very failure this exists
 * to stop.
 *
 * The render side merges too (`coalesceSharedLinkVisits` in the browser
 * parser): a page must read correctly while duplicates are still on disk, and
 * a document nothing has written to since is never healed here at all.
 *
 * This module is pure (no I/O) so the parsing/mutation logic is unit-testable
 * in isolation — the same shape as components/reviewBlocks.js.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-24
 */

'use strict';

/**
 * Matches EVERY SharedLinkVisits block; capture group 1 is the body.
 *
 * `g` so all blocks are found, `i` because the fence label has been written
 * both cased and lower-cased, `m` so `^`/`$` anchor the fence lines (which
 * keeps an indented ``` inside some other construct from closing it early).
 * Stateful — callers must reset `lastIndex` between passes.
 */
const BLOCK_RE = /^[ \t]*```SharedLinkVisits[ \t]*\r?\n([\s\S]*?)\r?\n?^[ \t]*```[ \t]*$/gim;

/** @returns {RegExp} A fresh, unshared matcher (BLOCK_RE is stateful). */
function blockMatcher() {
    return new RegExp(BLOCK_RE.source, BLOCK_RE.flags);
}

/**
 * Read every visit line in the document, oldest block first, de-duplicated.
 *
 * @param {string} content Full markdown document.
 * @returns {{entries: string[], blocks: number, firstAt: number}}
 *   `entries` de-duplicated visit lines in document order; `blocks` how many
 *   blocks were found; `firstAt` character offset of the first (-1 if none).
 */
function readVisits(content) {
    const re = blockMatcher();
    const entries = [];
    const seen = new Set();
    let blocks = 0;
    let firstAt = -1;
    let match;

    while ((match = re.exec(String(content || ''))) !== null) {
        if (firstAt === -1) firstAt = match.index;
        blocks++;
        for (const raw of String(match[1] || '').split(/\r?\n/)) {
            const entry = raw.trim();
            if (!entry || seen.has(entry)) continue;
            seen.add(entry);
            entries.push(entry);
        }
    }

    return { entries, blocks, firstAt };
}

/**
 * Add a visit line to a document, collapsing any existing blocks into one.
 *
 * Also the repair path: called with `line` omitted it merges duplicates and
 * changes nothing else, so a document can be healed without recording a visit.
 *
 * @param {string} content Full markdown document.
 * @param {string} [line] The visit line to record. Ignored if already present.
 * @returns {{content: string, merged: number, added: boolean}}
 *   `merged` is how many SURPLUS blocks were folded away (0 = nothing to fix).
 */
function recordVisit(content, line) {
    const source = String(content || '');
    const { entries, blocks, firstAt } = readVisits(source);

    const entry = typeof line === 'string' ? line.trim() : '';
    const added = Boolean(entry) && !entries.includes(entry);
    if (added) entries.push(entry);

    // Nothing to record and nothing to repair — hand back the original bytes
    // rather than a re-serialised near-copy, so a no-op write stays a no-op.
    if (!added && blocks <= 1) {
        return { content: source, merged: 0, added: false };
    }

    const rebuilt = '```SharedLinkVisits\n' + entries.join('\n') + '\n```';

    if (firstAt === -1) {
        const sep = source.length === 0
            ? ''
            : (source.endsWith('\n\n') ? '' : (source.endsWith('\n') ? '\n' : '\n\n'));
        return { content: source + sep + rebuilt + '\n', merged: 0, added };
    }

    // Reinstate the merged block where the first one was; drop the rest.
    let index = 0;
    let updated = source.replace(blockMatcher(), () => (index++ === 0 ? rebuilt : ''));
    // Removing the later blocks leaves behind the blank lines that separated
    // them, which would otherwise accumulate at EOF on every visit.
    updated = updated.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');

    return { content: updated, merged: Math.max(0, blocks - 1), added };
}

module.exports = {
    BLOCK_RE,
    blockMatcher,
    readVisits,
    recordVisit
};
