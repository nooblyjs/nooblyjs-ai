/**
 * @fileoverview Inline linked-document block helpers.
 *
 * A page's explicit relationships to other wiki content live inline in its
 * markdown, inside a single consolidated fenced ```linked-documents``` block
 * (one block per document, like ```reviews```), holding one entry per link:
 *
 *   ```linked-documents
 *   title: Related landscapes
 *   across: 4
 *    - [Engineering Space]/Solution Design/Application Landscapes
 *    - Sell/Promotions/overview.md | Promotions overview
 *   ```
 *
 * An entry is a REFERENCE, optionally followed by ` | Display label`:
 * `[Space Name]/space/relative/path` for content in another space, or a bare
 * space-relative path for content in the host document's own space. It may
 * point at a document OR a folder — the whole point of the feature is showing
 * how things relate, and a folder is as often the related thing as a file.
 *
 * WHY THE LINKS LIVE IN THE MARKDOWN and not in a sidecar index: path is
 * identity in this wiki, and the documents are the artefact that gets cloned,
 * versioned and read outside the app. A relationship stored beside the prose
 * travels with it into git, survives a restore from backup, and is visible to
 * anyone reading the raw file. A separate index would silently desynchronise
 * the first time a folder was moved on disk.
 *
 * The block is deliberately tolerant on read: `extras` collects any line this
 * module did not understand and {@link buildLinkedDocumentsBlock} writes them
 * back verbatim, so a hand-authored line is never eaten by a UI round-trip.
 *
 * This module is pure (no I/O) so the parsing/mutation logic is unit-testable
 * in isolation — the same shape as components/reviewBlocks.js. It mirrors the
 * client-side `MarkdownParser.parseLinkedDocuments`; the two grammars MUST
 * stay in step or a block renders one way and edits another.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-21
 */

'use strict';

/**
 * Matches the (single) linked-documents block. Capture group 1 is the body,
 * which may be empty — the closing alternation tries the empty-body case
 * first, because a lazy `[\s\S]*?` alone overshoots the closing fence of a
 * block that has no lines between its fences.
 */
const LINKED_DOCS_BLOCK_RE = /```linked-documents[ \t]*\r?\n(?:```|([\s\S]*?)\r?\n```)[ \t]*/;

/**
 * Fenced blocks that are page FURNITURE — they belong at the very bottom of a
 * document, below its content. A linked-documents block appended to a document
 * that has them is inserted above them, so the relationship band reads as part
 * of the page rather than as a footnote under the comment thread.
 */
const TRAILING_FURNITURE_RE = /\n*```(?:comments|sharedlinkvisits|liked|reviews)\b[^\n]*\r?\n(?:```|[\s\S]*?\r?\n```)[ \t]*/i;

/** Default section heading when the block declares no `title:`. */
const DEFAULT_TITLE = 'Linked documents';

// ----------------------------------------------------------------------------
// Reference normalisation
// ----------------------------------------------------------------------------

/**
 * Normalise one reference to the canonical `[Space]/path` or `path` form:
 * backslashes become `/` (the content roots include Windows checkouts, and a
 * path pasted from Explorer is a realistic input), leading slashes are
 * dropped, and the space prefix is trimmed of incidental spacing.
 *
 * @param {string} raw
 * @returns {string} '' when nothing usable remains
 */
function normaliseRef(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/\\/g, '/');
    if (!s) return '';
    const m = s.match(/^\[([^\]]*)\]\s*\/?\s*(.*)$/);
    if (m) {
        const space = m[1].trim();
        const rest = m[2].replace(/^\/+/, '').trim();
        if (!rest) return '';
        return space ? `[${space}]/${rest}` : rest;
    }
    return s.replace(/^\/+/, '').trim();
}

/**
 * Split a reference into its space (when prefixed) and space-relative path.
 * @param {string} ref
 * @returns {{spaceName: string, path: string}} spaceName '' means "host space"
 */
function splitRef(ref) {
    const s = String(ref == null ? '' : ref).trim().replace(/\\/g, '/');
    const m = s.match(/^\[([^\]]*)\]\s*\/?\s*(.*)$/);
    if (m) return { spaceName: m[1].trim(), path: m[2].replace(/^\/+/, '').trim() };
    return { spaceName: '', path: s.replace(/^\/+/, '').trim() };
}

/** Case-insensitive identity of a reference, for de-duplication. */
function refKey(ref) {
    const { spaceName, path } = splitRef(ref);
    return `${spaceName}|${path}`.toLowerCase();
}

// ----------------------------------------------------------------------------
// Parse / build
// ----------------------------------------------------------------------------

/**
 * Parse a linked-documents block BODY into its structured form.
 *
 * @param {string} body
 * @returns {{title:string, across:number, items:Array<{ref:string,label:string}>, extras:Array<string>}}
 */
function parseLinkedDocumentsBody(body) {
    const result = { title: '', across: 0, items: [], extras: [] };
    for (const line of String(body || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.toLowerCase() === 'linked-documents') continue;

        if (trimmed.startsWith('-')) {
            const entry = trimmed.replace(/^-\s*/, '').trim();
            if (!entry) continue;
            const bar = entry.indexOf('|');
            const ref = normaliseRef(bar === -1 ? entry : entry.slice(0, bar));
            const label = bar === -1 ? '' : entry.slice(bar + 1).trim();
            if (ref) result.items.push({ ref, label });
            continue;
        }

        const kv = trimmed.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (!kv) { result.extras.push(line); continue; }
        const key = kv[1].toLowerCase();
        if (key === 'title') { result.title = kv[2].trim(); continue; }
        if (key === 'across') { result.across = parseInt(kv[2], 10) || 0; continue; }
        result.extras.push(line);
    }
    return result;
}

