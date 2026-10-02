import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as users from '../../src/users.js';

test('renamed, alias kept', () => {
  assert.equal(users.getUser(2), 'Grace');
  assert.equal(users.getUsr(1), 'Ada');
  assert.doesNotMatch(fs.readFileSync('src/main.js', 'utf8'), /getUsr/);
  assert.equal(execFileSync(process.execPath, ['src/main.js'], { encoding: 'utf8' }).trim(), 'Ada and Grace');
});
