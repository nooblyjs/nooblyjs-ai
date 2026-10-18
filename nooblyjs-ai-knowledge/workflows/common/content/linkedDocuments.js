/**
 * @fileoverview Build the wiki's ```linked-documents``` block from a content job.
 *
 * The wiki renders that block as a "Linked documents" band — a row of cards,
 * one per related wiki document OR folder, each showing the target's cover
 * preview, title, item count and last-updated date. Readers use it to see how
 * a page relates to the rest of the repository; the platform also treats it as
 * declared context.
 *
 *   ```linked-documents
 *   title: Related landscapes
 *   across: 4
 *   - Solution Design/Application Landscapes
 *   - Solution Design/Reference Landscapes/overview.md | Reference overview
 *   ```
 *
 * REFERENCES ARE SPACE-ROOT RELATIVE, NOT JOB RELATIVE. This is the one thing
 * that goes wrong. A job knows its `contentfolder` (e.g.
 * `../knowledge-content/enterprise/Solution Design`), but the wiki resolves a
 * bare reference against the SPACE's content root
 * (`../knowledge-content/enterprise`) — so the reference has to be
 * `Solution Design/Application Landscapes`, not `Application Landscapes`.
 * {@link spaceRelativeRef} does that conversion from the two absolute paths a
 * job already has. Prefixing a space by name (`[Enterprise Space]/…`) is
 * possible but usually WRONG from a job: several spaces are views of one
 * content root, so naming one pins the link to a space the reader may not be
 * in, and a space rename breaks it. Emit bare paths and let the wiki resolve
 * them against whichever space the reader is using.
 *
 * Self-contained (only node:path) so any workflow can require it directly, the
 * same as common/content/wikiBlocks.js. The grammar mirrors
 * src/wiki/components/linkedDocumentBlocks.js
 * and MarkdownParser.parseLinkedDocuments — keep all three in step or a page
 * renders one way and edits another.
 *
 * See `.docs/Linked-Documents-for-Content-Jobs.md` in the knowledge repo for
 * the full guide, including which of the three ownership models to pick.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 2026-08-21
 */

'use strict';

const path = require('node:path');

/**
 * Matches the (single) linked-documents block. The closing alternation tries
 * the empty-body case first, because a lazy `[\s\S]*?` alone overshoots the
 * closing fence of a block with no lines between its fences.
 */
const LINKED_DOCS_BLOCK_RE = /```linked-documents[ \t]*\r?\n(?:```|([\s\S]*?)\r?\n```)[ \t]*/;

/** Page furniture that belongs at the very bottom, below the band. */
const TRAILING_FURNITURE_RE = /\n*```(?:comments|sharedlinkvisits|liked|reviews)\b[^\n]*\r?\n(?:```|[\s\S]*?\r?\n```)[ \t]*/i;

/** Cap enforced by the wiki's own API; a band, not a directory listing. */
const MAX_ITEMS = 60;

// ----------------------------------------------------------------------------
// References
// ----------------------------------------------------------------------------

/**
 * Normalise one reference to the canonical `[Space]/path` or `path` form:
 * backslashes become `/` (jobs run on Windows and build paths with
 * `path.join`), leading slashes are dropped, spacing around a space prefix is
 * trimmed.
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

/** Case-insensitive identity of a reference, for de-duplication. */
function refKey(ref) {
    const s = String(ref == null ? '' : ref).trim().replace(/\\/g, '/');
    const m = s.match(/^\[([^\]]*)\]\s*\/?\s*(.*)$/);
    const space = m ? m[1].trim() : '';
    const rest = (m ? m[2] : s).replace(/^\/+/, '').trim();
    return `${space}|${rest}`.toLowerCase();
}

/**
 * Turn an absolute path a job is working with into the space-root-relative
 * reference the wiki resolves.
 *
 *   spaceRelativeRef('../knowledge-content/enterprise',
 *                    '../knowledge-content/enterprise/Solution Design/Landscapes')
 *     → 'Solution Design/Landscapes'
 *
 * Both arguments are resolved before comparing, so a mix of relative and
 * absolute inputs (which is what workflow settings actually contain) works.
 * Returns '' when the target is not inside the space root — a caller that gets
 * '' back should NOT emit the link, because a reference the wiki cannot
 * resolve renders as a "no longer resolves" card.
 *
 * @param {string} spaceRoot - the SPACE's content root, e.g. the parent of the
 *   job's `contentfolder` (see the file header)
 * @param {string} target - the file or folder being linked to
 * @returns {string}
 */
function spaceRelativeRef(spaceRoot, target) {
    if (!spaceRoot || !target) return '';
    const root = path.resolve(String(spaceRoot));
    const abs = path.resolve(String(target));
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
    return rel.split(path.sep).join('/');
}

// ----------------------------------------------------------------------------
// Build / parse
// ----------------------------------------------------------------------------

/**
 * Drop empties and duplicates, keeping the FIRST occurrence — which is the one
 * whose position the job chose. Accepts either plain reference strings or
 * `{ ref, label }` objects.
 *
 * @param {Array<string|{ref:string,label?:string}>} items
 * @returns {Array<{ref:string,label:string}>}
 */
function normaliseItems(items) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(items) ? items : []) {
        const item = typeof raw === 'string' ? { ref: raw } : (raw || {});
        const ref = normaliseRef(item.ref);
        if (!ref) continue;
        const key = refKey(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ref, label: String(item.label || '').trim() });
        if (out.length >= MAX_ITEMS) break;
    }
    return out;
}

