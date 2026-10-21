// Phase 16c: the Design section's pages in the NooblyJS frame (noobly .claude/guides/porting-an-app.md §4): the CSS
// is scoped, every nav row has a route, and pages leave history and <body> to the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV } from '../index.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../public/', import.meta.url);

async function filesIn(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('every selector in public/ is scoped to [data-module="design"]', async () => {
  const css = (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'));
  assert.ok(css.length);
  for (const file of css) assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'design'), [], file);
});

test('every nav row has a list and an item page in the route table', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const row of NAV) {
    assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key && r.page), `a list for ${row.key}`);
    assert.ok(routes.some((r) => r.path === `${row.path}/:id` && r.nav === row.key && r.page), `an item page for ${row.key}`);
  }
});

test('pages never touch history, popstate or <body>: the frame owns them', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/]) assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
  }
});

test('CHG-009: the Architecture rows are the Product app\'s pages, drawn in its scope with its API, under /design', async () => {
  const { routes } = await import('../public/js/module.js');
  const { productPage, productContext, PRODUCT_PATH } = await import('../public/js/product-pages.js');
  assert.equal(PRODUCT_PATH, '/product');
  const list = routes.find((r) => r.path === '/architecture');
  const one = routes.find((r) => r.path === '/architecture/:id');
  assert.deepEqual([list.nav, list.meta, one.nav], ['architecture', { stage: 'architecture' }, 'architecture']);

  // The page is loaded from Product's folder, drawn in an element scoped like Product's module, with Product's API.
  const kitApi = new URL(`file://${require.resolve('nooblyjs-core/public/ui/js/api.js')}`).href;
  const { createApi } = await import(kitApi);
  const element = () => ({ dataset: {}, className: '', children: [], append(child) { this.children.push(child); } });
  const loaded = [];
  const seen = {};
  const wrapped = await productPage('architecture.js', {
    api: async () => createApi,
    doc: () => ({ createElement: element }),
    load: async (url) => { loaded.push(url); return { render: (root, args) => Object.assign(seen, { root, args }), destroy: () => { seen.destroyed = true; } }; },
  })();
  assert.deepEqual(loaded, ['/product/js/pages/architecture.js']);
  const navigated = [];
  const view = element();
  const ctx = { app: { name: 'design', label: 'Design', mountPath: '/design' }, signal: new AbortController().signal, navigate: (p, o) => navigated.push([p, o]) };
  await wrapped.render(view, { params: { id: 'PRD-031' }, ctx });
  assert.equal(seen.root, view.children[0]);
  assert.equal(seen.root.dataset.module, 'product', 'product.css applies');
  assert.equal(seen.args.ctx.api.base, '/product/api/v1');
  assert.equal(seen.args.ctx.app.mountPath, '/product', 'links to specs are Product\'s');
  seen.args.ctx.navigate('/architecture/PRD-032');
  assert.deepEqual(navigated, [['/architecture/PRD-032', undefined]], 'navigation stays this app\'s');
  wrapped.destroy();
  assert.equal(seen.destroyed, true);
  assert.equal(productContext(ctx, createApi).app.name, 'design');
});
