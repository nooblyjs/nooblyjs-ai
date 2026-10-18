/**
 * @fileoverview Inline annotation block helpers.
 *
 * Annotations are stored inline in a document's markdown, each in its own
 * fenced ```annotation``` block placed adjacent to the content it refers to:
 *
 *   ```annotation
 *   Target: row | table="Integrations" | match="Acme Express eCommerce"
 *   Annotation: This price is stale — confirm with finance.
 *   Annotator: user@example.com
 *   Date: 2026-05-30 11:00
 *   Id: a1b2c3d4
 *   ```
 *
 * Unlike comments (one consolidated block), each annotation is its own block so
 * it renders as a distinct callout next to its target. The `Target` descriptor
 * — not the block's line position — is the durable anchor: when a workflow
 * regenerates the document wholesale, `preserveAnnotations` re-resolves each
 * target against the new content and re-inserts the block beside it (or parks
 * it as an orphan when the target is gone).
 *
 * This module is pure (no I/O) so the anchoring logic is unit-testable in
 * isolation.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-30
 */

'use strict';

const { randomUUID } = require('node:crypto');

/** Matches a single annotation block; capture group 1 is the body. */
const ANNOTATION_BLOCK_RE = /```annotation[ \t]*\n([\s\S]*?)\n```/g;

/** Heading line, e.g. "## Pricing". */
function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function nowStamp(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function newId() {
    try { return randomUUID().replace(/-/g, '').slice(0, 12); }
    catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

// ----------------------------------------------------------------------------
// Target descriptor: parse / build
// ----------------------------------------------------------------------------

/**
 * Parse a Target descriptor line into a structured object.
 *   'row | table="Integrations" | match="Acme Express"'
 *     → { kind: 'row', table: 'Integrations', match: 'Acme Express' }
 * @param {string} str
 * @returns {Object} { kind, ...attrs }
 */
function parseTarget(str) {
    const parts = String(str || '').split('|').map(s => s.trim()).filter(Boolean);
    const target = { kind: (parts.shift() || '').toLowerCase() };
    for (const p of parts) {
        const m = p.match(/^([a-zA-Z][\w-]*)\s*=\s*"([\s\S]*)"$/);
        if (m) target[m[1]] = m[2];
    }
    return target;
}

/**
 * Build a Target descriptor line from an object (inverse of parseTarget).
 * @param {Object} target { kind, ...attrs }
 * @returns {string}
 */
function buildTarget(target) {
    const { kind, ...attrs } = target || {};
    const segs = [kind || 'text'];
    for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined && v !== null && v !== '') {
            segs.push(`${k}="${String(v).replace(/"/g, '')}"`);
        }
    }
    return segs.join(' | ');
}

// ----------------------------------------------------------------------------
// Block: parse / build / remove
// ----------------------------------------------------------------------------

/**
 * Parse a single annotation block body into a structured entry.
 * @param {string} body
 * @returns {Object} { target, targetRaw, annotation, annotator, date, id }
 */
function parseAnnotationBody(body) {
    let targetRaw = '', type = '', annotation = null, annotator = '', date = '', id = '', collecting = false;
    for (const line of String(body || '').split(/\r?\n/)) {
        const mt = line.match(/^Target:\s?(.*)$/);
        const mty = line.match(/^Type:\s?(.*)$/);
        const ma = line.match(/^Annotation:\s?(.*)$/);
        const mu = line.match(/^Annotator:\s?(.*)$/);
        const md = line.match(/^Date:\s?(.*)$/);
        const mi = line.match(/^Id:\s?(.*)$/);
        if (mt) { targetRaw = mt[1].trim(); collecting = false; }
        else if (mty) { type = mty[1].trim(); collecting = false; }
        else if (ma) { annotation = ma[1]; collecting = true; }
        else if (mu) { annotator = mu[1].trim(); collecting = false; }
        else if (md) { date = md[1].trim(); collecting = false; }
        else if (mi) { id = mi[1].trim(); collecting = false; }
        else if (collecting && annotation !== null) { annotation += '\n' + line; }
    }
    return {
        targetRaw,
        target: parseTarget(targetRaw),
        type: (type || 'note').toLowerCase(),
        annotation: (annotation || '').trim(),
        annotator,
        date,
        id
    };
}

/**
 * Find every annotation block in a document.
 * @param {string} content
 * @returns {Array<Object>} entries with an extra `block` (the full fenced text)
 */
function parseAnnotationBlocks(content) {
    const out = [];
    const re = new RegExp(ANNOTATION_BLOCK_RE.source, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
        const entry = parseAnnotationBody(m[1]);
        entry.block = m[0];
        out.push(entry);
    }
    return out;
}

