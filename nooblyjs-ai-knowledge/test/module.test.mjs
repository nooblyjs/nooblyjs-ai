// The app's screens in the NooblyJS frame (noobly docs/hosted-apps/porting-an-app.md §4): the frame's CSS is scoped, every
// nav row has a route, every page exports render(), the wiki's code leaves history and <body> to the frame, page
// URLs answer with the frame, a missing file is a 404, none of the standalone platform's pages are served, and the
// generated UI (public/app) matches its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NAV } from '../index.mjs';
import { startApp, filesUnder } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../public/', import.meta.url);
const read = (file) => fs.readFile(new URL(file, PUBLIC), 'utf8');
const under = async (dir) => (await filesUnder(fileURLToPath(new URL(dir, PUBLIC)))).map((f) => `${dir}${f.split(path.sep).join('/')}`);

test('every stylesheet the frame loads is scoped to [data-module="wiki"]', async () => {
  const t = await startApp();
  try {
    assert.ok(t.hosted.ui.styles.length > 0);
    for (const file of t.hosted.ui.styles) {
      // The one rule outside the scope is the icon font (scripts/port-wiki-ui.mjs): a @font-face cannot be scoped,
      // and without it every <i class="bi …"> is an empty box. Text fonts are the kit's.
      const css = (await read(file)).replace(/@font-face \{[^}]*font-family: "bootstrap-icons"[^}]*\}/, '');
      assert.deepEqual(unscopedSelectors(css, 'wiki'), [], file);
    }
  } finally {
    await t.close();
  }
});

test('every nav row has a route, and every route has a page that exports render()', async () => {
  const source = await read('js/module.js');
  const routed = new Set([...source.matchAll(/nav: '([a-z-]+)'/g)].map((m) => m[1]));
  for (const row of NAV) assert.ok(routed.has(row.key), `no route for the "${row.key}" nav row`);

  const pages = [...source.matchAll(/import\('\.\/(pages\/[a-z-]+\.js)'\)/g)].map((m) => m[1]);
  assert.ok(pages.length > 0);
  for (const page of pages) assert.match(await read(`js/${page}`), /export (async )?function render\(/, page);
});

// The datasources screens (standalone: /applications/datasources) are the rows after the wiki's own. Everyone signed
// in to NooblyJS sees them, so no row or route asks for a permission, and each route names a screen the generated
// scripts register.
test('the datasources screens: open to everyone signed in, and every screen a route names is one the scripts register', async () => {
  // public/ is served to the browser and has no package type of its own, so its modules are read, not imported.
  const source = await read('js/module.js');
  const routes = [...source.matchAll(/\{ path: '(\/datasources[^']*)', nav: '([a-z-]+)', title: '[^']+', meta: \{ screen: '([\w-]+)' \} \}/g)]
    .map(([, path, nav, screen]) => ({ path, nav, screen }));
  const scripts = JSON.parse((await read('app/ds/scripts.js')).replace(/^[\s\S]*?export default /, '').replace(/;\s*$/, ''));
  const rows = NAV.filter((row) => row.key !== 'home');
  assert.ok(rows.length >= 9);
  for (const row of rows) {
    assert.equal(row.requires, undefined, row.key);
    assert.equal(routes.find((r) => r.path === row.path)?.nav, row.key, `the "${row.key}" row and its route disagree`);
  }
  const registered = new Set();
  for (const src of scripts) {
    for (const m of (await read(`app/ds/${src}`)).matchAll(/Router\.register\('([\w-]+)'/g)) registered.add(m[1]);
  }
  for (const route of routes) assert.ok(registered.has(route.screen), `no screen registers "${route.screen}" (${route.path})`);
  assert.doesNotMatch(source, /requires:/);
  // They come before the wiki's catch-all depths, or /datasources/workflows would open the wiki at a space of that name.
  assert.match(source, /export const routes = \[\s*\{ path: '\/'[^\n]*\n\s*\.\.\.admin,\s*\.\.\.deep,\s*\];/);
});

// public/js/hosted/env.js is the one file allowed these: it is what stands between the wiki's code and the frame.
test('the wiki\'s own code never drives history, hears popstate, appends to <body>, opens a stream or calls the standalone URLs', async () => {
  const files = ['js/module.js', ...(await under('js/pages/')), ...(await under('app/')).filter((f) => f.endsWith('.js') && !f.includes('/vendor/'))];
  assert.ok(files.length > 50, 'the generated UI is missing: run npm run port:ui');
  const banned = [
    /(?<!__wikiEnv\.)\bhistory\.(push|replace)State\(/,
    /(?<!__wikiEnv\.(window|document)Events\.)addEventListener\(\s*['"]popstate/,
    /document\.body\.(appendChild|append|insertAdjacentHTML)\(/,
    /new EventSource\(/,
    /\bwindow\.fetch\(/,
    /\/applications\/wiki/,
  ];
  for (const file of files) {
    const source = await read(file);
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${file} uses ${pattern}`);
  }
});

test('the generated UI in public/ matches the standalone source it is generated from', () => {
  const script = fileURLToPath(new URL('../scripts/port-wiki-ui.mjs', import.meta.url));
  assert.doesNotThrow(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }), 'run: npm run port:ui');
});

test('page URLs answer with the host frame; files are served; a missing file is a 404', async () => {
  const t = await startApp();
  try {
    // A wiki location ends in a document name, so a page URL may carry an extension.
    for (const url of ['/wiki', '/wiki/', '/wiki/Engineering/Some Folder', '/wiki/Engineering/Buy/Notes.v2.md', '/wiki/datasources', '/wiki/datasources/workflows']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 501, url); // the stand-in host's frame answers 501
      assert.match(res.text, /NooblyJS frame/, url);
    }
    const module = await t.get('/wiki/js/module.js');
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await t.get('/wiki/js/pages/wiki.js')).status, 200);
    assert.equal((await t.get('/wiki/app/js/app.js')).status, 200);
    for (const url of ['/wiki/js/pages/datasources.js', '/wiki/app/ds/scripts.js', '/wiki/app/ds/js/core/router.js', '/wiki/vendor/codemirror/lib/codemirror.js']) assert.equal((await t.get(url)).status, 200, url);
    for (const file of t.hosted.ui.styles) assert.equal((await t.get(`/wiki/${file}`)).status, 200, file);
    for (const url of ['/wiki/js/nope.js', '/wiki/app/js/nope.js', '/wiki/vendor/nope.js', '/wiki/nope.js']) assert.equal((await t.get(url)).status, 404, url);
    // The app sets no Content-Security-Policy of its own: one page, one policy (the host's).
    assert.equal(module.headers.get('content-security-policy'), null);
  } finally {
    await t.close();
  }
});

test('the standalone platform\'s own pages in public/ are never served', async () => {
  const t = await startApp();
  try {
    for (const url of ['/wiki/index.html', '/wiki/content-review.html', '/wiki/index.md']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.status, 404, url);
      assert.equal(res.text, '', url);
    }
  } finally {
    await t.close();
  }
});

test('the status card has the frame\'s shape and answers at once', async () => {
  const t = await startApp();
  try {
    const started = Date.now();
    const status = await t.hosted.status();
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(status.badges, {});
    assert.equal(typeof status.card.pill.text, 'string');
    assert.ok(['ok', 'info', 'neutral', 'warning', 'danger'].includes(status.card.pill.tone));
  } finally {
    await t.close();
  }
});
