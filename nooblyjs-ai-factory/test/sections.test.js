// The Software Factory's sections (2026-10-19): Product and Infrastructure, which were hosted apps of their own, are
// mounted by the Factory's register() under its path, with their data inside its folder, their pages in its UI
// module and their services under the names other apps ask for. The sections' own behaviour is tested in
// product/test and infrastructure/test; this is how they sit in the Factory.
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
  const hosted = await register(app, createTestServerManager(), { mountPath: '/factory', dataDir, host: change(stand.host), pollMs: 0, schedule: false, sections, sectionOptions: { product: { draftStepMs: 0 }, infrastructure: { provisionStepMs: 0, sweepEveryMs: 0 } } });
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

test('the server and the browser name the same sections, at the same paths, with the same prefixes', () => {
  assert.deepEqual(SECTIONS.map(({ key, path: p, prefix }) => ({ key, path: p, prefix })), BROWSER_SECTIONS);
});

test('FACTORY_SECTIONS chooses the sections; unset means all, and a name that is not a section is refused', () => {
  assert.equal(sectionsFromEnv(undefined), undefined);
  assert.equal(sectionsFromEnv('*'), undefined);
  assert.deepEqual(sectionsFromEnv('product'), ['product']);
  assert.deepEqual(sectionsFromEnv(' product , infrastructure '), ['product', 'infrastructure']);
  assert.deepEqual(sectionsFromEnv(''), []);
  assert.throws(() => sectionsFromEnv('product,infra'), /FACTORY_SECTIONS names infra, which is not a section/);
});

test('every section row in the sidebar has its page in the Factory\'s route table, and Infrastructure\'s landing redirects', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const section of SECTIONS) {
    for (const row of sectionNav(section)) {
      assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key && typeof r.page === 'function'), `a page for ${row.key} at ${row.path}`);
    }
  }
  assert.deepEqual(routes.find((r) => r.path === '/infrastructure'), { path: '/infrastructure', redirect: '/infrastructure/environments' });
  assert.ok(routes.some((r) => r.path === '/product/specs/:id' && r.nav === 'product-specs'));
  // No path is claimed twice.
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
});

test('mounted at /factory: each section answers under its path, keeps its data in its own folder, and is seeded', async () => {
  const t = await startApp();
  try {
    // The APIs, signed in only.
    const specs = await t.get('/factory/product/api/v1/specs', { as: 'naledi-k' });
    assert.equal(specs.status, 200);
    assert.ok(Array.isArray(specs.json.specs) && specs.json.specs.length, 'the seed story\'s specs');
    assert.equal((await t.get('/factory/product/api/v1/specs')).status, 401);
    const environments = await t.get('/factory/infrastructure/api/v1/environments', { as: 'naledi-k' });
    assert.equal(environments.status, 200);
    // The Factory's own API is where it was.
    assert.equal((await t.get('/factory/api/v1/status', { as: 'naledi-k' })).status, 200);
    // Pages get the frame; the sections' modules are served at the URL the Factory's module imports them from.
    assert.equal((await t.get('/factory/product/specs/PRD-031', { as: 'naledi-k' })).text, FRAME);
    assert.equal((await t.get('/factory/infrastructure/designs', { as: 'naledi-k' })).text, FRAME);
    for (const file of ['/factory/product/js/module.js', '/factory/infrastructure/js/module.js', '/factory/product/css/product.css']) {
      assert.equal((await t.get(file)).status, 200, file);
    }
    // The old paths are not the Factory's.
    assert.equal((await t.get('/product/api/v1/specs', { as: 'naledi-k' })).text, FALLBACK);
    // Each section writes inside the Factory's folder, in its own.
    for (const key of ['product', 'infrastructure']) assert.ok(fs.existsSync(path.join(t.dataDir, key, 'seed.yaml')), `${key} was seeded in its folder`);
  } finally {
    await t.close();
  }
});

test('other apps still reach the sections by the names they always used', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(Object.keys(t.hosted.provides).sort(), ['infrastructure', 'product']);
    for (const fn of ['artefactsFor', 'readinessFacts', 'adrFor', 'gatesFor', 'waitingFor']) assert.equal(typeof t.hosted.provides.product[fn], 'function', `product.${fn}`);
    assert.equal(typeof t.hosted.provides.infrastructure.decideApproval, 'function');
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
    assert.deepEqual([...new Set(t.hosted.nav.map((n) => n.group))], ['Build']);
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
