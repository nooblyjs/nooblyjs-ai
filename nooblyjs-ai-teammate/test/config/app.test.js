// config/app.js: the mount path check and the paths the app is configured with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkMountPath, DEFAULT_MOUNT_PATH, PUBLIC_DIR, LOGIN_PATH } from '../../src/config/app.js';

test('the mount path is one or more plain path segments', () => {
  assert.equal(DEFAULT_MOUNT_PATH, '/teammates');
  for (const ok of ['/teammates', '/teammates-2', '/apps/teammates', '/a.b_c~d']) assert.equal(checkMountPath(ok), ok);
  for (const bad of ['', '/', 'teammates', '/teammates/', '//teammates', '/team mates', undefined]) {
    assert.throws(() => checkMountPath(bad), /mount path must look like \/teammates/, String(bad));
  }
});

test('the public folder holds the browser files, and no HTML page', () => {
  assert.equal(path.basename(PUBLIC_DIR), 'public');
  assert.ok(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'client.js')));
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'index.html')), false);
});

test('sign-in links point at nooblyjs-core', () => {
  assert.ok(LOGIN_PATH.startsWith('/services/authservice/'));
});
