// The UI kit (nooblyjs-core/public/ui) and NooblyJS's built-in modules, tested without a browser: escaping, components,
// routing helpers, the shell's renderers, the route tables and CSS scoping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const UI = path.dirname(require.resolve('nooblyjs-core/public/ui/package.json'));
const NOOBLY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = (p) => import(pathToFileURL(path.join(UI, p)).href);

test('html escapes everything interpolated unless it is SafeHtml', async () => {
  const { html, raw } = await kit('js/html.js');
  const evil = '<img src=x onerror="alert(1)">';
  assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>');
  assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
  assert.equal(String(html`${[1, null, undefined, false, 'a']}`), '1a');
});

test('components escape their text and say status in words', async () => {
  const c = await kit('js/components/index.js');
  const evil = '<script>x</script>';
  const out = [
    c.button({ label: evil }), c.statusPill({ text: evil }), c.statCard({ label: evil, value: evil }),
    c.listRow({ title: evil, meta: evil, who: evil }), c.dataTable({ columns: [{ key: 'a', label: evil }], rows: [{ a: evil }] }),
    c.kanbanColumn({ title: evil, cards: [{ title: evil }] }), c.timelineRow({ actor: evil, action: evil }),
    c.meter({ label: evil, value: evil, ratio: 2 }), c.processChevron({ code: evil, name: evil }),
    c.stageStrip({ stages: [{ name: evil, count: 1 }] }), c.swimlane({ rows: [{ title: evil, id: evil }] }),
    c.checklist({ items: [{ text: evil }] }), c.notice({ title: evil, text: evil }), c.pageHead({ title: evil }),
    c.chips({ label: evil, items: [{ value: evil, label: evil, count: evil }] }),
    c.swimlane({ rows: [{ title: evil, id: evil, href: evil, age: evil, cells: { s: { state: 'now', text: evil } } }], stages: [{ key: 's', label: evil }] }),
  ].map(String);
  for (const o of out) assert.ok(!o.includes('<script>'), `unescaped: ${o.slice(0, 80)}`);

  assert.match(String(c.meter({ label: 'x', value: 'y', ratio: 2 })), /aria-valuenow="100"/, 'meter clamps to 100%');
  assert.match(String(c.checklist({ items: [{ text: 'a', state: 'failed' }] })), /Missing/);
  assert.match(String(c.swimlane({ rows: [{ title: 't', id: 'i', cells: { Discover: { state: 'waiting' } } }] })), /Waiting too long/);
  const evilMessage = { id: 'm1', at: '2026-10-09T10:00:00.000Z', author: { id: 'x', name: evil, kind: 'agent' }, text: `${evil} @Ada\nline two`, mentions: [{ id: 'ada-quill', name: 'Ada Quill' }],
    cards: [{ id: 'card_1', type: 'plan', title: evil, steps: [evil], apply: { label: evil } }, { id: 'card_2', type: 'comparison', title: evil, columns: [evil], rows: [{ label: evil, values: [evil] }] },
      { id: 'card_3', type: 'facts', title: evil, rows: [{ label: evil, value: evil }] }, { id: 'card_4', type: 'approval', title: evil, text: evil, requires: 'change-repo-access', status: 'open' }, { id: 'card_5', type: 'pr-link', title: evil, status: evil }],
    citations: [{ n: 1, title: evil, type: evil }], costUsd: 0.42 };
  const chatHtml = String(c.chatPanel({ thread: { id: 'thr_x', title: evil }, messages: [evilMessage, { id: 'm2', at: '2026-10-09T10:00:00.000Z', author: { id: 'system', name: 'NooblyJS', kind: 'system' }, text: evil }], chips: [{ action: 'summarise', label: evil }], working: [{ id: 'a', name: evil }], canPost: true }, { can: () => true }));
  assert.ok(!chatHtml.includes('<script>'), 'chat escapes names, text, cards and citations');
  assert.match(chatHtml, /<span class="chat-mention">@Ada<\/span><br>line two/, 'a resolved mention is marked and line breaks are kept');
  assert.match(chatHtml, /chat-msg--agent[\s\S]*chat-msg__tag">Agent</, 'an agent message says Agent');
  assert.match(chatHtml, /role="log"/);
  // A card's actions follow the reader's permissions (a hint; the API decides), and never show once it is answered.
  const approval = { id: 'card_9', type: 'approval', title: 'Read access', requires: 'change-repo-access', status: 'open' };
  assert.match(String(c.chatCard(approval, { can: (p) => p === 'change-repo-access' })), /data-chat-action="approve"[\s\S]*data-chat-action="decline"/);
  assert.doesNotMatch(String(c.chatCard(approval, { can: () => false })), /data-chat-action/);
  assert.match(String(c.chatCard(approval, { can: () => false })), /Agents never can/);
  const answered = String(c.chatCard({ ...approval, status: 'approved', decidedByName: 'Stevie' }, { can: () => true }));
  assert.match(answered, /Approved by Stevie/);
  assert.doesNotMatch(answered, /data-chat-action/);
  assert.match(String(c.chatCard({ id: 'card_8', type: 'plan', title: 'Rollout plan', steps: ['a'], apply: { label: 'Apply to spec' }, status: 'applied', appliedVersion: 5, decidedByName: 'Lerato M.' }, { can: () => true })), /Applied by Lerato M\. · spec v5/);
  const lane = String(c.swimlane({ stages: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }], rows: [{ title: 't', id: 'i', cells: { a: { state: 'done' }, b: { state: 'now', text: 'Your review' } } }] }));
  assert.match(lane, /Done<\/span>/, 'a passed stage says Done');
  assert.match(lane, /Your review<span class="visually-hidden"> \(Now\)/);
  assert.match(lane, /Not reached/, 'a stage without a cell is not reached');
  const filter = String(c.chips({ label: 'Show', name: 'filter', current: 'mine', items: [{ value: 'all', label: 'All', count: 12 }, { value: 'mine', label: 'Mine', count: 0 }] }));
  assert.match(filter, /data-filter="mine" aria-pressed="true">Mine <span class="chip__count">0</, 'the pressed chip says so, and a zero count shows');
  assert.match(filter, /data-filter="all" aria-pressed="false"/);
  assert.throws(() => c.chips({ label: 'x', name: 'on click', items: [] }), /attribute suffix/);
  assert.match(String(c.stageStrip({ stages: [{ name: 'Build', count: 5 }], current: 'Build' })), /\(current\)/);
  assert.match(String(c.button({ label: 'Go', kind: 'nonsense' })), /btn--primary/, 'unknown kinds fall back to primary');
  assert.match(String(c.button({ label: 'Go', href: '/x', attrs: { onclick: 'bad()', 'data-x': '1' } })), /data-x="1"/);
  assert.doesNotMatch(String(c.button({ label: 'Go', attrs: { onclick: 'bad()' } })), /onclick/, 'only data-/aria- attributes pass');
});

