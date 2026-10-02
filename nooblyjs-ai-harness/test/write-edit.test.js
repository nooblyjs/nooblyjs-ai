import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { editTool } from '../src/tools/edit.js';
import { readTool } from '../src/tools/read.js';
import { writeTool } from '../src/tools/write.js';
import { makeProject, toolContext } from './helpers.js';

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

test('Write creates new files and missing folders without needing a Read', async () => {
  const dir = await makeProject();
  const out = await writeTool.call({ file_path: 'src/new/hello.js', content: 'a\nb\n' }, toolContext(dir));
  assert.equal(read(dir, 'src/new/hello.js'), 'a\nb\n');
  assert.match(out.content, /Created src\/new\/hello.js \(2 lines\)/);
});

test('Write refuses to overwrite a file it has not read', async () => {
  const dir = await makeProject({ 'a.txt': 'original' });
  await assert.rejects(writeTool.call({ file_path: 'a.txt', content: 'x' }, toolContext(dir)), /must Read a.txt before changing it/);
  assert.equal(read(dir, 'a.txt'), 'original');
});

test('Write can overwrite after a Read, and again after its own write', async () => {
  const dir = await makeProject({ 'a.txt': 'original' });
  const ctx = toolContext(dir);
  await readTool.call({ file_path: 'a.txt' }, ctx);
  await writeTool.call({ file_path: 'a.txt', content: 'second' }, ctx);
  await writeTool.call({ file_path: 'a.txt', content: 'third' }, ctx);
  assert.equal(read(dir, 'a.txt'), 'third');
});

test('Write and Edit refuse if the file changed since it was read', async () => {
  const dir = await makeProject({ 'a.txt': 'one' });
  const ctx = toolContext(dir);
  await readTool.call({ file_path: 'a.txt' }, ctx);
  // Someone else changes the file (set a clearly different mtime).
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed by you');
  fs.utimesSync(path.join(dir, 'a.txt'), new Date(), new Date(Date.now() + 5000));
  await assert.rejects(writeTool.call({ file_path: 'a.txt', content: 'x' }, ctx), /changed since you last read it/);
  await assert.rejects(editTool.call({ file_path: 'a.txt', old_string: 'one', new_string: 'two' }, ctx), /changed since you last read it/);
});

test('Write refuses paths outside the project, including through a symlinked folder', async () => {
  const dir = await makeProject();
  const outside = await makeProject();
  fs.symlinkSync(outside, path.join(dir, 'escape'));
  await assert.rejects(writeTool.call({ file_path: '../x.txt', content: 'x' }, toolContext(dir)), /outside the project/);
  await assert.rejects(writeTool.call({ file_path: 'escape/x.txt', content: 'x' }, toolContext(dir)), /outside the project/);
  assert.equal(fs.existsSync(path.join(outside, 'x.txt')), false);
});

async function readyToEdit(content) {
  const dir = await makeProject({ 'code.js': content });
  const ctx = toolContext(dir);
  await readTool.call({ file_path: 'code.js' }, ctx);
  return { dir, ctx };
}

test('Edit replaces an exact, unique string and shows a preview', async () => {
  const { dir, ctx } = await readyToEdit('const a = 1;\nconst b = 2;\n');
  const out = await editTool.call({ file_path: 'code.js', old_string: 'const b = 2;', new_string: 'const b = 3;\nconst c = 4;' }, ctx);
  assert.equal(read(dir, 'code.js'), 'const a = 1;\nconst b = 3;\nconst c = 4;\n');
  assert.match(out.content, /replaced 1 occurrence \(first at line 2\)/);
  assert.equal(out.display, '−1 +2 lines');
  assert.deepEqual(out.preview, ['- const b = 2;', '+ const b = 3;', '+ const c = 4;']);
});

test('Edit explains when old_string is missing or not unique', async () => {
  const { ctx } = await readyToEdit('x = 1\nx = 1\n');
  await assert.rejects(editTool.call({ file_path: 'code.js', old_string: 'y = 1', new_string: 'z' }, ctx), /was not found/);
  await assert.rejects(editTool.call({ file_path: 'code.js', old_string: 'x = 1', new_string: 'z' }, ctx), /appears 2 times/);
  await assert.rejects(editTool.call({ file_path: 'code.js', old_string: 'x', new_string: 'x' }, ctx), /identical/);
});

test('Edit with replace_all changes every occurrence', async () => {
  const { dir, ctx } = await readyToEdit('foo(); foo(); foo();');
  await editTool.call({ file_path: 'code.js', old_string: 'foo', new_string: 'bar', replace_all: true }, ctx);
  assert.equal(read(dir, 'code.js'), 'bar(); bar(); bar();');
});

test('Edit keeps "$" in the new text literally', async () => {
  const { dir, ctx } = await readyToEdit('price = 1');
  await editTool.call({ file_path: 'code.js', old_string: '1', new_string: '`$${cost}` $& $1' }, ctx);
  assert.equal(read(dir, 'code.js'), 'price = `$${cost}` $& $1');
});

test('Edit requires a prior Read', async () => {
  const dir = await makeProject({ 'code.js': 'a' });
  await assert.rejects(editTool.call({ file_path: 'code.js', old_string: 'a', new_string: 'b' }, toolContext(dir)), /must Read/);
});
