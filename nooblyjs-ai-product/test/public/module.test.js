// The app's own screens in the NooblyJS frame (noobly docs/hosted-apps/porting-an-app.md §4): the CSS is scoped, every
// nav row has a route, pages leave history and <body> to the frame, page URLs answer with the frame, a missing file
// is a 404, and the status card has the frame's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV } from '../../index.js';
import { startApp } from '../helpers.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../../public/', import.meta.url);

async function filesIn(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('every selector in public/css is scoped to [data-module="product"]', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'))) {
    assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'product'), [], file);
  }
});

test('every nav row has a route in module.js', async () => {
  const source = await fs.readFile(new URL('js/module.js', PUBLIC), 'utf8');
  const routed = new Set([...source.matchAll(/nav: '([a-z-]+)'/g)].map((m) => m[1]));
  for (const row of NAV) assert.ok(routed.has(row.key), `no route for the "${row.key}" nav row`);
});

test('pages never touch history, popstate or <body>: the frame owns them', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/]) {
      assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
    }
  }
});

test('register() describes the app for the rail and the sidebar', async () => {
  const t = await startApp({ seed: true });
  try {
    const { hosted } = t;
    assert.equal(hosted.name, 'product');
    assert.equal(hosted.label, 'Product');
    assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/product.css'] });
    assert.deepEqual(hosted.nav.map((n) => n.key), ['overview', 'portfolios', 'board', 'specs', 'architecture', 'ux', 'ui', 'reviews', 'handoffs', 'settings']);
    assert.deepEqual([...new Set(hosted.nav.map((n) => n.group).filter(Boolean))], ['Strategy', 'Stages', 'Flow', 'Setup']);
  } finally {
    await t.close();
  }
});

test('the status card: agents on duty, this month\'s spend against the budget, and the Reviews badge', async () => {
  const t = await startApp({ seed: true });
  try {
    const status = await t.hosted.status();
    assert.equal(status.badges.reviews, 2);
    assert.deepEqual(status.card.pill, { text: '1 agent on duty', tone: 'info' });
    assert.match(status.card.meter.label, /^[A-Z][a-z]+ spend$/);
    assert.match(status.card.meter.value, /^\$\d+ of \$1,500$/);
    assert.ok(status.card.meter.ratio >= 0 && status.card.meter.ratio < 1);
  } finally {
    await t.close();
  }
});

test('page URLs answer with the host frame; files are served; a missing file is a 404', async () => {
  const t = await startApp();
  try {
    for (const url of ['/product', '/product/board', '/product/specs/PRD-031', '/product/reviews', '/product/portfolios/pfl_digital', '/product/value-streams/vs_rewards', '/product/settings']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 501, url); // the stand-in host's frame answers 501
      assert.match(res.text, /NooblyJS frame/, url);
    }
    const module = await fetch(`${t.base}/product/js/module.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${t.base}/product/css/product.css`)).status, 200);
    assert.equal((await fetch(`${t.base}/product/js/nope.js`)).status, 404);
    // The app sets no Content-Security-Policy of its own: one page, one policy (the host's).
    assert.equal(module.headers.get('content-security-policy'), null);
  } finally {
    await t.close();
  }
});
