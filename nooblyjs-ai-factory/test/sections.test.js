// The Software Factory's sections: the Test section (quality/) is mounted by the Factory's register() under its path,
// with its data inside its folder, its pages in its UI module and its services under the name other apps ask for. Its
// own behaviour is tested in quality/test; this is how it sits in the Factory. Infrastructure (CHG-007), Product and
// Design (CHG-009) were sections and are hosted apps of their own.
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
  const hosted = await register(app, createTestServerManager(), { mountPath: '/factory', dataDir, host: change(stand.host), pollMs: 0, schedule: false, sections });
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
  assert.deepEqual(SECTIONS.map((s) => s.key), ['quality']);
});

test('FACTORY_SECTIONS chooses the sections; unset means all, and a name that is not a section is refused', () => {
  assert.equal(sectionsFromEnv(undefined), undefined);
  assert.equal(sectionsFromEnv('*'), undefined);
  assert.deepEqual(sectionsFromEnv('quality'), ['quality']);
  assert.deepEqual(sectionsFromEnv(' quality '), ['quality']);
  assert.deepEqual(sectionsFromEnv(''), []);
  assert.throws(() => sectionsFromEnv('quality,qaulity'), /FACTORY_SECTIONS names qaulity, which is not a section/);
  // Infrastructure (CHG-007), Product and Design (CHG-009) are hosted apps of their own, not sections.
  assert.throws(() => sectionsFromEnv('quality,product'), /FACTORY_SECTIONS names product, which is not a section \(quality\)/);
  assert.throws(() => sectionsFromEnv('design,infrastructure'), /FACTORY_SECTIONS names design, infrastructure, which is not a section/);
});

test('every section row in the sidebar has its page in the Factory\'s route table', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const section of SECTIONS) {
    for (const row of sectionNav(section)) {
      assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key && typeof r.page === 'function'), `a page for ${row.key} at ${row.path}`);
    }
  }
  assert.equal(routes.some((r) => r.path.startsWith('/infrastructure')), false, 'Infrastructure is not in the Factory');
  assert.ok(routes.some((r) => r.path === '/quality/test-analysis/:id' && r.nav === 'quality-test-analysis'));
  assert.equal(routes.some((r) => (r.path.startsWith('/product') || r.path.startsWith('/design')) && r.nav), false, 'no Product or Design page in the Factory');
  // No path is claimed twice.
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
});

test('mounted at /factory: the section answers under its path, keeps its data in its own folder, and is seeded', async () => {
  const t = await startApp();
  try {
    // The APIs, signed in only.
    const stories = await t.get('/factory/quality/api/v1/stories', { as: 'naledi-k' });
    assert.equal(stories.status, 200);
    assert.ok(Array.isArray(stories.json.stories));
    assert.equal((await t.get('/factory/quality/api/v1/stories')).status, 401);
    // The Factory's own API is where it was.
    assert.equal((await t.get('/factory/api/v1/status', { as: 'naledi-k' })).status, 200);
    // Pages get the frame; the section's module is served at the URL the Factory's module imports it from.
    assert.equal((await t.get('/factory/quality/test-analysis', { as: 'naledi-k' })).text, FRAME);
    for (const file of ['/factory/quality/js/module.js', '/factory/quality/css/quality.css']) {
      assert.equal((await t.get(file)).status, 200, file);
    }
    // Product and Design are not the Factory's: their old API paths are its page fallback, not an API.
    assert.equal((await t.get('/factory/product/api/v1/specs', { as: 'naledi-k' })).text, FRAME);
    // The section writes inside the Factory's folder, in its own; nothing is written for the apps that left.
    assert.ok(fs.existsSync(path.join(t.dataDir, 'quality', 'seed.yaml')), 'quality was seeded in its folder');
    for (const gone of ['infrastructure', 'product', 'design']) assert.equal(fs.existsSync(path.join(t.dataDir, gone)), false, gone);
  } finally {
    await t.close();
  }
});

test('other apps still reach the section by the name they always used', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(Object.keys(t.hosted.provides), ['quality']);
    for (const fn of ['readinessFacts', 'casesFor', 'summaryFor', 'stories']) assert.equal(typeof t.hosted.provides.quality[fn], 'function', `quality.${fn}`);
  } finally {
    await t.close();
  }
});

