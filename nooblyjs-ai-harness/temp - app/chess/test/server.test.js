import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../server.js';

test('Express serves the game, SVG artwork, scripts and health endpoint', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true });
  for (const [file, contentType] of [['/', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'javascript'], ['/ai-worker.js', 'javascript'], ['/chess.js', 'javascript'], ['/pieces.svg', 'image/svg+xml'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await fetch(`${base}${file}`);
    assert.equal(response.status, 200, file);
    assert.ok(response.headers.get('content-type').includes(contentType), file);
    assert.ok(response.headers.get('content-security-policy').includes("worker-src 'self'"));
    assert.ok((await response.text()).length > 0);
  }
  const missing = await fetch(`${base}/missing-file`);
  assert.equal(missing.status, 404);
  const source = await fetch(`${base}/server.js`);
  assert.equal(source.status, 404);
});
