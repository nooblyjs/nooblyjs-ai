import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { globTool } from '../src/tools/glob.js';
import { grepTool, hasRipgrep, searchWithJavaScript, searchWithRipgrep } from '../src/tools/grep.js';
import { createPermissions } from '../src/permissions/gate.js';
import { makeProject, toolContext } from './helpers.js';

const files = {
  'src/app.js': 'import x from "y";\n// TODO: fix\nconst answer = 42;\n',
  'src/util/math.js': 'export function add(a, b) {\n  return a + b; // todo later\n}\n',
  'README.md': '# Demo\nTODO list\n',
  'image.bin': '\u0000\u0001TODO',
};

test('Glob finds files by pattern, newest first', async () => {
  const dir = await makeProject(files);
  fs.utimesSync(path.join(dir, 'src/util/math.js'), new Date(), new Date(Date.now() + 10_000));
  const out = await globTool.call({ pattern: '**/*.js' }, toolContext(dir));
  assert.equal(out.content, 'src/util/math.js\nsrc/app.js');
  assert.equal(out.display, '2 files');
});

test('Glob reports no matches clearly', async () => {
  const dir = await makeProject(files);
  assert.match((await globTool.call({ pattern: '*.py' }, toolContext(dir))).content, /No files match/);
});

test('Glob and Grep skip files ignored by git', async () => {
  const dir = await makeProject({ ...files, '.gitignore': 'dist/\n', 'dist/bundle.js': 'TODO' });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const globbed = await globTool.call({ pattern: '**/*.js' }, toolContext(dir));
  assert.doesNotMatch(globbed.content, /dist/);
  const grepped = await grepTool.call({ pattern: 'TODO' }, toolContext(dir));
  assert.doesNotMatch(grepped.content, /dist/);
});

test('Grep lists matching files (skipping binaries)', async () => {
  const dir = await makeProject(files);
  const out = await grepTool.call({ pattern: 'TODO' }, toolContext(dir));
  assert.equal(out.content, 'README.md\nsrc/app.js');
});

test('Grep content mode shows path:line:text, and ignore_case works', async () => {
  const dir = await makeProject(files);
  const out = await grepTool.call({ pattern: 'todo', ignore_case: true, output_mode: 'content' }, toolContext(dir));
  assert.equal(out.content, 'README.md:2:TODO list\nsrc/app.js:2:// TODO: fix\nsrc/util/math.js:2:  return a + b; // todo later');
});

test('Grep count mode, glob filter and path filter', async () => {
  const dir = await makeProject(files);
  const ctx = toolContext(dir);
  assert.equal((await grepTool.call({ pattern: 'Demo|TODO', output_mode: 'count', glob: '*.md' }, ctx)).content, 'README.md:2');
  assert.equal((await grepTool.call({ pattern: 'return', path: 'src/util' }, ctx)).content, 'src/util/math.js');
});

test('Grep head_limit caps the results', async () => {
  const dir = await makeProject(files);
  const out = await grepTool.call({ pattern: '.', output_mode: 'content', head_limit: 2 }, toolContext(dir));
  assert.match(out.content, /more lines not shown/);
  assert.equal(out.content.split('\n').filter((l) => l.includes(':')).length, 2);
});

test('Grep explains an invalid regex', async () => {
  const dir = await makeProject(files);
  await assert.rejects(searchWithJavaScript({ pattern: '(', mode: 'content', target: dir, cwd: dir }), /Invalid regular expression/);
});

test('ripgrep and the JavaScript fallback give the same results', { skip: !(await hasRipgrep()) && 'ripgrep is not installed' }, async () => {
  const dir = await makeProject(files);
  for (const mode of ['files_with_matches', 'content', 'count']) {
    for (const extra of [{}, { ignore_case: true }, { glob: '*.js' }]) {
      const args = { pattern: 'todo|add', mode, target: dir, cwd: dir, ...extra };
      const rg = (await searchWithRipgrep(args)).sort();
      const js = (await searchWithJavaScript(args)).sort();
      assert.deepEqual(rg, js, `mode ${mode} ${JSON.stringify(extra)}`);
    }
  }
});

test('Grep leaves out files a deny rule keeps you from reading (like .env), and never follows symlinks out', async () => {
  const outside = await makeProject({ 'id_rsa': 'PRIVATE KEY' });
  const dir = await makeProject({ '.env': 'SECRET=hunter2', 'app.js': 'const SECRET = process.env.SECRET;' });
  fs.symlinkSync(path.join(outside, 'id_rsa'), path.join(dir, 'key.txt'));
  const ctx = toolContext(dir);
  ctx.session.permissions = createPermissions();
  const out = await grepTool.call({ pattern: 'SECRET|KEY', output_mode: 'content' }, ctx);
  assert.match(out.content, /app\.js:1:/);
  assert.doesNotMatch(out.content, /hunter2|PRIVATE/);
  for (const search of [searchWithJavaScript, ...((await hasRipgrep()) ? [searchWithRipgrep] : [])]) {
    for (const mode of ['files_with_matches', 'content', 'count']) {
      const lines = await search({ pattern: 'SECRET|KEY', mode, target: dir, cwd: dir, skip: (file) => file === '.env' });
      assert.ok(lines.length > 0 && lines.every((line) => line.startsWith('app.js')), `${search.name} ${mode}: ${lines}`);
    }
  }
});
