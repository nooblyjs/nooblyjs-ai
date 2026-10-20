// The Software Factory's sections (2026-10-19): Product, which was a hosted app of its own, is mounted by the Factory's
// register() under its path, with its data inside its folder, its pages in its UI module and its services under the
// name other apps ask for. The section's own behaviour is tested in product/test; this is how it sits in the Factory.
// Infrastructure was a section until 2026-10-20 (CHG-007) and is the hosted app nooblyjs-ai-infrastructure again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { register } from '../index.js';
import { SECTIONS, sectionNav, sectionsFromEnv } from '../src/services/sections.js';
import { SECTIONS as BROWSER_SECTIONS, sectionRoutes } from '../public/js/sections.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHost, createTestServerManager, FRAME } from './fixtures/host.js';
import { tmpDir } from './helpers.js';

const FALLBACK = 'the host answers';

async function startApp({ sections, host: change = (h) => h } = {}) {
  const dataDir = path.join(tmpDir('factory-sections-'), 'factory');
  fs.mkdirSync(dataDir);
  const stand = createHost();
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { mountPath: '/factory', dataDir, host: change(stand.host), pollMs: 0, schedule: false, sections, sectionOptions: { product: { draftStepMs: 0 } } });
  app.use((req, res) => res.status(404).type('text').send(FALLBACK));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const get = async (url, { as } = {}) => {
    const res = await fetch(base + url, { redirect: 'manual', headers: as ? { 'x-dev-person': as } : {} });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  };
  return {
    ...stand, hosted, dataDir, get,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await hosted.close();
    },
  };
}

test('the server and the browser name the same sections, at the same paths, with the same prefixes and scope', () => {
  const pick = ({ key, path: p, prefix, scope }) => ({ key, path: p, prefix, ...(scope ? { scope } : {}) });
  assert.deepEqual(SECTIONS.map(pick), BROWSER_SECTIONS.map(pick));
});

test('FACTORY_SECTIONS chooses the sections; unset means all, and a name that is not a section is refused', () => {
  assert.equal(sectionsFromEnv(undefined), undefined);
  assert.equal(sectionsFromEnv('*'), undefined);
  assert.deepEqual(sectionsFromEnv('product'), ['product']);
  assert.deepEqual(sectionsFromEnv(' product '), ['product']);
  assert.deepEqual(sectionsFromEnv(''), []);
  assert.throws(() => sectionsFromEnv('product,prodcut'), /FACTORY_SECTIONS names prodcut, which is not a section/);
  // Infrastructure is a hosted app of its own again (CHG-007), not a section.
  assert.throws(() => sectionsFromEnv('product,infrastructure'), /FACTORY_SECTIONS names infrastructure, which is not a section \(product, design\)/);
});

test('every section row in the sidebar has its page in the Factory\'s route table', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const section of SECTIONS) {
    for (const row of sectionNav(section)) {
      assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key && typeof r.page === 'function'), `a page for ${row.key} at ${row.path}`);
    }
  }
  assert.equal(routes.some((r) => r.path.startsWith('/infrastructure')), false, 'Infrastructure is not in the Factory');
  assert.ok(routes.some((r) => r.path === '/product/specs/:id' && r.nav === 'product-specs'));
  // No path is claimed twice.
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
});

