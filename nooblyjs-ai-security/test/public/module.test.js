// The app's own screens in the NooblyJS frame (noobly structure.md §2a): the CSS is scoped, every nav row has a route,
// every page exports render(), pages leave history and <body> to the frame, page URLs answer with the frame, and a
// missing file is a 404.
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

test('every selector in public/css is scoped to [data-module="security"]', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'))) {
    assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'security'), [], file);
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

test('pages never touch history, popstate or <body>, write no inline styles, and keep no timers of their own', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/, /style="/, /\.innerHTML = (?!String\()/]) {
      assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
    }
  }
  for (const file of (await filesIn(new URL('js/pages/', PUBLIC))).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /setInterval|setTimeout/, file);
  }
});

test('the kit is imported by absolute URL and the app\'s own files relatively', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    for (const [, from] of (await fs.readFile(file, 'utf8')).matchAll(/from '([^']+)'/g)) {
      assert.match(from, /^(\/ui\/js\/|\.\.?\/)/, `${path.basename(file)} imports ${from}`);
    }
  }
});

test('register() describes the app for the rail and the sidebar; the status card says findings in words', async () => {
  const t = await startApp({ seed: true });
  try {
    const { hosted } = t;
    assert.deepEqual([hosted.name, hosted.label, hosted.icon], ['security', 'Security', 'key']);
    assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/security.css'] });
    assert.deepEqual(hosted.nav.map((n) => n.key), ['threat-models', 'findings', 'risks', 'policies']);
    const status = await hosted.status();
    assert.deepEqual(status.badges, { findings: 2 });
    assert.deepEqual(status.card.pill, { text: '2 open findings', tone: 'warning' });
    assert.deepEqual(status.card.items.map((i) => i.label), ['Threat models waiting', 'Scanner']);
  } finally {
    await t.close();
  }
});

test('page URLs answer with the host frame; files are served; a missing file is a 404', async () => {
  const t = await startApp();
  try {
    for (const url of ['/security', '/security/findings', '/security/findings/FND-001', '/security/threat-models/TM-031', '/security/policies']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 501, url); // the stand-in host's frame answers 501
      assert.match(res.text, /NooblyJS frame/, url);
    }
    const module = await fetch(`${t.base}/security/js/module.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${t.base}/security/css/security.css`)).status, 200);
    assert.equal((await fetch(`${t.base}/security/js/nope.js`)).status, 404);
  } finally {
    await t.close();
  }
});