/**
 * Read the linked-documents block out of a whole document.
 * @param {string} content - full markdown
 * @returns {{title:string, across:number, items:Array, extras:Array}|null} null when absent
 */
function parseLinkedDocuments(content) {
    const match = LINKED_DOCS_BLOCK_RE.exec(String(content || ''));
    if (!match) return null;
    return parseLinkedDocumentsBody(match[1] || '');
}

/**
 * Drop duplicate references, keeping the FIRST occurrence — which is the one
 * whose position the author chose. A reference that survives normalisation as
 * an empty string is dropped entirely.
 * @param {Array<{ref:string,label:string}>} items
 * @returns {Array<{ref:string,label:string}>}
 */
function dedupeItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
        const ref = normaliseRef(item && item.ref);
        if (!ref) continue;
        const key = refKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ref, label: String((item && item.label) || '').trim() });
    }
    return out;
}

/**
 * Render the structured form back into a fenced block.
 * @param {{title?:string, across?:number, items?:Array, extras?:Array}} data
 * @returns {string}
 */
function buildLinkedDocumentsBlock(data) {
    const d = data || {};
    const lines = [];
    if (d.title && d.title !== DEFAULT_TITLE) lines.push(`title: ${d.title}`);
    if (d.across > 0) lines.push(`across: ${d.across}`);
    dedupeItems(d.items).forEach(({ ref, label }) => {
        lines.push(label ? `- ${ref} | ${label}` : `- ${ref}`);
    });
    // Lines we did not understand on read are written back verbatim.
    (Array.isArray(d.extras) ? d.extras : []).forEach(l => { if (String(l).trim()) lines.push(l); });
    return '```linked-documents\n' + lines.join('\n') + '\n```';
}

// ----------------------------------------------------------------------------
// Mutation
// ----------------------------------------------------------------------------

/**
 * Replace the document's linked-documents block, or add one when it has none.
 *
 * A new block is inserted ABOVE any trailing page furniture (comments, likes,
 * visit stats, reviews) rather than blindly appended, so it reads as part of
 * the page instead of sitting under the comment thread.
 *
 * @param {string} content - full markdown
 * @param {{title?:string, across?:number, items?:Array, extras?:Array}} data
 * @returns {string}
 */
function upsertLinkedDocumentsBlock(content, data) {
    const block = buildLinkedDocumentsBlock(data);
    const original = String(content || '');

    if (LINKED_DOCS_BLOCK_RE.test(original)) {
        return original.replace(LINKED_DOCS_BLOCK_RE, block);
    }

    const furniture = TRAILING_FURNITURE_RE.exec(original);
    if (furniture) {
        const head = original.slice(0, furniture.index).replace(/\s+$/, '');
        const tail = original.slice(furniture.index).replace(/^\n+/, '');
        return `${head}\n\n${block}\n\n${tail}`;
    }

    const trimmed = original.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
}

/**
 * Remove the linked-documents block entirely.
 * @param {string} content
 * @returns {string}
 */
function removeLinkedDocumentsBlock(content) {
    const original = String(content || '');
    if (!LINKED_DOCS_BLOCK_RE.test(original)) return original;
    return original.replace(LINKED_DOCS_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '');
}

/**
 * Set the document's links from a list of references, preserving the block's
 * `title` / `across` / unknown lines when it already exists. An empty list
 * removes the block rather than leaving an empty band on the page.
 *
 * @param {string} content
 * @param {Array<{ref:string,label?:string}|string>} items
 * @param {{title?:string, across?:number}} [options] - overrides for the section
 * @returns {string}
 */
function setLinkedDocuments(content, items, options = {}) {
    const existing = parseLinkedDocuments(content) || { title: '', across: 0, items: [], extras: [] };
    const normalised = dedupeItems(
        (Array.isArray(items) ? items : []).map(i => (typeof i === 'string' ? { ref: i, label: '' } : i))
    );

    if (!normalised.length && !existing.extras.length) {
        return removeLinkedDocumentsBlock(content);
    }

    return upsertLinkedDocumentsBlock(content, {
        title: options.title !== undefined ? options.title : existing.title,
        across: options.across !== undefined ? options.across : existing.across,
        items: normalised,
        extras: existing.extras
    });
}

// ----------------------------------------------------------------------------
// Durability: carry the block across a wholesale document overwrite
// ----------------------------------------------------------------------------

/**
 * Carry a document's links into a freshly-generated version of it. When the
 * new content already has a linked-documents block it wins (an explicit edit);
 * otherwise the old block is re-inserted, so a workflow regeneration of a
 * folder home — which is exactly the kind of page these links are authored on
 * — cannot silently drop them.
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{content: string, carried: number}}
 */
function preserveLinkedDocuments(oldContent, newContent) {
    if (LINKED_DOCS_BLOCK_RE.test(String(newContent || ''))) return { content: newContent, carried: 0 };
    const existing = parseLinkedDocuments(oldContent);
    if (!existing || (!existing.items.length && !existing.extras.length)) {
        return { content: newContent, carried: 0 };
    }
    return { content: upsertLinkedDocumentsBlock(newContent, existing), carried: existing.items.length };
}

module.exports = {
    LINKED_DOCS_BLOCK_RE,
    DEFAULT_TITLE,
    normaliseRef,
    splitRef,
    refKey,
    parseLinkedDocumentsBody,
    parseLinkedDocuments,
    dedupeItems,
    buildLinkedDocumentsBlock,
    upsertLinkedDocumentsBlock,
    removeLinkedDocumentsBlock,
    setLinkedDocuments,
    preserveLinkedDocuments
};
