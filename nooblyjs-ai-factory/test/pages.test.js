// CHG-008: the Engineering, Pull requests and Test pages draw from the API's answers. In Node, on a small stand-in DOM
// (elements that keep their text; the kit's components are kept as their markup), with the UI kit loaded as the browser
// does (/ui/js/…) and the API answered by the real handlers over the seeded samples and a stand-in lifecycle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { seedSamples } from '../src/services/engineering/samples.js';
import { engineeringRoutes } from '../src/services/engineering/views.js';
import { pullRequestRoutes } from '../src/services/pull-requests/views.js';
import { createArchitecture } from '../src/services/engineering/architecture.js';
import { tmpDir } from './helpers.js';

const require = createRequire(import.meta.url);
const KIT = pathToFileURL(require.resolve('nooblyjs-core/public/ui/js/html.js')).href.replace(/html\.js$/, '');
registerHooks({ resolve: (specifier, context, next) => (specifier.startsWith('/ui/js/') ? { url: KIT + specifier.slice(7), shortCircuit: true } : next(specifier, context)) });

class Base {}
class Text extends Base { constructor(data) { super(); this.data = data; } }
/** An element that keeps its children, attributes and text: enough for h(), kit() and page(). */
class El extends Base {
  constructor(tag, markup = '') { super(); Object.assign(this, { tag, markup, children: [], attrs: {}, className: '', open: false }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  get classList() { return { add: (c) => { this.className += ` ${c}`; } }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains() { return false; }
  close() {}
  get text() { return [this.markup.replace(/<[^>]+>/g, ' '), ...this.children.map((c) => (c instanceof El ? c.text : c.data ?? ''))].join(' ').replace(/\s+/g, ' '); }
}

const ITEMS = [
  { id: 'PRD-027', ref: 'PRD-027', type: 'spec', title: 'Live order tracking map', stage: 'design', status: 'active' },
  { id: 'STORY-027-1', ref: 'STORY-027-1', type: 'story', title: 'See the driver on a live map', stage: 'engineer', status: 'active', parentId: 'PRD-027' },
  { id: 'web-storefront-481', ref: 'web-storefront #481', type: 'pr', title: 'Checkout focus order', stage: 'test', status: 'active', owner: 'priya-s' },
];
const APPROVALS = [{ id: 'apr_wsf476test', type: 'test-approval', itemId: 'web-storefront-481', status: 'approved', decidedAt: '2026-10-08T10:20:00.000Z', decidedBy: 'lerato-m', reviewers: [] }];

let api;
before(() => {
  globalThis.document = {
    hidden: true, activeElement: null,
    createElement: (tag) => new El(tag),
    createTextNode: (data) => new Text(data),
    createRange: () => ({ createContextualFragment: (markup) => ({ firstElementChild: new El('kit', markup) }) }),
  };
  globalThis.Node = Base;
  globalThis.CSS ??= { escape: (s) => s };
  const home = tmpDir('factory-pages-');
  seedSamples(home, { now: () => Date.parse('2026-10-09T10:00:00.000Z') });
  const services = {
    workflows: {
      items: async ({ stage } = {}) => ITEMS.filter((i) => !stage || i.stage === stage),
      item: async ({ itemId }) => ITEMS.find((i) => i.id === itemId) ?? null,
      approvals: async ({ type } = {}) => APPROVALS.filter((a) => !type || a.type === type),
      readinessOf: async () => ({ passed: 1, total: 3, checks: [
        { key: 'architecture-accepted', passed: false, text: "The application architecture is not accepted: delivery-planner's architecture is proposed" },
        { key: 'criteria-ready', passed: false, text: 'A criterion has no ready test case: "Given the order is delivered…" has no ready test case' },
        { key: 'interfaces-tested', passed: true, text: 'Every interface has an integration test' },
      ] }),
    },
    design: { designFor: async () => ({ stories: [{ id: 'STORY-027-1', title: 'See the driver on a live map', systems: ['web-storefront', 'delivery-planner'], criteria: [] }], systems: [{ name: 'web-storefront', repo: 'acme/web-storefront' }, { name: 'delivery-planner', repo: 'acme/delivery-planner' }] }) },
    quality: {
      summaryFor: async () => ({ criteria: 2, ready: 1, cases: 7, automated: 6, text: '1 of 2 criteria has a ready test case', untestedInterfaces: [] }),
      stories: async () => [{ id: 'STORY-027-1', parentId: 'PRD-027', title: 'See the driver on a live map', summary: { criteria: 2, ready: 1, cases: 7, automated: 6, text: '1 of 2 criteria has a ready test case' } }],
    },
  };
  const host = {
    people: { get: async (id) => ({ id, name: { 'lerato-m': 'Lerato M.', 'priya-s': 'Priya S.', 'thabo-n': 'Thabo N.' }[id] ?? id }) },
    service: (name) => services[name],
  };
  const architecture = createArchitecture({ home, env: { FACTORY_HOME: home }, host });
  const bridge = /** @type {any} */ ({ syncPushes: async () => [] });
  const routes = [...engineeringRoutes({ home, host, architecture }), ...pullRequestRoutes({ home, host, store: { get: () => null }, bridge })].filter(([method]) => method === 'GET').map(([, pattern, fn]) => [new RegExp(`^${pattern.replace('/api/', '').replace(':id', '([^/]+)')}$`), fn]);
  api = {
    get: async (path) => {
      for (const [re, fn] of routes) {
        const m = re.exec(path);
        if (m) return (await fn({ params: { id: m[1] && decodeURIComponent(m[1]) }, query: {} })).json;
      }
      throw new Error(`no route for ${path}`);
    },
  };
});
after(() => { delete globalThis.document; delete globalThis.Node; });

async function draw(module, view, params = {}) {
  const { render } = await import(`../public/js/pages/${module}.js`);
  const root = new El('main');
  const controller = new AbortController();
  const ctx = { api, app: { mountPath: '/factory' }, can: () => true, isCurrent: () => true, signal: controller.signal, sse: { on() {} } };
  await render(root, { params, ctx, route: { meta: { view } } });
  controller.abort();
  return root.text;
}

test('Engineering: the stories in Engineer, one story\'s architecture with its actions, and the sign-off\'s checks', async () => {
  assert.match(await draw('engineering', 'architecture'), /STORY-027-1 · See the driver on a live map.*1 of 2 systems accepted.*web-storefront: Accepted by Thabo N\..*delivery-planner: Proposed/);
  const signoff = await draw('engineering', 'signoff');
  assert.match(signoff, /1 of 3 checks pass.*Fails .*delivery-planner's architecture is proposed.*Passes .*Every interface has an integration test/);
  assert.match(signoff, /Override the failing checks, with a reason .*Sign off & send to Build/);
  const arch = await draw('engineering', 'architecture-detail', { id: 'STORY-027-1' });
  assert.ok(arch.includes('position (lat, lng, at)'), 'a field with commas is one field');
  for (const words of ['Application flow', 'TrackingSnapshot', 'NFRs per component', 'src/tracking/', 'Accepted by Thabo N.', 'Proposed: an Application Architect accepts it', "Accept delivery-planner's architecture", 'Ask Rhea to draft it again', "can't be checked against the code", 'Sample data of the seed story']) assert.ok(arch.includes(words), words);
});

test('Pull requests and Test: approvals, runs, coverage and defects, each in words', async () => {
  assert.match(await draw('testing', 'pull-requests'), /web-storefront #481 · Checkout focus order.*Not asked yet/);
  assert.match(await draw('testing', 'approvals'), /The automated tests are running \(TRN-0104\)/);
  const runs = await draw('testing', 'runs');
  assert.match(runs, /TRN-0102 web-storefront #481 .*focus returns to the slot chip.* Failed · 37 passed, 1 failed/);
  assert.match(runs, /Accessibility \(axe, keyboard\)/, 'a suite name with a comma is whole');
  assert.match(await draw('testing', 'coverage'), /Criteria with a ready test case.*1 of 2/);
  assert.match(await draw('testing', 'defects'), /DEF-001.*S2.*Open/);
});