test('mounted at /factory: the section answers under its path, keeps its data in its own folder, and is seeded', async () => {
  const t = await startApp();
  try {
    // The APIs, signed in only.
    const specs = await t.get('/factory/product/api/v1/specs', { as: 'naledi-k' });
    assert.equal(specs.status, 200);
    assert.ok(Array.isArray(specs.json.specs) && specs.json.specs.length, 'the seed story\'s specs');
    assert.equal((await t.get('/factory/product/api/v1/specs')).status, 401);
    // The Factory's own API is where it was.
    assert.equal((await t.get('/factory/api/v1/status', { as: 'naledi-k' })).status, 200);
    // Pages get the frame; the sections' modules are served at the URL the Factory's module imports them from.
    assert.equal((await t.get('/factory/product/specs/PRD-031', { as: 'naledi-k' })).text, FRAME);
    for (const file of ['/factory/product/js/module.js', '/factory/product/css/product.css']) {
      assert.equal((await t.get(file)).status, 200, file);
    }
    // The old paths are not the Factory's.
    assert.equal((await t.get('/product/api/v1/specs', { as: 'naledi-k' })).text, FALLBACK);
    // The section writes inside the Factory's folder, in its own; nothing is written for Infrastructure.
    assert.ok(fs.existsSync(path.join(t.dataDir, 'product', 'seed.yaml')), 'product was seeded in its folder');
    assert.equal(fs.existsSync(path.join(t.dataDir, 'infrastructure')), false);
  } finally {
    await t.close();
  }
});

test('other apps still reach the section by the name they always used', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(Object.keys(t.hosted.provides), ['product']);
    for (const fn of ['artefactsFor', 'readinessFacts', 'adrFor', 'gatesFor', 'waitingFor']) assert.equal(typeof t.hosted.provides.product[fn], 'function', `product.${fn}`);
    // The links they hand out are under the Factory.
    const rows = await t.hosted.provides.product.artefactsFor('PRD-031');
    assert.equal(rows.link, '/factory/product/specs/PRD-031');
    const adr = await t.hosted.provides.product.adrFor('ADR-014');
    assert.match(adr.href, /^\/factory\/product\/architecture\//);
  } finally {
    await t.close();
  }
});

test('without sections the Factory is the line alone; a section that cannot start stops the Factory starting', async () => {
  const t = await startApp({ sections: [] });
  try {
    // The Factory's own groups stay (lifecycle v3): Engineering, Build and Test.
    assert.deepEqual([...new Set(t.hosted.nav.map((n) => n.group))], ['Engineering', 'Build', 'Test']);
    assert.deepEqual(t.hosted.groups.map((g) => g.name), ['Engineering', 'Build', 'Test']);
    assert.deepEqual(t.hosted.provides, {});
    assert.equal((await t.get('/factory/product/api/v1/specs', { as: 'naledi-k' })).text, FRAME, 'nothing mounted there: the Factory\'s page fallback answers');
  } finally {
    await t.close();
  }
  // The Product section needs host.people; without it nothing of the Factory is left mounted.
  await assert.rejects(startApp({ host: (h) => ({ ...h, people: undefined }) }), /The Product section needs host\.people/);
});

test('in the browser, a section\'s page draws in its own scope, with a ctx bound to the section', async () => {
  // The kit's real API client (nooblyjs-core/public/ui/js/api.js), and just enough of a document for the wrapper.
  const kitApi = pathToFileURL(createRequire(import.meta.url).resolve('nooblyjs-core/public/ui/js/api.js')).href;
  const { createApi } = await import(kitApi);
  const element = () => ({ dataset: {}, className: '', children: [], append(child) { this.children.push(child); } });
  const doc = { createElement: element };
  const seen = {};
  const page = { render: (root, args) => Object.assign(seen, { root, args }), destroy: () => { seen.destroyed = true; } };
  const product = BROWSER_SECTIONS.find((s) => s.key === 'product');
  const [overview, specs, redirect] = sectionRoutes(product, [
    { path: '/', nav: 'overview', title: 'Product Factory', page: async () => page },
    { path: '/specs/:id', nav: 'specs', title: 'Spec', page: async () => page },
    { path: '/old', redirect: '/specs' },
  ], { api: async () => createApi, doc: () => doc });
  assert.deepEqual([overview.path, overview.nav, specs.path, specs.nav], ['/product', 'product-overview', '/product/specs/:id', 'product-specs']);
  assert.deepEqual(redirect, { path: '/product/old', redirect: '/product/specs' });

  const navigated = [];
  const signal = new AbortController().signal;
  const frameCtx = {
    app: { name: 'factory', label: 'Factory', mountPath: '/factory' }, signal, can: () => true, person: { id: 'stevie' },
    navigate: (path, options) => navigated.push([path, options]),
  };
  const view = element();
  const wrapped = await specs.page();
  await wrapped.render(view, { params: { id: 'PRD-031' }, ctx: frameCtx });
  // Drawn inside an element scoped as the section's app was, so its stylesheet applies.
  assert.equal(view.children.length, 1);
  assert.equal(seen.root, view.children[0]);
  assert.equal(seen.root.dataset.module, 'product');
  // Its ctx: the API, links and navigation under the section; the rest is the frame's.
  const { ctx } = seen.args;
  assert.equal(ctx.api.base, '/factory/product/api/v1');
  assert.deepEqual(ctx.app, { name: 'factory', label: 'Factory', mountPath: '/factory/product', section: 'product' });
  assert.equal(ctx.signal, signal);
  assert.equal(ctx.can('read'), true);
  assert.deepEqual(seen.args.params, { id: 'PRD-031' });
  ctx.navigate('/specs/PRD-032');
  ctx.navigate('/', { replace: true });
  ctx.navigate('/teammates/hire', { absolute: true });
  assert.deepEqual(navigated, [['/product/specs/PRD-032', { replace: false }], ['/product', { replace: true }], ['/teammates/hire', { replace: false }]]);
  wrapped.destroy();
  assert.equal(seen.destroyed, true);
});

