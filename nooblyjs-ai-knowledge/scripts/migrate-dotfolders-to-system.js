/**
 * @fileoverview One-off migration: consolidate the space-root hidden folders
 * under a single `.system/` namespace.
 *
 * For every space content dir (from `.application/spaces/spaces.json`) AND the
 * app base dir itself, each legacy space-root folder is moved into `.system/`:
 *
 *   .derived                 -> .system/derived
 *   .useractivity            -> .system/useractivity
 *   .dashboards              -> .system/dashboards
 *   .continuous-explorations -> .system/continuous-explorations
 *   .templates               -> .system/templates
 *   .archive                 -> .system/archive
 *
 * Per-folder items (`.settings`, `.aicontext`, `.context`, `.originals`,
 * `.home.md`) are NOT touched — they are folder-local by design and stay put.
 * The app base dir's existing `.system/.help`, `.system/.headline` and
 * `.system/.whatsnew` are already in place; only its global `.useractivity`
 * (profile preferences) moves.
 *
 * Run from the repo root:
 *   node scripts/migrate-dotfolders-to-system.js            # apply
 *   node scripts/migrate-dotfolders-to-system.js --dry-run  # preview
 *
 * Idempotent: re-running is a no-op once the legacy folders are gone. If a
 * target already exists (a partial prior run), children are merged into it
 * without overwriting existing files, and a warning is printed.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-13
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');

const spaceUserStore = require('../src/wiki/components/spaceUserStore');

const DRY_RUN = process.argv.includes('--dry-run');

// Legacy folder name (space-root) -> subfolder name under `.system/`.
const SYSTEM_DIR = '.system';
const MOVES = [
    ['.derived', 'derived'],
    ['.useractivity', 'useractivity'],
    ['.dashboards', 'dashboards'],
    ['.continuous-explorations', 'continuous-explorations'],
    ['.templates', 'templates'],
    ['.archive', 'archive'],
];

function resolveAppBaseDir() {
    if (process.env.APP_BASE_DIR) return process.env.APP_BASE_DIR;
    const candidates = [
        path.resolve(__dirname, '../../.application'),
        path.resolve(__dirname, '../.application'),
        path.join(process.cwd(), '.application'),
    ];
    for (const c of candidates) if (fs.existsSync(path.join(c, 'spaces', 'spaces.json'))) return c;
    return candidates[0];
}

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Move `src` to `dest`. Handles the normal case (rename), a pre-existing target
 * (merge children without overwriting), and cross-device moves (copy + remove).
 * Returns 'moved' | 'merged'.
 */
async function movePath(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (!fs.existsSync(dest)) {
        try {
            await fsp.rename(src, dest);
            return 'moved';
        } catch (err) {
            if (err.code !== 'EXDEV') throw err;
            // Different volume — fall back to copy + remove.
            await fsp.cp(src, dest, { recursive: true, force: false, errorOnExist: false });
            await fsp.rm(src, { recursive: true, force: true });
            return 'moved';
        }
    }

    // Target already exists — merge source children into it (never overwrite an
    // existing file), then drop the now-emptied source.
    await fsp.cp(src, dest, { recursive: true, force: false, errorOnExist: false });
    await fsp.rm(src, { recursive: true, force: true });
    return 'merged';
}

async function migrateDir(label, dir) {
    if (!isDir(dir)) return { label, dir, actions: [], skipped: 'no such dir' };
    const actions = [];
    for (const [legacy, target] of MOVES) {
        const src = path.join(dir, legacy);
        if (!isDir(src)) continue;
        const dest = path.join(dir, SYSTEM_DIR, target);

        if (DRY_RUN) {
            const merge = fs.existsSync(dest) ? ' (merge — target exists)' : '';
            actions.push(`would move ${legacy} -> ${SYSTEM_DIR}/${target}${merge}`);
            continue;
        }

        const result = await movePath(src, dest);
        actions.push(`${legacy} -> ${SYSTEM_DIR}/${target}${result === 'merged' ? ' (merged)' : ''}`);
        if (result === 'merged') {
            console.warn(`  ! ${label}: ${SYSTEM_DIR}/${target} already existed — merged without overwriting`);
        }
    }
    return { label, dir, actions };
}

async function main() {
    // Space `path`s in spaces.json may be relative (e.g. `../knowledge-content/x`)
    // and are resolved by spaceUserStore against process.cwd(). The server runs
    // from the repo root, so anchor cwd there — otherwise, invoked from some other
    // directory, relative space dirs resolve to nowhere and get silently skipped.
    const repoRoot = path.resolve(__dirname, '..');
    try { process.chdir(repoRoot); } catch { /* best-effort */ }

    const appBaseDir = resolveAppBaseDir();
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Consolidating space-root dot-folders under ${SYSTEM_DIR}/`);
    console.log(`App base dir: ${appBaseDir}\n`);

    const spaces = await spaceUserStore.loadSpaces(appBaseDir).catch(() => []);

    // Build a deduped list of target directories: the app base dir (for the
    // global .useractivity) plus every space's content dir.
    const targets = new Map(); // absPath -> label
    targets.set(path.resolve(appBaseDir), 'app base dir');
    for (const space of spaces) {
        const dir = spaceUserStore.spaceContentDir(space);
        if (dir) targets.set(path.resolve(dir), `space "${space.name}"`);
    }

    let totalActions = 0;
    for (const [dir, label] of targets) {
        const { actions, skipped } = await migrateDir(label, dir);
        if (skipped) { continue; }
        if (actions.length) {
            console.log(`${label}  (${dir})`);
            for (const a of actions) console.log(`  ✓ ${a}`);
            totalActions += actions.length;
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. ${totalActions} folder move(s)${DRY_RUN ? ' pending' : ' applied'} across ${targets.size} location(s).`);
    if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
});
