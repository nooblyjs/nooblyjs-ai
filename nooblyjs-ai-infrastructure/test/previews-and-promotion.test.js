// NooblyJS Phase 21 (roadmap I8) on the app on its own: a pull request the lifecycle records gets a preview from its
// product's design (a repository on no path gets none, and the event says why); the merge destroys it; the suites that
// ran in an environment are recorded on it; promotion goes right only when they pass, naming each failing test, by a
// person with the apply rule's permission, never into Production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { previewName } from '../src/services/previews.js';

const API = '/infrastructure/api/v1';
const PRS = {
  'PR-031-1-1': { id: 'PR-031-1-1', type: 'pr', parentId: 'STORY-031-1', title: 'See which stores still have capacity', pr: { repo: 'web-storefront' } },
  'PR-099-1-1': { id: 'PR-099-1-1', type: 'pr', parentId: 'STORY-099-1', title: 'Elsewhere', pr: { repo: 'mobile-app' } },
};
const services = { workflows: { item: async ({ itemId }) => PRS[itemId] ?? null } };
const settle = async (t) => { await new Promise((r) => setTimeout(r, 20)); await t.hosted.idle(); };
/** Waits until an event of this type has been emitted (the listeners are asynchronous), then for the runs. */
async function until(t, type, ms = 5000) {
  const end = Date.now() + ms;
  while (!t.eventLog.some((e) => e.type === type)) {
    if (Date.now() > end) throw new Error(`no ${type} event`);
    await new Promise((r) => setTimeout(r, 10));
  }
  await settle(t);
}

test('a preview per pull request on a product\'s repository, provisioned, and destroyed when it merges', async () => {
  assert.equal(previewName('PR-031-1-1'), 'pr-031-1-1');
  const t = await startApp({ seed: true, services });
  try {
    await t.emit('pr.recorded', { itemId: 'PR-031-1-1', parentId: 'STORY-031-1', itemType: 'pr', system: 'factory' });
    await until(t, 'environment.provisioned');
    const env = (await t.get(`${API}/environments/pr-031-1-1`, { as: 'priya-s' })).json;
    assert.deepEqual([env.kind, env.repo, env.status, env.design.id], ['preview', 'web-storefront', 'live', 'INF-031']);
    assert.ok(t.eventLog.some((e) => e.type === 'environment.provisioned' && e.payload.environment === 'pr-031-1-1' && e.payload.kind === 'preview'));
    const preview = await t.hosted.services.previewForPr('PR-031-1-1');
    assert.deepEqual([preview.name, preview.status], ['pr-031-1-1', 'live']);
    assert.match(preview.url, /^https:\/\/pr-031-1-1\.preview\.slots\./);
    // A new commit on it makes no second preview; a repository on no path gets none, and says why.
    await t.emit('pr.recorded', { itemId: 'PR-031-1-1', parentId: 'STORY-031-1', itemType: 'pr' });
    await t.emit('pr.recorded', { itemId: 'PR-099-1-1', parentId: 'STORY-099-1', itemType: 'pr' });
    await until(t, 'environment.preview_skipped');
    assert.equal(t.eventLog.filter((e) => e.type === 'environment.preview_opened').length, 1);
    assert.match(t.eventLog.find((e) => e.type === 'environment.preview_skipped').payload.summary, /no infrastructure design serves mobile-app/);
    // The Test section's view of it.
    const raw = await t.hosted.services.environment('pr-031-1-1');
    assert.deepEqual([raw.prId, raw.storyId, raw.repos], ['PR-031-1-1', 'STORY-031-1', ['web-storefront', 'slots-api', 'stores-service']]);
    await t.emit('pr.merged', { itemId: 'STORY-031-1', pullRequestId: 'PR-031-1-1', repo: 'web-storefront' });
    await until(t, 'environment.destroyed');
    assert.equal((await t.hosted.services.previewForPr('PR-031-1-1')).status, 'destroyed');
    assert.equal(await t.hosted.services.environment('pr-031-1-1'), null);
    assert.ok(t.eventLog.some((e) => e.type === 'environment.destroyed' && e.payload.reason === 'PR-031-1-1 merged'));
  } finally {
    await settle(t);
    await t.close();
  }
});

test('the suites decide promotion: refused naming the failing test, allowed once they pass; Production only through a release', async () => {
  const t = await startApp({ seed: true, services });
  try {
    const failing = { suite: 'e2e', passed: 41, total: 42, failing: ['TC-031-2-1: The slot returns to the pool within 5 seconds'], failingDetail: [{ name: 'TC-031-2-1: The slot returns to the pool within 5 seconds', caseId: 'TC-031-2-1', criterionRef: 'AC-031-2-1' }] };
    await t.hosted.services.recordTests({ environment: 'test-slots', testRunId: 'TRN-test-slots-1', suites: [failing, { suite: 'load', passed: 1, total: 1, failing: [] }] });
    assert.ok(t.eventLog.some((e) => e.type === 'environment.tested' && e.payload.environment === 'test-slots' && e.payload.passed === false));
    assert.equal((await t.post(`${API}/promotion-paths/slots/promote`, { as: 'priya-s', body: { from: 'test' } })).status, 403, 'a Contributor');
    assert.equal((await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'qa' } })).status, 400);
    const refused = await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'test' } });
    assert.deepEqual([refused.status, refused.json.error.code], [422, 'tests_failing']);
    assert.equal(refused.json.error.message, 'Promotion to Staging is refused: a test is failing in test-slots: TC-031-2-1: The slot returns to the pool within 5 seconds (AC-031-2-1).');
    await t.hosted.services.recordTests({ environment: 'test-slots', testRunId: 'TRN-test-slots-2', suites: [{ ...failing, passed: 42, failing: [], failingDetail: [] }] });
    const ok = await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'test' } });
    assert.equal(ok.status, 200, ok.text);
    const staging = (await t.get(`${API}/environments/staging`, { as: 'stevie' })).json;
    assert.deepEqual(staging.deployedServices, [{ service: 'api', version: '0.9.4' }, { service: 'web', version: '4.12.0' }]);
    assert.equal(staging.tests.text, 'Promoted: its suites run next');
    // Dev's smoke tests pass: it goes to Test, which then hasn't been tested; Production only through a release.
    assert.equal((await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'dev' } })).status, 200);
    assert.equal((await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'test' } })).json.error.code, 'not_tested');
    assert.equal((await t.post(`${API}/promotion-paths/slots/promote`, { as: 'stevie', body: { from: 'staging' } })).json.error.code, 'release_only');
  } finally {
    await t.close();
  }
});