test('router: patterns, the longest mount path, relative and full paths', async () => {
  const r = await kit('js/router.js');
  const routes = [{ path: '/' }, { path: '/runs' }, { path: '/runs/:id' }];
  assert.equal(r.matchRoute(routes, '/').route.path, '/');
  assert.deepEqual(r.matchRoute(routes, '/runs/214/').params, { id: '214' });
  assert.deepEqual(r.matchRoute(routes, '/runs/a%20b').params, { id: 'a b' });
  assert.equal(r.matchRoute(routes, '/nope'), null);
  const apps = [{ name: 'home', mountPath: '/' }, { name: 'product', mountPath: '/product' }, { name: 'factory', mountPath: '/factory' }];
  assert.equal(r.appFor(apps, '/product/specs/PRD-031').name, 'product');
  assert.equal(r.appFor(apps, '/productx').name, 'home', 'a prefix only counts at a path boundary');
  assert.equal(r.appFor(apps, '/home/approvals').name, 'home');
  assert.equal(r.relativePath('/product', '/product'), '/');
  assert.equal(r.relativePath('/product', '/product/specs'), '/specs');
  assert.equal(r.relativePath('/', '/home/approvals'), '/home/approvals');
  assert.equal(r.fullPath('/factory', '/'), '/factory');
  assert.equal(r.fullPath('/', '/home/overview'), '/home/overview');
  assert.equal(r.resolveAsset('/hello', 'js/module.js'), '/hello/js/module.js');
  assert.equal(r.resolveAsset('/', '/js/modules/home.js'), '/js/modules/home.js');
});

