'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const repo = require('../src/storage/fsRepository');
const { NotFoundError } = require('../src/lib/errors');

test.after(() => cleanup(dir));

test('writes and reads back a document', async () => {
  const file = path.join(dir, 'doc.json');
  await repo.writeJsonAtomic(file, { hello: 'world' });
  assert.deepEqual(await repo.readJson(file), { hello: 'world' });
});

test('a successful write leaves no temp files behind', async () => {
  const file = path.join(dir, 'clean.json');
  await repo.writeJsonAtomic(file, { a: 1 });
  const strays = fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(strays, []);
});

test('concurrent writes to one file serialise into a valid result', async () => {
  const file = path.join(dir, 'race.json');
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => repo.writeJsonAtomic(file, { n: i, pad: 'y'.repeat(500) }))
  );
  const result = await repo.readJson(file);
  assert.equal(typeof result.n, 'number', 'file must be valid JSON, not interleaved');
  assert.equal(result.pad.length, 500);
});

test('a failed write leaves the previous version intact', async () => {
  const file = path.join(dir, 'durable.json');
  await repo.writeJsonAtomic(file, { version: 1 });

  const circular = {};
  circular.self = circular;
  await assert.rejects(() => repo.writeJsonAtomic(file, circular));

  assert.deepEqual(await repo.readJson(file), { version: 1 });
});

test('reading a missing file is a NotFoundError', async () => {
  await assert.rejects(() => repo.readJson(path.join(dir, 'nope.json')), NotFoundError);
});

test('listing a missing directory returns empty rather than throwing', async () => {
  assert.deepEqual(await repo.listFiles(path.join(dir, 'missing')), []);
  assert.deepEqual(await repo.listDirs(path.join(dir, 'missing')), []);
});

test('listings ignore in-flight temp files', async () => {
  const sub = path.join(dir, 'listing');
  await repo.ensureDir(sub);
  await repo.writeJsonAtomic(path.join(sub, 'real.json'), {});
  fs.writeFileSync(path.join(sub, 'other.json.tmp-123-abc'), '{}');
  assert.deepEqual(await repo.listFiles(sub), ['real.json']);
});
