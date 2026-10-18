/**
 * @fileoverview One-off migration: relocate per-folder `.context/` sidecars into
 * the space-root `.system/context/` namespace, mirroring the source tree.
 *
 * The build-context workflow used to write its curated AI-context sidecars into a
 * hidden `.context/` folder next to each source folder:
 *
 *   <folder>/.context/<SourceFile>.md   (per-file context, keeps the source name)
 *   <folder>/.context/_folder.md        (folder roll-up)
 *
 * They now live under one hidden per-space namespace, alongside `derived` and
 * `originals`, mirroring the source path:
 *
 *   <folder>/.context/<file>  ->  .system/context/<folder>/<file>
 *   <folder>/.context/_folder.md -> .system/context/<folder>/_folder.md
 *   (root)   .context/<file>  ->  .system/context/<file>
 *
 * For every space content dir (from `.application/spaces/spaces.json`) this walks
 * the tree, finds every `.context/` folder, and moves its files to the mirrored
 * location under `.system/context/`, then removes the emptied `.context/` dir.
 *
 * Run from the repo root:
 *   node scripts/migrate-context-to-system.js            # apply
 *   node scripts/migrate-context-to-system.js --dry-run  # preview
 *
 * Idempotent: re-running is a no-op once the `.context/` folders are gone. If a
 * target file already exists (a partial prior run), it is left untouched and the
 * source is dropped, with a warning.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-20
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');

const spaceUserStore = require('../src/wiki/components/spaceUserStore');

const DRY_RUN = process.argv.includes('--dry-run');

const SYSTEM_DIR = '.system';
const CONTEXT_SUBDIR = 'context';
const LEGACY_CONTEXT = '.context';

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

/** Join a space-relative folder path with more segments, POSIX-style for display. */
function relJoin(rel, ...parts) {
    return [rel, ...parts].filter(Boolean).join('/');
}

/**
 * Move a single file `src` to `dest`, creating parent dirs. Never overwrites an
 * existing target (a prior partial run): in that case the source is dropped.
 * Handles cross-device moves (copy + remove). Returns 'moved' | 'kept-existing'.
 */
async function moveFile(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
        await fsp.rm(src, { force: true });
        return 'kept-existing';
    }
    try {
        await fsp.rename(src, dest);
        return 'moved';
    } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fsp.cp(src, dest, { recursive: true, force: false, errorOnExist: false });
        await fsp.rm(src, { recursive: true, force: true });
        return 'moved';
    }
}

/**
 * Recursively collect space-relative folder paths that contain a `.context/` dir.
 * Records the `.context` folder (without descending into it) and skips every
 * other hidden dir (`.system`, `.settings`, …) and `node_modules`.
 */
function findContextFolders(contentDir, rel, out) {
    const abs = rel ? path.join(contentDir, ...rel.split('/')) : contentDir;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === LEGACY_CONTEXT) { out.push(rel); continue; }
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        findContextFolders(contentDir, relJoin(rel, e.name), out);
    }
}

/** Move one folder's `.context/*` sidecars to `.system/context/<rel>/*`. */
async function migrateContextFolder(contentDir, rel) {
    const legacyDir = path.join(contentDir, ...(rel ? rel.split('/') : []), LEGACY_CONTEXT);
    const destDir = path.join(contentDir, SYSTEM_DIR, CONTEXT_SUBDIR, ...(rel ? rel.split('/') : []));
    const destRel = relJoin(`${SYSTEM_DIR}/${CONTEXT_SUBDIR}`, rel);

    let children;
    try { children = fs.readdirSync(legacyDir); } catch { return []; }

    const actions = [];
    for (const name of children) {
        const src = path.join(legacyDir, name);
        const dest = path.join(destDir, name);
        const from = relJoin(rel, LEGACY_CONTEXT, name);
        const to = relJoin(destRel, name);

        if (DRY_RUN) {
            actions.push(`would move ${from} -> ${to}${fs.existsSync(dest) ? ' (target exists — will keep existing)' : ''}`);
            continue;
        }
        const result = await moveFile(src, dest);
        if (result === 'kept-existing') {
            console.warn(`  ! ${to} already existed — kept existing, dropped ${from}`);
            actions.push(`${from} -> (kept existing ${to})`);
        } else {
            actions.push(`${from} -> ${to}`);
        }
    }

    // Drop the now-empty legacy `.context` dir.
    if (!DRY_RUN) { try { fs.rmdirSync(legacyDir); } catch { /* not empty / already gone */ } }
    return actions;
}

async function main() {
    // Space `path`s in spaces.json may be relative and are resolved by
    // spaceUserStore against process.cwd(); anchor cwd at the repo root so
    // relative space dirs resolve the same way the server resolves them.
    const repoRoot = path.resolve(__dirname, '..');
    try { process.chdir(repoRoot); } catch { /* best-effort */ }

    const appBaseDir = resolveAppBaseDir();
    console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Relocating .context/ sidecars into ${SYSTEM_DIR}/${CONTEXT_SUBDIR}/`);
    console.log(`App base dir: ${appBaseDir}\n`);

    const spaces = await spaceUserStore.loadSpaces(appBaseDir).catch(() => []);

    const targets = new Map(); // absPath -> label
    for (const space of spaces) {
        const dir = spaceUserStore.spaceContentDir(space);
        if (dir) targets.set(path.resolve(dir), `space "${space.name}"`);
    }

    let totalActions = 0;
    for (const [dir, label] of targets) {
        if (!isDir(dir)) continue;
        const folders = [];
        findContextFolders(dir, '', folders);
        if (folders.length === 0) continue;

        const lines = [];
        for (const rel of folders) {
            const actions = await migrateContextFolder(dir, rel);
            lines.push(...actions);
        }
        if (lines.length) {
            console.log(`${label}  (${dir})`);
            for (const a of lines) console.log(`  ✓ ${a}`);
            totalActions += lines.length;
        }
    }

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. ${totalActions} context file move(s)${DRY_RUN ? ' pending' : ' applied'} across ${targets.size} space(s).`);
    if (DRY_RUN) console.log('Re-run without --dry-run to apply.');
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
});
