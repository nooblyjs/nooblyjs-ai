/**
 * @fileoverview Manual test runner for ContextProcessor.ensureFolderHome — the
 * provenance rule that decides whether a folder's `.home.md` may be rewritten.
 *
 * Unlike its siblings this needs NO registry, NO spaces.json and NO AI provider: the
 * rule is pure filesystem logic, so the runner builds a throwaway tree under the OS
 * temp dir, drives the real method against it, and asserts what landed on disk.
 *
 * What it protects:
 *
 *   The build seeds `<folder>/.home.md` from that folder's context roll-up. Because
 *   the page DESCRIBES the folder it goes stale as documents are added — but a page
 *   on disk carries no record of its author, so the build long refused to touch an
 *   existing home at all, and a seeded page was frozen at version one forever.
 *   `<folder>/.system/home-seed.json` records a hash of exactly what was written,
 *   which is what lets a rebuild refresh its OWN page while never overwriting a
 *   hand-written one. Every branch that is not "provably ours and unchanged" must
 *   leave the page alone — that asymmetry is the whole safety property, so if you
 *   change ensureFolderHome, this is the file that says whether you broke it.
 *
 * The platform side of the same contract (marker layout, deletion) is covered by
 * nooblyjs-ai-knowledge/tests/backend/components/homeSeedMarker.test.js.
 *
 * Usage:
 *   node ensureFolderHome.script.js
 *
 * Exits non-zero on the first failure.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const ContextProcessor = require('../../services/contextProcessor');

const SILENT = { info() {}, warn() {}, error() {} };

let root;
let passed = 0;

/** Fresh throwaway space root for one case. */
function newSpace() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-home-'));
  return new ContextProcessor({
    space: { id: 0, name: 'test', baseDir: root },
    wikiApi: {},
    expert: {},
    logger: SILENT,
  });
}

const abs = (rel) => path.join(root, rel);
const put = (rel, body) => {
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), body, 'utf8');
};
const read = (rel) => fs.readFileSync(abs(rel), 'utf8');
const gone = (rel) => !fs.existsSync(abs(rel));

/** Write the roll-up ensureFolderHome copies from. */
const rollup = (processor, folder, body) => {
  const p = processor.folderContextPath(folder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
};

function test(name, fn) {
  const processor = newSpace();
  try {
    fn(processor);
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log('ensureFolderHome — provenance rule\n');

test('no home file -> seeded, and the marker records what was written', (p) => {
  rollup(p, 'Sell', '# Sell\nv1\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), true);
  assert.strictEqual(read('Sell/.home.md'), '# Sell\nv1\n');
  assert.strictEqual(p.stats.homesSeeded, 1);
  assert.strictEqual(p.stats.homesRefreshed, 0);

  const seed = JSON.parse(read('Sell/.system/home-seed.json'));
  assert.strictEqual(seed.file, '.home.md');
  assert.strictEqual(seed.hash, p.hashHome('# Sell\nv1\n'));
  assert.ok(seed.seededAt && seed.updatedAt, 'marker carries both timestamps');
});

test('the "— folder context" header suffix is still stripped', (p) => {
  rollup(p, 'Sell', '# Sell — folder context\n\nBody\n');
  p.ensureFolderHome('Sell');
  assert.strictEqual(read('Sell/.home.md'), '# Sell\n\nBody\n');
  // The marker must hash what was WRITTEN, not the roll-up it came from, or the
  // very next run reads its own page as hand-edited.
  assert.strictEqual(
    JSON.parse(read('Sell/.system/home-seed.json')).hash,
    p.hashHome('# Sell\n\nBody\n'));
});

test('* ours and untouched -> REFRESHED (the whole point of the marker)', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');

  rollup(p, 'Sell', '# v2 — now with the documents added since\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), true);
  assert.strictEqual(read('Sell/.home.md'), '# v2 — now with the documents added since\n');
  assert.strictEqual(p.stats.homesSeeded, 1, 'a refresh is not counted as a seed');
  assert.strictEqual(p.stats.homesRefreshed, 1);
});

test('ownership is not spent on first use — it refreshes every run', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  rollup(p, 'Sell', '# v2\n');
  p.ensureFolderHome('Sell');
  rollup(p, 'Sell', '# v3\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), true);
  assert.strictEqual(read('Sell/.home.md'), '# v3\n');
  assert.strictEqual(p.stats.homesRefreshed, 2);
});

test('* edited by hand -> left alone, permanently', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  put('Sell/.home.md', '# My own words\n');

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(read('Sell/.home.md'), '# My own words\n');

  // Still refused on every LATER run, not just the next one.
  rollup(p, 'Sell', '# v3\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(read('Sell/.home.md'), '# My own words\n');
  assert.strictEqual(p.stats.homesRefreshed, 0);
});

test('no marker -> hand-written, or pre-dates provenance: hands off', (p) => {
  put('Sell/.home.md', '# Written before any of this existed\n');
  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(read('Sell/.home.md'), '# Written before any of this existed\n');
});

test('a corrupt marker fails to "not ours", never to "overwrite"', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  put('Sell/.system/home-seed.json', '{ this is not json');

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(read('Sell/.home.md'), '# v1\n');
});

test('a marker with no hash is not proof of anything', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  put('Sell/.system/home-seed.json', JSON.stringify({ file: '.home.md' }));

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
});

test('a hand-written home.md is never seeded over, marker or not', (p) => {
  put('Sell/home.md', '# The real landing page\n');
  rollup(p, 'Sell', '# v1\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.ok(gone('Sell/.home.md'), 'no .home.md is created beside it');
});

test('a home.md beside a seeded .home.md wins the display, so no churn', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  put('Sell/home.md', '# The real landing page\n');

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(read('Sell/.home.md'), '# v1\n');
});

test('an unchanged roll-up writes nothing, so the mtime keeps meaning something', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  const before = fs.statSync(abs('Sell/.home.md')).mtimeMs;

  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.strictEqual(fs.statSync(abs('Sell/.home.md')).mtimeMs, before);
});

test('a CRLF round-trip through git is not mistaken for an edit', (p) => {
  rollup(p, 'Sell', '# v1\nline two\n');
  p.ensureFolderHome('Sell');
  put('Sell/.home.md', '# v1\r\nline two\r\n');   // autocrlf checkout

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), true,
    'CRLF normalisation keeps the page ours');
});

