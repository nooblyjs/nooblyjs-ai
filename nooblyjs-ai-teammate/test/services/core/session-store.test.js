// services/core/session-store.js: sign-in sessions kept in a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileSessionStore } from '../../../src/services/core/session-store.js';

test('sign-in sessions are kept in a file, so a restart does not sign people out', async () => {
  const require = createRequire(import.meta.url);
  const session = require(require.resolve('express-session', { paths: [path.dirname(require.resolve('nooblyjs-core'))] }));
  const Store = fileSessionStore(session);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-sessions-'));
  const file = path.join(dir, 'sessions.json');
  const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => (err ? reject(err) : resolve(value))));
  try {
    const first = new Store({ file });
    const sess = { cookie: { originalMaxAge: 60000, expires: new Date(Date.now() + 60000).toISOString() }, passport: { user: 'admin@localhost' } };
    await call(first, 'set', 'sid-alive', sess);
    await call(first, 'set', 'sid-expired', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
    await first.close();

    // "Restart": a new store reads the file.
    const second = new Store({ file });
    assert.deepEqual((await call(second, 'get', 'sid-alive')).passport, { user: 'admin@localhost' });
    assert.equal(await call(second, 'get', 'sid-expired'), null);
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!text.includes('sid-alive'), 'session ids are stored hashed');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await call(second, 'destroy', 'sid-alive');
    await second.close();
    assert.equal(await call(new Store({ file }), 'get', 'sid-alive'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
