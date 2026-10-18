/**
 * @fileoverview Per-user, per-space content index.
 *
 * Comments and likes live inline inside each document's markdown, so there is
 * no cheap way to answer "show me everything <user> has commented on / liked in
 * this space". This module maintains a lightweight per-user index per space so
 * the profile screen can load those lists instantly.
 *
 * Storage — one file per user inside that space's content repo, keyed by the
 * email local-part (the same identity recorded in the markdown
 * ```comments```/```liked``` blocks):
 *   <space.path>/.system/useractivity/<prefix>/content.json
 *   { "comments": [...], "likes": [...], "annotations": [...], "reviews": [...] }
 *
 * Every function takes (appBaseDir, spaceName, email, …); the space dir is
 * resolved via spaceUserStore. The index is best-effort: kept in sync by the
 * comments/likes/annotations/reviews route handlers and rebuildable with
 * scripts/backfill-user-content.js.
 *
 * @author noobly Team
 * @version 2.0.0
 * @since 2026-05-19
 */

'use strict';

const userStore = require('./userStore');
const spaceUserStore = require('./spaceUserStore');

/** Turn an email into a filesystem-safe, case-stable key (the activity folder name). */
function userKey(email) {
    return userStore.userDir(email);
}

const EMPTY = () => ({ comments: [], likes: [], annotations: [], reviews: [] });

/**
 * Read a user's content index for a space. Always resolves to a well-formed
 * { comments, likes, annotations, reviews } object, even when the file is missing.
 */
async function read(appBaseDir, spaceName, email) {
    const parsed = await spaceUserStore.readJson(appBaseDir, spaceName, email, 'content.json', null);
    if (!parsed) return EMPTY();
    return {
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
        likes: Array.isArray(parsed.likes) ? parsed.likes : [],
        annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
        reviews: Array.isArray(parsed.reviews) ? parsed.reviews : []
    };
}

async function write(appBaseDir, spaceName, email, data) {
    await spaceUserStore.writeJson(appBaseDir, spaceName, email, 'content.json', data);
}

/** A comment is uniquely identified by where it lives + when + its text. */
function commentKey(c) {
    return `${c.spaceName}::${c.path}::${c.date}::${c.text}`;
}

/** A like is one-per-document-per-user, so location alone is the key. */
function likeKey(l) {
    return `${l.spaceName}::${l.path}`;
}

/**
 * Add a comment to the author's index (no-op if an identical entry exists).
 * entry: { spaceName, path, title, text, date }
 */
async function recordComment(appBaseDir, spaceName, email, entry) {
    const data = await read(appBaseDir, spaceName, email);
    const key = commentKey(entry);
    if (!data.comments.some(c => commentKey(c) === key)) {
        data.comments.unshift({ ...entry, indexedAt: new Date().toISOString() });
        await write(appBaseDir, spaceName, email, data);
    }
}

/**
 * Remove a comment from the author's index.
 * match: { spaceName, path, date, text }
 */
async function removeComment(appBaseDir, spaceName, email, match) {
    const data = await read(appBaseDir, spaceName, email);
    const key = commentKey(match);
    const filtered = data.comments.filter(c => commentKey(c) !== key);
    if (filtered.length !== data.comments.length) {
        data.comments = filtered;
        await write(appBaseDir, spaceName, email, data);
    }
}

/**
 * Add a like to the user's index (no-op if already present).
 * entry: { spaceName, path, title }
 */
async function recordLike(appBaseDir, spaceName, email, entry) {
    const data = await read(appBaseDir, spaceName, email);
    const key = likeKey(entry);
    if (!data.likes.some(l => likeKey(l) === key)) {
        data.likes.unshift({ ...entry, likedAt: entry.likedAt || new Date().toISOString() });
        await write(appBaseDir, spaceName, email, data);
    }
}

/**
 * Remove a like from the user's index.
 * match: { spaceName, path }
 */
async function removeLike(appBaseDir, spaceName, email, match) {
    const data = await read(appBaseDir, spaceName, email);
    const key = likeKey(match);
    const filtered = data.likes.filter(l => likeKey(l) !== key);
    if (filtered.length !== data.likes.length) {
        data.likes = filtered;
        await write(appBaseDir, spaceName, email, data);
    }
}

/** An annotation is uniquely identified by its id (stable across edits). */
function annotationKey(a) {
    return a.id ? `id:${a.id}` : `${a.spaceName}::${a.path}::${a.date}::${a.text}`;
}

/**
 * Add (or update) an annotation in the author's index.
 * entry: { id, spaceName, path, title, text, target, date }
 */
async function recordAnnotation(appBaseDir, spaceName, email, entry) {
    const data = await read(appBaseDir, spaceName, email);
    const key = annotationKey(entry);
    const without = data.annotations.filter(a => annotationKey(a) !== key);
    without.unshift({ ...entry, indexedAt: new Date().toISOString() });
    data.annotations = without;
    await write(appBaseDir, spaceName, email, data);
}

/**
 * Remove an annotation from the author's index.
 * match: { id } (preferred) or { spaceName, path, date, text }
 */
async function removeAnnotation(appBaseDir, spaceName, email, match) {
    const data = await read(appBaseDir, spaceName, email);
    const key = annotationKey(match);
    const filtered = data.annotations.filter(a => annotationKey(a) !== key);
    if (filtered.length !== data.annotations.length) {
        data.annotations = filtered;
        await write(appBaseDir, spaceName, email, data);
    }
}

/** A review is uniquely identified by its id (stable across complete/cancel). */
function reviewKey(r) {
    return r.id ? `id:${r.id}` : `${r.spaceName}::${r.path}::${r.reviewer}::${r.startdate}`;
}

/**
 * Add (or replace) a review record in a participant's index. Recorded on both
 * the reviewer's and the requestor's index so each sees it from their side; the
 * `role` field says which side this copy is for.
 * entry: { id, spaceName, path, title, requested, reviewer, status, stars,
 *          startdate, enddate, role: 'reviewer' | 'requestor' }
 */
async function recordReview(appBaseDir, spaceName, email, entry) {
    const data = await read(appBaseDir, spaceName, email);
    const key = reviewKey(entry);
    const without = data.reviews.filter(r => reviewKey(r) !== key);
    without.unshift({ ...entry, indexedAt: new Date().toISOString() });
    data.reviews = without;
    await write(appBaseDir, spaceName, email, data);
}

/**
 * Merge `fields` into an existing review record (no-op when absent).
 * match: { id }
 */
async function updateReview(appBaseDir, spaceName, email, id, fields) {
    const data = await read(appBaseDir, spaceName, email);
    let changed = false;
    data.reviews = data.reviews.map(r => {
        if (reviewKey(r) !== reviewKey({ id })) return r;
        changed = true;
        return { ...r, ...fields, indexedAt: new Date().toISOString() };
    });
    if (changed) await write(appBaseDir, spaceName, email, data);
}

/**
 * Remove a review record from a participant's index.
 * match: { id }
 */
async function removeReview(appBaseDir, spaceName, email, match) {
    const data = await read(appBaseDir, spaceName, email);
    const key = reviewKey(match);
    const filtered = data.reviews.filter(r => reviewKey(r) !== key);
    if (filtered.length !== data.reviews.length) {
        data.reviews = filtered;
        await write(appBaseDir, spaceName, email, data);
    }
}

module.exports = {
    userKey,
    read,
    write,
    recordComment,
    removeComment,
    recordLike,
    removeLike,
    recordAnnotation,
    removeAnnotation,
    recordReview,
    updateReview,
    removeReview
};
