/**
 * @fileoverview Backfill the per-user content index.
 *
 * Comments and likes are stored inline in document markdown. The profile
 * screen reads them from a per-user index (see components/userContentIndex.js)
 * that is kept current by the comments/likes route handlers — but that index
 * only covers activity created *after* the index shipped.
 *
 * Run this once to seed the index from comments/likes already present in
 * documents:
 *
 *   node scripts/backfill-user-content.js
 *
 * It scans every space listed in <appBaseDir>/spaces/spaces.json, parses each
 * markdown file's ```comments``` / ```liked``` blocks, and rewrites the
 * usercontent.<email>.json files from scratch.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-19
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const userContentIndex = require('../src/wiki/components/userContentIndex');

const COMMENTS_FENCE_RE = /```comments\s*\n([\s\S]*?)\n```/i;
const LIKED_FENCE_RE = /```liked\s*\n([\s\S]*?)\n```/i;

const appBaseDir = process.env.APP_BASE_DIR
    || path.resolve(__dirname, '../.application');

/** Recursively collect every .md / .markdown file under a directory. */
async function collectMarkdown(dir) {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
        return [];
    }
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectMarkdown(full));
        } else if (/\.(md|markdown)$/i.test(entry.name)) {
            files.push(full);
        }
    }
    return files;
}

/** Parse a ```comments``` block into { comment, commentor, date } entries. */
function parseComments(content) {
    const m = content.match(COMMENTS_FENCE_RE);
    if (!m) return [];
    const entries = [];
    for (const chunk of m[1].split(/^\s*---\s*$/m)) {
        let comment = null, commentor = '', date = '', collecting = false;
        for (const line of chunk.split(/\r?\n/)) {
            const mc = line.match(/^Comment:\s?(.*)$/);
            const mu = line.match(/^Commentor:\s?(.*)$/);
            const md = line.match(/^Date:\s?(.*)$/);
            if (mc) { comment = mc[1]; collecting = true; }
            else if (mu) { commentor = mu[1].trim(); collecting = false; }
            else if (md) { date = md[1].trim(); collecting = false; }
            else if (collecting && comment !== null) { comment += '\n' + line; }
        }
        if (comment !== null && commentor) {
            entries.push({ comment: comment.trim(), commentor, date });
        }
    }
    return entries;
}

/** Parse a ```liked``` block into { timestamp, email } entries. */
function parseLikes(content) {
    const m = content.match(LIKED_FENCE_RE);
    if (!m) return [];
    const out = [];
    for (const raw of m[1].split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const parts = line.match(/^(\S+)\s+(\S+)\s*$/);
        if (parts) out.push({ timestamp: parts[1], email: parts[2] });
        else out.push({ timestamp: '', email: line });
    }
    return out;
}

function docTitle(documentPath) {
    return path.basename(documentPath).replace(/\.(md|markdown)$/i, '');
}

async function main() {
    const spacesPath = path.join(appBaseDir, 'spaces', 'spaces.json');
    let spaces;
    try {
        spaces = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
    } catch (err) {
        console.error(`No spaces found at ${spacesPath} — nothing to backfill.`);
        process.exit(0);
    }

    // `${spaceName}::${email}` -> { spaceName, email, comments: [], likes: [] }
    // Content is now per-space, so the index is keyed by (space, user).
    const byKey = new Map();
    const ensure = (spaceName, email) => {
        const e = email.trim().toLowerCase();
        const key = `${spaceName}::${e}`;
        if (!byKey.has(key)) byKey.set(key, { spaceName, email: e, comments: [], likes: [] });
        return byKey.get(key);
    };

    let fileCount = 0;
    for (const space of spaces) {
        const documentsDir = space.path
            || space.configuration?.filing?.baseDir
            || path.join(appBaseDir, 'documents', space.name);

        const files = await collectMarkdown(documentsDir);
        for (const absPath of files) {
            fileCount++;
            let content;
            try {
                content = await fs.readFile(absPath, 'utf8');
            } catch (err) {
                continue;
            }
            const relPath = path.relative(documentsDir, absPath).split(path.sep).join('/');

            for (const c of parseComments(content)) {
                ensure(space.name, c.commentor).comments.push({
                    spaceName: space.name,
                    path: relPath,
                    title: docTitle(relPath),
                    text: c.comment,
                    date: c.date,
                    indexedAt: new Date().toISOString()
                });
            }
            for (const l of parseLikes(content)) {
                ensure(space.name, l.email).likes.push({
                    spaceName: space.name,
                    path: relPath,
                    title: docTitle(relPath),
                    likedAt: l.timestamp || new Date().toISOString()
                });
            }
        }
    }

    for (const { spaceName, email, comments, likes } of byKey.values()) {
        await userContentIndex.write(appBaseDir, spaceName, email, { comments, likes });
        console.log(`  [${spaceName}] ${email}: ${comments.length} comment(s), ${likes.length} like(s)`);
    }

    console.log(`\nScanned ${fileCount} document(s) across ${spaces.length} space(s).`);
    console.log(`Wrote ${byKey.size} per-space content index file(s) to <space>/.system/useractivity/<prefix>/content.json.`);
}

main().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
