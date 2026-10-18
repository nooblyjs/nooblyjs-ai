// Phase 13 in the real app (roadmap Phase 13 test script): a kind of write an Owner set to "needs approval".
// Jira and Bitbucket are production systems: here they are the fake in test/fixtures/atlassian.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eventually, today } from './helpers.js';
import { start, post, patch, issuePosts, REPOS } from './fixtures/devtools-app.js';

test('a write that needs approval is on Home · Approvals; an Approver sends it, and nothing is sent before', async () => {
  const t = await start({ DEVTOOLS_WRITES: 'true' });
  try {
    await patch(t.stevie, '/api/v1/devtools/writes/mode', { system: 'jira', mode: 'send' });
    assert.equal((await patch(t.stevie, '/api/v1/devtools/writes/rules', { kind: 'jira.create-issue', rule: 'approval' })).status, 200);
    await t.approveHandoff();
    assert.equal(t.fetch.writes().length, 0);
    const waiting = (await t.writes()).outbox.entries.filter((e) => e.state === 'waiting-approval');
    assert.equal(waiting.length, 6);
    const approval = (await t.stevie.json(`/workflows/api/v1/approvals/${waiting[0].approvalId}`)).body.approval ?? (await t.stevie.json(`/workflows/api/v1/approvals/${waiting[0].approvalId}`)).body;
    assert.equal(approval.type, 'devtools-write');
    // A Viewer cannot decide it.
    assert.equal((await post(t.viewer, `/workflows/api/v1/approvals/${waiting[0].approvalId}/decision`, { decision: 'approve' })).status, 403);
    assert.equal(t.fetch.writes().length, 0);
    // The Owner is not one of this approval's reviewers (the item team's Approvers are), so even he is refused.
    assert.equal((await post(t.stevie, `/workflows/api/v1/approvals/${waiting[0].approvalId}/decision`, { decision: 'approve' })).status, 403);
    assert.equal(t.fetch.writes().length, 0);
    const reviewer = t.app.client();
    await reviewer.signIn(approval.reviewers[0].id);
    const decided = await post(reviewer, `/workflows/api/v1/approvals/${waiting[0].approvalId}/decision`, { decision: 'approve' });
    assert.equal(decided.status, 200);
    assert.equal(issuePosts(t.fetch).length, 1, 'that one issue was created, and only that one');
    assert.equal((await t.writes()).outbox.counts.sent, 1);
  } finally { await t.app.stop(); }
});
