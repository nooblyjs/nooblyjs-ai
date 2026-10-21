// Phase F26: the UI module shares ONE page with NooblyJS and every other app, so: its CSS is scoped,
// its routes cover its nav, every page keeps the frame's contract, and it draws no shell of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { NAV, ENGINEERING_NAV, TEST_NAV } from '../index.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');
const KIT = path.resolve(import.meta.dirname, '..', '..', '..', 'nooblyjs-core', 'public', 'ui');
const read = (...parts) => fs.readFileSync(path.join(PUBLIC, ...parts), 'utf8');
const SCOPE = '[data-module="factory"]';

/** Every selector of a stylesheet (at-rule preludes left out), split on top-level commas. */
function selectors(css) {
  const out = [];
  for (const [, prelude] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
    if (prelude.trim().startsWith('@')) continue;
    out.push(...prelude.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

test('every selector in public/css starts with [data-module="factory"], and loads nothing from elsewhere', () => {
  const sheets = fs.readdirSync(path.join(PUBLIC, 'css'));
  assert.deepEqual(sheets, ['factory.css']);
  const css = read('css', 'factory.css');
  assert.ok(selectors(css).length > 200);
  assert.deepEqual(selectors(css).filter((s) => !s.startsWith(SCOPE)), []);
  assert.doesNotMatch(css, /@import|@font-face|https?:/, 'fonts and imports belong to the kit');
});

test('kit class names the factory also uses are reverted inside its pages, so the kit styles do not leak in', (t) => {
  if (!fs.existsSync(KIT)) return t.skip('../../nooblyjs-core is not checked out');
  const kit = fs.readFileSync(path.join(KIT, 'css', 'components.css'), 'utf8');
  const kitClasses = new Set([...kit.matchAll(/^\.([a-z][a-z0-9-]*)/gm)].map((m) => m[1]));
  const css = read('css', 'factory.css');
  const reverted = /:where\(\.fx-root\) :is\(([^)]*)\) \{ all: revert;/.exec(css);
  assert.ok(reverted, 'the revert rule is there');
  const ours = new Set(selectors(css.replace(reverted[0], '')).flatMap((s) => [...s.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1])));
  assert.deepEqual(reverted[1].split(',').map((c) => c.trim().slice(1)).sort(), [...ours].filter((c) => kitClasses.has(c)).sort());
});

test('the route table covers every nav row, and every page keeps the frame\'s contract', async () => {
  const { routes } = await import('../public/js/module.js');
  for (const row of [...ENGINEERING_NAV, ...NAV, ...TEST_NAV]) assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key), `a route for ${row.key}`);
  assert.deepEqual(routes[0], { path: '/', redirect: '/line' });
  const pages = fs.readdirSync(path.join(PUBLIC, 'js', 'pages'));
  // engineering.js and testing.js: the Engineering, Pull requests and Test rows (CHG-008); moved.js: old Test analysis
  // links; moved-app.js: old Product and Design addresses (CHG-009, test/sections.test.js).
  assert.deepEqual(pages.sort(), ['campaigns.js', 'engineering.js', 'inbox.js', 'line.js', 'metrics.js', 'moved-app.js', 'moved.js', 'run.js', 'runs.js', 'testing.js']);
  // The sections' routes are checked in test/sections.test.js; these are the Factory's own.
  const own = routes.filter((r) => !/^\/(product|design|quality)(\/|$)/.test(r.path));
  for (const route of own.filter((r) => r.page)) {
    assert.match(route.path, /^\/[a-z:/-]*$/);
    const [, file] = /import\('\.\/pages\/([a-z]+\.js)'\)/.exec(String(route.page)) ?? [];
    assert.ok(pages.includes(file), `${route.path} loads a page that exists`);
  }
  // A page draws through page(), or (needing its route's meta) exports render() itself.
  for (const file of pages) assert.match(read('js', 'pages', file), /^export (const render = page\(\w+\);$|function render\()/m, `${file} exports render()`);
});

test('the module draws no shell and shares the page politely', () => {
  for (const gone of ['index.html', 'js/app.js', 'js/index.html']) assert.equal(fs.existsSync(path.join(PUBLIC, gone)), false, gone);
  const files = [['js', 'module.js'], ['js', 'lib.js'], ['js', 'parts.js'], ...fs.readdirSync(path.join(PUBLIC, 'js', 'pages')).map((f) => ['js', 'pages', f])];
  for (const parts of files) {
    const js = read(...parts);
    const name = parts.at(-1);
    assert.doesNotMatch(js, /history\.(pushState|replaceState)|'popstate'|'hashchange'|location\.hash/, `${name} routes on its own`);
    assert.doesNotMatch(js, /document\.body|document\.getElementById|document\.querySelector/, `${name} reaches outside its view`);
    assert.doesNotMatch(js, /new EventSource|new WebSocket/, `${name} opens its own stream`);
    assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML/, `${name} writes HTML from text`);
    assert.doesNotMatch(js, /href: ['`]#\//, `${name} still has a hash link`);
    assert.doesNotMatch(js, /sessionStorage|factory-token/, `${name} keeps a token`);
  }
});
