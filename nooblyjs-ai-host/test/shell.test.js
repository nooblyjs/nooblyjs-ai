// The shell on the server: /api/v1/shell (rail order, built-ins, states, permissions), the status cards, the frame
// for every UI route, and the UI kit and NooblyJS's own browser files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let env;
before(async () => {
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: false },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: false },
      { path: 'test/fixtures/hello-app', mountPath: '/hello', enabled: true },
      { path: 'test/fixtures/throwing-app', mountPath: '/throwing', enabled: true },
      { path: 'test/fixtures/broken-app', mountPath: '/broken', enabled: true },
    ],
  });
});
after(async () => { await env?.stop(); });

test('the rail order is Home, the hosted apps with a UI (Product first), Platform; API-only apps are off the rail', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/shell');
  const rail = body.apps.filter((a) => a.rail).map((a) => a.name);
  assert.deepEqual(rail, ['home', 'product', 'factory', 'hello-app', 'throwing-app', 'broken-app', 'platform']);
  const by = Object.fromEntries(body.apps.map((a) => [a.name, a]));
  assert.equal(by.factory.state, 'not-installed');
  assert.equal(by.factory.phase, 7);
  assert.equal(by.factory.label, 'Factory');
  assert.equal(by['broken-app'].state, 'unavailable');
  assert.equal(by.workflows, undefined, 'the lifecycle engine is part of NooblyJS, not an app on the list');
  assert.equal(by.dev.rail, false, 'the dev app has no rail item');
  assert.equal(by.home.title, 'noobly');
  assert.deepEqual(by.home.nav.map((n) => n.key), ['for-you', 'overview', 'lifecycle', 'approvals', 'activity', 'metrics', 'teams']);
  // Product is nooblyjs-ai-product's (test/product.test.js has it running); here it is listed but not installed.
  assert.equal(by.product.state, 'not-installed');
  assert.equal(by.product.label, 'Product');
  assert.deepEqual([...new Set(by.platform.nav.map((n) => n.group))], ['Build', 'Govern']);
});

test('the person gets their permissions for ctx.can(); an Owner has more than a Viewer', async () => {
  const owner = env.client();
  await owner.signIn('stevie');
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  const o = (await owner.json('/api/v1/shell')).body.permissions;
  const v = (await viewer.json('/api/v1/shell')).body.permissions;
  assert.ok(o.includes('change-guardrails'));
  assert.deepEqual(v, ['read']);
});

test('status cards come in the mockup shape', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/shell/status');
  assert.equal(body.home.card.pill.text, '1 app unavailable', 'broken-app is counted');
  assert.equal(body.home.card.items[0].label, 'Agents working now');
  assert.equal(body.home.card.meter.label, 'Spent today');
  assert.ok(body.platform.card);
});

test('every UI route answers with the frame; signed out it goes to /login', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  for (const p of ['/', '/home', '/home/approvals', '/product', '/product/specs/PRD-031', '/platform', '/platform/audit',
    '/dev/styleguide', '/factory', '/factory/runs/214', '/broken', '/broken/x', '/hello', '/hello/deep/link', '/throwing']) {
    const res = await c.get(p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /src="\/ui\/js\/frame\.js"/, `${p} is not the frame`);
  }
  const anon = await env.client().get('/product/specs/PRD-031');
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /^\/login\?next=/);
});

test('the UI kit, the fonts and NooblyJS\'s modules are served with the right types', async () => {
  const c = env.client();
  const want = [
    ['/ui/css/tokens.css', /text\/css/], ['/ui/js/frame.js', /javascript/], ['/ui/js/components/index.js', /javascript/],
    ['/ui/fonts/figtree-latin-400-normal.woff2', /font\/woff2/], ['/ui/img/favicon.svg', /svg/],
    ['/js/modules/home.js', /javascript/], ['/js/pages/placeholder.js', /javascript/], ['/css/login.css', /text\/css/],
    ['/hello/js/module.js', /javascript/],
  ];
  for (const [p, type] of want) {
    const res = await c.get(p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), type, p);
  }
  assert.equal((await c.get('/ui/')).status, 404, 'no directory listing or index page');
});

test('the sign-in page uses the UI kit', async () => {
  const html = await (await env.client().get('/login')).text();
  assert.match(html, /href="\/ui\/css\/tokens\.css"/);
  assert.match(html, /class="login__person"/);
});

test('the lifecycle engine is always there, with no hosted app at all: Overview has its counts and its API answers', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { status, body } = await c.json('/api/v1/home/overview');
  assert.equal(status, 200);
  assert.equal(body.lifecycle.summary, '12 items in flight across 2 systems. Four are waiting on you.');
  assert.equal(body.systems.length, 5);
  const items = await c.json('/workflows/api/v1/items');
  assert.equal(items.status, 200);
  assert.equal((await c.json('/api/v1/shell/status')).body.home.badges.approvals, 4);
  // An entry left in an older hosted-apps.yaml is ignored; nothing else may take its place.
  assert.equal((await env.client().get('/workflows/api/v1/items')).status, 401);
});
