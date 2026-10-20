// The cloud budget (stack.md §3, roadmap I3, NooblyJS Phase 9a): at the budget, new provisioning pauses. Hosted in NooblyJS
// it is Platform's cloud budget and Platform's words; standalone, budget.yaml's. A refusal changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const newDev = (t) => t.post(`${API}/environments`, { as: 'stevie', body: { name: 'dev-two', kind: 'dev', designId: 'INF-031' } });

test('standalone: past budget.yaml\'s monthly budget a new environment is refused, and nothing is written', async () => {
  const t = await startApp({ seed: true });
  try {
    await fs.writeFile(path.join(t.dataDir, 'budget.yaml'), 'monthlyUsd: 100\n');
    const res = await newDev(t);
    assert.equal(res.status, 402);
    assert.equal(res.json.error.code, 'budget_reached');
    assert.match(res.json.error.message, /^New provisioning is paused: this month's cloud spend \(\$[\d,]+ of \$100\) has reached the budget\.$/);
    assert.equal((await t.get(`${API}/environments/dev-two`, { as: 'stevie' })).status, 404);
  } finally {
    await t.close();
  }
});

test('hosted: Platform decides, in its words; its cloud budget is the one the status card shows', async () => {
  const asked = [];
  const platform = {
    refuse: null,
    async checkAgentWork(q) {
      asked.push(q);
      return this.refuse ? { ok: false, code: 'budget_reached', message: this.refuse } : { ok: true, route: null };
    },
    budgetFor: async (system) => (system === 'cloud' ? 2500 : null),
  };
  const t = await startApp({ seed: true, services: { platform } });
  try {
    const card = (await t.hosted.status()).card.meter;
    assert.match(card.value, / of \$2,500$/);
    platform.refuse = 'New provisioning is paused: Cloud (Infrastructure) has reached its $2,000 budget ($2,140 spent this month). An Owner can raise it in Platform · Settings · Budgets.';
    const refused = await newDev(t);
    assert.deepEqual([refused.status, refused.json.error.message], [402, platform.refuse]);
    assert.deepEqual(asked.at(-1), { system: 'cloud', teammateId: 'stevie' });
    // Approving a design and restoring drift wait too.
    const approve = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'test' } });
    assert.equal(approve.status, 402);
    assert.equal((await t.get(`${API}/designs/INF-031`, { as: 'stevie' })).json.status, 'waiting-approval', 'nothing recorded');
    platform.refuse = null;
    assert.equal((await newDev(t)).status, 201);
    await t.hosted.idle();
  } finally {
    await t.close();
  }
});
