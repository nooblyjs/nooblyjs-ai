// Findings (root roadmap Phase 19, steps 2–5 on the app on its own): a scan of a change with an unapproved package fails
// the SCA gate and opens a finding with its owner and fix-by date, with the SBOM; the same problem again is the same
// finding; "Draft a fix as a PR" asks the Software Factory; only the fix run's passing scan closes it; a medium risk is
// accepted by an Architect with a reason and an expiry (a high one needs an Owner, an agent is refused), and when the
// business clock passes the expiry the finding is open again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { fakes } from './fakes.js';

const API = '/security/api/v1';
const DAY = 86_400_000;
const withChart = [
  { path: 'package.json', text: JSON.stringify({ name: 'web-storefront-demo', dependencies: { 'chart.js': '4.4.1' } }) },
  { path: 'slot-chart.js', text: 'export const slotChartConfig = (slots) => ({ type: "bar", data: slots });\n' },
];
const without = [{ path: 'package.json', text: JSON.stringify({ name: 'web-storefront-demo' }) }, { path: 'slot-chart.js', text: 'export const slotChartSvg = () => "<svg/>";\n' }];

test('the SCA gate fails on an unapproved package; the finding has an owner and a fix-by date; the SBOM comes back', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    const scan = await t.hosted.services.scanChange({ repo: 'web-storefront', itemId: 'PRD-031', runId: 'run_a', sha: 'abcdef1234', files: withChart });
    assert.equal(scan.passed, false);
    assert.equal(scan.scanner, 'mock');
    assert.match(scan.text, /not a real scan/);
    assert.deepEqual(scan.results.map((r) => [r.kind, r.status]), [['secrets', 'passed'], ['sast', 'passed'], ['sca', 'failed'], ['licence', 'passed'], ['iac', 'passed']]);
    const sca = scan.results.find((r) => r.kind === 'sca');
    assert.deepEqual(sca.findings, ['FND-003']);
    assert.match(sca.excerpt, /^FND-003 \(Medium\): chart\.js is not an approved package\. Owner priya-s, fix by \d{4}-\d\d-\d\d/);
    assert.deepEqual(scan.sbom.components, [{ name: 'chart.js', version: '4.4.1', licence: 'MIT' }]);
    const finding = (await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json;
    assert.deepEqual([finding.severity, finding.state, finding.owner, finding.ownerName, finding.subject.repo, finding.subject.itemId], ['medium', 'open', 'priya-s', 'Priya S.', 'web-storefront', 'PRD-031']);
    assert.match(finding.fixByText, /^Fix by .* · in 30 days$/);
    assert.ok(t.eventLog.some((e) => e.type === 'finding.opened' && e.payload.findingId === 'FND-003'));
    // The same problem in the next scan is the same finding.
    const again = await t.hosted.services.scanChange({ repo: 'web-storefront', runId: 'run_b', files: withChart });
    assert.deepEqual(again.results.find((r) => r.kind === 'sca').findings, ['FND-003']);
    assert.equal((await t.get(`${API}/findings`, { as: 'priya-s' })).json.findings.length, 3);
    // Other kinds: a key in the code is critical and fails at once.
    const secret = await t.hosted.services.scanChange({ repo: 'web-storefront', files: [{ path: 'config.js', text: 'const key = "AKIAABCDEFGHIJKLMNOP";' }] });
    assert.equal(secret.results.find((r) => r.kind === 'secrets').status, 'failed');
  } finally {
    await t.close();
  }
});

