// utils/dates.js: billing periods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, isoWeek, startOfWeek } from '../../src/utils/dates.js';

test('billing periods', () => {
  assert.deepEqual(periodRange('month', 0, '2026-10-01'), { period: 'month', offset: 0, start: '2026-10-01', end: '2026-10-31', label: 'October' });
  assert.equal(periodRange('month', -1, '2026-10-01').label, 'September');
  assert.deepEqual(periodRange('quarter', -1, '2026-10-01'), { period: 'quarter', offset: -1, start: '2026-07-01', end: '2026-09-30', label: 'Q3 2026' });
  assert.equal(periodRange('week', 0, '2026-10-01').start, '2026-09-28');
  assert.equal(startOfWeek('2026-10-04'), '2026-09-28');
  assert.equal(isoWeek('2026-10-01'), 40);
});
