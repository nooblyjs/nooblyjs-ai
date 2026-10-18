#!/usr/bin/env node
/**
 * @fileoverview Relocate the global site-content files out of the hidden
 * `.system/.*` folders under APP_BASE_DIR into a single visible `content/`
 * folder.
 *
 *   <APP_BASE_DIR>/.system/.headline/headline.txt  ->  <APP_BASE_DIR>/content/headline.txt
 *   <APP_BASE_DIR>/.system/.help/help.md           ->  <APP_BASE_DIR>/content/help.md
 *   <APP_BASE_DIR>/.system/.whatsnew/whatsnew.md   ->  <APP_BASE_DIR>/content/whatsnew.md
 *
 * The app reads the new location first and falls back to the old one, so this
 * migration is a tidy-up rather than a hard requirement — but until it runs,
 * the first admin save writes to the new location and the stale legacy file
 * lingers, which is confusing. Run it once per environment.
 *
 * DRY RUN BY DEFAULT — prints what it would do and changes nothing. Pass
 * `--apply` to perform the move.
 *
 * Usage:
 *   node scripts/migrate-system-content-to-content.js [options]
 *
 * Options:
 *   --apply            Actually move the files (default: dry run)
 *   --base-dir <path>  APP_BASE_DIR to migrate. Defaults to $APP_BASE_DIR, then
 *                      <repo>/.application
 *   --keep-legacy      Copy instead of move — leave the old file in place
 *   --help             Show this help
 *
 * Self-contained: imports nothing from the app, so it can be copied to a
 * production host and run there. Safe to re-run; already-migrated files are
 * reported and skipped, and an existing destination is never overwritten.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

/** Kept in step with src/shared/content/contentPaths.js. */
const MIGRATIONS = [
  { kind: 'headline', legacy: ['.system', '.headline', 'headline.txt'], file: 'headline.txt' },
  { kind: 'help', legacy: ['.system', '.help', 'help.md'], file: 'help.md' },
  { kind: 'whatsnew', legacy: ['.system', '.whatsnew', 'whatsnew.md'], file: 'whatsnew.md' }
];

function parseArgs(argv) {
  const args = { apply: false, keepLegacy: false, baseDir: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--keep-legacy') args.keepLegacy = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--base-dir') { args.baseDir = argv[i + 1]; i += 1; }
    else {
      console.error(`Unknown option: ${arg}\nRun with --help for usage.`);
      process.exit(2);
    }
  }
  return args;
}

function resolveBaseDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.APP_BASE_DIR) return path.resolve(process.env.APP_BASE_DIR);
  // <repo>/scripts/this.js -> <repo>/.application
  return path.resolve(__dirname, '..', '.application');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }

  const baseDir = resolveBaseDir(args.baseDir);
  const contentDir = path.join(baseDir, 'content');
  const mode = args.apply ? 'APPLY' : 'DRY RUN';
  const verb = args.keepLegacy ? 'copy' : 'move';

  console.log('='.repeat(72));
  console.log(`  Site content migration  [${mode}]`);
  console.log('='.repeat(72));
  console.log(`  APP_BASE_DIR : ${baseDir}`);
  console.log(`  Destination  : ${contentDir}`);
  console.log(`  Mode         : ${verb} legacy file to destination`);
  console.log('-'.repeat(72));

  if (!fs.existsSync(baseDir)) {
    console.error(`\nERROR: APP_BASE_DIR does not exist: ${baseDir}`);
    process.exit(1);
  }

  let planned = 0;
  let skipped = 0;
  const actions = [];

  for (const entry of MIGRATIONS) {
    const legacyPath = path.join(baseDir, ...entry.legacy);
    const targetPath = path.join(contentDir, entry.file);
    const legacyExists = fs.existsSync(legacyPath);
    const targetExists = fs.existsSync(targetPath);

    if (!legacyExists && !targetExists) {
      console.log(`  -  ${entry.kind.padEnd(9)} nothing to do (neither location exists)`);
      skipped += 1;
    } else if (!legacyExists && targetExists) {
      console.log(`  =  ${entry.kind.padEnd(9)} already migrated -> ${targetPath}`);
      skipped += 1;
    } else if (legacyExists && targetExists) {
      // Never clobber: the destination may hold newer content written by an
      // admin save after the code change but before this script ran.
      console.log(`  !  ${entry.kind.padEnd(9)} SKIPPED — destination already exists, not overwriting`);
      console.log(`     legacy : ${legacyPath} (${fs.statSync(legacyPath).size} bytes)`);
      console.log(`     target : ${targetPath} (${fs.statSync(targetPath).size} bytes)`);
      console.log('     Remove or rename one of them, then re-run.');
      skipped += 1;
    } else {
      console.log(`  ${args.apply ? '>' : '?'}  ${entry.kind.padEnd(9)} ${verb} ${legacyPath}`);
      console.log(`     ${' '.repeat(9)}   -> ${targetPath} (${fs.statSync(legacyPath).size} bytes)`);
      actions.push({ entry, legacyPath, targetPath });
      planned += 1;
    }
  }

  if (args.apply && actions.length) {
    fs.mkdirSync(contentDir, { recursive: true });
    for (const action of actions) {
      fs.copyFileSync(action.legacyPath, action.targetPath);
      if (!args.keepLegacy) {
        fs.unlinkSync(action.legacyPath);
        // Remove the now-empty hidden folder; harmless if others put files there.
        try {
          fs.rmdirSync(path.dirname(action.legacyPath));
        } catch { /* not empty, or already gone — leave it */ }
      }
    }
  }

  console.log('-'.repeat(72));
  if (!args.apply && planned > 0) {
    console.log(`  ${planned} file(s) would be migrated, ${skipped} skipped.`);
    console.log('  DRY RUN — nothing was changed. Re-run with --apply to perform the migration.');
  } else if (args.apply) {
    console.log(`  ${planned} file(s) migrated, ${skipped} skipped.`);
  } else {
    console.log(`  Nothing to migrate (${skipped} skipped).`);
  }
  console.log('='.repeat(72));
}

main();