test('a fix is a Software Factory run; only that run\'s passing scan closes the finding, with the proof', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    await t.hosted.services.scanChange({ repo: 'web-storefront', itemId: 'PRD-031', runId: 'run_a', files: withChart });
    assert.equal((await t.post(`${API}/findings/FND-003/fix`, { as: 'naledi-k' })).status, 403, 'a Viewer');
    const asked = await t.post(`${API}/findings/FND-003/fix`, { as: 'priya-s' });
    assert.equal(asked.status, 202);
    assert.deepEqual([asked.json.state, asked.json.fix.runId, asked.json.fix.title], ['fixing', 'run_fix1', 'Remove chart.js']);
    const start = f.calls.find((c) => c.name === 'factory.startWork').input;
    assert.deepEqual([start.itemId, start.workItemId, start.repo, start.findingId, start.title], ['PRD-031', 'FND-003', 'web-storefront', 'FND-003', 'Remove chart.js']);
    assert.match(start.brief, /chart\.js is not an approved package/);
    assert.equal((await t.post(`${API}/findings/FND-003/fix`, { as: 'priya-s' })).status, 409, 'one at a time');
    // A scan of some other run without the package does not close it: it is not the fix's.
    await t.hosted.services.scanChange({ repo: 'web-storefront', runId: 'run_other', files: without });
    assert.equal((await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json.state, 'fixing');
    // The fix run's scan, still with the package, keeps it; without it, closes it.
    await t.hosted.services.scanChange({ repo: 'web-storefront', runId: 'run_fix1', findingId: 'FND-003', files: withChart });
    assert.equal((await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json.state, 'fixing');
    const passed = await t.hosted.services.scanChange({ repo: 'web-storefront', runId: 'run_fix1', sha: '1234567abc', findingId: 'FND-003', files: without });
    assert.equal(passed.passed, true);
    const closed = (await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json;
    assert.deepEqual([closed.state, closed.proof.runId, closed.proof.text], ['closed', 'run_fix1', 'The scan of run run_fix1 at 1234567 no longer finds it']);
    assert.ok(t.auditLog.some((a) => a.action === 'finding.closed' && a.target === 'FND-003'));
    // The fix run delivered: the finding links to its pull request.
    await t.emit('run.finished', { runId: 'run_fix1', outcome: 'delivered', pr: '/factory/forge/prs/2' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json.fix.pr, '/factory/forge/prs/2');
  } finally {
    await t.close();
  }
});

test('a risk acceptance: an Architect for a medium one, an Owner for a high one, never an agent; it expires on the business clock', async () => {
  let at = Date.now();
  const t = await startApp({ seed: true, clock: { now: () => at } });
  try {
    const body = { reason: 'TLS comes with the cluster upgrade in November', expiresInDays: 30 };
    assert.equal((await t.post(`${API}/findings/FND-002/accept-risk`, { as: 'thabo-n', body: { ...body, expiresInDays: 120 } })).status, 400, 'at most 90 days');
    assert.equal((await t.post(`${API}/findings/FND-002/accept-risk`, { as: 'thabo-n', body: { expiresInDays: 30 } })).status, 400, 'a reason');
    // An agent with an Owner's role is refused, and the refusal audited.
    await assert.rejects(t.hosted.services.acceptRisk({ findingId: 'FND-002', ...body, actor: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'ada-quill' && a.reason === 'agents propose, people decide'));
    // A high risk needs an Owner.
    assert.equal((await t.post(`${API}/findings/FND-001/accept-risk`, { as: 'thabo-n', body })).status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'thabo-n' && a.reason === 'a high risk needs an Owner'));
    const ok = await t.post(`${API}/findings/FND-002/accept-risk`, { as: 'thabo-n', body });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.json.state, ok.json.acceptance.by, ok.json.acceptance.days], ['accepted', 'thabo-n', 30]);
    assert.match(ok.json.fixByText, /^Risk accepted until /);
    assert.ok(t.auditLog.some((a) => a.action === 'risk.accepted' && a.target === 'FND-002' && a.actor === 'thabo-n'));
    assert.equal((await t.get(`${API}/risks`, { as: 'naledi-k' })).json.risks[0].current, true);
    // 29 days on: still accepted. 31 days on: open again, once.
    at += 29 * DAY;
    assert.equal((await t.get(`${API}/findings/FND-002`, { as: 'priya-s' })).json.state, 'accepted');
    at += 2 * DAY;
    const reopened = (await t.get(`${API}/findings/FND-002`, { as: 'priya-s' })).json;
    assert.equal(reopened.state, 'open');
    assert.match(reopened.history.at(-1).what, /expired; the finding is open again/);
    await t.hosted.sweep();
    assert.equal(t.eventLog.filter((e) => e.type === 'finding.reopened').length, 1);
    assert.ok(t.auditLog.some((a) => a.action === 'risk.expired' && a.target === 'FND-002'));
    const register = (await t.get(`${API}/risks`, { as: 'naledi-k' })).json.risks;
    assert.deepEqual([register.length, register[0].current], [1, false]);
    // A Stevie (Owner) may accept the high one.
    assert.equal((await t.post(`${API}/findings/FND-001/accept-risk`, { as: 'stevie', body })).status, 200);
  } finally {
    await t.close();
  }
});

