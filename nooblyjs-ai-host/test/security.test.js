// Phase 19 in the real app (root roadmap Phase 19 test script): PRD-031's threat model is asked for from Design ·
// Solution architecture, drafted from the container view with threats on the slot hold flow, and accepted by Thabo, not
// Priya; a Software Factory run on web-storefront (the work item "Slot chart on the store console", whose scripted agent
// adds chart.js) fails Security's SCA gate and its PR shows the finding; the finding has an owner and a fix-by date, a
// fix is a run of its own whose scan passes and closes it; a medium risk accepted for 30 days is open again 31 days on
// by the dev clock; an agent accepting a risk is refused and audited; and the mock scanner says so. Security, the
// Software Factory and Digital Teammates are hosted; the Factory's runs do real git and real gates, so this file is slow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let thabo;
let priya;
const design = '/factory/design/api/v1';
const security = '/security/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const RUN_MS = { ms: 240_000, every: 500 };
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' };
const services = () => env.noobly.hosted.apps.find((a) => a.name === 'security').services;
const factory = () => env.noobly.hosted.apps.find((a) => a.name === 'factory').services;
const run = async (runId) => (await stevie.json(`/factory/api/v1/runs/${runId}`)).body;
const chartFinding = async () => (await stevie.json(`${security}/findings?repo=web-storefront`)).body.findings.find((f) => f.kind === 'sca' && /chart\.js/.test(f.title));

let finding;

before(async () => {
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-security', mountPath: '/security', enabled: true },
    ],
  });
  [stevie, thabo, priya] = [env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [thabo, 'thabo-n'], [priya, 'priya-s']]) await c.signIn(id);
  // PRD-031 into Design (the 16c script, in short).
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
});
after(async () => { await env?.stop(); });

test('step 1: Design · Solution architecture asks for the threat model; threats on the slot hold flow, each with a mitigation; Thabo accepts, Priya can\'t', async () => {
  const asked = await post(priya, `${design}/items/PRD-031/threat-model`);
  assert.equal(asked.status, 201);
  const tm = await asked.json();
  assert.deepEqual([tm.id, tm.version, tm.status], ['TM-031', 1, 'waiting']);
  assert.ok(tm.threats.length > 0 && tm.threats.every((t) => t.mitigation?.text && ['requirement', 'quality-attribute'].includes(t.mitigation.becomes)), 'each threat has a mitigation');
  assert.ok(tm.threats.some((t) => t.holdFlow && /hold/i.test(t.title)), 'threats on the slot hold flow');
  // Design shows it.
  const view = (await priya.json(`${design}/items/PRD-031`)).body;
  assert.equal(view.threatModel.id, 'TM-031');
  // It is a threat-model approval on Home · Approvals.
  const approval = (await thabo.json(`${lifecycle}/approvals?tab=mine`)).body.rows.find((a) => a.type === 'threat-model' && a.itemId === 'PRD-031');
  assert.ok(approval, 'a threat-model approval waits');
  // Priya (a Contributor) can't; the refusal is audited.
  assert.equal((await post(priya, `${security}/threat-models/TM-031/decision`, { decision: 'approve' })).status, 403);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'priya-s' && r.permission === 'accept-threat-model')));
  // Thabo accepts on Home · Approvals: the same decision.
  const decided = await post(thabo, `${lifecycle}/approvals/${approval.id}/decision`, { decision: 'approve' });
  assert.equal(decided.status, 200, await decided.clone().text());
  const after = (await thabo.json(`${security}/threat-models/TM-031`)).body;
  assert.deepEqual([after.status, after.decision.by], ['accepted', 'thabo-n']);
  const checks = (await thabo.json('/api/v1/home/items/PRD-031/checks')).body;
  assert.ok(checks.checks.some((c) => c.source === 'Security' && c.result === 'passed'), JSON.stringify(checks.checks.map((c) => [c.source, c.key, c.result])));
});

test('step 2: a Factory run on web-storefront fails the SCA gate (chart.js); the PR shows the finding', { timeout: 300_000 }, async () => {
  const started = await factory().startWork({ itemId: 'PRD-031', workItemId: 'WI-031-chart', title: 'Slot chart on the store console', repo: 'web-storefront' });
  assert.ok(started.runId, JSON.stringify(started));
  await eventually(async () => assert.ok(await chartFinding(), 'the SCA finding'), RUN_MS);
  finding = await chartFinding();
  assert.deepEqual([finding.severity, finding.state, finding.subject.repo, finding.subject.itemId, finding.subject.runId], ['medium', 'open', 'web-storefront', 'PRD-031', started.runId]);
  // The run's evidence: the SCA gate failed with the finding in it, the other kinds passed, and the SBOM.
  let r;
  await eventually(async () => {
    r = await run(started.runId);
    assert.ok(['delivered', 'gate_failed', 'needs_human'].includes(r.run?.status ?? r.status), JSON.stringify(r.run?.status ?? r.status));
  }, RUN_MS);
  const text = JSON.stringify(r);
  assert.match(text, /security: sca/);
  assert.match(text, new RegExp(finding.id));
  assert.match(text, /not a real scan/);
  // The PR file under data/factory/forge shows the finding and the SBOM.
  await eventually(async () => {
    const forge = path.join(env.dataDir, 'factory', 'forge');
    const files = (await fs.readdir(forge, { recursive: true })).filter((f) => f.endsWith('.md'));
    const texts = await Promise.all(files.map((f) => fs.readFile(path.join(forge, f), 'utf8')));
    const pr = texts.find((t) => /Slot chart on the store console/.test(t));
    assert.ok(pr, 'the PR is a file');
    assert.match(pr, new RegExp(finding.id));
    assert.match(pr, /Security scan and SBOM/);
    assert.match(pr, /chart\.js/);
  }, RUN_MS);
});

