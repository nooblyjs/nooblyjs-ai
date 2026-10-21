// Phase 17: spend placed by where the work sits. This month's agent spend facts that name an item go, through the
// item's parents, to its product's value stream and portfolio; cloud spend comes per item from Infrastructure; each
// portfolio is set against its budget; what can't be placed is said. Spend per item feeds a business case's estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaces } from '../../src/services/metrics/places.js';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const T = (day) => Date.parse(`2026-10-${day}T10:00:00.000Z`);
const services = new Map(Object.entries({
  workflows: { items: async () => [{ id: 'PRD-031' }, { id: 'STORY-031-1', parentId: 'PRD-031' }, { id: 'PR-031-1-1', parentId: 'STORY-031-1' }, { id: 'PRD-030' }] },
  product: { placeOf: async (id) => ({ 'PRD-031': { portfolio: 'Digital', valueStream: 'Digital Commerce' }, 'PRD-030': { portfolio: 'Digital', valueStream: 'Rewards' } })[id] ?? null },
  infrastructure: { cloudByItem: async () => ({ items: { 'PRD-031': 300, 'PRD-099': 20 }, unattributed: 40, basis: 'shared by cost a day' }) },
  platform: { budgets: { read: async () => ({ portfolios: [{ name: 'Digital', monthly: 500 }, { name: 'Banking', monthly: 100 }] }) } },
}));
const FACTS = [
  { t: T('02'), k: 'spend', system: 'factory', cost: 10, item: 'PR-031-1-1' },
  { t: T('05'), k: 'spend', system: 'product', cost: 5, item: 'PRD-031' },
  { t: T('06'), k: 'spend', system: 'product', cost: 7, item: 'PRD-030' },
  { t: T('07'), k: 'spend', system: 'teammates', cost: 3 },
  { t: Date.parse('2026-09-20T10:00:00.000Z'), k: 'spend', system: 'product', cost: 100, item: 'PRD-031' },
];

test('this month\'s spend by value stream, each portfolio against its budget, and what can\'t be placed', async () => {
  const s = await createPlaces({ services }).byValueStream(FACTS, NOW);
  assert.equal(s.month, '2026-10');
  assert.deepEqual(s.rows.map((r) => [r.valueStream, r.agentUsd, r.cloudUsd, r.totalUsd, r.items]), [
    ['Digital Commerce', 15, 300, 315, ['PRD-031']],
    ['Rewards', 7, 0, 7, ['PRD-030']],
  ]);
  assert.deepEqual(s.portfolios.map((p) => [p.name, p.totalUsd, p.budgetUsd, p.text]), [
    ['Banking', 0, 100, '$0 of $100 this month'],
    ['Digital', 322, 500, '$322 of $500 this month'],
  ]);
  assert.deepEqual([s.unplaced.agentUsd, s.unplaced.cloudUsd, s.unplaced.items], [3, 60, ['PRD-099']]);
  assert.equal(s.text, '$322 placed across 2 value streams this month');
});

test('agent spend per item, rolled up to the item a pull request and its story are for', async () => {
  assert.deepEqual(await createPlaces({ services }).spendByItem(FACTS), { 'PRD-031': 115, 'PRD-030': 7 });
  const alone = await createPlaces({ services: new Map() }).byValueStream(FACTS, NOW);
  assert.deepEqual([alone.rows, alone.unplaced.agentUsd], [[], 25], 'nothing to place with: all of it said, none hidden');
});
