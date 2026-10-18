/**
 * @fileoverview Wiki block preservation for content builders.
 *
 * Workflow content builders regenerate a document's markdown and write it to
 * disk wholesale. The wiki, however, stores user contributions *inside* that
 * markdown as fenced blocks:
 *
 *   ```document``` — document metadata (owner, …)         (singleton, hidden)
 *   ```annotation``` — inline annotations anchored to content (many)
 *   ```comments``` — the comment thread                    (singleton)
 *   ```liked``` — who liked the page                        (singleton)
 *   ```wiki-link``` / ```wiki-links``` — curated links      (singleton)
 *   ```linked-documents``` — the relationship band          (singleton)
 *
 * A naive overwrite destroys all of these. `preserveWikiBlocks` carries them
 * from the old file into freshly-generated content: singletons are re-attached
 * if the new content doesn't already include one, and annotations are
 * re-anchored to their `Target` (or parked under a "needs re-anchoring" heading
 * when the content they referred to is gone).
 *
 * Self-contained (only node:fs/path) so any workflow can require it. The
 * annotation re-anchoring mirrors backend/src/wiki/components/annotationBlocks.js
 * in the main app — keep the two in sync if the anchoring rules change.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 2026-05-30
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Singleton blocks: at most one per document, re-attached verbatim.
 *
 * ORDER MATTERS — this is the order they are appended back, so page furniture
 * a reader expects at the bottom (comments, likes) must come last.
 * `linked-documents` sits above them for that reason.
 */
const SINGLETON_TYPES = ['document', 'linked-documents', 'comments', 'liked', 'wiki-link', 'wiki-links'];
const ANNOTATION_BLOCK_RE = /```annotation[ \t]*\n([\s\S]*?)\n```/g;
const USER_CONTENT_BLOCK_RE = /```user-content[ \t]*\n([\s\S]*?)\n```/g;
const DOCUMENT_BLOCK_RE = /```document[ \t]*\n([\s\S]*?)\n```/;
const ORPHAN_HEADING = '## Annotations needing re-anchoring';
const UC_ORPHAN_HEADING = '## Added content needing re-anchoring';

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Full text of the first ```type``` block in content, or null. */
function extractBlock(content, type) {
    const re = new RegExp('```' + escapeRegExp(type) + '[ \\t]*\\n[\\s\\S]*?\\n```');
    const m = content.match(re);
    return m ? m[0] : null;
}

function hasBlock(content, type) {
    return new RegExp('```' + escapeRegExp(type) + '[ \\t]*(\\n|$)').test(content);
}

// ----------------------------------------------------------------------------
// Annotation target parsing + resolution (mirrors annotationBlocks.js)
// ----------------------------------------------------------------------------

function parseTarget(str) {
    const parts = String(str || '').split('|').map(s => s.trim()).filter(Boolean);
    const target = { kind: (parts.shift() || '').toLowerCase() };
    for (const p of parts) {
        const m = p.match(/^([a-zA-Z][\w-]*)\s*=\s*"([\s\S]*)"$/);
        if (m) target[m[1]] = m[2];
    }
    return target;
}

/** Parse every anchored block (annotation / user-content) matching `blockRe`. */
function parseAnchoredBlocks(content, blockRe) {
    const out = [];
    const re = new RegExp(blockRe.source, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
        let targetRaw = '', id = '';
        for (const line of m[1].split(/\r?\n/)) {
            const mt = line.match(/^Target:\s?(.*)$/);
            const mi = line.match(/^Id:\s?(.*)$/);
            if (mt) targetRaw = mt[1].trim();
            else if (mi) id = mi[1].trim();
        }
        out.push({ block: m[0], target: parseTarget(targetRaw), id });
    }
    return out;
}

function parseAnnotationBlocks(content) {
    return parseAnchoredBlocks(content, ANNOTATION_BLOCK_RE);
}

function parseUserContentBlocks(content) {
    return parseAnchoredBlocks(content, USER_CONTENT_BLOCK_RE);
}

function hasAnnotationId(content, id) {
    return parseAnnotationBlocks(content).some(e => e.id === id);
}

function hasUserContentId(content, id) {
    return parseUserContentBlocks(content).some(e => e.id === id);
}

