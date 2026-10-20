// Roadmap I4 (NooblyJS Phase 9a): the drift sweep on the host's clock, cancelling a run, and destroying an environment.
// The sweep only finds and records; cancel and destroy are people's actions under the apply rules, each with a test
// that refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const HOUR = 3_600_000;
const events = (t, type) => t.eventLog.filter((e) => e.type === type);

test('the drift sweep runs when 6 business hours have passed on the host\'s clock, records new drift, and repairs nothing', async () => {
  let at = Date.parse('2026-10-12T08:00:00Z');
  const t = await startApp({ seed: true, changeHost: (h) => ({ ...h, clock: { now: () => at } }) });
  try {
    assert.deepEqual(await t.hosted.sweep.tick(), { ran: false, reason: 'first start' });
    at += 5 * HOUR;
    assert.deepEqual(await t.hosted.sweep.tick(), { ran: false, reason: 'not due' });
    // Someone changes pr-486's Redis by hand.
    const file = path.join(t.dataDir, 'environments', 'pr-486.md');
    const text = await fs.readFile(file, 'utf8');
    // (The seed leaves pr-486 mid-run until the next start; here it is live, on design v2.)
    await fs.writeFile(file, text.replace('status: provisioning', 'status: live').replace(/^---\r?\n/, '---\nobserved:\n  redis-cache: { maxmemory: 4gb }\n'));
    at += 1 * HOUR;
    const swept = await t.hosted.sweep.tick();
    assert.equal(swept.ran, true);
    assert.equal(swept.found, 1);
    assert.equal(events(t, 'drift.sweep_finished').length, 1);
    const drift = (await t.get(`${API}/drift`, { as: 'stevie' })).json.drift.find((d) => d.environment === 'pr-486');
    assert.deepEqual([drift.setting, drift.expected, drift.actual, drift.status], ['maxmemory', '1gb', '4gb', 'open']);
    // Nothing was applied: no run started.
    assert.equal(events(t, 'environment.plan_ready').length, 0);
    // The next sweep finds nothing new (the drift is already known), and only after another 6 hours.
    assert.equal((await t.hosted.sweep.tick()).ran, false);
    at += 6 * HOUR;
    assert.equal((await t.hosted.sweep.tick()).found, 0);
  } finally {
    await t.close();
  }
});

