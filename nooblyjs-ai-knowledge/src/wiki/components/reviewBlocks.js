/**
 * @fileoverview Inline review block helpers.
 *
 * A document's review requests live inline in its markdown, inside a single
 * consolidated fenced ```reviews``` block (one block per document, like
 * ```comments```), holding one entry per requested review:
 *
 *   ```reviews
 *
 *   id: 7f3a1c9e2b04
 *   review: inprogress
 *   requested: srbooysen@example.com
 *   reviewer: sdupreez@example.com
 *   annotations: 2
 *   stars:
 *   comment:
 *   startdate: 2026-06-09
 *   enddate:
 *
 *   ```
 *
 * Entries are separated by a blank line; each entry is a set of `key: value`
 * lines. `review` is `inprogress` until the reviewer completes it (which sets
 * `stars`, `comment`, `enddate` and flips it to `complete`). A page is "under
 * review" while any entry is `inprogress`. `annotations` counts the review
 * annotations that reviewer has left on the page.
 *
 * This module is pure (no I/O) so the parsing/mutation logic is unit-testable
 * in isolation — the same shape as components/annotationBlocks.js.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const { randomUUID } = require('node:crypto');

/** Matches the (single) reviews block; capture group 1 is the body. */
const REVIEWS_BLOCK_RE = /```reviews[ \t]*\n([\s\S]*?)\n```/;

