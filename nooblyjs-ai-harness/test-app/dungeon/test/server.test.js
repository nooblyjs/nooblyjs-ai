import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../server.js';

/** Start the app on a random free port and return its base URL. */
async function start(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('the health endpoint answers ok', async (t) => {
  const base = await start(t);
  const response = await fetch(`${base}/api/health`);
  assert.deepEqual(await response.json(), { ok: true });
});

test('the page, stylesheet and script are served with a strict security policy', async (t) => {
  const base = await start(t);
  const files = [
    ['/', 'text/html'], ['/style.css', 'text/css'],
    ['/app.js', 'javascript'], ['/render.js', 'javascript'], ['/sprites.js', 'javascript'], ['/room.js', 'javascript'],
    ['/game.js', 'javascript'], ['/input.js', 'javascript'], ['/levels.js', 'javascript'],
    ['/levels/1.json', 'application/json'],
  ];
  for (const [file, contentType] of files) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200, file);
    assert.ok(response.headers.get('content-type').includes(contentType), file);
    assert.ok(response.headers.get('content-security-policy').includes("default-src 'self'"), file);
    assert.ok((await response.text()).length > 0, file);
  }
});

test('the page has the game canvas', async (t) => {
  const base = await start(t);
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<canvas id="game"/);
  assert.match(html, /<title>Sandstone Depths<\/title>/);
});

test('files outside public/ are not served', async (t) => {
  const base = await start(t);
  for (const file of ['/server.js', '/package.json', '/.noobly/ui/License.txt', '/missing-file']) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 404, file);
  }
});
