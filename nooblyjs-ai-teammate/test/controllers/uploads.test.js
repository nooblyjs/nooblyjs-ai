// controllers/uploads.js: avatar uploads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let base;
let app;
before(async () => {
  app = await startApp();
  base = app.url; // the app's root, e.g. http://127.0.0.1:port/teammates
});
after(() => app.close());

const send = (method, url, body) => app.send(method, url, body);
const authed = (headers = {}) => ({ ...headers, Cookie: app.session.cookie, 'X-CSRF-Token': app.session.csrf });

test('uploads accept real images only', async () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
  assert.equal((await send('POST', '/api/v1/uploads', { dataUrl: svg })).status, 400);
  const fakePng = `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`;
  assert.equal((await send('POST', '/api/v1/uploads', { dataUrl: fakePng })).status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0def46b80000000049454e44ae426082', 'hex');
  const ok = await send('POST', '/api/v1/uploads', { dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(ok.status, 201);
  const img = await fetch(base + ok.body.url, { headers: authed() });
  assert.equal(img.headers.get('content-type'), 'image/png');
});
