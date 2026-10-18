// Phase F17: static files: the page, its types and headers, and nothing outside its folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { serveStatic, staticFile } from '../../src/middleware/static.js';
import { tmpDir } from '../helpers.js';

function site() {
  const root = tmpDir('factory-static-');
  const dir = path.join(root, 'site');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>line</h1>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'outside');
  return dir;
}

/** A response that records its status, headers and body. */
function response() {
  const chunks = [];
  const res = Object.assign(new Writable({ write: (c, _e, cb) => (chunks.push(c), cb()) }), {
    status: 0,
    headers: {},
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers;
    },
  });
  const done = new Promise((resolve) => res.on('finish', () => resolve(Buffer.concat(chunks).toString())));
  return { res, done };
}

test('staticFile: "/" is index.html; folders, missing files and paths outside the folder are null', () => {
  const dir = site();
  assert.equal(staticFile(dir, '/'), path.join(dir, 'index.html'));
  assert.equal(staticFile(dir, '/app.js'), path.join(dir, 'app.js'));
  assert.equal(staticFile(dir, '/sub'), null, 'a folder is not a file');
  assert.equal(staticFile(dir, '/nope.js'), null);
  assert.equal(staticFile(dir, '/../secret.txt'), null);
  assert.equal(staticFile(dir, '/..%2fsecret.txt'), null);
  assert.equal(staticFile(undefined, '/'), null, 'no folder, no files');
});

test('serveStatic: the file, with its type and the safety headers', async () => {
  const { res, done } = response();
  serveStatic(site(), '/app.js', /** @type {any} */ (res));
  assert.equal(await done, 'console.log(1)');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/javascript/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
});

test('serveStatic: anything else is a plain 404', async () => {
  const { res, done } = response();
  serveStatic(site(), '/../secret.txt', /** @type {any} */ (res));
  assert.equal(await done, 'Not found');
  assert.equal(res.status, 404);
});
