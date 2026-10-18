// Who drafts each stage (src/services/stage-agents.js): one of the teammates hired in Digital Teammates, never a name
// written in code. With only StevieB hired, StevieB drafts specs, not Ada Quill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createStageAgents } from '../src/services/stage-agents.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');

async function make(roster) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'product-stage-agents-'));
  const audit = [];
  const host = {
    store: new FsStore(dir),
    service: (name) => (name === 'teammates' && roster ? { roster: async () => roster } : undefined),
    audit: { record: async (r) => audit.push(r) },
    events: { emit: async () => {} },
  };
  return { agents: createStageAgents({ host }), audit, stop: () => fs.rm(dir, { recursive: true, force: true }) };
}

test('with only StevieB hired, StevieB drafts every stage', async () => {
  const t = await make([{ id: 'stevieb', name: 'StevieB', role: 'Engineer' }]);
  try {
    for (const stage of ['product', 'architecture', 'ux', 'ui']) {
      const d = await t.agents.forStage(stage);
      assert.deepEqual(d.teammate, { id: 'stevieb', name: 'StevieB', kind: 'agent' }, stage);
    }
    assert.equal((await t.agents.resolve('product')).name, 'StevieB');
  } finally { await t.stop(); }
});

test('the stage\'s usual teammate drafts when hired; with several and none assigned, a person chooses, and the choice is kept', async () => {
  const t = await make([{ id: 'stevieb', name: 'StevieB' }, { id: 'ada-quill', name: 'Ada Quill' }, { id: 'kai', name: 'Kai' }]);
  try {
    assert.equal((await t.agents.forStage('product')).teammate.id, 'ada-quill');
    const ux = await t.agents.forStage('ux');
    assert.equal(ux.teammate, null);
    assert.match(ux.reason, /Choose which teammate drafts UX design: StevieB, Ada Quill, Kai/);
    await assert.rejects(() => t.agents.resolve('ux'), (err) => err.status === 409 && err.code === 'choose_teammate');
    assert.equal((await t.agents.resolve('ux', { teammateId: 'kai', actor: { id: 'stevie' } })).name, 'Kai');
    assert.equal((await t.agents.forStage('ux')).teammate.id, 'kai', 'the pick is remembered');
    assert.ok(t.audit.some((a) => a.action === 'product.stage_agent_assigned' && a.to === 'kai'));
    await assert.rejects(() => t.agents.resolve('ux', { teammateId: 'nobody' }), /not one of your hired teammates/);
  } finally { await t.stop(); }
});

test('with nobody hired, nobody drafts, and it says how to fix that', async () => {
  const t = await make([]);
  try {
    const d = await t.agents.forStage('product');
    assert.deepEqual([d.teammate, d.options], [null, []]);
    assert.match(d.reason, /No agent teammate is hired yet/);
    await assert.rejects(() => t.agents.resolve('product'), (err) => err.status === 409 && err.code === 'no_teammate');
  } finally { await t.stop(); }
});

test('without Digital Teammates (this engine on its own) the usual name stands in, as before', async () => {
  const t = await make(null);
  try {
    const d = await t.agents.forStage('product');
    assert.deepEqual([d.standalone, d.teammate.id], [true, 'ada-quill']);
  } finally { await t.stop(); }
});
