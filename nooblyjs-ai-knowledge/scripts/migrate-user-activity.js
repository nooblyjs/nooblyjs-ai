/**
 * @fileoverview One-off migration: consolidate per-user data into the
 * `.useractivity/<prefix>/` layout (see src/wiki/components/userStore.js).
 *
 * Moves the flat, mixed-keyed files from <appBaseDir>/users/ into a single
 * folder per user named by their email local-part, splits global notification
 * subscriptions per-user, copies each registered user's workflow-generated
 * dashboard into their folder, deletes orphaned files (user-ids no longer in
 * users.json), and removes the now-empty users/ directory.
 *
 *   node scripts/migrate-user-activity.js
 *
 * Idempotent: re-running after the users/ folder is gone is a no-op.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const fs = require('node:fs').promises;
const fssync = require('node:fs');
const path = require('node:path');

const userStore = require('../src/wiki/components/userStore');

/** Resolve the data directory: APP_BASE_DIR, else the first candidate that has a users/ folder. */
function resolveAppBaseDir() {
    if (process.env.APP_BASE_DIR) return process.env.APP_BASE_DIR;
    const candidates = [
        path.resolve(__dirname, '../../.application'), // workspace-root/.application (real layout)
        path.resolve(__dirname, '../.application'),       // <repo>/.application
        path.join(process.cwd(), '.application')
    ];
    for (const c of candidates) {
        if (fssync.existsSync(path.join(c, 'users')) || fssync.existsSync(path.join(c, 'spaces'))) {
            return c;
        }
    }
    return candidates[0];
}

const appBaseDir = resolveAppBaseDir();

/** Build id -> email from users.json (keyed by email, each carrying an id). */
async function loadIdToEmail() {
    try {
        const raw = await fs.readFile(path.join(appBaseDir, 'data', 'auth', 'users.json'), 'utf8');
        const users = JSON.parse(raw);
        const map = {};
        for (const email of Object.keys(users)) {
            const u = users[email];
            if (u && u.id) map[u.id] = u.email || email;
        }
        return map;
    } catch (err) {
        console.error(`Could not read users.json (${err.message}); cannot map ids → emails.`);
        return {};
    }
}

/**
 * Classify a filename from users/ into { kind, id|key, target } or null if
 * unrecognised. `target` is the canonical filename inside the user folder.
 */
function classify(name) {
    let m;
    if ((m = name.match(/^userActivity_(.+)\.json$/)))     return { byId: true,  id: m[1], target: 'activity.json' };
    if ((m = name.match(/^userPreferences_(.+)\.json$/)))  return { byId: true,  id: m[1], target: 'preferences.json' };
    if ((m = name.match(/^chatHistory_(.+)\.json$/)))      return { byId: true,  id: m[1], target: 'chathistory.json' };
    if ((m = name.match(/^userpins\.(.+)\.json$/)))        return { byId: true,  id: m[1], target: 'pins.json' };
    if ((m = name.match(/^usercontent\.(.+)\.json$/)))     return { byId: false, key: m[1], target: 'content.json' };
    return null;
}

async function migrateUsersFolder(idToEmail, summary) {
    const usersDir = path.join(appBaseDir, 'users');
    let names;
    try {
        names = await fs.readdir(usersDir);
    } catch (err) {
        console.log('No users/ folder — nothing to migrate from there.');
        return;
    }

    for (const name of names) {
        const src = path.join(usersDir, name);
        const info = classify(name);
        if (!info) {
            console.log(`  • skip (unrecognised): ${name}`);
            continue;
        }

        // Resolve the identity (email) that determines the destination folder.
        const identity = info.byId ? idToEmail[info.id] : info.key;
        if (!identity) {
            // Orphan — a user-id no longer present in users.json (or 'anonymous').
            await fs.unlink(src);
            summary.deleted.push(name);
            console.log(`  ✗ delete orphan: ${name}`);
            continue;
        }

        const data = JSON.parse(await fs.readFile(src, 'utf8'));
        await userStore.writeJson(appBaseDir, identity, info.target, data);
        await fs.unlink(src);
        summary.moved.push(`${name} → ${userStore.userDir(identity)}/${info.target}`);
        console.log(`  ✓ ${name} → .useractivity/${userStore.userDir(identity)}/${info.target}`);
    }

    // Remove users/ if now empty.
    try {
        const left = await fs.readdir(usersDir);
        if (left.length === 0) {
            await fs.rmdir(usersDir);
            console.log('  ✓ removed empty users/ directory');
        } else {
            console.log(`  • users/ not removed — ${left.length} file(s) remain: ${left.join(', ')}`);
        }
    } catch (_) { /* already gone */ }
}

async function migrateSubscriptions(summary) {
    const subFile = path.join(appBaseDir, 'notifications', 'subscriptions.json');
    let subs;
    try {
        subs = JSON.parse(await fs.readFile(subFile, 'utf8'));
    } catch (err) {
        console.log('No global subscriptions.json — skipping subscriptions split.');
        return;
    }
    if (!Array.isArray(subs)) return;

    const byPrefix = new Map();
    for (const sub of subs) {
        const prefix = userStore.userDir(sub.userId);
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix).push(sub);
    }
    for (const [prefix, arr] of byPrefix) {
        await userStore.writeJson(appBaseDir, prefix, 'subscriptions.json', arr);
        summary.moved.push(`subscriptions → ${prefix}/subscriptions.json (${arr.length})`);
        console.log(`  ✓ subscriptions → .useractivity/${prefix}/subscriptions.json (${arr.length})`);
    }
    // The global file is no longer read; remove it to avoid confusion.
    await fs.unlink(subFile).catch(() => {});
    console.log(`  ✓ removed global notifications/subscriptions.json (${subs.length} entr${subs.length === 1 ? 'y' : 'ies'} split)`);
}

async function migrateDashboards(idToEmail, summary) {
    // Content repos are siblings of the workspace root (parent of .application).
    const workspaceRoot = path.dirname(appBaseDir);
    let siblings;
    try {
        siblings = await fs.readdir(workspaceRoot, { withFileTypes: true });
    } catch (err) {
        console.log('Could not scan for content repos — skipping dashboards.');
        return;
    }
    const dashDirs = siblings
        .filter(d => d.isDirectory() && d.name.startsWith('digital-technologies-content-'))
        .map(d => path.join(workspaceRoot, d.name, '.dashboards'));

    const prefixes = [...new Set(Object.values(idToEmail).map(e => userStore.userDir(e)))];
    for (const prefix of prefixes) {
        for (const dir of dashDirs) {
            const candidate = path.join(dir, `${prefix}.md`);
            try {
                const md = await fs.readFile(candidate, 'utf8');
                await userStore.writeText(appBaseDir, prefix, 'dashboard.md', md);
                summary.moved.push(`dashboard → ${prefix}/dashboard.md`);
                console.log(`  ✓ dashboard → .useractivity/${prefix}/dashboard.md (from ${path.basename(path.dirname(dir))})`);
                break; // first match wins — copies are identical across repos
            } catch (_) { /* not in this repo — try the next */ }
        }
    }
}

async function main() {
    console.log(`Migrating user activity under: ${appBaseDir}\n`);
    const idToEmail = await loadIdToEmail();
    const summary = { moved: [], deleted: [] };

    console.log('users/ files:');
    await migrateUsersFolder(idToEmail, summary);

    console.log('\nsubscriptions:');
    await migrateSubscriptions(summary);

    console.log('\ndashboards:');
    await migrateDashboards(idToEmail, summary);

    console.log(`\nDone. Moved ${summary.moved.length} item(s), deleted ${summary.deleted.length} orphan(s).`);
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
