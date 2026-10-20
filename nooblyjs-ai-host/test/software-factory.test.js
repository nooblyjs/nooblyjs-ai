// Phase 7 in the real app (roadmap Phase 7 test script): a handoff approved in NooblyJS becomes Software Factory runs
// on the demo repository, the runs report back to the item, a stuck run asks a developer, and no agent merges.
// The lifecycle engine, the Product Factory and the Software Factory are hosted; the Factory's scheduler runs in
// this process. Offline: the agents are the seed's scripts. The steps run in order on one data folder, and the
// runs do real git and a real test gate, so this file is slow (a minute or two).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let priya;
let viewer;
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const work = async (c = priya) => (await c.json('/api/v1/home/items/PRD-028/runs')).body;
const run = async (title) => (await work()).runs.find((r) => r.title === title);
/** Runs do real work: wait for a status, looking every half second. */
const until = (check) => eventually(check, { ms: 240_000, every: 500 });

before(async () => {
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
    ],
  });
  [stevie, priya, viewer] = [env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await priya.signIn('priya-s');
  await viewer.signIn('naledi-k');
});
after(async () => { await env?.stop(); });

test('a fresh Factory has its demo repository, no database, and nothing running; the item has no runs yet', async () => {
  const dir = path.join(env.dataDir, 'factory');
  const names = await fs.readdir(dir);
  assert.ok(names.includes('repos.yaml') && names.includes('repos') && names.includes('scripts'));
  assert.ok(!names.includes('factory.db'), 'the log is files, not SQLite');
  assert.match(await fs.readFile(path.join(dir, 'repos.yaml'), 'utf8'), /^web-storefront: repos\/web-storefront$/m);
  assert.deepEqual(await work(), { itemId: 'PRD-028', running: true, runs: [], waiting: [] });
  const home = (await priya.json('/api/v1/home/for-you')).body;
  assert.deepEqual([home.panels.runs.rows, home.panels.question.rows], [[], []]);
  assert.deepEqual(home.tiles.find((t) => t.key === 'runs').note, 'Nothing in flight');
});

test('step 1: the Design handoff and the Engineering sign-off; two work items become runs on the demo repo, and four wait for a repository', async () => {
  // Someone tries to configure an agent merge first (step 4): the operator's config asks for autonomy L3.
  await fs.writeFile(path.join(env.dataDir, 'factory', 'config.json'), JSON.stringify({ autonomy: 'L3' }));
  const res = await post(stevie, '/workflows/api/v1/approvals/apr_slotpickerdesign/decision', { decision: 'approve' });
  assert.equal(res.status, 200);
  // Lifecycle v3 (Phase 16b): nothing is built before the Engineering sign-off.
  assert.equal((await res.json()).item.stage, 'engineer');
  assert.deepEqual((await work()).runs, []);
  const signed = await post(stevie, '/workflows/api/v1/items/PRD-028/advance', {});
  assert.equal(signed.status, 200);
  await until(async () => assert.equal((await work()).runs.length, 2));
  const w = await work();
  assert.deepEqual(w.runs.map((r) => [r.title, r.repo, r.itemId]).sort(), [
    ['SlotChip, HoldTimer', 'web-storefront', 'PRD-028'],
    ['picker, nearby, basket', 'web-storefront', 'PRD-028'],
  ]);
  assert.deepEqual(w.waiting.map((x) => [x.repo, x.reason]).sort(), [
    ['design-system', 'no repository is set up for "design-system"'],
    ['mobile-app', 'no repository is set up for "mobile-app"'],
    ['slots-api', 'no repository is set up for "slots-api"'],
    ['slots-api', 'no repository is set up for "slots-api"'],
  ]);
  assert.ok(w.runs.every((r) => r.href.startsWith('/factory/runs/')));
  // The item is in Build, and the runs are on Priya's home.
  assert.equal((await priya.json('/workflows/api/v1/items/PRD-028')).body.item.stage, 'build');
  const home = (await priya.json('/api/v1/home/for-you')).body;
  assert.equal(home.panels.runs.rows.length, 2);
  assert.equal(home.panels.runs.waiting.length, 4);
});

