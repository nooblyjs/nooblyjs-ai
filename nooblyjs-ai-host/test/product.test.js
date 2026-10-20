// The Product Factory in NooblyJS: the Software Factory's Product section since 2026-10-19 (nooblyjs-ai-factory/product, at
// /factory/product), which owns its screens like Teammates. Its sidebar rows lead the Factory's; its pages are in the
// Factory's UI module; its API is signed-in only, gated by the NooblyJS permissions matrix, CSRF-checked and audited by
// the host; and it writes only under data/factory/product/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { startApp, today, eventually } from './helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');

let env;
before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },] });
});
after(async () => { await env?.stop(); });

test('the shell lists the Factory first after Home, with the Product section\'s rows leading its sidebar, its styles and kit icons', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const { apps } = (await c.json('/api/v1/shell')).body;
  const rail = apps.filter((a) => a.rail).map((a) => a.name);
  assert.deepEqual(rail.slice(0, 2), ['home', 'factory']);
  assert.equal(apps.find((a) => a.name === 'product'), undefined, 'not an app of its own');
  const factory = apps.find((a) => a.name === 'factory');
  assert.equal(factory.state, 'ready');
  assert.ok(factory.ui.styles.includes('product/css/product.css'));
  const product = factory.nav.filter((n) => n.group === 'Product');
  assert.deepEqual(product.map((n) => n.key), ['product-overview', 'product-portfolios', 'product-board', 'product-specs', 'product-ux', 'product-ui', 'product-reviews', 'product-handoffs', 'product-settings']);
  // Architecture moved to the Design section (Phase 16b), which has its own five rows since Phase 16c.
  assert.deepEqual(factory.nav.filter((n) => n.group === 'Design').map((n) => [n.key, n.path]), [
    ['design-architecture', '/design/architecture'], ['design-requirements', '/design/requirements'], ['design-solution', '/design/solution'],
    ['design-functional', '/design/functional'], ['design-stories', '/design/stories'], ['design-handoff', '/design/handoff'],
  ]);
  assert.deepEqual(factory.nav.slice(0, product.length), product, 'Product leads the sidebar');
  assert.ok(product.every((n) => n.path === '/product' || n.path.startsWith('/product/')));
  const kitIcons = await fs.readFile(require.resolve('nooblyjs-core/public/ui/js/icons.js'), 'utf8');
  for (const name of product.map((n) => n.icon)) assert.match(kitIcons, new RegExp(`\\b${name}:`), `kit icon ${name}`);
});

test('every page URL under /factory/product is the frame; its module and scoped styles load; missing files are 404s', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  for (const page of ['/factory/product', '/factory/product/board', '/factory/product/specs/PRD-031', '/factory/product/board?product=Delivery']) {
    const res = await c.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, page);
  }
  const mod = await c.get('/factory/product/js/module.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-security-policy'), /default-src 'self'/, "NooblyJS's policy, not the app's own");
  assert.deepEqual(unscopedSelectors(await (await c.get('/factory/product/css/product.css')).text(), 'product'), []);
  assert.equal((await c.get('/factory/product/js/nope.js')).status, 404);
  const anon = env.client();
  assert.equal((await anon.get('/factory/product/board')).status, 302);
  assert.equal((await anon.get('/factory/product/api/v1/board')).status, 401);
});

test('the board comes from the seeded story, and a change needs the NooblyJS CSRF token', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const board = (await c.json('/factory/product/api/v1/board')).body;
  assert.deepEqual(board.columns.map((col) => col.count), [4, 3, 2, 2, 2]);
  const blocked = await c.request('/factory/product/api/v1/signals/sig_substitutionsrandom/idea', { method: 'POST', json: {}, csrf: false });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'csrf_failed');
  const made = await c.request('/factory/product/api/v1/signals/sig_substitutionsrandom/idea', { method: 'POST', json: {} });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).id, 'IDEA-021');
});

test('approving is for Approvers and up, and the refusal is audited with the NooblyJS permission', async () => {
  const c = env.client();
  await c.signIn('priya-s');
  const res = await c.request('/factory/product/api/v1/specs/PRD-031/decision', { method: 'POST', json: { decision: 'approve' } });
  assert.equal(res.status, 403);
  // The host writes the audit record once the answer has gone out.
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.actor === 'priya-s' && r.action === 'access.refused' && r.permission === 'approve'));
  });
});

test('the Factory\'s status card carries the Product section: its agents on duty, and the Reviews badge', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const status = (await c.json('/api/v1/shell/status')).body;
  assert.equal(status.product, undefined, 'the Product section is not an app of its own');
  assert.equal(status.factory.badges['product-reviews'], 2);
  assert.ok(status.factory.card.items.some((i) => i.label === 'Product' && /agents? on duty$/.test(i.value)));
});

test('accepting ADR-014 is for an Architect, through the NooblyJS session and CSRF token', async () => {
  const lerato = env.client();
  await lerato.signIn('lerato-m');
  assert.equal((await lerato.request('/factory/product/api/v1/adrs/ADR-014/accept', { method: 'POST', json: {} })).status, 403);
  const thabo = env.client();
  await thabo.signIn('thabo-n');
  assert.equal((await thabo.get('/factory/product/architecture/PRD-031')).status, 200);
  const res = await thabo.request('/factory/product/api/v1/adrs/ADR-014/accept', { method: 'POST', json: {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'accepted');
  const standards = (await thabo.json('/factory/product/api/v1/architecture/PRD-031/standards-check')).body;
  assert.equal(standards.text, '4 of 4');
});

test('it writes only under data/factory/product/', async () => {
  const entries = await fs.readdir(`${env.dataDir}/factory/product`);
  assert.ok(entries.includes('specs') && entries.includes('seed.yaml'));
});
