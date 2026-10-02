import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as common from 'nooblyjs-ai-common';
import { costOf } from 'nooblyjs-ai-common/cost';
import pkg from 'nooblyjs-ai-common/package.json' with { type: 'json' };

test('the package entry and every subpath export resolve', async () => {
  assert.equal(common.costOf, costOf);
  for (const subpath of Object.keys(pkg.exports)) {
    if (subpath === '.' || subpath.endsWith('.json')) continue;
    const mod = await import(`nooblyjs-ai-common/${subpath.slice(2)}`);
    assert.ok(Object.keys(mod).length, `${subpath} exports something`);
    // One adapter's internals (buildRequest…) stay under its own subpath; everything else is in the main entry too.
    if (subpath.startsWith('./providers/')) continue;
    for (const [name, value] of Object.entries(mod)) assert.equal(common[name], value, `${subpath} ${name} is in the main entry`);
  }
});