test('step 2: the runs execute; one ends with a ready PR file that carries its gates and evidence, and reports to the item', { timeout: 300_000 }, async () => {
  await until(async () => assert.equal((await run('SlotChip, HoldTimer')).status, 'delivered'));
  const done = await run('SlotChip, HoldTimer');
  assert.deepEqual([done.statusText, done.gates], ['PR ready', 'test passed']);
  assert.ok(done.pr);
  const forge = path.join(env.dataDir, 'factory', 'forge');
  const files = (await fs.readdir(forge, { recursive: true })).filter((f) => f.endsWith('.md'));
  const texts = await Promise.all(files.map((f) => fs.readFile(path.join(forge, f), 'utf8')));
  const pr = texts.find((t) => /SlotChip, HoldTimer/.test(t) && /test/i.test(t));
  assert.ok(pr, 'the PR is a file under data/factory/forge');
  // NooblyJS heard about it, with the item on each event; Activity shows it under Factory.
  await eventually(async () => {
    const events = await today(env.store, 'events');
    const finished = events.find((e) => e.type === 'run.finished' && e.payload.outcome === 'delivered');
    assert.deepEqual([finished.payload.itemId, finished.payload.system, finished.payload.repo], ['PRD-028', 'factory', 'web-storefront']);
    assert.ok(events.some((e) => e.type === 'pr.opened' && e.payload.itemId === 'PRD-028'));
  }, { ms: 10_000, every: 200 });
  const rows = (await priya.json('/api/v1/activity?filter=factory&limit=50')).body.rows;
  assert.ok(rows.some((r) => r.type === 'run.finished' && r.itemId === 'PRD-028' && /SlotChip, HoldTimer/.test(r.action)));
});

test('step 3: the other run fails its gate and cannot fix it, so it asks; Priya sees the question on her home and in the item\'s thread', { timeout: 300_000 }, async () => {
  await until(async () => assert.equal((await run('picker, nearby, basket')).status, 'gate_failed'));
  assert.match((await run('picker, nearby, basket')).gates, /test failed/);
  let question;
  await eventually(async () => {
    const home = (await priya.json('/api/v1/home/for-you')).body;
    assert.equal(home.tiles.find((t) => t.key === 'help').value, 1);
    [question] = home.panels.question.rows;
    assert.deepEqual([question.kind, question.itemId, question.canAnswer], ['escalation', 'PRD-028', true]);
  }, { ms: 10_000, every: 200 });
  assert.match(question.title, /needs a person: check "test" failed/);
  await eventually(async () => {
    const { messages } = (await priya.json('/api/v1/chat/thread?kind=item&id=PRD-028')).body;
    assert.ok(messages.some((m) => m.author.kind === 'system' && /A Software Factory run is asking a person: .*needs a person/.test(m.text)));
  }, { ms: 10_000, every: 200 });

  // A Viewer can read it and can't answer it; the refusal is audited.
  const seen = (await viewer.json('/api/v1/home/items/PRD-028/runs')).body;
  assert.equal(seen.runs.length, 2);
  const refused = await post(viewer, `/factory/api/v1/inbox/${question.id}`, { decision: 'answered', answer: 'x' });
  assert.equal(refused.status, 403);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'naledi-k')));

  // Priya answers; the run goes back to be repaired with her words, and ends with a ready PR.
  const answered = await post(priya, `/factory/api/v1/inbox/${question.id}`, { decision: 'answered', answer: 'A store exactly at the limit counts: make it inclusive.' });
  assert.equal(answered.status, 200);
  assert.equal((await answered.json()).resumed, true);
  await until(async () => assert.equal((await run('picker, nearby, basket')).status, 'delivered'));
  assert.equal((await run('picker, nearby, basket')).gates, 'test passed');
  assert.deepEqual((await priya.json('/api/v1/home/for-you')).body.panels.question.rows, []);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.actor === 'priya-s' && String(r.action).includes(`/factory/api/v1/inbox/${question.id}`))));
});

test('step 4: the configured agent merge was refused and audited; nothing was merged, and both PRs wait for a person', async () => {
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    const refused = audit.filter((r) => r.action === 'merge.refused');
    assert.ok(refused.length >= 1);
    const asked = refused.find((r) => /autonomy L3/.test(r.reason));
    assert.ok(asked, 'the configured agent merge is named in the refusal');
    assert.deepEqual([asked.itemId, asked.actor, asked.system], ['PRD-028', 'factory', 'factory']);
  }, { ms: 10_000, every: 200 });
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'merge.refused'));
  assert.ok(!events.some((e) => e.type === 'run.merged' || e.type === 'pr.merged'));
  // The item stays in Build: a merge is a person's approval in NooblyJS.
  assert.equal((await priya.json('/workflows/api/v1/items/PRD-028')).body.item.stage, 'build');
});

test('step 5: Factory Metrics counts the runs and their cost; the item\'s page and Activity agree', async () => {
  const metrics = await priya.json('/factory/api/v1/metrics?since=30d');
  assert.equal(metrics.status, 200);
  assert.match(JSON.stringify(metrics.body), /"runs":\s*2|"total":\s*2|"delivered":\s*2/);
  const w = await work();
  assert.deepEqual(w.runs.map((r) => r.status), ['delivered', 'delivered']);
  const status = (await priya.json('/api/v1/shell/status')).body.factory;
  assert.match(status.card.items[0].value, /^0 of \d+ slots · 0 queued$/);
  assert.equal(status.badges.inbox, 0);
});
