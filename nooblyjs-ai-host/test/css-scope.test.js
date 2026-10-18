// nooblyjs-core's CSS scoping (src/shell/css-scope.js): what every hosted app uses to port its stylesheet into the shared
// page, and what each app's tests use to prove every selector starts with [data-module="<name>"].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scopeCss, unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const S = '[data-module="tm"]';
const squash = (css) => css.replace(/\s+/g, ' ').trim();

test('every selector in a list gets the scope; :root, html and body become the scope itself', () => {
  const out = scopeCss(':root { --x: 1; } body { color: red; } .a, .b > c { margin: 0; } * { padding: 0; }', 'tm');
  assert.equal(squash(out), squash(`${S} { --x: 1; } ${S} { color: red; } ${S} .a,\n${S} .b > c { margin: 0; } ${S} * { padding: 0; }`));
});

test('conditions on body stay on the scope; descendants of body go under it', () => {
  const out = scopeCss('body:not(.can-manage) .x { display: none; } body.dark .y { color: #fff; } body .z { gap: 1px; }', 'tm');
  assert.match(out, /\[data-module="tm"\]:not\(\.can-manage\) \.x/);
  assert.match(out, /\[data-module="tm"\]\.dark \.y/);
  assert.match(out, /\[data-module="tm"\] \.z/);
});

test('@media and @supports are scoped inside; @keyframes are left alone', () => {
  const out = scopeCss('@media (max-width: 860px) { .a { gap: 0; } } @keyframes spin { to { transform: rotate(1turn); } }', 'tm');
  assert.match(out, /@media \(max-width: 860px\) \{\s*\[data-module="tm"\] \.a \{ gap: 0; \}\s*\}/);
  assert.match(out, /@keyframes spin \{ to \{ transform: rotate\(1turn\); \} \}/);
});

test("@import is dropped whole, even with semicolons inside its URL, and the rules after it survive", () => {
  const dropped = [];
  const css = "@import url('https://fonts.example/css2?family=X:wght@400;500;600&display=swap');\n:root { --gap: 24px; }\n.a { gap: var(--gap); }";
  const out = scopeCss(css, 'tm', { onDropped: (t) => dropped.push(t) });
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /^@import url\('https:\/\/fonts\.example/);
  assert.doesNotMatch(out, /@import|500;600/);
  assert.match(out, /\[data-module="tm"\] \{ --gap: 24px; \}/);
  assert.match(out, /\[data-module="tm"\] \.a \{ gap: var\(--gap\); \}/);
});

test('strings and comments with braces or commas do not confuse it', () => {
  const out = scopeCss('/* .x { } */ .a[title="a,b{c}"] { content: "}"; } .b::before { content: \'{\'; }', 'tm');
  assert.deepEqual(unscopedSelectors(out, 'tm'), []);
  assert.match(out, /\[data-module="tm"\] \.a\[title="a,b\{c\}"\] \{ content: "\}"; \}/);
});

test('drop leaves out obsolete selectors, and the rule when none are left', () => {
  const out = scopeCss('.sidebar, .card { padding: 4px; } .sidebar { width: 232px; }', 'tm', { drop: (s) => s.includes('.sidebar') });
  assert.equal(squash(out), squash(`${S} .card { padding: 4px; }`));
});

test('unscopedSelectors names what would leak into the shared page', () => {
  assert.deepEqual(unscopedSelectors(`${S} .a {} .b {} @media print { .c {} } @font-face { font-family: X; }`, 'tm'), ['.b', '.c', '@font-face']);
  assert.deepEqual(unscopedSelectors(scopeCss('.a{} @media print{.b{}}', 'tm'), 'tm'), []);
});