/**
 * Ensure the document carries a ```document``` metadata block declaring an owner.
 * Idempotent: a block that already has an `owner:` line is left untouched; a
 * block without one gets `owner: <owner>` inserted; no block at all gets a
 * minimal one prepended. This is how workflow-generated pages become
 * `owner: system` (the wiki then hides their editor tabs).
 * @param {string} content
 * @param {{ owner?: string, name?: string }} [opts]
 * @returns {string}
 */
function ensureDocumentOwner(content, opts = {}) {
    const owner = opts.owner || 'system';
    const src = String(content == null ? '' : content);
    const m = src.match(DOCUMENT_BLOCK_RE);
    if (m) {
        if (/^[ \t]*owner[ \t]*:/im.test(m[1])) return src;   // already declared
        const rebuilt = m[0].replace(/^```document[ \t]*\n/, (fence) => `${fence}owner: ${owner}\n`);
        return src.replace(m[0], rebuilt);
    }
    const name = String(opts.name || '').replace(/\s+/g, ' ').trim();
    const lines = ['```document', '', `owner: ${owner}`];
    if (name) lines.push(`Name: ${name}`);
    lines.push('', '```');
    return `${lines.join('\n')}\n\n${src}`;
}

function endOfLine(content, from) {
    const nl = content.indexOf('\n', from);
    return nl === -1 ? content.length : nl;
}

function endOfParagraph(content, from) {
    const blank = content.indexOf('\n\n', from);
    return blank === -1 ? content.length : blank;
}

function endOfTable(content, lineStart) {
    const lines = content.split('\n');
    let idx = 0, startLine = 0;
    for (let i = 0; i < lines.length; i++) {
        if (idx + lines[i].length >= lineStart) { startLine = i; break; }
        idx += lines[i].length + 1;
    }
    let endLine = startLine;
    while (endLine < lines.length && lines[endLine].trim().startsWith('|')) endLine++;
    let charIdx = 0;
    for (let i = 0; i < endLine; i++) charIdx += lines[i].length + 1;
    return Math.min(charIdx - 1, content.length);
}

/** Offset in `content` after the target content, or -1 when not found. */
function resolveTarget(content, target) {
    if (!target || !target.kind) return -1;
    switch (target.kind) {
        case 'text': {
            const quote = target.quote;
            if (!quote) return -1;
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
            if (!target.heading) return -1;
            const re = new RegExp(`^#{1,6}[ \\t]+${escapeRegExp(target.heading)}[ \\t]*$`, 'm');
            const m = re.exec(content);
            return m ? endOfLine(content, m.index) : -1;
        }
        case 'table': {
            const caption = target.caption || target.table;
            if (!caption) return -1;
            const at = content.indexOf(caption);
            if (at === -1) return -1;
            const tableStart = content.indexOf('\n|', at);
            return tableStart === -1 ? endOfParagraph(content, at) : endOfTable(content, tableStart + 1);
        }
        case 'row': {
            if (!target.match) return -1;
            const at = content.indexOf(target.match);
            if (at === -1) return -1;
            const lineStart = content.lastIndexOf('\n', at) + 1;
            if (!content.slice(lineStart).trimStart().startsWith('|')) return endOfParagraph(content, at);
            return endOfTable(content, lineStart);
        }
        case 'cell': {
            const cellText = target.text || target.quote;
            if (!cellText) return -1;
            let from = 0;
            while (true) {
                const at = content.indexOf(cellText, from);
                if (at === -1) return -1;
                const lineStart = content.lastIndexOf('\n', at) + 1;
                const nl = content.indexOf('\n', at);
                const line = content.slice(lineStart, nl === -1 ? content.length : nl);
                if (line.trimStart().startsWith('|') && (!target.row || line.includes(target.row))) {
                    return endOfTable(content, lineStart);
                }
                from = at + cellText.length;
            }
        }
        default:
            return -1;
    }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Carry the wiki's special blocks from `oldContent` into freshly-generated
 * `newContent`.
 * @param {string} oldContent - The previously written file (may be empty)
 * @param {string} newContent - The regenerated content
 * @returns {{ content: string, reanchored: Array, orphaned: Array, preserved: Array }}
 */
function preserveWikiBlocks(oldContent, newContent) {
    let content = newContent;
    const reanchored = [];
    const orphaned = [];
    const preserved = [];

    if (!oldContent) {
        return { content, reanchored, orphaned, preserved };
    }

    // Annotations — re-anchor each surviving block to its target.
    for (const entry of parseAnnotationBlocks(oldContent)) {
        if (entry.id && hasAnnotationId(content, entry.id)) continue;
        const at = resolveTarget(content, entry.target);
        if (at !== -1) {
            content = content.slice(0, at) + '\n\n' + entry.block + content.slice(at);
            reanchored.push(entry.id || entry.target.kind);
        } else {
            orphaned.push(entry);
        }
    }
    if (orphaned.length) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        const blocks = orphaned.map(o => o.block).join('\n\n');
        content = `${content}${trailing}\n${ORPHAN_HEADING}\n\n${blocks}\n`;
    }

    // "Add Content" contributions — re-anchor exactly like annotations, under a
    // separate orphan heading so the two kinds aren't mixed together.
    const ucOrphaned = [];
    for (const entry of parseUserContentBlocks(oldContent)) {
        if (entry.id && hasUserContentId(content, entry.id)) continue;
        const at = resolveTarget(content, entry.target);
        if (at !== -1) {
            content = content.slice(0, at) + '\n\n' + entry.block + content.slice(at);
            reanchored.push(entry.id || entry.target.kind);
        } else {
            ucOrphaned.push(entry);
            orphaned.push(entry);
        }
    }
    if (ucOrphaned.length) {
        const trailing = content.endsWith('\n') ? '' : '\n';
        const blocks = ucOrphaned.map(o => o.block).join('\n\n');
        content = `${content}${trailing}\n${UC_ORPHAN_HEADING}\n\n${blocks}\n`;
    }

    // Singletons — re-attach the old block when the new content lacks one.
    for (const type of SINGLETON_TYPES) {
        if (hasBlock(content, type)) continue;
        const block = extractBlock(oldContent, type);
        if (!block) continue;
        if (type === 'document') {
            // Hidden metadata — keep it at the very top, where it belongs.
            content = `${block}\n\n${content}`;
        } else {
            const trailing = content.endsWith('\n') ? '' : '\n';
            content = `${content}${trailing}\n${block}\n`;
        }
        preserved.push(type);
    }

    return { content, reanchored, orphaned: orphaned.map(o => o.id || o.target.kind), preserved };
}

/** True when content contains any preservable wiki block (cheap pre-check). */
function hasPreservableBlocks(content) {
    return /```(?:document|annotation|user-content|comments|liked|wiki-link|wiki-links|linked-documents)\b/.test(content || '');
}

/**
 * Write markdown to disk, preserving the wiki's blocks from any existing file.
 * Best-effort: if reading/merging fails, the new content is written as-is so a
 * build never breaks. Creates parent directories. Synchronous.
 *
 * Skips the write entirely when the final (block-merged) content is
 * byte-identical to what is already on disk. Content builders regenerate every
 * run; rewriting an unchanged page would needlessly churn the git repository
 * and fire the wiki file-watcher. The comparison is against the merged result,
 * so it never skips a write that would actually change the file.
 * @param {string} filePath
 * @param {string} newContent
 * @returns {string} the content on disk after the call (written or unchanged)
 */
function writeMarkdownPreserving(filePath, newContent) {
    let merged = newContent;
    let existing = null;
    try {
        if (fs.existsSync(filePath)) {
            existing = fs.readFileSync(filePath, 'utf8');
            if (hasPreservableBlocks(existing)) {
                merged = preserveWikiBlocks(existing, newContent).content;
            }
        }
    } catch (e) {
        // fall back to writing newContent verbatim
        merged = newContent;
        existing = null;
    }
    // Every workflow-generated page is system-owned: guarantee a ```document```
    // block declaring owner: system so the wiki hides the editor tabs and treats
    // it as generated. Idempotent — a block that already declares an owner (e.g.
    // solution-design's rich document block) is left untouched.
    const docName = path.basename(filePath).replace(/\.(md|markdown)$/i, '');
    merged = ensureDocumentOwner(merged, { owner: 'system', name: docName });
    // Unchanged → leave the file (and its mtime) alone.
    if (existing !== null && existing === merged) {
        return merged;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, merged);
    return merged;
}

module.exports = {
    SINGLETON_TYPES,
    parseTarget,
    parseAnnotationBlocks,
    parseUserContentBlocks,
    resolveTarget,
    extractBlock,
    hasBlock,
    hasPreservableBlocks,
    ensureDocumentOwner,
    preserveWikiBlocks,
    writeMarkdownPreserving
};