test('step 3: the finding has an owner and a fix-by date; a fix is a run whose scan passes, and the finding closes', { timeout: 300_000 }, async () => {
  assert.equal(finding.owner, 'priya-s', 'web-storefront\'s owner');
  assert.match(finding.fixByText, /^Fix by .* in (29|30) days$/);
  const asked = await post(priya, `${security}/findings/${finding.id}/fix`);
  assert.equal(asked.status, 202, await asked.clone().text());
  const fixing = await asked.json();
  assert.equal(fixing.state, 'fixing');
  const runId = fixing.fix.runId;
  await eventually(async () => assert.equal((await stevie.json(`${security}/findings/${finding.id}`)).body.state, 'closed'), RUN_MS);
  const closed = (await stevie.json(`${security}/findings/${finding.id}`)).body;
  assert.equal(closed.proof.runId, runId);
  assert.match(closed.proof.text, /no longer finds it/);
  const r = await run(runId);
  assert.match(JSON.stringify(r), /security: sca/);
});

test('step 4: a medium risk accepted for 30 days; 31 days on by the dev clock, the finding is open again', async () => {
  // A new medium finding to accept: the same chart library seen again on another run is a new finding.
  const scan = await services().scanChange({ repo: 'web-storefront', itemId: 'PRD-031', runId: 'run-step4', files: [{ path: 'package.json', text: JSON.stringify({ dependencies: { 'chart.js': '^4.4.0' } }) }] });
  assert.equal(scan.passed, false);
  const medium = (await stevie.json(`${security}/findings?repo=web-storefront&state=open`)).body.findings.find((f) => f.severity === 'medium');
  assert.ok(medium);
  assert.equal((await post(thabo, `${security}/findings/${medium.id}/accept-risk`, { reason: 'The console is internal; the library is reviewed next sprint', expiresInDays: 30 })).status, 200);
  assert.equal((await stevie.json(`${security}/findings/${medium.id}`)).body.state, 'accepted');
  assert.equal((await stevie.json(`${security}/risks`)).body.risks.find((x) => x.findingId === medium.id).current, true);
  assert.equal((await post(stevie, '/api/v1/dev/clock', { hours: 31 * 24 })).status, 200);
  const reopened = (await stevie.json(`${security}/findings/${medium.id}`)).body;
  assert.equal(reopened.state, 'open');
  assert.equal(reopened.acceptance.expired, true);
  await eventually(async () => assert.ok((await today(env.store, 'events')).some((e) => e.type === 'risk.expired' && e.payload.findingId === medium.id)));
  await post(stevie, '/api/v1/dev/clock', { reset: true });
});

test('step 5: an agent accepting a risk is refused and audited', async () => {
  const open = (await stevie.json(`${security}/findings?state=open`)).body.findings[0];
  await assert.rejects(services().acceptRisk({ findingId: open.id, reason: 'x', expiresInDays: 5, actor: AGENT }), { code: 'people_only' });
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'ada-quill')));
  assert.notEqual((await stevie.json(`${security}/findings/${open.id}`)).body.state, 'accepted');
});

test('step 6: the scanner is the mock and Security · Policies says so', async () => {
  const p = (await priya.json(`${security}/policies`)).body;
  assert.equal(p.scanner.name, 'mock');
  assert.equal(p.scanner.real, false);
  assert.match(JSON.stringify(p.scanner), /not a real scan/i);
  const about = (await priya.json(`${security}/about`)).body;
  assert.deepEqual([about.scanner, about.realScanner], ['mock', false]);
});

test('the Security engineer: the onboarding card, and a home of findings near or past fix-by, threat models waiting, risks ending and items with none', async () => {
  const onboarding = (await thabo.json('/api/v1/me/onboarding')).body;
  assert.ok(onboarding.roles.some((r) => r.key === 'security-engineer' && r.name === 'Security engineer'), 'the onboarding card');
  await env.store.updateDoc(['people', 'thabo-n', 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole: 'security-engineer' } }));
  const home = (await thabo.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'security-engineer');
  assert.deepEqual(home.tiles.map((t) => t.key), ['late', 'open', 'threat-models', 'risks']);
  const open = (await thabo.json(`${security}/findings`)).body.findings.filter((f) => f.state === 'open' || f.state === 'fixing');
  assert.equal(home.tiles[1].value, open.length);
  assert.equal(home.tiles[2].value, 0, 'TM-031 is accepted');
  assert.ok(!home.panels.side.find((l) => l.key === 'without').rows.some((r) => r.id === 'PRD-031'), 'PRD-031 has its threat model');
  assert.equal(home.action.href, '/security/findings');
});
