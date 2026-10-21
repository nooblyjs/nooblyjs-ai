// nooblyjs-ai-factory hosted in NooblyJS (roadmap hosted-app checklist). Its rail entry, nav and status card come from
// register(); its pages are a UI module in the frame; its API is signed-in only, gated by the NooblyJS permissions
// matrix, CSRF-checked and audited by the host; and it writes only under data/factory/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApp, today, eventually } from './helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');

let env;
before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true }, { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true }, { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }] });
});
after(async () => { await env?.stop(); });

test('the shell lists Factory as ready, with its UI module, kit icons and nav', async () => {
  const c = env.client();
  await c.signIn('naledi-k');
  const app = (await c.json('/api/v1/shell')).body.apps.find((a) => a.name === 'factory');
  assert.equal(app.state, 'ready');
  assert.equal(app.rail, true);
  assert.equal(app.label, 'Factory');
  // The Test section's styles load with the Factory (Phase 16d), and the sidebar follows the work (Phase 16b). Product
  // and Design are apps of their own (CHG-009).
  assert.deepEqual(app.ui, { entry: 'js/module.js', styles: ['css/factory.css', 'quality/css/quality.css'] });
  // Phase 16d: the Test section's Test analysis sits in the Engineering group.
  assert.deepEqual(app.nav.filter((n) => n.group === 'Engineering').map((n) => n.key), ['app-architecture', 'quality-test-analysis', 'engineering-signoff']);
  assert.deepEqual([...new Set(app.nav.map((n) => n.group))], ['Engineering', 'Build', 'Test']);
  assert.deepEqual(app.nav.filter((n) => n.group === 'Build').map((n) => [n.key, n.path]), [
    ['line', '/line'], ['runs', '/runs'], ['pull-requests', '/pull-requests'], ['inbox', '/inbox'], ['campaigns', '/campaigns'], ['metrics', '/metrics'],
  ]);
  const kitIcons = await fs.readFile(require.resolve('nooblyjs-core/public/ui/js/icons.js'), 'utf8');
  for (const name of [app.icon, ...app.nav.map((n) => n.icon)]) assert.match(kitIcons, new RegExp(`\\b${name}:`), `kit icon ${name}`);
});

test('every page URL under /factory is the frame; its module, pages and scoped styles load; missing files are 404s', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  for (const page of ['/factory', '/factory/line', '/factory/runs', '/factory/runs/run-214', '/factory/inbox', '/factory/metrics?since=30d']) {
    const res = await c.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, page);
  }
  const mod = await c.get('/factory/js/module.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
  assert.match(mod.headers.get('content-security-policy'), /default-src 'self'/, "NooblyJS's policy, not the app's own");
  for (const file of ['lib.js', 'parts.js', 'pages/line.js', 'pages/runs.js', 'pages/run.js', 'pages/inbox.js', 'pages/campaigns.js', 'pages/metrics.js']) {
    assert.equal((await c.get(`/factory/js/${file}`)).status, 200, file);
  }
  const css = await (await c.get('/factory/css/factory.css')).text();
  assert.deepEqual(unscopedSelectors(css, 'factory'), []);
  assert.equal((await c.get('/factory/js/nope.js')).status, 404);
  assert.equal((await c.get('/factory/dashboard/app.js')).status, 404, "the CLI dashboard's own page is not served here");
  // Signed out, a page goes to the sign-in, and the API answers 401.
  const anon = env.client();
  assert.equal((await anon.get('/factory/line')).status, 302);
  assert.equal((await anon.get('/factory/api/v1/status')).status, 401);
});

test('the API takes the NooblyJS session; a fresh factory answers with honest zeros', async () => {
  const c = env.client();
  await c.signIn('naledi-k'); // a Viewer reads everything
  const status = await c.json('/factory/api/v1/status');
  assert.equal(status.status, 200);
  assert.deepEqual([status.body.stopped, status.body.running, status.body.queued, status.body.inbox], [false, [], [], 0]);
  assert.ok(status.body.line.length > 0, 'the default line has stations');
  assert.deepEqual((await c.json('/factory/api/v1/runs')).body, { runs: [] });
  assert.deepEqual((await c.json('/factory/api/v1/inbox')).body, { entries: [] });
  const missing = await c.json('/factory/api/v1/runs/nope');
  assert.deepEqual([missing.status, missing.body.error.code], [404, 'not_found']);
});

test('a change needs the NooblyJS CSRF token and the right access role; a refusal is audited', async () => {
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  const blocked = await viewer.request('/factory/api/v1/stop-all', { method: 'POST', json: {}, csrf: false });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'csrf_failed');
  const refused = await viewer.request('/factory/api/v1/stop-all', { method: 'POST', json: {} });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, 'forbidden');
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.permission === 'approve' && r.actor === 'naledi-k'));
  });

  // An Approver stops the factory and starts it again; the sidebar card follows.
  const approver = env.client();
  await approver.signIn('lerato-m');
  const stop = await approver.request('/factory/api/v1/stop-all', { method: 'POST', json: {} });
  assert.deepEqual([stop.status, await stop.json()], [200, { stopped: true }]);
  assert.deepEqual((await approver.json('/api/v1/shell/status')).body.factory.card.pill, { text: 'Stopped', tone: 'danger' });
  const resume = await approver.request('/factory/api/v1/resume-all', { method: 'POST', json: {} });
  assert.deepEqual(await resume.json(), { stopped: false });
});

test('the status card is in the shell shape, with the inbox badge', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/shell/status');
  const s = body.factory;
  assert.equal(s.badges.inbox, 0);
  assert.deepEqual(s.card.pill, { text: 'Accepting work', tone: 'ok' });
  assert.match(s.card.items[0].value, /^0 of \d+ slots · 0 queued$/);
  assert.match(s.card.meter.value, /^\$0 of \$\d+/);
  assert.equal(s.card.meter.ratio, 0);
});

test('it writes only under data/factory/', async () => {
  const entries = await fs.readdir(path.join(env.dataDir, 'factory'));
  // Phase 7: the log is daily YAML streams, not SQLite; the seed's demo repository and its map are here too.
  assert.ok(!entries.some((f) => f.startsWith('factory.db')), 'no database file');
  for (const name of ['repos.yaml', 'repos', 'scripts']) assert.ok(entries.includes(name), `${name} is in its own folder`);
  const root = await fs.readdir(env.dataDir);
  assert.ok(!root.some((f) => f.startsWith('factory.db') || ['artifacts', 'forge', 'events.lock', 'repos', 'scripts', 'repos.yaml'].includes(f)), 'nothing of its own at the data root');
});
