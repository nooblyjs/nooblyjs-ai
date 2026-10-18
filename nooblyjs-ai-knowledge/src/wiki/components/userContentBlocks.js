/**
 * @fileoverview Inline user-content block helpers.
 *
 * "Add Content" lets any authenticated user contribute prose *into* a document
 * without editing it — the same "contribution, not edit" model as annotations
 * (see annotationBlocks.js), but rendered as ordinary body text rather than a
 * highlighted callout. This is what lets people add to system-owned documents
 * (owner: system) whose Blocks/Markdown/Visualise editor tabs are hidden.
 *
 * Each contribution is its own fenced ```user-content``` block placed adjacent
 * to the content it was added against:
 *
 *   ```user-content
 *   Target: text | quote="the sentence they clicked" | before="…" | after="…"
 *   Content: The added prose. May span
 *   multiple lines and contain markdown.
 *   Author: user@example.com
 *   Date: 2026-07-12 14:30
 *   Id: a1b2c3d4
 *   ```
 *
 * The `Target` descriptor — not the block's line position — is the durable
 * anchor: when a workflow regenerates the document wholesale, `preserveUserContent`
 * re-resolves each target against the new content and re-inserts the block beside
 * it (or parks it as an orphan when the anchored content is gone). The anchoring
 * primitives (parseTarget / buildTarget / resolveTarget) are shared verbatim with
 * annotationBlocks.js so both contribution types behave identically.
 *
 * Pure (no I/O) so the anchoring logic is unit-testable in isolation.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-12
 */

'use strict';

const {
    nowStamp,
    newId,
    parseTarget,
    buildTarget,
    resolveTarget
} = require('./annotationBlocks');

/** Matches a single user-content block; capture group 1 is the body. */
const USER_CONTENT_BLOCK_RE = /```user-content[ \t]*\n([\s\S]*?)\n```/g;

// ----------------------------------------------------------------------------
// Block: parse / build / remove / update
// ----------------------------------------------------------------------------

/**
 * Parse a single user-content block body into a structured entry. The Content
 * field can span multiple lines until the next known field is reached.
 * @param {string} body
 * @returns {Object} { target, targetRaw, content, author, date, id }
 */
function parseUserContentBody(body) {
    let targetRaw = '', content = null, author = '', date = '', id = '', collecting = false;
    for (const line of String(body || '').split(/\r?\n/)) {
        const mt = line.match(/^Target:\s?(.*)$/);
        const mc = line.match(/^Content:\s?(.*)$/);
        const mu = line.match(/^Author:\s?(.*)$/);
        const md = line.match(/^Date:\s?(.*)$/);
        const mi = line.match(/^Id:\s?(.*)$/);
        if (mt) { targetRaw = mt[1].trim(); collecting = false; }
        else if (mc) { content = mc[1]; collecting = true; }
        else if (mu) { author = mu[1].trim(); collecting = false; }
        else if (md) { date = md[1].trim(); collecting = false; }
        else if (mi) { id = mi[1].trim(); collecting = false; }
        else if (collecting && content !== null) { content += '\n' + line; }
    }
    return {
        targetRaw,
        target: parseTarget(targetRaw),
        content: (content || '').trim(),
        author,
        date,
        id
    };
}

/**
 * Find every user-content block in a document.
 * @param {string} content
 * @returns {Array<Object>} entries with an extra `block` (the full fenced text)
 */
function parseUserContentBlocks(content) {
    const out = [];
    const re = new RegExp(USER_CONTENT_BLOCK_RE.source, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
        const entry = parseUserContentBody(m[1]);
        entry.block = m[0];
        out.push(entry);
    }
    return out;
}

/**
 * Build a fenced user-content block from an entry. Missing id/date are filled in.
 * @param {Object} entry { target|targetRaw, content, author, date, id }
 * @returns {string}
 */
function buildUserContentBlock(entry) {
    const targetRaw = entry.targetRaw || buildTarget(entry.target || { kind: 'text' });
    return [
        '```user-content',
        `Target: ${targetRaw}`,
        `Content: ${String(entry.content || '').replace(/\r/g, '').trim()}`,
        `Author: ${(entry.author || 'unknown').trim()}`,
        `Date: ${entry.date || nowStamp()}`,
        `Id: ${entry.id || newId()}`,
        '```'
    ].join('\n');
}