/** Field order written into each entry. */
const FIELD_ORDER = ['id', 'review', 'requested', 'reviewer', 'annotations', 'stars', 'comment', 'startdate', 'enddate'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/** Today's date as YYYY-MM-DD. */
function today(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function newId() {
    try { return randomUUID().replace(/-/g, '').slice(0, 12); }
    catch (_) { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

// ----------------------------------------------------------------------------
// Entry: parse / build
// ----------------------------------------------------------------------------

/**
 * Parse one entry's `key: value` lines into a structured object.
 * @param {string} text
 * @returns {Object} { id, review, requested, reviewer, annotations, stars, comment, startdate, enddate }
 */
function parseReviewEntry(text) {
    const entry = {};
    for (const line of String(text || '').split(/\r?\n/)) {
        const m = line.match(/^([a-zA-Z][\w-]*)\s*:\s?(.*)$/);
        if (m) entry[m[1].toLowerCase()] = m[2].trim();
    }
    return {
        id: entry.id || '',
        review: (entry.review || 'inprogress').toLowerCase(),
        requested: entry.requested || '',
        reviewer: entry.reviewer || '',
        annotations: entry.annotations || '',
        stars: entry.stars || '',
        comment: entry.comment || '',
        startdate: entry.startdate || '',
        enddate: entry.enddate || ''
    };
}

/**
 * Find every review entry in a document.
 * @param {string} content
 * @returns {Array<Object>} parsed entries (empty when there is no block)
 */
function parseReviews(content) {
    const m = String(content || '').match(REVIEWS_BLOCK_RE);
    if (!m) return [];
    return m[1]
        .split(/\n\s*\n/)               // entries separated by a blank line
        .map(chunk => chunk.trim())
        .filter(Boolean)
        .map(parseReviewEntry);
}

/**
 * Build one entry's text (single-line values; newlines in `comment` collapsed).
 * Missing id/startdate/review are filled in.
 * @param {Object} entry
 * @returns {string}
 */
function buildReviewEntry(entry) {
    const e = {
        id: entry.id || newId(),
        review: (entry.review || 'inprogress').toLowerCase(),
        requested: entry.requested || '',
        reviewer: entry.reviewer || '',
        annotations: entry.annotations === 0 ? '0' : (entry.annotations || ''),
        stars: entry.stars === 0 ? '0' : (entry.stars || ''),
        comment: String(entry.comment || '').replace(/[\r\n]+/g, ' ').trim(),
        startdate: entry.startdate || today(),
        enddate: entry.enddate || ''
    };
    return FIELD_ORDER.map(k => `${k}: ${e[k] === '' ? '' : e[k]}`.replace(/\s+$/, '')).join('\n');
}

/**
 * Build the full fenced reviews block from a list of entries.
 * @param {Array<Object>} entries
 * @returns {string}
 */
function buildReviewsBlock(entries) {
    const body = (entries || []).map(buildReviewEntry).join('\n\n');
    return '```reviews\n\n' + body + '\n\n```';
}

// ----------------------------------------------------------------------------
// Document mutation
// ----------------------------------------------------------------------------

/**
 * Replace the reviews block in `content` with one rebuilt from `entries`, or
 * append a fresh block when none exists. When `entries` is empty the block is
 * removed entirely.
 * @param {string} content
 * @param {Array<Object>} entries
 * @returns {string}
 */
function upsertReviewsBlock(content, entries) {
    const list = entries || [];
    const hasBlock = REVIEWS_BLOCK_RE.test(content);

    if (!list.length) {
        if (!hasBlock) return content;
        return content.replace(REVIEWS_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    }

    const block = buildReviewsBlock(list);
    if (hasBlock) return content.replace(REVIEWS_BLOCK_RE, block);

    const trailing = content.endsWith('\n') ? '' : '\n';
    const sep = content.trim().length ? '\n' : '';
    return `${content}${trailing}${sep}${block}\n`;
}

/**
 * Append a new review entry. Returns { content, id }.
 * @param {string} content
 * @param {Object} entry { requested, reviewer, review?, startdate?, ... }
 * @returns {{ content: string, id: string }}
 */
function addReview(content, entry) {
    const id = entry.id || newId();
    const entries = parseReviews(content);
    entries.push({ ...entry, id });
    return { content: upsertReviewsBlock(content, entries), id };
}

/** Find a single review entry by id (or null). */
function findReviewById(content, id) {
    return parseReviews(content).find(e => e.id === id) || null;
}

/**
 * Update fields of the entry with `id` in place. Returns updated content, or
 * null when no entry has that id.
 * @param {string} content
 * @param {string} id
 * @param {Object} fields  partial entry to merge
 * @returns {string|null}
 */
function updateReviewById(content, id, fields) {
    const entries = parseReviews(content);
    let found = false;
    const next = entries.map(e => {
        if (e.id !== id) return e;
        found = true;
        return { ...e, ...fields };
    });
    if (!found) return null;
    return upsertReviewsBlock(content, next);
}

/**
 * Remove the entry with `id`. Returns updated content, or null when not found.
 * @param {string} content
 * @param {string} id
 * @returns {string|null}
 */
function removeReviewById(content, id) {
    const entries = parseReviews(content);
    const next = entries.filter(e => e.id !== id);
    if (next.length === entries.length) return null;
    return upsertReviewsBlock(content, next);
}

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

/** True when any review is still in progress. */
function isUnderReview(content) {
    return parseReviews(content).some(e => e.review === 'inprogress');
}

/**
 * The in-progress review assigned to `email` (case-insensitive), or null.
 * @param {string} content
 * @param {string} email
 * @returns {Object|null}
 */
function activeReviewFor(content, email) {
    const want = String(email || '').trim().toLowerCase();
    if (!want) return null;
    return parseReviews(content).find(
        e => e.review === 'inprogress' && e.reviewer.toLowerCase() === want
    ) || null;
}

/**
 * Increment the `annotations` count on `reviewer`'s in-progress entry. Returns
 * updated content (unchanged when that reviewer has no in-progress review).
 * @param {string} content
 * @param {string} reviewerEmail
 * @returns {string}
 */
function incrementAnnotationCount(content, reviewerEmail) {
    const entry = activeReviewFor(content, reviewerEmail);
    if (!entry) return content;
    const n = parseInt(entry.annotations, 10);
    const next = (Number.isFinite(n) ? n : 0) + 1;
    return updateReviewById(content, entry.id, { annotations: String(next) }) || content;
}

// ----------------------------------------------------------------------------
// Durability: carry the reviews block across a wholesale document overwrite
// ----------------------------------------------------------------------------

/**
 * Carry review requests from an old document version into a freshly-generated
 * one. When the new content already has a reviews block it wins (an explicit
 * edit); otherwise the old block's entries are re-appended so a workflow
 * regeneration or editor save can't silently drop in-flight reviews.
 *
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ content: string, carried: number }}
 */
function preserveReviews(oldContent, newContent) {
    if (REVIEWS_BLOCK_RE.test(newContent)) return { content: newContent, carried: 0 };
    const existing = parseReviews(oldContent);
    if (!existing.length) return { content: newContent, carried: 0 };
    return { content: upsertReviewsBlock(newContent, existing), carried: existing.length };
}

module.exports = {
    REVIEWS_BLOCK_RE,
    today,
    newId,
    parseReviewEntry,
    parseReviews,
    buildReviewEntry,
    buildReviewsBlock,
    upsertReviewsBlock,
    addReview,
    findReviewById,
    updateReviewById,
    removeReviewById,
    isUnderReview,
    activeReviewFor,
    incrementAnnotationCount,
    preserveReviews
};
