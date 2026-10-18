/**
 * @fileoverview Test the orphaned-clone sweep.
 *
 * Self-contained: builds a throwaway working folder in the OS temp dir, runs the
 * pure finder against it, and cleans up. No backend, no credentials, no network.
 *
 *   node application-design/tests/utilities/orphanedClones.js
 *
 * What it pins down is the set of mistakes that cost real money if they ever
 * regress — this code deletes clones, and a deleted clone is re-documented from
 * scratch in AI calls:
 *
 *   - a clone is a DIRECTORY PLUS a sibling `.state.json`, and both halves must
 *     be reported together (a surviving marker makes a re-listed repo resume
 *     from a stale SHA and document nothing);
 *   - name matching is case-insensitive, because these folders live on Windows;
 *   - `sweepOrphans` REFUSES to act when no repository rows were read, which is
 *     what a mistyped configuration folder looks like.
 *
 * @author Digital Technologies Team
 * @since 2026-08-26
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findOrphanedClones, removeOrphan, formatBytes } =
   require('../../utilities/orphanedClones.js');
const { sweepOrphans } = require('../../steps/discover-repos.js');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
   if (condition) { passed += 1; console.log(`  ok    ${label}`); return; }
   failed += 1;
   console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

function equal(label, actual, expected) {
   const a = JSON.stringify(actual);
   const e = JSON.stringify(expected);
   check(label, a === e, `expected ${e}\n        actual   ${a}`);
}

/** Build a working folder: clone dirs, their markers, and some decoys. */
function makeWorkingFolder() {
   const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-test-'));
   const clone = (name, files = 1) => {
      const dir = path.join(root, name);
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      for (let i = 0; i < files; i++) {
         fs.writeFileSync(path.join(dir, 'src', `f${i}.js`), 'x'.repeat(1000), 'utf8');
      }
      fs.writeFileSync(
         path.join(root, `.${name}.state.json`),
         JSON.stringify({ lastProcessedSha: 'abc123' }), 'utf8');
   };
   clone('live-service', 2);
   clone('My-Service', 1);          // listed with different casing
   clone('gone-service', 3);        // orphan: folder + marker
   // Orphan marker whose folder has already been deleted by hand.
   fs.writeFileSync(path.join(root, '.vanished.state.json'), '{}', 'utf8');
   // Decoys that must never be treated as clones.
   fs.mkdirSync(path.join(root, '.tooling'), { recursive: true });
   fs.writeFileSync(path.join(root, 'README.txt'), 'not a clone', 'utf8');
   return root;
}

const root = makeWorkingFolder();
const known = ['live-service', 'my-service'];   // note the lower-case casing

console.log('\nfindOrphanedClones');
{
   const { orphans, kept } = findOrphanedClones({ dataFolder: root, knownNames: known });
   const names = orphans.map((o) => o.name).sort();

   equal('reports exactly the unlisted clones', names, ['gone-service', 'vanished']);
   check('a listed clone is kept whatever its casing', kept.length === 2, `kept=${kept}`);
   check('a dot-directory is not a clone', !names.includes('.tooling'));
   check('a loose file is not a clone', !names.includes('README.txt'));

   const gone = orphans.find((o) => o.name === 'gone-service');
   check('an orphan carries BOTH its folder and its state marker',
      !!gone.folder && !!gone.statePath, JSON.stringify(gone));
   check('an orphan reports a non-zero size', gone.bytes >= 3000, `bytes=${gone.bytes}`);

   const vanished = orphans.find((o) => o.name === 'vanished');
   check('a marker with no folder is itself an orphan',
      vanished.folder === null && !!vanished.statePath, JSON.stringify(vanished));

   check('orphans sort largest first', orphans[0].name === 'gone-service');
}

console.log('\nfindOrphanedClones — nothing to do');
{
   const absent = findOrphanedClones({ dataFolder: path.join(root, 'nope'), knownNames: known });
   check('a missing working folder reports missing, not orphans',
      absent.missing === true && absent.orphans.length === 0);

   const all = findOrphanedClones({
      dataFolder: root,
      knownNames: ['live-service', 'my-service', 'gone-service', 'vanished'],
   });
   check('nothing is orphaned when everything is listed', all.orphans.length === 0);
}

