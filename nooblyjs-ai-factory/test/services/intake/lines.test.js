// NooblyJS Phase 27b: which line a run takes is the operator's (data/factory/lines.yaml, by repository and by item
// type), and lines may be the operator's own (data/factory/lines/*.json, which win over a built-in of the same name). A
// line that doesn't exist or doesn't read refuses the work item, saying so; a run keeps the line it was queued with.
// Nothing runs here: the runs stay queued.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';
import { register } from '../../../index.js';
import { loadLine, lineForRequest, lineNames } from '../../../src/models/line.js';
import { loadLineChoice, lineFor } from '../../../src/config/lines-choice.js';
import { KINDS } from '../../../src/services/line/executor.js';
import { createHost, createTestServerManager } from '../../fixtures/host.js';
import { tmpDir } from '../../helpers.js';

const handoff = (id, itemId, title) => ({ id, itemId, workItems: [{ id: `WI-${itemId}-1`, repo: 'web-storefront', title, status: 'new' }] });
const HANDOFFS = [handoff('hof_quick', 'PRD-201', 'SlotChip, HoldTimer'), handoff('hof_defect', 'DEF-201-1', 'picker, nearby, basket'), handoff('hof_missing', 'PRD-202', 'SlotChip, HoldTimer')];
const TYPES = { 'PRD-201': 'spec', 'DEF-201-1': 'defect', 'PRD-202': 'spec' };

let t;
before(async () => {
  const dataDir = path.join(tmpDir('factory-lines-'), 'factory');
  fs.mkdirSync(dataDir);
  const stand = createHost();
  stand.host.service = (name) => ({
    workflows: {
      handoffOf: async ({ handoffId }) => HANDOFFS.find((h) => h.id === handoffId) ?? null,
      item: async ({ itemId }) => (TYPES[itemId] ? { id: itemId, type: TYPES[itemId] } : null),
    },
  })[name];
  stand.host.development = true;
  const hosted = await register(express(), createTestServerManager(), { mountPath: '/factory', dataDir, host: stand.host, pollMs: 0, schedule: false });
  await hosted.seed();
  const env = { FACTORY_HOME: dataDir };
  t = { hosted, dataDir, env, run: (itemId) => hosted.internals.store.list('runs').find((r) => r.request?.noobly?.itemId === itemId), close: () => hosted.close() };
});
after(async () => { await t?.close(); });

test('lines.yaml: a repository\'s line, else its item type\'s, else the default; no file is `default`', () => {
  assert.deepEqual(loadLineChoice(t.env), { default: 'default', repositories: {}, itemTypes: {} });
  fs.writeFileSync(path.join(t.dataDir, 'lines.yaml'), 'default: default\nrepositories:\n  slots-api: quick\nitemTypes:\n  defect: quick\n');
  const choice = loadLineChoice(t.env);
  assert.equal(lineFor(choice, { repo: 'slots-api', itemType: 'spec' }), 'quick');
  assert.equal(lineFor(choice, { repo: 'web-storefront', itemType: 'defect' }), 'quick');
  assert.equal(lineFor(choice, { repo: 'web-storefront', itemType: 'spec' }), 'default');
  fs.rmSync(path.join(t.dataDir, 'lines.yaml'));
});

test('27b step 3: `web-storefront: quick` in lines.yaml: the next run on it goes build → verify → deliver', async () => {
  fs.writeFileSync(path.join(t.dataDir, 'lines.yaml'), 'repositories:\n  web-storefront: quick\n');
  const [out] = await t.hosted.services.intake({ handoffId: 'hof_quick' });
  assert.ok(out.runId, JSON.stringify(out));
  const run = t.run('PRD-201');
  assert.equal(run.request.line, 'quick');
  assert.deepEqual(lineForRequest(run.request, KINDS()).stations.map((s) => s.id), ['build', 'verify', 'deliver']);
  // By item type: a defect's work takes the item type's line when its repository names none.
  fs.writeFileSync(path.join(t.dataDir, 'lines.yaml'), 'itemTypes:\n  defect: quick\n');
  await t.hosted.services.intake({ handoffId: 'hof_defect' });
  assert.equal(t.run('DEF-201-1').request.line, 'quick');
});

test('a line nobody wrote refuses the work item, saying so; nothing starts', async () => {
  fs.writeFileSync(path.join(t.dataDir, 'lines.yaml'), 'repositories:\n  web-storefront: careful\n');
  const [out] = await t.hosted.services.intake({ handoffId: 'hof_missing' });
  assert.equal(out.runId ?? null, null);
  assert.match(out.waiting, /the line "careful" can't be used: No line "careful"\. Built in: default, quick/);
  assert.equal(t.run('PRD-202'), undefined);
  fs.rmSync(path.join(t.dataDir, 'lines.yaml'));
});

test('27b step 4: a line in data/factory/lines/ wins over the built-in one; with a bad `when` it is refused at load, saying where; a run keeps its line', () => {
  const dir = path.join(t.dataDir, 'lines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'quick.json'), JSON.stringify({ name: 'quick', stations: [{ id: 'build', kind: 'build' }, { id: 'deliver', kind: 'deliver' }] }));
  assert.deepEqual(loadLine('quick', KINDS(), t.env).stations.map((s) => s.id), ['build', 'deliver']);
  assert.ok(lineNames(t.env).includes('quick'));
  fs.writeFileSync(path.join(dir, 'careful.json'), JSON.stringify({ name: 'careful', stations: [{ id: 'build', kind: 'build' }, { id: 'verify', kind: 'verify', when: "build.agent.outcome == 'success' &&" }] }));
  assert.throws(() => loadLine('careful', KINDS(), t.env), (e) => /careful\.json is not a valid line/.test(e.message) && /station 2 \("verify"\): Condition .* at the end/.test(e.message));
  // The run queued before the file changed keeps the line it started with.
  const run = t.run('PRD-201');
  assert.deepEqual(lineForRequest(run.request, KINDS()).stations.map((s) => s.id), ['build', 'verify', 'deliver']);
  // A name that isn't a line's name can't reach a file.
  assert.throws(() => loadLine('../../etc/passwd', KINDS(), t.env), /is not a line's name/);
  fs.rmSync(dir, { recursive: true });
});