test('lifecycle v3: Architecture is the Design section\'s, and its old addresses move on', async () => {
  const { routes } = await import('../public/js/module.js');
  assert.ok(routes.some((r) => r.path === '/design/architecture/:id' && r.nav === 'design-architecture' && typeof r.page === 'function'));
  assert.equal(routes.some((r) => r.path === '/product/architecture/:id' && r.nav === 'product-architecture'), false, 'no longer a Product page');
  assert.deepEqual(routes.find((r) => r.path === '/product/architecture'), { path: '/product/architecture', redirect: '/design/architecture' });
  const moved = routes.find((r) => r.path === '/product/architecture/:id');
  assert.equal(moved.meta.to, '/design/architecture');
  const navigated = [];
  const page = await moved.page();
  page.render({}, { params: { id: 'PRD-031' }, ctx: { navigate: (to, options) => navigated.push([to, options]) }, route: moved });
  assert.deepEqual(navigated, [['/design/architecture/PRD-031', { replace: true }]]);
});

test('in the browser, the Design section\'s pages are the Product section\'s: its API, links and scope, under /design', async () => {
  const kitApi = pathToFileURL(createRequire(import.meta.url).resolve('nooblyjs-core/public/ui/js/api.js')).href;
  const { createApi } = await import(kitApi);
  const element = () => ({ dataset: {}, className: '', children: [], append(child) { this.children.push(child); } });
  const seen = {};
  const design = BROWSER_SECTIONS.find((s) => s.key === 'design');
  const [route] = sectionRoutes(design, [{ path: '/architecture/:id', nav: 'architecture', title: 'Architecture', page: async () => ({ render: (root, args) => Object.assign(seen, { root, args }) }) }], { api: async () => createApi, doc: () => ({ createElement: element }) });
  assert.deepEqual([route.path, route.nav], ['/design/architecture/:id', 'design-architecture']);
  const navigated = [];
  const view = element();
  await (await route.page()).render(view, { params: { id: 'PRD-031' }, ctx: { app: { name: 'factory', mountPath: '/factory' }, signal: new AbortController().signal, navigate: (p, o) => navigated.push([p, o]) } });
  assert.equal(seen.root.dataset.module, 'product', 'the Product section\'s stylesheet applies');
  assert.equal(seen.args.ctx.api.base, '/factory/product/api/v1');
  assert.equal(seen.args.ctx.app.mountPath, '/factory/product', 'links to specs stay the Product section\'s');
  assert.equal(seen.args.ctx.app.section, 'design');
  seen.args.ctx.navigate('/architecture/PRD-032');
  assert.deepEqual(navigated, [['/design/architecture/PRD-032', { replace: false }]]);
});