test('cancel: a queued run ends at once and a running one at its next step; an agent and a Viewer are refused', async () => {
  const people = [
    { id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true },
    { id: 'priya-s', name: 'Priya S.', accessRole: 'Contributor', active: true },
    { id: 'naledi-k', name: 'Naledi K.', accessRole: 'Viewer', active: true },
    { id: 'ines-tau', name: 'Ines Tau', accessRole: 'Owner', kind: 'agent', active: true },
  ];
  const t = await startApp({ seed: true, people, provisionStepMs: 40 });
  try {
    await t.hosted.idle(); // the seed's own run finishes first
    const first = (await t.post(`${API}/environments`, { as: 'priya-s', body: { name: 'dev-two', kind: 'dev', designId: 'INF-031' } })).json.run;
    const second = (await t.post(`${API}/environments`, { as: 'priya-s', body: { name: 'dev-three', kind: 'dev', designId: 'INF-031' } })).json.run;
    assert.equal((await t.post(`${API}/runs/${second.id}/cancel`, { as: 'ines-tau' })).status, 403);
    assert.equal((await t.post(`${API}/runs/${second.id}/cancel`, { as: 'naledi-k' })).status, 403);
    // Queued: gone at once, and the environment it was making is not left half made.
    const queued = await t.post(`${API}/runs/${second.id}/cancel`, { as: 'priya-s' });
    assert.deepEqual([queued.status, queued.json.run.status], [200, 'cancelled']);
    assert.equal((await t.get(`${API}/environments`, { as: 'stevie' })).json.environments.some((e) => e.name === 'dev-three'), false);
    // Running: asked to stop, and it does.
    assert.equal((await t.post(`${API}/runs/${first.id}/cancel`, { as: 'priya-s' })).status, 200);
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/runs/${first.id}`, { as: 'stevie' })).json.status, 'cancelled');
    assert.equal((await t.post(`${API}/runs/${first.id}/cancel`, { as: 'priya-s' })).status, 409);
    assert.deepEqual(events(t, 'environment.provisioning_cancelled').map((e) => e.payload.environment).sort(), ['dev-three', 'dev-two']);
    assert.ok(t.auditLog.some((a) => a.actor === 'ines-tau' && a.action === 'access.refused'));
  } finally {
    await t.close();
  }
});

test('destroy: Preview with draft; Test needs the platform owner and a reason; Production is refused; it leaves every list', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.hosted.idle();
    const before = (await t.hosted.status()).card.items[0].value;
    assert.equal((await t.post(`${API}/environments/pr-485/destroy`, { as: 'naledi-k', body: {} })).status, 403);
    const preview = await t.post(`${API}/environments/pr-485/destroy`, { as: 'priya-s', body: {} });
    assert.deepEqual([preview.status, preview.json.status], [200, 'destroyed']);
    assert.equal((await t.post(`${API}/environments/test-slots/destroy`, { as: 'priya-s', body: { reason: 'no longer needed' } })).status, 403);
    assert.equal((await t.post(`${API}/environments/test-slots/destroy`, { as: 'stevie', body: {} })).status, 400);
    assert.equal((await t.post(`${API}/environments/test-slots/destroy`, { as: 'stevie', body: { reason: 'Replaced by test-two' } })).status, 200);
    const prod = await t.post(`${API}/environments/prod/destroy`, { as: 'stevie', body: { reason: 'x y z' } });
    assert.deepEqual([prod.status, prod.json.error.code], [422, 'release_only']);
    const names = (await t.get(`${API}/environments`, { as: 'stevie' })).json.environments.map((e) => e.name);
    assert.ok(!names.includes('pr-485') && !names.includes('test-slots') && names.includes('prod'));
    assert.equal((await t.post(`${API}/environments/pr-485/destroy`, { as: 'priya-s', body: {} })).status, 404);
    assert.notEqual((await t.hosted.status()).card.items[0].value, before);
    assert.deepEqual(events(t, 'environment.destroyed').map((e) => [e.payload.environment, e.payload.reason]), [['pr-485', null], ['test-slots', 'Replaced by test-two']]);
    // The record is kept for its history.
    assert.match(await fs.readFile(path.join(t.dataDir, 'environments', 'test-slots.md'), 'utf8'), /status: destroyed/);
  } finally {
    await t.close();
  }
});

test('a run has a page of its own: the plan, who asked, who approved, and a log of each step', async () => {
  const t = await startApp({ seed: true });
  try {
    const approved = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'test' } });
    const id = approved.json.runs.find((r) => r.environment === 'test-slots').id;
    await t.hosted.idle();
    const run = (await t.get(`${API}/runs/${id}`, { as: 'priya-s' })).json;
    assert.deepEqual([run.status, run.environment, run.approvedBy.name, run.cancellable, run.runHref], ['done', 'test-slots', 'Stevie', false, `/infrastructure/runs/${id}`]);
    const lines = run.log.map((l) => l.text);
    assert.equal(lines[0], 'Queued: Design INF-031 v2 approved for Test');
    assert.match(lines[1], /^Plan for INF-031 v2: \+\d+ to add/);
    assert.equal(lines[2], 'Approved by Stevie');
    assert.equal(lines[3], 'Started (mock provisioner)');
    assert.equal(lines.at(-1), 'Provisioned test-slots from INF-031 v2');
    assert.ok(lines.includes('Applied 50%'));
    // The seed's run, from before logs were kept, still has one.
    assert.ok((await t.get(`${API}/runs/run_seedpr486`, { as: 'priya-s' })).json.log.length >= 1);
    assert.equal((await t.get(`${API}/runs/run_nope000000`, { as: 'priya-s' })).status, 404);
  } finally {
    await t.close();
  }
});