test('the sidebar is Engineering, Build and Test; without sections the Factory is the line alone; a section that cannot start stops the Factory starting', async () => {
  const t = await startApp();
  try {
    assert.deepEqual([...new Set(t.hosted.nav.map((n) => n.group))], ['Engineering', 'Build', 'Test']);
    assert.deepEqual(t.hosted.groups.map((g) => g.name), ['Engineering', 'Build', 'Test']);
  } finally {
    await t.close();
  }
  const none = await startApp({ sections: [] });
  try {
    assert.deepEqual([...new Set(none.hosted.nav.map((n) => n.group))], ['Engineering', 'Build', 'Test']);
    assert.deepEqual(none.hosted.provides, {});
    assert.equal((await none.get('/factory/quality/api/v1/stories', { as: 'naledi-k' })).text, FRAME, 'nothing mounted there: the Factory\'s page fallback answers');
  } finally {
    await none.close();
  }
  // The Test section needs host.people; without it nothing of the Factory is left mounted.
  await assert.rejects(startApp({ host: (h) => ({ ...h, people: undefined }) }), /The Test section needs host\.people/);
});

test('in the browser, a section\'s page draws in its own scope, with a ctx bound to the section', async () => {
  // The kit's real API client (nooblyjs-core/public/ui/js/api.js), and just enough of a document for the wrapper.
  const kitApi = pathToFileURL(createRequire(import.meta.url).resolve('nooblyjs-core/public/ui/js/api.js')).href;
  const { createApi } = await import(kitApi);
  const element = () => ({ dataset: {}, className: '', children: [], append(child) { this.children.push(child); } });
  const doc = { createElement: element };
  const seen = {};
  const page = { render: (root, args) => Object.assign(seen, { root, args }), destroy: () => { seen.destroyed = true; } };
  const quality = BROWSER_SECTIONS.find((s) => s.key === 'quality');
  const [list, story, redirect] = sectionRoutes(quality, [
    { path: '/test-analysis', nav: 'test-analysis', title: 'Test analysis', page: async () => page },
    { path: '/test-analysis/:id', nav: 'test-analysis', title: 'Test analysis', page: async () => page },
    { path: '/', redirect: '/test-analysis' },
  ], { api: async () => createApi, doc: () => doc });
  assert.deepEqual([list.path, list.nav, story.path, story.nav], ['/quality/test-analysis', 'quality-test-analysis', '/quality/test-analysis/:id', 'quality-test-analysis']);
  assert.deepEqual(redirect, { path: '/quality', redirect: '/quality/test-analysis' });

  const navigated = [];
  const signal = new AbortController().signal;
  const frameCtx = {
    app: { name: 'factory', label: 'Factory', mountPath: '/factory' }, signal, can: () => true, person: { id: 'stevie' },
    navigate: (path, options) => navigated.push([path, options]),
  };
  const view = element();
  const wrapped = await story.page();
  await wrapped.render(view, { params: { id: 'STORY-031-1' }, ctx: frameCtx });
  // Drawn inside an element scoped as the section's own, so its stylesheet applies.
  assert.equal(view.children.length, 1);
  assert.equal(seen.root, view.children[0]);
  assert.equal(seen.root.dataset.module, 'quality');
  // Its ctx: the API, links and navigation under the section; the rest is the frame's.
  const { ctx } = seen.args;
  assert.equal(ctx.api.base, '/factory/quality/api/v1');
  assert.deepEqual(ctx.app, { name: 'factory', label: 'Factory', mountPath: '/factory/quality', section: 'quality' });
  assert.equal(ctx.signal, signal);
  assert.equal(ctx.can('read'), true);
  assert.deepEqual(seen.args.params, { id: 'STORY-031-1' });
  ctx.navigate('/test-analysis/STORY-031-2');
  ctx.navigate('/', { replace: true });
  ctx.navigate('/teammates/hire', { absolute: true });
  assert.deepEqual(navigated, [['/quality/test-analysis/STORY-031-2', { replace: false }], ['/quality', { replace: true }], ['/teammates/hire', { replace: false }]]);
  wrapped.destroy();
  assert.equal(seen.destroyed, true);
});

test('CHG-009: an old /factory/product or /factory/design address lands on the same page in its own app', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const from of ['product', 'design']) {
    for (const p of [`/${from}`, `/${from}/:a`, `/${from}/:a/:b`, `/${from}/:a/:b/:c`]) assert.ok(routes.some((r) => r.path === p && r.meta?.from === from), p);
  }
  const moved = routes.find((r) => r.path === '/product/:a/:b');
  const page = await moved.page();
  const navigated = [];
  globalThis.window = { location: { pathname: '/factory/product/specs/PRD-031', search: '?tab=goals', hash: '' } };
  try {
    page.render({}, { ctx: { app: { mountPath: '/factory' }, navigate: (to, options) => navigated.push([to, options]) }, route: moved });
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(navigated, [['/product/specs/PRD-031?tab=goals', { absolute: true, replace: true }]]);
});