/**
 * Remove the user-content block with the given id. Returns the updated content,
 * or null when no block with that id was found.
 * @param {string} content
 * @param {string} id
 * @returns {string|null}
 */
function removeUserContentById(content, id) {
    const re = new RegExp(USER_CONTENT_BLOCK_RE.source, 'g');
    let found = false;
    const updated = content.replace(re, (block, body) => {
        if (!found && parseUserContentBody(body).id === id) {
            found = true;
            return '';
        }
        return block;
    });
    if (!found) return null;
    return updated.replace(/\n{3,}/g, '\n\n');
}

/** True when a block with this id already exists in content. */
function hasUserContentId(content, id) {
    return parseUserContentBlocks(content).some(e => e.id === id);
}

/**
 * Find a single user-content entry by id (or null). Includes `block`.
 * @param {string} content
 * @param {string} id
 * @returns {Object|null}
 */
function findUserContentById(content, id) {
    return parseUserContentBlocks(content).find(e => e.id === id) || null;
}

/**
 * Replace the prose of an existing block in place, keeping its target/author/id.
 * Returns updated content, or null if not found.
 * @param {string} content
 * @param {string} id
 * @param {{ content: string, date?: string }} fields
 * @returns {string|null}
 */
function updateUserContentById(content, id, fields) {
    const entry = findUserContentById(content, id);
    if (!entry) return null;
    const rebuilt = buildUserContentBlock({
        targetRaw: entry.targetRaw,
        content: fields.content != null ? fields.content : entry.content,
        author: entry.author,
        date: fields.date || entry.date,
        id: entry.id
    });
    return content.replace(entry.block, rebuilt);
}

// ----------------------------------------------------------------------------
// Insertion + durability
// ----------------------------------------------------------------------------

/**
 * Insert a user-content block adjacent to its resolved target. When the target
 * can't be resolved the block is appended at the end of the document.
 * @param {string} content
 * @param {Object} entry (target may be object or targetRaw)
 * @returns {{ content: string, resolved: boolean, block: string, id: string }}
 */
function insertUserContent(content, entry) {
    const target = entry.target || parseTarget(entry.targetRaw || '');
    const id = entry.id || newId();
    const block = buildUserContentBlock({ ...entry, target, id });

    const at = resolveTarget(content, target);
    if (at === -1) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        return { content: `${content}${trailing}\n${block}\n`, resolved: false, block, id };
    }
    const before = content.slice(0, at);
    const after = content.slice(at);
    return { content: `${before}\n\n${block}${after}`, resolved: true, block, id };
}

const ORPHAN_HEADING = '## Added content needing re-anchoring';

/**
 * Carry user contributions from an old document version into a freshly-generated
 * one. Blocks already present in `newContent` (matched by Id) are left as-is; the
 * rest are re-inserted at their resolved target, or parked under an orphan
 * heading when the target no longer exists.
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ content: string, reanchored: Array, orphaned: Array }}
 */
function preserveUserContent(oldContent, newContent) {
    const existing = parseUserContentBlocks(oldContent);
    let content = newContent;
    const reanchored = [];
    const orphaned = [];

    for (const entry of existing) {
        if (entry.id && hasUserContentId(content, entry.id)) continue; // already carried over
        const at = resolveTarget(content, entry.target);
        if (at !== -1) {
            content = insertUserContent(content, entry).content;
            reanchored.push(entry);
        } else {
            orphaned.push(entry);
        }
    }

    if (orphaned.length) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        const blocks = orphaned.map(e => buildUserContentBlock(e)).join('\n\n');
        content = `${content}${trailing}\n${ORPHAN_HEADING}\n\n${blocks}\n`;
    }

    return { content, reanchored, orphaned };
}

module.exports = {
    USER_CONTENT_BLOCK_RE,
    parseUserContentBody,
    parseUserContentBlocks,
    buildUserContentBlock,
    removeUserContentById,
    hasUserContentId,
    findUserContentById,
    updateUserContentById,
    insertUserContent,
    preserveUserContent,
    ORPHAN_HEADING
};
