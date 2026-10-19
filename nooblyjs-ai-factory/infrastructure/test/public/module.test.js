// The app's own screens in the NooblyJS frame (noobly structure.md §2a): the CSS is scoped, every nav row has a route,
// every page exports render(), pages leave history and <body> to the frame, page URLs answer with the frame, and
// a missing file is a 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV } from '../../index.js';
import { startApp } from '../helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../../../public/infrastructure/', import.meta.url);

async function filesIn(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('every selector in public/css is scoped to [data-module="infrastructure"]', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'))) {
    assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'infrastructure'), [], file);
  }
});

test('every nav row has a route, and every route names a page file that exports render()', async () => {
  const source = await fs.readFile(new URL('js/module.js', PUBLIC), 'utf8');
  const routed = new Set([...source.matchAll(/nav: '([a-z-]+)'/g)].map((m) => m[1]));
  for (const row of NAV) assert.ok(routed.has(row.key), `no route for the "${row.key}" nav row`);
  const pages = [...source.matchAll(/import\('\.\/pages\/([a-z-]+\.js)'\)/g)].map((m) => m[1]);
  assert.ok(pages.length >= NAV.length);
  for (const page of new Set(pages)) {
    assert.match(await fs.readFile(new URL(`js/pages/${page}`, PUBLIC), 'utf8'), /export async function render\(view, \{/, page);
  }
});

test('pages never touch history, popstate or <body>, and write no inline styles', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/, /style="/, /\.innerHTML = (?!String\()/]) {
      assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
    }
  }
});

test('the kit is imported by absolute URL and the app\'s own files relatively', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    for (const [, from] of (await fs.readFile(file, 'utf8')).matchAll(/from '([^']+)'/g)) {
      assert.match(from, /^(\/ui\/js\/|\.\.?\/)/, `${path.basename(file)} imports ${from}`);
    }
  }
});

test('register() describes the app for the rail and the sidebar', async () => {
  const t = await startApp();
  try {
    const { hosted } = t;
    assert.deepEqual([hosted.name, hosted.label, hosted.title], ['infrastructure', 'Infra', 'infrastructure']);
    assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/infrastructure.css'] });
    assert.deepEqual(hosted.nav.map((n) => n.key), ['environments', 'designs', 'runs', 'testing', 'blueprints', 'cost', 'policies']);
    assert.deepEqual([...new Set(hosted.nav.map((n) => n.group).filter(Boolean))], ['Govern']);
    assert.equal(hosted.nav.find((n) => n.key === 'runs').badge, 'runs');
  } finally {
    await t.close();
  }
});

test('the status card: drift in words, live environments, cloud spend against the budget, and the runs badge', async () => {
  const t = await startApp({ seed: true });
  try {
    const status = await t.hosted.status();
    assert.deepEqual(status.badges, { runs: 1 });
    assert.deepEqual(status.card.pill, { text: '1 drift detected', tone: 'warning' });
    assert.deepEqual(status.card.items, [{ label: 'Live environments', value: '6 · 2 of them previews' }]);
    assert.match(status.card.meter.label, /^[A-Z][a-z]+ cloud spend$/);
    assert.equal(status.card.meter.value, '$2,140 of $6,000');
  } finally {
    await t.close();
  }
});

test('page URLs answer with the host frame; files are served; a missing file is a 404', async () => {
  const t = await startApp();
  try {
    for (const url of ['/infrastructure', '/infrastructure/environments', '/infrastructure/designs/INF-031', '/infrastructure/policies']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 501, url); // the stand-in host's frame answers 501
      assert.match(res.text, /NooblyJS frame/, url);
    }
    const module = await fetch(`${t.base}/infrastructure/js/module.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${t.base}/infrastructure/css/infrastructure.css`)).status, 200);
    assert.equal((await fetch(`${t.base}/infrastructure/js/nope.js`)).status, 404);
    // No Content-Security-Policy of its own: one page, one policy (the host's).
    assert.equal(module.headers.get('content-security-policy'), null);
  } finally {
    await t.close();
  }
});

test('pages follow the frame\'s event stream when there is one, and only refresh on a timer when there is not (roadmap I4)', async () => {
  const { reloadable } = await import(new URL('js/live.js', PUBLIC));
  const view = { addEventListener() {} };
  const signal = new AbortController().signal;
  const draws = [];
  // Hosted in NooblyJS: an Infrastructure event redraws the page; an unrelated one does not; no timer is kept.
  let listener = null;
  const live = { signal, isCurrent: () => true, sse: { enabled: true, on: (topic, fn) => { listener = fn; } } };
  await reloadable(view, live, async () => { draws.push('live'); return 2000; });
  assert.equal(draws.length, 1);
  listener({ type: 'chat.message_posted' });
  listener({ type: 'environment.provisioning_progressed' });
  await new Promise((resolve) => setTimeout(resolve, 650));
  assert.equal(draws.length, 2);
  // For every page file: no polling of its own.
  for (const file of (await filesIn(new URL('js/pages/', PUBLIC))).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /setInterval|setTimeout/, file);
  }
});
