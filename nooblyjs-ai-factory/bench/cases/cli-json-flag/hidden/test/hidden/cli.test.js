import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

const run = (...args) => execFileSync(process.execPath, ['src/report.js', ...args], { encoding: 'utf8' }).trim();
test('plain output unchanged', () => assert.equal(run(), '3 items, total 60'));
test('--json', () => assert.deepEqual(JSON.parse(run('--json')), { items: 3, total: 60 }));
