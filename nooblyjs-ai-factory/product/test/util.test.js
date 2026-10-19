import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, nextNumbered, isId } from '../src/util/ids.js';
import { toTable, parseTable } from '../src/util/md-table.js';
import { HttpError, conflict, unprocessable } from '../src/util/errors.js';

test('generated ids are <prefix>_<random>', () => {
  const id = newId('drf');
  assert.match(id, /^drf_[a-z0-9]{10}$/);
  assert.notEqual(newId('drf'), id);
  assert.throws(() => newId('Draft'), /prefix/);
});

test('numbered ids continue from the highest in use, padded to three digits', () => {
  assert.equal(nextNumbered('PRD', ['PRD-031', 'PRD-029', 'ADR-099']), 'PRD-032');
  assert.equal(nextNumbered('IDEA', []), 'IDEA-001');
  assert.equal(nextNumbered('ADR', ['ADR-999']), 'ADR-1000');
  assert.throws(() => nextNumbered('XYZ', []), /unknown/);
});

test('isId accepts the ids this engine issues and nothing that could be a path', () => {
  for (const ok of ['PRD-031', 'IDEA-018', 'ADR-014', 'drf_8f3k2q9a1b']) assert.ok(isId(ok), ok);
  for (const bad of ['../PRD-031', 'PRD-31', 'prd-031', 'drf_', '', null]) assert.ok(!isId(bad), String(bad));
});

test('Markdown tables round-trip, including pipes and line breaks in cells', () => {
  const columns = [
    { key: 'attribute', label: 'Attribute' },
    { key: 'target', label: 'Target' },
  ];
  const rows = [
    { attribute: 'Latency', target: 'p95 < 300 ms' },
    { attribute: 'Cost | run', target: 'under\n$600 \\ month' },
  ];
  const text = toTable(columns, rows);
  assert.equal(text.split('\n')[0], '| Attribute | Target |');
  assert.deepEqual(parseTable(`Intro\n\n${text}\n\nAfter`, columns), [
    { attribute: 'Latency', target: 'p95 < 300 ms' },
    { attribute: 'Cost | run', target: 'under $600 \\ month' },
  ]);
});

test('parseTable matches columns by label, in any order, and skips tables without them', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| Target | Attribute |\n|:---|---:|\n| fast | Latency |';
  assert.deepEqual(parseTable(md, [{ key: 'attribute', label: 'attribute' }, { key: 'target', label: 'TARGET' }]), [
    { attribute: 'Latency', target: 'fast' },
  ]);
  assert.deepEqual(parseTable('no table here', [{ key: 'a', label: 'A' }]), []);
});

test('HttpError helpers carry status and code', () => {
  const err = conflict('Someone saved a newer version.', { version: 5 });
  assert.ok(err instanceof HttpError);
  assert.deepEqual([err.status, err.code, err.details], [409, 'conflict', { version: 5 }]);
  assert.equal(unprocessable('Bad').status, 422);
});
