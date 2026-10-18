// NooblyJS Phase 9: the factory asks NooblyJS Platform. A handoff's work item on a repository where agents may not open
// pull requests (or with the budget reached) waits, with Platform's reason; the daily cap is Platform's; and
// Platform · Containers can cancel a run and stop everything. The Platform here is a stand-in with the same calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';
import { register } from '../../index.js';
import { createHost, createTestServerManager } from '../fixtures/host.js';
import { tmpDir } from '../helpers.js';

const handoff = (id, workItems) => ({ id, itemId: 'PRD-031', workItems });
const HANDOFFS = {
  hof_allowed: handoff('hof_allowed', [{ id: 'WI-1', repo: 'web-storefront', title: 'SlotChip, HoldTimer', status: 'new' }]),
  hof_refused: handoff('hof_refused', [{ id: 'WI-2', repo: 'web-storefront', title: 'picker, nearby, basket', status: 'new' }]),
};

let t;
before(async () => {
  const dataDir = path.join(tmpDir('factory-noobly-platform-'), 'factory');
  fs.mkdirSync(dataDir);
  const stand = createHost();
  const asked = [];
  const platform = {
    refuse: null,
    cap: 15,
    async checkAgentWork(q) {
      asked.push(q);
      return this.refuse ? { ok: false, code: 'repo_no_access', message: this.refuse } : { ok: true, route: null };
    },
    budgets: { read: async () => ({ systems: [{ key: 'factory', period: 'day', limit: platform.cap }] }) },
  };
  stand.host.service = (name) => ({ platform, workflows: { handoffOf: async ({ handoffId }) => HANDOFFS[handoffId] ?? null } })[name];
  stand.host.development = true;
  const hosted = await register(express(), createTestServerManager(), { mountPath: '/factory', dataDir, host: stand.host, pollMs: 0, schedule: false });
  await hosted.seed();
  t = { ...stand, hosted, platform, asked };
});
after(async () => { await t?.hosted.close(); });

test('a work item starts only when Platform allows agents to open PRs there; otherwise it waits with Platform\'s reason', async () => {
  const [ok] = await t.hosted.services.intake({ handoffId: 'hof_allowed' });
  assert.ok(ok.runId);
  assert.deepEqual(t.asked[0], { system: 'factory', workType: 'implementation', repo: 'web-storefront', needs: 'openPrs', itemId: 'PRD-031', teammateId: 'factory' });

  t.platform.refuse = 'Agents may not open pull requests on acme/web-storefront (Read only). An Owner can change it in Platform · Repositories.';
  const [waits] = await t.hosted.services.intake({ handoffId: 'hof_refused' });
  assert.equal(waits.runId, undefined);
  assert.equal(waits.waiting, t.platform.refuse);
  const waiting = await t.hosted.services.waitingWork('PRD-031');
  assert.deepEqual(waiting.map((w) => [w.workItemId, w.reason]), [['WI-2', t.platform.refuse]]);
  t.platform.refuse = null;
});

test('the daily cap is Platform\'s, and follows a budget change', async () => {
  assert.equal((await t.hosted.services.status()).dailyBudgetUsd, 15);
  t.platform.cap = 40;
  t.host.events.emit('budget.changed', { system: 'platform', changed: ['factory'] });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await t.hosted.services.status()).dailyBudgetUsd, 40);
});

test('Platform · Containers cancels a run, and Stop all stops the factory', async () => {
  const run = (await t.hosted.services.runsForItem('PRD-031'))[0];
  assert.equal(await t.hosted.services.cancel(run.id), 'cancelled');
  await t.hosted.flush();
  assert.equal(t.hosted.internals.store.get('runs', run.id).status, 'cancelled');
  assert.deepEqual(await t.hosted.services.stopAll({ by: 'Stevie', reason: 'drill' }), { stopped: true });
  assert.equal((await t.hosted.services.status()).stopped, true);
});
