// LIVE: this runs one Software Factory run with a real model (triage, build, review) and costs real money, capped
// by the Factory's own run budget ($2 by default). It is not part of `npm test`; run it with
// `npm run test:live:factory`, which loads .env. It needs ANTHROPIC_API_KEY, and is skipped without one.
//
// Roadmap Phase 7, "once with a real model": the Design lead approves PRD-028's handoff, and the work item
// "SlotChip, HoldTimer" is built on the demo repository by a model instead of the seed's script. The repository's
// own test gate decides whether the PR is ready. What a model does with a two-word work item is not fixed, so
// this test checks what must hold whatever it does (a real model worked, it cost something, nothing merged, the
// item heard about it) and prints the rest for a person to read.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from '../helpers.js';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const TITLE = 'SlotChip, HoldTimer';
const DONE = ['delivered', 'gate_failed', 'agent_failed', 'no_changes', 'needs_info', 'rejected', 'error', 'parked'];
let env;
let stevie;

before(async () => {
  if (!hasKey) return;
  process.env.AI_PROVIDER = 'anthropic';
  process.env.NODE_ENV = 'development';
  env = await startApp({
    env: { NODE_ENV: 'development' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    ],
  });
  stevie = env.client();
  await stevie.signIn('stevie');
});
after(async () => { await env?.stop(); });

test('live: a real model builds one work item on the demo repository; the gate decides, nothing merges, the item hears about it', { skip: !hasKey && 'no ANTHROPIC_API_KEY', timeout: 900_000 }, async () => {
  // Without its script, this work item is the model's. The other keeps its script, so only one run is live.
  await fs.rm(path.join(env.dataDir, 'factory', 'scripts', 'slotchip-holdtimer.json'));
  const res = await stevie.request('/workflows/api/v1/approvals/apr_slotpickerui/decision', { method: 'POST', json: { decision: 'approve' } });
  assert.equal(res.status, 200);

  const run = async () => (await stevie.json('/api/v1/home/items/PRD-028/runs')).body.runs.find((r) => r.title === TITLE);
  await eventually(async () => assert.ok(DONE.includes((await run())?.status), `still ${(await run())?.status}`), { ms: 840_000, every: 3000 });
  const r = await run();
  const detail = (await stevie.json(`/factory/api/v1/runs/${r.id}`)).body;
  const steps = (detail.run?.steps ?? detail.steps ?? []);
  console.log(`\n--- run "${r.title}" on ${r.repo} for ${r.itemId} ---`);
  console.log(`status: ${r.status} (${r.statusText}) · gates: ${r.gates ?? 'none ran'} · cost: $${r.costUsd} · PR: ${r.pr ?? 'none'}`);
  for (const s of Array.isArray(steps) ? steps : Object.entries(steps).map(([id, v]) => ({ id, ...v }))) console.log(`  ${s.id}: ${s.status}${s.result?.costUsd ? ` · $${s.result.costUsd}` : ''}${s.route?.model ? ` · ${s.route.model}` : ''}`);
  const questions = (await stevie.json('/factory/api/v1/inbox')).body.entries.filter((e) => e.runId === r.id);
  for (const q of questions) console.log(`  asks (${q.kind}): ${q.title}\n${String(q.body ?? '').slice(0, 1200)}`);

  assert.ok(r.costUsd > 0, 'a real model costs something');
  assert.equal(r.itemId, 'PRD-028');
  await eventually(async () => {
    const events = await today(env.store, 'events');
    assert.ok(events.some((e) => e.type === 'run.started' && e.payload.runId === r.id && e.payload.itemId === 'PRD-028'));
    assert.ok(!events.some((e) => e.type === 'run.merged' || e.type === 'pr.merged'), 'no agent merged');
  }, { ms: 15_000, every: 500 });
  if (r.status === 'delivered') {
    const forge = path.join(env.dataDir, 'factory', 'forge');
    const files = (await fs.readdir(forge, { recursive: true })).filter((f) => f.endsWith('.md'));
    const texts = await Promise.all(files.map((f) => fs.readFile(path.join(forge, f), 'utf8')));
    const pr = texts.find((t) => t.includes(TITLE) && t.includes('## From NooblyJS'));
    assert.ok(pr, 'the ready PR carries what it is for in NooblyJS');
    console.log(`\n--- the PR file (first 60 lines) ---\n${pr.split('\n').slice(0, 60).join('\n')}\n`);
  }
});
