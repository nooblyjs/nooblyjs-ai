import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { readTool } from '../src/tools/read.js';

let dir;
let outside;
const ctx = () => ({ cwd: dir, session: { readFiles: new Map() } });

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noobly-read-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'noobly-outside-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  fs.writeFileSync(path.join(dir, 'image.bin'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  fs.writeFileSync(path.join(dir, 'long.txt'), Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'sneaky-link.txt'));
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('reads a file with line numbers', async () => {
  const out = await readTool.call({ file_path: 'hello.txt' }, ctx());
  assert.equal(out.content, '     1\tone\n     2\ttwo\n     3\tthree');
  assert.equal(out.display, '3 lines');
});

test('offset and limit read part of a file, and say how to read more', async () => {
  const out = await readTool.call({ file_path: 'long.txt', offset: 3, limit: 2 }, ctx());
  assert.match(out.content, /^ {5}3\tline 3\n {5}4\tline 4/);
  assert.match(out.content, /Showed lines 3-4 of 10\. Use offset=5 to read more\./);
});

test('absolute paths inside the project work', async () => {
  const out = await readTool.call({ file_path: path.join(dir, 'hello.txt') }, ctx());
  assert.equal(out.display, '3 lines');
});

test('records the file in session.readFiles', async () => {
  const context = ctx();
  await readTool.call({ file_path: 'hello.txt' }, context);
  assert.ok(context.session.readFiles.has(fs.realpathSync(path.join(dir, 'hello.txt'))));
});

test('explains the problem for missing files, directories, binaries and empty files', async () => {
  await assert.rejects(readTool.call({ file_path: 'nope.txt' }, ctx()), /File not found: nope.txt/);
  await assert.rejects(readTool.call({ file_path: 'sub' }, ctx()), /is a directory/);
  await assert.rejects(readTool.call({ file_path: 'image.bin' }, ctx()), /binary file/);
  await assert.rejects(readTool.call({ file_path: 'hello.txt', offset: 50 }, ctx()), /past the end of the file, which has 3 lines/);
  assert.equal((await readTool.call({ file_path: 'empty.txt' }, ctx())).content, '(This file is empty.)');
});

test('refuses files outside the project, including through a symlink', async () => {
  await assert.rejects(readTool.call({ file_path: path.join(outside, 'secret.txt') }, ctx()), /outside the project/);
  await assert.rejects(readTool.call({ file_path: '../' + path.basename(outside) + '/secret.txt' }, ctx()), /outside the project/);
  await assert.rejects(readTool.call({ file_path: 'sneaky-link.txt' }, ctx()), /outside the project/);
});

test('summarize shows project paths relative, others as given', () => {
  assert.equal(readTool.summarize({ file_path: path.join(dir, 'hello.txt') }, ctx()), 'hello.txt');
  assert.equal(readTool.summarize({ file_path: '/etc/passwd' }, ctx()), '/etc/passwd');
});
