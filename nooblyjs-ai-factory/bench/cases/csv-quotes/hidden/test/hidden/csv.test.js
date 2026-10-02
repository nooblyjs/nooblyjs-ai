import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsvLine } from '../../src/csv.js';

test('quotes', () => {
  assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(parseCsvLine('"say ""hi"""'), ['say "hi"']);
  assert.deepEqual(parseCsvLine('a,,b'), ['a', '', 'b']);
  assert.deepEqual(parseCsvLine(''), ['']);
});
