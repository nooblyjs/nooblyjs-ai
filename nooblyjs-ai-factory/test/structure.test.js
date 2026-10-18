// The repo's LAYOUT: src/ holds only the NooblyJS app folders (the same ones as nooblyjs-ai-teammate),
// and test/ mirrors it. A new top-level folder, or a test with no source folder to match, fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const FOLDERS = ['config', 'controllers', 'middleware', 'models', 'roles', 'routes', 'services', 'utils'];
const dirs = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const files = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('src/ holds exactly the eight app folders, and no loose files', () => {
  assert.deepEqual(dirs(path.join(ROOT, 'src')), FOLDERS);
  assert.deepEqual(files(path.join(ROOT, 'src')), []);
});

test('test/ uses the same folders (plus fixtures/), and every test sits beside a matching source folder', () => {
  const extra = dirs(path.join(ROOT, 'test')).filter((d) => !FOLDERS.includes(d) && d !== 'fixtures');
  assert.deepEqual(extra, [], 'test/ folders that src/ does not have');
  const orphans = walk(path.join(ROOT, 'test'))
    .filter((f) => f.endsWith('.test.js') && path.dirname(f) !== path.join(ROOT, 'test'))
    .map((f) => path.relative(path.join(ROOT, 'test'), path.dirname(f)))
    .filter((dir) => !fs.existsSync(path.join(ROOT, 'src', dir)));
  assert.deepEqual([...new Set(orphans)], [], 'test folders with no src folder of the same name');
});

test('every folder in src/ has tests', () => {
  for (const folder of FOLDERS) {
    const tests = walk(path.join(ROOT, 'test', folder)).filter((f) => f.endsWith('.test.js'));
    assert.ok(tests.length > 0, `test/${folder}/ has no tests`);
  }
});

test('the library entry is the root index.js, and package.json points at it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'index.js');
  assert.ok(fs.existsSync(path.join(ROOT, 'index.js')));
});

test('every relative import in src/ resolves to a file', () => {
  const missing = [];
  for (const file of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) missing.push(`${path.relative(ROOT, file)} → ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the HTTP layers point one way: routes → controllers → models/services, never back', () => {
  const importsOf = (folder) => walk(path.join(ROOT, 'src', folder))
    .filter((f) => f.endsWith('.js'))
    .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => path.relative(path.join(ROOT, 'src'), path.resolve(path.dirname(f), m[1])).split(path.sep)[0]));
  for (const folder of ['models', 'middleware', 'utils', 'config']) {
    const back = importsOf(folder).filter((top) => ['routes', 'controllers'].includes(top));
    assert.deepEqual(back, [], `src/${folder}/ must not import routes or controllers`);
  }
});