/**
 * Build a fenced annotation block from an entry. Missing id/date are filled in.
 * @param {Object} entry { target|targetRaw, annotation, annotator, date, id }
 * @returns {string}
 */
function buildAnnotationBlock(entry) {
    const targetRaw = entry.targetRaw || buildTarget(entry.target || { kind: 'text' });
    const type = (entry.type || 'note').toLowerCase();
    const lines = ['```annotation', `Target: ${targetRaw}`];
    // Only emit Type for non-default kinds, so existing plain annotations are
    // left byte-for-byte unchanged.
    if (type && type !== 'note') lines.push(`Type: ${type}`);
    lines.push(
        `Annotation: ${String(entry.annotation || '').replace(/\r/g, '').trim()}`,
        `Annotator: ${(entry.annotator || 'unknown').trim()}`,
        `Date: ${entry.date || nowStamp()}`,
        `Id: ${entry.id || newId()}`,
        '```'
    );
    return lines.join('\n');
}

/**
 * Remove the annotation block with the given id. Returns the updated content,
 * or null when no block with that id was found.
 * @param {string} content
 * @param {string} id
 * @returns {string|null}
 */
function removeAnnotationById(content, id) {
    const re = new RegExp(ANNOTATION_BLOCK_RE.source, 'g');
    let found = false;
    const updated = content.replace(re, (block, body) => {
        if (!found && parseAnnotationBody(body).id === id) {
            found = true;
            // Also swallow the surrounding blank line(s) we inserted with it.
            return '';
        }
        return block;
    });
    if (!found) return null;
    // Collapse the triple-newline left where the block used to be.
    return updated.replace(/\n{3,}/g, '\n\n');
}

/** True when a block with this id already exists in content. */
function hasAnnotationId(content, id) {
    return parseAnnotationBlocks(content).some(e => e.id === id);
}

/**
 * Find a single annotation entry by id (or null). Includes `block` (full text).
 * @param {string} content
 * @param {string} id
 * @returns {Object|null}
 */
function findAnnotationById(content, id) {
    return parseAnnotationBlocks(content).find(e => e.id === id) || null;
}

/**
 * Replace the annotation text of an existing block in place, keeping its
 * target/annotator/id. Returns updated content, or null if not found.
 * @param {string} content
 * @param {string} id
 * @param {{ annotation: string, date?: string }} fields
 * @returns {string|null}
 */
function updateAnnotationById(content, id, fields) {
    const entry = findAnnotationById(content, id);
    if (!entry) return null;
    const rebuilt = buildAnnotationBlock({
        targetRaw: entry.targetRaw,
        type: entry.type,
        annotation: fields.annotation != null ? fields.annotation : entry.annotation,
        annotator: entry.annotator,
        date: fields.date || entry.date,
        id: entry.id
    });
    return content.replace(entry.block, rebuilt);
}

// ----------------------------------------------------------------------------
// Target resolution: where does a block attach in a given document?
// ----------------------------------------------------------------------------

/** End-of-line index at or after `from`. */
function endOfLine(content, from) {
    const nl = content.indexOf('\n', from);
    return nl === -1 ? content.length : nl;
}

/** End of the paragraph (next blank line) containing index `from`. */
function endOfParagraph(content, from) {
    const blank = content.indexOf('\n\n', from);
    return blank === -1 ? content.length : blank;
}

/** End of a contiguous markdown table block that begins on the line at `from`. */
function endOfTable(content, lineStart) {
    const lines = content.split('\n');
    // Map char index → line index.
    let idx = 0, startLine = 0;
    for (let i = 0; i < lines.length; i++) {
        if (idx + lines[i].length >= lineStart) { startLine = i; break; }
        idx += lines[i].length + 1;
    }
    let endLine = startLine;
    while (endLine < lines.length && lines[endLine].trim().startsWith('|')) endLine++;
    // char index of end of endLine-1
    let charIdx = 0;
    for (let i = 0; i < endLine; i++) charIdx += lines[i].length + 1;
    return Math.min(charIdx - 1, content.length);
}

/**
 * Resolve a Target to an insertion offset in `content` (the position *after*
 * the referenced content, where the annotation block should go). Returns -1
 * when the target can't be found.
 * @param {string} content
 * @param {Object} target { kind, ... }
 * @returns {number}
 */
