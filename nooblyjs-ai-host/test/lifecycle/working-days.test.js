import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingDays, dueFrom, daysBetween } from '../../src/lifecycle/working-days.js';
import { stageKey, stageLabel, handoffLabel, nextStage } from '../../src/lifecycle/stages.js';

test('working days skip the weekend', () => {
  assert.equal(addWorkingDays('2026-10-08T08:00:00.000Z', 1), '2026-10-09T08:00:00.000Z'); // Thu → Fri
  assert.equal(addWorkingDays('2026-10-09T10:00:00.000Z', 1), '2026-10-12T10:00:00.000Z'); // Fri → Mon
  assert.equal(addWorkingDays('2026-10-09T10:00:00.000Z', 2), '2026-10-13T10:00:00.000Z'); // Fri → Tue
  assert.equal(addWorkingDays('2026-10-10T10:00:00.000Z', 1), '2026-10-12T10:00:00.000Z'); // Sat → Mon
});

test('due times follow the rule: end of the working day, clock hours, or the end of that day', () => {
  assert.equal(dueFrom('2026-10-08T08:00:00.000Z', { workingDays: 1 }), '2026-10-09T23:59:59.000Z');
  assert.equal(dueFrom('2026-10-09T06:30:00.000Z', { hours: 4 }), '2026-10-09T10:30:00.000Z');
  assert.equal(dueFrom('2026-10-09T06:30:00.000Z', { sameDay: true }), '2026-10-09T23:59:59.000Z');
  assert.equal(dueFrom('2026-10-09T06:30:00.000Z', undefined), null);
  assert.equal(daysBetween('2026-10-05T10:00:00.000Z', '2026-10-09T10:00:00.000Z'), 4);
});

test('stages: the Product Factory\'s names and the names from before map onto lifecycle v3\'s, and handoffs are named by area', () => {
  assert.equal(stageKey('product'), 'product');
  assert.equal(stageKey('Architecture'), 'design');
  assert.equal(stageKey('specify'), 'product');
  // Ship was replaced by Verify (Phase 16a), and Verify by Test (Phase 16b): an old name still lands, and history still reads.
  assert.equal(stageKey('ship'), 'test');
  assert.equal(stageKey('verify'), 'test');
  assert.equal(stageLabel('ship'), 'Ship');
  assert.equal(stageKey('nowhere'), null);
  assert.equal(nextStage('engineer'), 'build');
  assert.equal(nextStage('build'), 'test');
  assert.equal(nextStage('operate'), null);
  assert.equal(handoffLabel('product', 'design'), 'Product → Design');
  assert.equal(handoffLabel('discover', 'product'), 'Discover → Product');
  assert.equal(handoffLabel('engineer', 'build'), 'Engineering → Build');
  assert.equal(handoffLabel('release', 'operate'), 'Release → Operate');
  // History from before reads with its own labels.
  assert.equal(handoffLabel('specify', 'architect'), 'Specify → Architect');
});
