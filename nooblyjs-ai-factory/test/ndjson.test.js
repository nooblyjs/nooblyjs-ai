// Phase F01: NDJSON from a pipe arrives in chunks, not lines.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNdjsonParser } from '../src/exec/harness/ndjson.js';

test('lines split across chunks, and a UTF-8 character split across chunks, parse correctly', () => {
  const values = [];
  const parser = createNdjsonParser((v) => values.push(v));
  const bytes = Buffer.from('{"a":1}\n{"text":"café"}\n{"b":2}\n');
  for (let i = 0; i < bytes.length; i += 3) parser.push(bytes.subarray(i, i + 3)); // cuts "é" in half somewhere
  parser.end();
  assert.deepEqual(values, [{ a: 1 }, { text: 'café' }, { b: 2 }]);
});

test('a last line without a newline is still read at the end; bad lines are reported, not thrown', () => {
  const values = [];
  const bad = [];
  const parser = createNdjsonParser((v) => values.push(v), (line) => bad.push(line));
  parser.push('{"a":1}\nnot json\n\n{"b":');
  parser.push('2}');
  parser.end();
  assert.deepEqual(values, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(bad, ['not json']);
});
