// utils/md-table.js: Markdown tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, renderTable } from '../../src/utils/md-table.js';

test('markdown tables escape pipes and newlines', () => {
  const rows = [{ id: '1', task: 'a | b\nc', amount: '5' }];
  const parsed = parseTable(renderTable(['id', 'task', 'amount'], rows));
  assert.deepEqual(parsed, [{ id: '1', task: 'a | b c', amount: '5' }]);
});