/**
 * Build the fenced block. Returns '' when nothing survives normalisation, so a
 * caller can concatenate the result unconditionally and simply get no band on
 * a page with no links.
 *
 * MUST be a triple-backtick fence: the wiki parser detects `linked-documents`
 * by fence only, never by indentation (its name is ordinary English, and
 * prefix detection would otherwise swallow any paragraph opening "Linked
 * documents …"). An indented variant is silently ignored.
 *
 * @param {Array<string|{ref:string,label?:string}>} items
 * @param {Object} [options]
 * @param {string} [options.title] - section heading; omitted when it is the
 *   default, so the block stays minimal
 * @param {number} [options.across] - cards per row; omit to fit automatically
 * @param {Array<string>} [options.extras] - lines to write back verbatim
 * @returns {string}
 */
function buildLinkedDocumentsBlock(items, options = {}) {
    const normalised = normaliseItems(items);
    if (!normalised.length) return '';

    const lines = [];
    const title = String(options.title || '').trim();
    if (title && title !== 'Linked documents') lines.push(`title: ${title}`);
    const across = parseInt(options.across, 10) || 0;
    if (across > 0) lines.push(`across: ${across}`);
    normalised.forEach(({ ref, label }) => {
        lines.push(label ? `- ${ref} | ${label}` : `- ${ref}`);
    });
    (Array.isArray(options.extras) ? options.extras : []).forEach((l) => {
        if (String(l).trim()) lines.push(l);
    });

    return '```linked-documents\n' + lines.join('\n') + '\n```';
}

/**
 * Read a document's linked-documents block.
 * @param {string} content - full markdown
 * @returns {{title:string, across:number, items:Array<{ref:string,label:string}>, extras:Array<string>}|null}
 */
function parseLinkedDocuments(content) {
    const match = LINKED_DOCS_BLOCK_RE.exec(String(content || ''));
    if (!match) return null;

    const result = { title: '', across: 0, items: [], extras: [] };
    for (const line of String(match[1] || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.toLowerCase() === 'linked-documents') continue;

        if (trimmed.startsWith('-')) {
            const body = trimmed.replace(/^-\s*/, '').trim();
            if (!body) continue;
            const bar = body.indexOf('|');
            const ref = normaliseRef(bar === -1 ? body : body.slice(0, bar));
            const label = bar === -1 ? '' : body.slice(bar + 1).trim();
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

// ----------------------------------------------------------------------------
// Placement
// ----------------------------------------------------------------------------

/**
 * Put `block` into `content`, replacing an existing linked-documents block or
 * inserting one ABOVE any trailing page furniture (comments, likes, visit
 * stats, reviews) — so the band reads as part of the page rather than sitting
 * under the comment thread. An empty `block` removes the band.
 *
 * @param {string} content - full markdown
 * @param {string} block - output of {@link buildLinkedDocumentsBlock}
 * @returns {string}
 */
function setLinkedDocumentsBlock(content, block) {
    const original = String(content || '');

    if (LINKED_DOCS_BLOCK_RE.test(original)) {
        if (!block) {
            return original.replace(LINKED_DOCS_BLOCK_RE, '')
                .replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '');
        }
        return original.replace(LINKED_DOCS_BLOCK_RE, block);
    }
    if (!block) return original;

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
 * ADDITIVE ownership: keep every link a reader curated by hand on top of the
 * ones this run generated, generated first.
 *
 * Use it only when a job means to CONTRIBUTE links to a page rather than own
 * its band. The trade-off is real and cannot be avoided without marking each
 * item's origin in the file: a link this job generated in a previous run and
 * has now dropped (because its source disappeared) is indistinguishable from
 * one a reader added, so it is carried forward and the band never shrinks.
 * If a job's links are derived from the source system, prefer the default —
 * emit the block and let it win — so removals actually take effect.
 *
 * @param {string} oldContent - what is currently on disk ('' for a new file)
 * @param {string} newContent - freshly generated markdown, block already in it
 * @returns {string}
 */
function mergeLinkedDocuments(oldContent, newContent) {
    const previous = parseLinkedDocuments(oldContent);
    if (!previous || !previous.items.length) return newContent;

    const generated = parseLinkedDocuments(newContent);
    if (!generated) {
        // Nothing generated this run — leave the reader's block alone. (With
        // `linked-documents` in wikiBlocks.SINGLETON_TYPES this is already the
        // behaviour of writeMarkdownPreserving; handled here too so the helper
        // is correct on its own.)
        return setLinkedDocumentsBlock(newContent, buildLinkedDocumentsBlock(previous.items, previous));
    }

    const known = new Set(generated.items.map((i) => refKey(i.ref)));
    const carried = previous.items.filter((i) => !known.has(refKey(i.ref)));
    if (!carried.length) return newContent;

    return setLinkedDocumentsBlock(
        newContent,
        buildLinkedDocumentsBlock(generated.items.concat(carried), generated)
    );
}

module.exports = {
    LINKED_DOCS_BLOCK_RE,
    MAX_ITEMS,
    normaliseRef,
    refKey,
    spaceRelativeRef,
    normaliseItems,
    buildLinkedDocumentsBlock,
    parseLinkedDocuments,
    setLinkedDocumentsBlock,
    mergeLinkedDocuments
};