test('deleting the page (and its marker) gets a fresh one', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  put('Sell/.home.md', '# My own words\n');
  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);

  // What the wiki's folder-view Delete button does, via documentArtifacts.
  fs.unlinkSync(abs('Sell/.home.md'));
  fs.unlinkSync(abs('Sell/.system/home-seed.json'));

  assert.strictEqual(p.ensureFolderHome('Sell'), true);
  assert.strictEqual(read('Sell/.home.md'), '# v2\n');
});

test('deleting only the page still works — a stale marker proves nothing', (p) => {
  rollup(p, 'Sell', '# v1\n');
  p.ensureFolderHome('Sell');
  fs.unlinkSync(abs('Sell/.home.md'));   // marker left behind

  rollup(p, 'Sell', '# v2\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), true);
  assert.strictEqual(read('Sell/.home.md'), '# v2\n');
});

test('no roll-up to copy from -> nothing happens', (p) => {
  fs.mkdirSync(abs('Sell'), { recursive: true });
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.ok(gone('Sell/.home.md'));
  assert.ok(gone('Sell/.system/home-seed.json'), 'no marker for a page never written');
});

test('an empty roll-up is not a landing page', (p) => {
  rollup(p, 'Sell', '   \n\n');
  assert.strictEqual(p.ensureFolderHome('Sell'), false);
  assert.ok(gone('Sell/.home.md'));
});

test('the space root is just another folder', (p) => {
  rollup(p, '', '# Space\n');
  assert.strictEqual(p.ensureFolderHome(''), true);
  assert.strictEqual(read('.home.md'), '# Space\n');
  assert.strictEqual(read('.system/home-seed.json').includes('"hash"'), true);

  rollup(p, '', '# Space v2\n');
  assert.strictEqual(p.ensureFolderHome(''), true);
  assert.strictEqual(read('.home.md'), '# Space v2\n');
});

test('a nested folder keeps its marker beside its own page', (p) => {
  rollup(p, 'A/B/C', '# Deep\n');
  assert.strictEqual(p.ensureFolderHome('A/B/C'), true);
  assert.strictEqual(read('A/B/C/.home.md'), '# Deep\n');
  assert.ok(fs.existsSync(abs('A/B/C/.system/home-seed.json')));
  assert.ok(gone('.system/home-seed.json'), 'nothing is written at the space root');
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
