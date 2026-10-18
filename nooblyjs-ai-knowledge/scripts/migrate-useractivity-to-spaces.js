/**
 * @fileoverview One-off migration: move the global per-user activity tree into
 * each space's content repo.
 *
 * Phase 1 — the file-based per-user data that the backend now reads per-space:
 *   <appBaseDir>/.useractivity/<prefix>/{activity,pins,content}.json
 *     -> split by each item's `spaceName` into
 *        <space.path>/.useractivity/<prefix>/{activity,pins,content}.json
 *   chathistory.json (no space tag) -> the default space.
 *   dashboard.md (global copy) -> removed; the loader falls back to the space's
 *     existing .dashboards/<prefix>.md.
 *
 * Also split per-space: subscriptions.json, notifications.json (by each item's
 * spaceName), and notification-preferences.json (-> default space; not space-specific).
 *
 * Left in place: preferences.json (the user's profile — not space-scoped).
 *
 * Run from the repo root:  node scripts/migrate-useractivity-to-spaces.js
 * Idempotent-ish: re-running after the split files are gone is a no-op.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');

const userStore = require('../src/wiki/components/userStore');
const spaceUserStore = require('../src/wiki/components/spaceUserStore');

function resolveAppBaseDir() {
    if (process.env.APP_BASE_DIR) return process.env.APP_BASE_DIR;
    const candidates = [
        path.resolve(__dirname, '../../.application'),
        path.resolve(__dirname, '../.application'),
        path.join(process.cwd(), '.application')
    ];
    for (const c of candidates) if (fs.existsSync(path.join(c, '.useractivity'))) return c;
    return candidates[0];
}

const appBaseDir = resolveAppBaseDir();
const globalRoot = path.join(appBaseDir, userStore.ROOT); // <appBaseDir>/.useractivity

// Files that are split per-space by an embedded spaceName, plus how to split them.
const arrayBySpace = (arr) => {
    const by = new Map();
    for (const item of (Array.isArray(arr) ? arr : [])) {
        const sp = item && item.spaceName;
        if (!sp) continue;
        if (!by.has(sp)) by.set(sp, []);
        by.get(sp).push(item);
    }
    return by;
};

// Exact space resolution — NO fallback. Unknown spaceNames (e.g. corrupt/legacy
// data) must not be silently folded into the default space.
let SPACES = null;
const skipped = [];
async function exactSpaceDir(spaceName) {
    if (!SPACES) SPACES = await spaceUserStore.loadSpaces(appBaseDir);
    const s = SPACES.find(x => x.name === spaceName)
        || SPACES.find(x => String(x.id) === String(spaceName));
    return s ? spaceUserStore.spaceContentDir(s) : null;
}

async function defaultSpaceName() {
    if (!SPACES) SPACES = await spaceUserStore.loadSpaces(appBaseDir);
    const s = SPACES.find(x => String(x.id) === String(spaceUserStore.DEFAULT_SPACE_ID)) || SPACES[0];
    return s ? s.name : null;
}

async function writePerSpace(spaceName, prefix, fileName, data, count) {
    const dir = await exactSpaceDir(spaceName);
    if (!dir) {
        skipped.push(`${fileName} for "${prefix}": unknown space "${spaceName}" (${count} item(s)) — left in backup, not migrated`);
        return false;
    }
    await userStore.writeJson(dir, prefix, fileName, data);
    return true;
}

async function migratePrefix(prefix, summary) {
    const dir = path.join(globalRoot, prefix);
    const read = (name) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
        catch { return null; }
    };
    const removeGlobal = (name) => { try { fs.unlinkSync(path.join(dir, name)); } catch {} };

    // --- activity.json: { userId, starred:[], recent:[], ... } -> per-space ---
    const activity = read('activity.json');
    if (activity) {
        const starredBy = arrayBySpace(activity.starred);
        const recentBy = arrayBySpace(activity.recent);
        const spaces = new Set([...starredBy.keys(), ...recentBy.keys()]);
        for (const sp of spaces) {
            const star = starredBy.get(sp) || [];
            const rec = recentBy.get(sp) || [];
            const ok = await writePerSpace(sp, prefix, 'activity.json', {
                userId: activity.userId || null,
                starred: star,
                recent: rec,
                createdAt: activity.createdAt,
                updatedAt: activity.updatedAt
            }, star.length + rec.length);
            if (ok) summary.push(`activity -> ${sp}/${prefix} (★${star.length} ⏱${rec.length})`);
        }
        removeGlobal('activity.json');
    }

    // --- pins.json: [ {spaceName, ...} ] -> per-space ---
    const pins = read('pins.json');
    if (pins) {
        for (const [sp, arr] of arrayBySpace(pins)) {
            const ok = await writePerSpace(sp, prefix, 'pins.json', arr, arr.length);
            if (ok) summary.push(`pins -> ${sp}/${prefix} (${arr.length})`);
        }
        removeGlobal('pins.json');
    }

    // --- content.json: { comments, likes, annotations, reviews } -> per-space ---
    const content = read('content.json');
    if (content) {
        const cats = ['comments', 'likes', 'annotations', 'reviews'];
        const perSpace = new Map(); // sp -> { comments:[], ... }
        for (const cat of cats) {
            for (const [sp, arr] of arrayBySpace(content[cat])) {
                if (!perSpace.has(sp)) perSpace.set(sp, { comments: [], likes: [], annotations: [], reviews: [] });
                perSpace.get(sp)[cat] = arr;
            }
        }
        for (const [sp, data] of perSpace) {
            const n = data.comments.length + data.likes.length + data.annotations.length + data.reviews.length;
            const ok = await writePerSpace(sp, prefix, 'content.json', data, n);
            if (ok) summary.push(`content -> ${sp}/${prefix} (c${data.comments.length} l${data.likes.length} a${data.annotations.length} r${data.reviews.length})`);
        }
        removeGlobal('content.json');
    }

    // --- chathistory.json: no space tag -> default space ---
    const chat = read('chathistory.json');
    if (chat && Array.isArray(chat) && chat.length) {
        const dir2 = await spaceUserStore.resolveSpaceDir(appBaseDir, null); // default space
        await userStore.writeJson(dir2, prefix, 'chathistory.json', chat);
        summary.push(`chathistory -> default-space/${prefix} (${chat.length})`);
    }
    removeGlobal('chathistory.json');

    // --- subscriptions.json: [ {type,path,spaceName?} ] -> per-space (default if untagged) ---
    const subs = read('subscriptions.json');
    if (subs && Array.isArray(subs) && subs.length) {
        const def = await defaultSpaceName();
        const bySpace = new Map();
        for (const s of subs) {
            const sp = s.spaceName || def;
            s.spaceName = sp;
            if (!bySpace.has(sp)) bySpace.set(sp, []);
            bySpace.get(sp).push(s);
        }
        for (const [sp, arr] of bySpace) {
            const ok = await writePerSpace(sp, prefix, 'subscriptions.json', arr, arr.length);
            if (ok) summary.push(`subscriptions -> ${sp}/${prefix} (${arr.length})`);
        }
    }
    removeGlobal('subscriptions.json');

    // --- notifications.json: { userId, notifications:[{spaceName,...}] } -> per-space ---
    const notif = read('notifications.json');
    if (notif && Array.isArray(notif.notifications)) {
        const bySpace = new Map();
        for (const n of notif.notifications) {
            if (!n.spaceName) continue;
            if (!bySpace.has(n.spaceName)) bySpace.set(n.spaceName, []);
            bySpace.get(n.spaceName).push(n);
        }
        for (const [sp, arr] of bySpace) {
            const ok = await writePerSpace(sp, prefix, 'notifications.json', { userId: notif.userId || null, notifications: arr }, arr.length);
            if (ok) summary.push(`notifications -> ${sp}/${prefix} (${arr.length})`);
        }
    }
    removeGlobal('notifications.json');

    // --- notification-preferences.json: not space-specific -> default space ---
    const nprefs = read('notification-preferences.json');
    if (nprefs && nprefs.preferences) {
        const dir3 = await spaceUserStore.resolveSpaceDir(appBaseDir, null); // default space
        await userStore.writeJson(dir3, prefix, 'notification-preferences.json', { userId: nprefs.userId || null, preferences: nprefs.preferences });
        summary.push(`notification-preferences -> default-space/${prefix}`);
    }
    removeGlobal('notification-preferences.json');

    // --- dashboard.md: drop the global copy; loader falls back to .dashboards/ ---
    removeGlobal('dashboard.md');
}

async function main() {
    console.log(`Migrating per-user activity into spaces. Source: ${globalRoot}\n`);
    let prefixes;
    try {
        prefixes = (await fsp.readdir(globalRoot, { withFileTypes: true }))
            .filter(d => d.isDirectory()).map(d => d.name);
    } catch (e) {
        console.log('No global .useractivity/ — nothing to migrate.');
        return;
    }

    const summary = [];
    for (const prefix of prefixes) {
        console.log(`• ${prefix}`);
        await migratePrefix(prefix, summary);
    }

    console.log('\nMoved:');
    for (const line of summary) console.log(`  ${line}`);
    if (skipped.length) {
        console.log('\nSkipped (unknown spaceName — kept in backup only):');
        for (const line of skipped) console.log(`  ⚠ ${line}`);
    }
    console.log(`\nLeft global (by design): preferences.json (the user's profile — not space-specific).`);
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
