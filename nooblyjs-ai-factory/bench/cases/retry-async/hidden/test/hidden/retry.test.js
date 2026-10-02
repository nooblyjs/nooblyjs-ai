import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retry } from '../../src/retry.js';

test('succeeds on the third call', async () => {
  let calls = 0;
  const out = await retry(async () => { calls++; if (calls < 3) throw new Error(`fail ${calls}`); return 'ok'; }, 5);
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
});
test('gives up with the last error', async () => {
  let calls = 0;
  await assert.rejects(retry(async () => { calls++; throw new Error(`fail ${calls}`); }, 2), /fail 2/);
  assert.equal(calls, 2);
});