test('shell renderers: rail order, current item, states, nav groups and badges, status card, person', async () => {
  const s = await kit('js/shell.js');
  const apps = [
    { name: 'home', label: 'Home', icon: 'home', mountPath: '/', rail: true, state: 'ready' },
    { name: 'factory', label: 'Factory', icon: 'factory', mountPath: '/factory', rail: true, state: 'not-installed' },
    { name: 'dev', label: 'Dev', mountPath: '/dev', rail: false, state: 'ready' },
  ];
  const rail = String(s.renderRail(apps, 'home'));
  assert.ok(rail.indexOf('data-app="home"') < rail.indexOf('data-app="factory"'));
  assert.match(rail, /data-app="home" aria-current="page"/);
  assert.match(rail, /Not installed yet/);
  assert.doesNotMatch(rail, /data-app="dev"/);

  const app = { name: 'platform', label: 'Platform', mountPath: '/platform', nav: [
    { key: 'repos', label: 'Repositories', path: '/repositories', group: 'Build' },
    { key: 'settings', label: 'Settings', path: '/settings', group: 'Govern', badge: 'pending' },
  ] };
  const nav = String(s.renderNav(app, { currentKey: 'settings', badges: { pending: 3 } }));
  assert.match(nav, /nav__group">Build</);
  assert.match(nav, /href="\/platform\/settings" data-nav="settings" aria-current="page"/);
  assert.match(nav, /nav__badge">3/);
  assert.doesNotMatch(String(s.renderNav(app, { badges: { pending: 0 } })), /nav__badge/, 'a zero badge is hidden');

  const card = String(s.renderStatusCard({ pill: { text: 'All systems healthy', tone: 'info' }, items: [{ label: 'Agents', value: '9' }], meter: { label: 'Spent today', value: '$142 of $400', ratio: 0.355 }, lines: ['x'] }));
  for (const part of ['All systems healthy', 'status-card__label">Agents', 'Spent today', 'aria-valuenow="36"', 'status-card__line">x']) assert.ok(card.includes(part), part);
  assert.equal(String(s.renderStatusCard(null)), '');
  const person = String(s.renderPerson({ name: 'Lerato M.', workRole: 'product-manager', accessRole: 'Approver' }, 'tok'));
  assert.match(person, /LM/);
  assert.match(person, /Product manager · Approver/);
  assert.match(person, /name="_csrf" value="tok"/);
});

test('built-in modules: every nav item has a route, every route has a page or redirect, placeholders name a phase', async () => {
  const { HOME, PLATFORM, DEV } = await import('../src/built-in-apps.js');
  const { matchRoute } = await kit('js/router.js');
  for (const app of [HOME, PLATFORM, DEV]) {
    const mod = await import(pathToFileURL(path.join(NOOBLY, 'public', app.ui.entry)).href);
    for (const row of app.nav) {
      const m = matchRoute(mod.routes, row.path);
      assert.ok(m, `${app.name}: nav ${row.key} (${row.path}) has no route`);
      const target = m.route.redirect ? matchRoute(mod.routes, m.route.redirect).route : m.route;
      assert.equal(target.nav, row.key, `${app.name}: ${row.path} highlights ${target.nav}, not ${row.key}`);
    }
    for (const route of mod.routes) {
      assert.ok(route.redirect || typeof route.page === 'function', `${app.name}: ${route.path} has neither page nor redirect`);
      if (route.page && route.meta) assert.ok(Number.isInteger(route.meta.phase), `${app.name}: ${route.path} names no phase`);
    }
  }
});

test('app stylesheets are scoped under [data-module]', async () => {
  const files = [
    [path.join(NOOBLY, 'public', 'css', 'styleguide.css'), 'dev'],
    [path.join(NOOBLY, 'public', 'css', 'teams-simulator.css'), 'dev'],
    [path.join(NOOBLY, 'test', 'fixtures', 'hello-app', 'public', 'css', 'hello.css'), 'hello-app'],
  ];
  // The kit's own check, which looks inside @media blocks (the hosted apps' tests use it too).
  const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
  for (const [file, name] of files) {
    assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), name), [], `${path.basename(file)} has selectors that are not scoped`);
  }
});