test('the policies say the scanner is the mock, and the Security engineer\'s home has what needs them', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    const p = (await t.get(`${API}/policies`, { as: 'naledi-k' })).json;
    assert.equal(p.scanner.name, 'mock');
    assert.match(p.scanner.text, /^Scanner: mock\. .*It is not a real scan/);
    assert.deepEqual(p.fixBy.map((x) => x.days), [7, 14, 30, 90]);
    assert.match(p.riskAcceptance.text, /low or medium risk; a critical or high one needs an Owner/);
    const home = await t.hosted.services.home();
    assert.deepEqual(home.open.map((x) => x.id), ['FND-001', 'FND-002']);
    assert.deepEqual(home.without.map((x) => x.id), ['PRD-031', 'PRD-027'], 'items in Design or later with no threat model');
  } finally {
    await t.close();
  }
});

test('Phase 21: an environment\'s DAST finds a missing CSP on a web preview, linked to the pull request and story; the image scan has nothing to scan', async () => {
  const f = fakes();
  const t = await startApp({ seed: true, services: f.services });
  try {
    const dast = await t.hosted.services.scanEnvironment({ kind: 'dast', environment: 'pr-031-1-1', envKind: 'preview', repo: 'web-storefront', itemId: 'STORY-031-1', prId: 'PR-031-1-1' });
    assert.deepEqual([dast.passed, dast.total, dast.failing, dast.findings], [1, 1, [], ['FND-003']], 'medium: below the level a DAST suite blocks at');
    assert.match(dast.text, /^Dynamic scan: FND-003, below the level that blocks \(High\) \(mock scanner: not a real scan\)$/);
    const finding = (await t.get(`${API}/findings/FND-003`, { as: 'priya-s' })).json;
    assert.deepEqual([finding.kind, finding.severity, finding.owner, finding.subject.prId, finding.subject.itemId, finding.subject.environment], ['dast', 'medium', 'priya-s', 'PR-031-1-1', 'STORY-031-1', 'pr-031-1-1']);
    assert.equal(finding.fixAs.title, 'Send a Content-Security-Policy header');
    // The same problem in Staging is the same finding; a service repository has none; the image scan finds nothing.
    assert.deepEqual((await t.hosted.services.scanEnvironment({ kind: 'dast', environment: 'staging', repo: 'web-storefront' })).findings, ['FND-003']);
    assert.deepEqual((await t.hosted.services.scanEnvironment({ kind: 'dast', environment: 'staging', repo: 'slots-api' })).findings, []);
    const image = await t.hosted.services.scanEnvironment({ kind: 'image', environment: 'test-slots', repo: 'slots-api' });
    assert.match(image.text, /^Container image: no image to scan/);
    await assert.rejects(t.hosted.services.scanEnvironment({ kind: 'sast', environment: 'x' }), /dast or image/);
  } finally {
    await t.close();
  }
});
