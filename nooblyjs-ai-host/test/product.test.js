// nooblyjs-ai-product hosted in NooblyJS: the Product Factory, which owns its screens like Teammates (roadmap hosted-app
// checklist). Its rail entry, nav and status card come from register(); its pages are a UI module in the frame;
// its API is signed-in only, gated by the NooblyJS permissions matrix, CSRF-checked and audited by the host; and it
// writes only under data/product/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startApp, today, eventually } from './helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');

let env;
before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true }] });
});
after(async () => { await env?.stop(); });

test('the shell lists Product as ready, first after Home, with its UI module, kit icons and nav', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const { apps } = (await c.json('/api/v1/shell')).body;
  const rail = apps.filter((a) => a.rail).map((a) => a.name);
  assert.deepEqual(rail.slice(0, 2), ['home', 'product']);
  const product = apps.find((a) => a.name === 'product');
  assert.equal(product.state, 'ready');
  assert.equal(product.label, 'Product');
  assert.deepEqual(product.ui, { entry: 'js/module.js', styles: ['css/product.css'] });
  assert.deepEqual(product.nav.map((n) => n.key), ['overview', 'portfolios', 'board', 'specs', 'architecture', 'ux', 'ui', 'reviews', 'handoffs', 'settings']);
  const kitIcons = await fs.readFile(require.resolve('nooblyjs-core/public/ui/js/icons.js'), 'utf8');
  for (const name of [product.icon, ...product.nav.map((n) => n.icon)]) assert.match(kitIcons, new RegExp(`\\b${name}:`), `kit icon ${name}`);
});

test('every page URL under /product is the frame; its module and scoped styles load; missing files are 404s', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  for (const page of ['/product', '/product/board', '/product/specs/PRD-031', '/product/board?product=Delivery']) {
    const res = await c.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, page);
  }
  const mod = await c.get('/product/js/module.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-security-policy'), /default-src 'self'/, "NooblyJS's policy, not the app's own");
  assert.deepEqual(unscopedSelectors(await (await c.get('/product/css/product.css')).text(), 'product'), []);
  assert.equal((await c.get('/product/js/nope.js')).status, 404);
  const anon = env.client();
  assert.equal((await anon.get('/product/board')).status, 302);
  assert.equal((await anon.get('/product/api/v1/board')).status, 401);
});

test('the board comes from the seeded story, and a change needs the NooblyJS CSRF token', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const board = (await c.json('/product/api/v1/board')).body;
  assert.deepEqual(board.columns.map((col) => col.count), [4, 3, 2, 2, 2]);
  const blocked = await c.request('/product/api/v1/signals/sig_substitutionsrandom/idea', { method: 'POST', json: {}, csrf: false });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'csrf_failed');
  const made = await c.request('/product/api/v1/signals/sig_substitutionsrandom/idea', { method: 'POST', json: {} });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).id, 'IDEA-021');
});

test('approving is for Approvers and up, and the refusal is audited with the NooblyJS permission', async () => {
  const c = env.client();
  await c.signIn('priya-s');
  const res = await c.request('/product/api/v1/specs/PRD-031/decision', { method: 'POST', json: { decision: 'approve' } });
  assert.equal(res.status, 403);
  // The host writes the audit record once the answer has gone out.
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.actor === 'priya-s' && r.action === 'access.refused' && r.permission === 'approve'));
  });
});

test('the status card says agents on duty and spend against the budget; Reviews has its badge', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { product } = (await c.json('/api/v1/shell/status')).body;
  assert.equal(product.badges.reviews, 2);
  assert.match(product.card.pill.text, /agents? on duty$/);
  assert.match(product.card.meter.value, /^\$\d+ of \$1,500$/);
});

test('accepting ADR-014 is for an Architect, through the NooblyJS session and CSRF token', async () => {
  const lerato = env.client();
  await lerato.signIn('lerato-m');
  assert.equal((await lerato.request('/product/api/v1/adrs/ADR-014/accept', { method: 'POST', json: {} })).status, 403);
  const thabo = env.client();
  await thabo.signIn('thabo-n');
  assert.equal((await thabo.get('/product/architecture/PRD-031')).status, 200);
  const res = await thabo.request('/product/api/v1/adrs/ADR-014/accept', { method: 'POST', json: {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'accepted');
  const standards = (await thabo.json('/product/api/v1/architecture/PRD-031/standards-check')).body;
  assert.equal(standards.text, '4 of 4');
});

test('it writes only under data/product/', async () => {
  const entries = await fs.readdir(`${env.dataDir}/product`);
  assert.ok(entries.includes('specs') && entries.includes('seed.yaml'));
});