console.log('\nsweepOrphans — the refusals');
{
   const makeSummary = (documentsProcessed) => ({
      documentsProcessed,
      orphans: { mode: 'remove', found: [], removed: [], errors: [], bytes: 0 },
   });
   const logger = { info() {}, warn() {}, error() {} };
   const settings = {
      targetFolderBase: root, orphanCleanup: 'remove', configurationLocation: 'X',
   };

   const noDocs = makeSummary(0);
   sweepOrphans({ settings, knownNames: new Set(known), summary: noDocs, logger });
   check('REFUSES when no documents were parsed',
      noDocs.orphans.refused === 'no repository rows were read'
      && noDocs.orphans.removed.length === 0);
   check('...and removes nothing', fs.existsSync(path.join(root, 'gone-service')));

   const noNames = makeSummary(3);
   sweepOrphans({ settings, knownNames: new Set(), summary: noNames, logger });
   check('REFUSES when documents parsed but listed no repositories',
      !!noNames.orphans.refused && noNames.orphans.removed.length === 0);

   const noFolder = makeSummary(1);
   sweepOrphans({
      settings: { ...settings, targetFolderBase: '' },
      knownNames: new Set(known), summary: noFolder, logger,
   });
   check('skips when no working folder is configured', noFolder.orphans.found.length === 0);

   const off = makeSummary(1);
   sweepOrphans({
      settings: { ...settings, orphanCleanup: 'off' },
      knownNames: new Set(known), summary: off, logger,
   });
   check('does nothing at all when mode is off', off.orphans.found.length === 0);
}

console.log('\nsweepOrphans — report mode is the safe default');
{
   const summary = {
      documentsProcessed: 1,
      orphans: { mode: 'report', found: [], removed: [], errors: [], bytes: 0 },
   };
   sweepOrphans({
      settings: { targetFolderBase: root, orphanCleanup: 'report', configurationLocation: 'X' },
      knownNames: new Set(known), summary, logger: { info() {}, warn() {}, error() {} },
   });
   check('reports the orphans it found', summary.orphans.found.length === 2);
   check('reports a human-readable size', /\d/.test(summary.orphans.found[0].size));
   check('removes NOTHING', summary.orphans.removed.length === 0
      && fs.existsSync(path.join(root, 'gone-service')));
}

console.log('\nsweepOrphans — remove mode takes both halves');
{
   const summary = {
      documentsProcessed: 1,
      orphans: { mode: 'remove', found: [], removed: [], errors: [], bytes: 0 },
   };
   sweepOrphans({
      settings: { targetFolderBase: root, orphanCleanup: 'remove', configurationLocation: 'X' },
      knownNames: new Set(known), summary, logger: { info() {}, warn() {}, error() {} },
   });

   equal('removed both orphans', summary.orphans.removed.sort(), ['gone-service', 'vanished']);
   check('the clone directory is gone', !fs.existsSync(path.join(root, 'gone-service')));
   check('its state marker went with it',
      !fs.existsSync(path.join(root, '.gone-service.state.json')));
   check('the stray marker is gone', !fs.existsSync(path.join(root, '.vanished.state.json')));
   check('the LISTED clones are untouched',
      fs.existsSync(path.join(root, 'live-service'))
      && fs.existsSync(path.join(root, '.live-service.state.json'))
      && fs.existsSync(path.join(root, 'My-Service')));
   check('the decoys are untouched',
      fs.existsSync(path.join(root, '.tooling')) && fs.existsSync(path.join(root, 'README.txt')));
   check('no errors', summary.orphans.errors.length === 0,
      JSON.stringify(summary.orphans.errors));
}

console.log('\nremoveOrphan / formatBytes');
{
   const nothing = removeOrphan({ name: 'x', folder: null, statePath: null });
   check('an orphan with nothing on disk is a no-op', nothing.removed.length === 0
      && nothing.errors.length === 0);
   equal('formatBytes', [formatBytes(0), formatBytes(2048), formatBytes(5 * 1024 * 1024)],
      ['0 B', '2.0 KB', '5.0 MB']);
}

fs.rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
