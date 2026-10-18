// The UI module shares one page with NooblyJS and every other app (noobly structure.md §2a, hosted-app checklist step 11):
// its CSS is scoped, its routes cover its nav, and it never draws a shell of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PUBLIC_DIR } from '../../src/config/app.js';
import { NAV } from '../../index.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const read = (...parts) => fs.readFileSync(path.join(PUBLIC_DIR, ...parts), 'utf8');

test('every selector in public/css starts with [data-module="teammates"]', () => {
  const sheets = fs.readdirSync(path.join(PUBLIC_DIR, 'css')).filter((f) => f.endsWith('.css'));
  assert.ok(sheets.length);
  for (const sheet of sheets) assert.deepEqual(unscopedSelectors(read('css', sheet), 'teammates'), [], sheet);
});

test('kit class names Teammates also uses are confined to its older pages, so neither side restyles the other', () => {
  const kit = fs.readFileSync(require.resolve('nooblyjs-core/public/ui/css/components.css'), 'utf8');
  const kitClasses = new Set([...kit.matchAll(/^\.([a-z][a-z0-9-]*)/gm)].map((m) => m[1]));
  const css = read('css', 'teammates.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // Inside .tm-root (pages not yet on the kit, dialogs, toasts) the kit's rules for these names are reverted…
  const reverted = /:where\(\.tm-root, #teammates-portal\) :is\(([^)]*)\) \{\s*all: revert;/.exec(css);
  assert.ok(reverted, 'the revert rule is there');
  const listed = reverted[1].split(',').map((c) => c.trim().replace(/^\./, '')).sort();
  const ours = new Set([...css.matchAll(/:where\(\.tm-root\) [^{,]*?\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  assert.deepEqual(listed, [...ours].filter((c) => kitClasses.has(c) && listed.includes(c)).sort());
  // …and outside it (pages built on the kit, in .tm-kit) no rule of Teammates' names a kit class or a bare element.
  const loose = [...css.matchAll(/\[data-module="teammates"\] ([^{,]+)[{,]/g)].map((m) => m[1].trim())
    .filter((sel) => !sel.startsWith(':where(.tm-root') && !sel.startsWith('.tm-root') && !sel.startsWith('.tm-kit'));
  for (const sel of loose) {
    assert.doesNotMatch(sel, /^([*]|[a-z][a-z0-9]*)(?![a-z0-9-])/, `"${sel}" styles an element everywhere`);
    const first = /^\.([a-z][a-z0-9-]*)/.exec(sel)?.[1];
    assert.ok(!kitClasses.has(first), `"${sel}" restyles the kit's .${first}`);
  }
});

test('the route table covers every nav row, with the same permission', () => {
  const module = read('js', 'module.js');
  for (const row of NAV) {
    assert.match(module, new RegExp(`path: '${row.path}', nav: '${row.key}'`), `a route for ${row.key}`);
  }
  // Rows that need a permission name the same one on their route (client.js mirrors services/auth.js).
  const client = read('js', 'client.js');
  assert.match(client, /PERMISSION_FOR_ROLE = \{ viewer: 'read', manager: 'approve', owner: 'set-budgets', hire: 'hire-teammates', post: 'draft' \}/);
});

test("the pages are the frame's: render() and destroy(), the kit's helpers, and no stream, bridge or helper copies of their own", () => {
  for (const gone of ['bridge.js', 'base.js', 'api.js', 'html.js', 'icons.js']) assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', gone)), false, gone);
  const all = [...fs.readdirSync(path.join(PUBLIC_DIR, 'js')).filter((f) => f.endsWith('.js')).map((f) => ['js', f]), ...fs.readdirSync(path.join(PUBLIC_DIR, 'js', 'pages')).map((f) => ['js', 'pages', f])];
  for (const parts of all) {
    const js = read(...parts);
    assert.doesNotMatch(js, /new EventSource|api\/v1\/events/, `${parts.at(-1)} opens its own event stream`);
    assert.doesNotMatch(js, /from '\.\.?\/(html|icons|api|base|bridge)\.js'/, `${parts.at(-1)} imports a helper that was removed`);
  }
  for (const file of fs.readdirSync(path.join(PUBLIC_DIR, 'js', 'pages'))) {
    const js = read('js', 'pages', file);
    assert.match(js, /export async function render\(frameView, \{ [^}]*ctx: frame \}\)/, `${file}: render(view, { params, query, ctx })`);
    assert.match(js, /await enter\(frameView, frame, '/, `${file} opens through client.js`);
  }
  // The roster is built on the kit's components.
  assert.match(read('js', 'pages', 'roster.js'), /import \{ pageHead, statCard, chips, statusPill, meter, button, notice \} from '\/ui\/js\/components\/index\.js'/);
});

test('the module draws no shell: no page of its own, no sidebar, sign-in or router', () => {
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'index.html')), false);
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'app.js')), false);
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'pages', 'login.js')), false);
  for (const file of fs.readdirSync(path.join(PUBLIC_DIR, 'js', 'pages'))) {
    const js = read('js', 'pages', file);
    // replaceState for a page's own filters in the query string is fine; navigation goes through ctx.navigate.
    assert.doesNotMatch(js, /history\.pushState|'popstate'/, `${file} routes on its own`);
    assert.doesNotMatch(js, /document\.body\.(append|classList)/, `${file} touches <body>`);
  }
});
