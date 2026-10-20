// Phase 16c: the Design section's pages in the NooblyJS frame (noobly docs/hosted-apps/porting-an-app.md §4): the CSS
// is scoped, every nav row has a route, and pages leave history and <body> to the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { NAV } from '../index.js';

const require = createRequire(import.meta.url);
const { unscopedSelectors } = require('nooblyjs-core/src/shell/css-scope.js');
const PUBLIC = new URL('../../public/design/', import.meta.url);

async function filesIn(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('every selector in public/design is scoped to [data-module="design"]', async () => {
  const css = (await filesIn(PUBLIC)).filter((f) => f.endsWith('.css'));
  assert.ok(css.length);
  for (const file of css) assert.deepEqual(unscopedSelectors(await fs.readFile(file, 'utf8'), 'design'), [], file);
});

test('every nav row has a list and an item page in the route table', async () => {
  const { routes } = await import('../../public/design/js/module.js');
  for (const row of NAV) {
    assert.ok(routes.some((r) => r.path === row.path && r.nav === row.key && r.page), `a list for ${row.key}`);
    assert.ok(routes.some((r) => r.path === `${row.path}/:id` && r.nav === row.key && r.page), `an item page for ${row.key}`);
  }
});

test('pages never touch history, popstate or <body>: the frame owns them', async () => {
  for (const file of (await filesIn(PUBLIC)).filter((f) => f.endsWith('.js'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const banned of [/history\.(push|replace)State/, /popstate/, /document\.body/]) assert.doesNotMatch(source, banned, `${path.basename(file)} uses ${banned}`);
  }
});