function resolveTarget(content, target) {
    if (!target || !target.kind) return -1;

    switch (target.kind) {
        case 'text': {
            const quote = target.quote;
            if (!quote) return -1;
            // Prefer a context-qualified match, then fall back to the bare quote.
            let at = -1;
            if (target.before || target.after) {
                const ctx = `${target.before || ''}${quote}${target.after || ''}`;
                at = content.indexOf(ctx);
                if (at !== -1) at += (target.before || '').length;
            }
            if (at === -1) at = content.indexOf(quote);
            if (at === -1) return -1;
            return endOfParagraph(content, at);
        }
        case 'section': {
            const heading = target.heading;
            if (!heading) return -1;
            const re = new RegExp(`^#{1,6}[ \\t]+${escapeRegExp(heading)}[ \\t]*$`, 'm');
            const m = re.exec(content);
            if (!m) return -1;
            return endOfLine(content, m.index);
        }
        case 'table': {
            const caption = target.caption || target.table;
            if (!caption) return -1;
            const at = content.indexOf(caption);
            if (at === -1) return -1;
            // Find the first table line at/after the caption and skip to its end.
            const tableStart = content.indexOf('\n|', at);
            if (tableStart === -1) return endOfParagraph(content, at);
            return endOfTable(content, tableStart + 1);
        }
        case 'row': {
            const match = target.match;
            if (!match) return -1;
            // Find the row line containing the match text, then jump to table end
            // (annotation blocks can't live inside a table).
            const at = content.indexOf(match);
            if (at === -1) return -1;
            // Walk back to the start of that line.
            const lineStart = content.lastIndexOf('\n', at) + 1;
            if (!content.slice(lineStart).trimStart().startsWith('|')) {
                return endOfParagraph(content, at);
            }
            return endOfTable(content, lineStart);
        }
        case 'cell': {
            // A specific table cell, anchored by its own text and (for
            // uniqueness) its row's first-cell key. Annotation blocks can't live
            // inside a table, so we attach after the whole table.
            const cellText = target.text || target.quote;
            if (!cellText) return -1;
            const rowKey = target.row;
            let from = 0;
            while (true) {
                const at = content.indexOf(cellText, from);
                if (at === -1) return -1;
                const lineStart = content.lastIndexOf('\n', at) + 1;
                const nl = content.indexOf('\n', at);
                const line = content.slice(lineStart, nl === -1 ? content.length : nl);
                if (line.trimStart().startsWith('|') && (!rowKey || line.includes(rowKey))) {
                    return endOfTable(content, lineStart);
                }
                from = at + cellText.length;
            }
        }
        default:
            return -1;
    }
}

/**
 * Insert an annotation block adjacent to its resolved target. When the target
 * can't be resolved the block is appended at the end of the document.
 * @param {string} content
 * @param {Object} entry annotation entry (target may be object or targetRaw)
 * @returns {{ content: string, resolved: boolean, block: string, id: string }}
 */
function insertAnnotation(content, entry) {
    const target = entry.target || parseTarget(entry.targetRaw || '');
    const id = entry.id || newId();
    const block = buildAnnotationBlock({ ...entry, target, id });

    const at = resolveTarget(content, target);
    if (at === -1) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        return { content: `${content}${trailing}\n${block}\n`, resolved: false, block, id };
    }
    const before = content.slice(0, at);
    const after = content.slice(at);
    return { content: `${before}\n\n${block}${after}`, resolved: true, block, id };
}

// ----------------------------------------------------------------------------
// Durability: preserve annotations across a wholesale document overwrite
// ----------------------------------------------------------------------------

const ORPHAN_HEADING = '## Annotations needing re-anchoring';

/**
 * Carry annotations from an old document version into a freshly-generated one.
 * Blocks already present in `newContent` (matched by Id) are left as-is; the
 * rest are re-inserted at their resolved target, or parked under an orphan
 * heading when the target no longer exists.
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ content: string, reanchored: Array, orphaned: Array }}
 *   `orphaned` entries carry `{ annotator, annotation, id, targetRaw }` so the
 *   caller can notify each author.
 */
function preserveAnnotations(oldContent, newContent) {
    const existing = parseAnnotationBlocks(oldContent);
    let content = newContent;
    const reanchored = [];
    const orphaned = [];

    for (const entry of existing) {
        if (entry.id && hasAnnotationId(content, entry.id)) continue; // already carried over

        const at = resolveTarget(content, entry.target);
        if (at !== -1) {
            const res = insertAnnotation(content, entry);
            content = res.content;
            reanchored.push(entry);
        } else {
            orphaned.push(entry);
        }
    }

    if (orphaned.length) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        const blocks = orphaned.map(e => buildAnnotationBlock(e)).join('\n\n');
        content = `${content}${trailing}\n${ORPHAN_HEADING}\n\n${blocks}\n`;
    }

    return { content, reanchored, orphaned };
}

module.exports = {
    ANNOTATION_BLOCK_RE,
    nowStamp,
    newId,
    parseTarget,
    buildTarget,
    parseAnnotationBody,
    parseAnnotationBlocks,
    buildAnnotationBlock,
    removeAnnotationById,
    hasAnnotationId,
    findAnnotationById,
    updateAnnotationById,
    resolveTarget,
    insertAnnotation,
    preserveAnnotations,
    ORPHAN_HEADING
};
