// NooblyJS Phase 17: cloud spend by lifecycle item, for Metrics' spend by value stream. The seed's ledger is by kind of
// environment; each kind's month is shared across its environments by their cost a day, to the item each one's design
// was built for (INF-031 → PRD-031); what no item can take is unattributed. And a month of an item's infrastructure in
// production, from its design, for a business case's estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('this month\'s cloud spend goes to PRD-031 through INF-031\'s environments; a month in production from the design', async () => {
  const t = await startApp({ seed: true });
  try {
    const month = new Date().toISOString().slice(0, 7);
    const by = await t.hosted.services.cloudByItem(month);
    assert.equal(by.month, month);
    assert.ok(by.items['PRD-031'] > 0, JSON.stringify(by));
    assert.deepEqual(Object.keys(by.items), ['PRD-031'], 'every seeded environment is built from INF-031');
    assert.match(by.basis, /shared across its environments by their cost a day/);
    assert.deepEqual(await t.hosted.services.cloudByItem('2001-01'), { month: '2001-01', items: {}, unattributed: 0, basis: by.basis });
    const prod = await t.hosted.services.monthlyCostFor('PRD-031');
    assert.equal(prod.design, 'INF-031');
    assert.ok(prod.perDay > 0);
    assert.equal(prod.usd, Math.round(prod.perDay * 30 * 100) / 100);
    assert.equal(await t.hosted.services.monthlyCostFor('PRD-999'), null);
  } finally {
    await t.close();
  }
});
