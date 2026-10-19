// Phase 13 in the real app (roadmap Phase 13 test script): steps 1 and 2 with every lock open: a handoff becomes Jira issues, Jira's
// statuses come back, pull requests are followed, and people merging them in Bitbucket moves the item to Verify.
// Jira and Bitbucket are production systems: here they are the fake in test/fixtures/atlassian.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eventually, today } from './helpers.js';
import { start, post, patch, issuePosts, REPOS } from './fixtures/devtools-app.js';

let open;
before(async () => {
  open = await start({ DEVTOOLS_WRITES: 'true' });
  for (const system of ['jira', 'bitbucket']) assert.equal((await patch(open.stevie, '/api/v1/devtools/writes/mode', { system, mode: 'send' })).status, 200);
});
after(async () => { await open?.app.stop(); });

test('step 1: the approved handoff creates a Jira issue per work item, and moving one in Jira updates the item in NooblyJS', async () => {
  await open.approveHandoff();
  assert.equal(issuePosts(open.fetch).length, 6);
  let work = await open.work();
  assert.deepEqual(work.workItems.map((w) => w.issue?.key), ['DTE-500', 'DTE-501', 'DTE-502', 'DTE-503', 'DTE-504', 'DTE-505']);
  assert.match(issuePosts(open.fetch)[0].body.fields.description.content[0].content[0].text, /Work item WI-PRD-028-1 of PRD-028/);
  // The issues are linked to the work items, so the runs and the item's Jira card find them (Phase 11).
  assert.deepEqual(await open.app.noobly.devtools.links.keys('WI-PRD-028-1'), ['DTE-500']);
  // A person moves the first one in Jira; the Contributor asks NooblyJS to read now.
  open.fetch.moveIssue('DTE-500', 'In Review', 'indeterminate');
  const synced = await post(open.priya, '/api/v1/devtools/sync');
  assert.equal(synced.status, 200);
  work = await open.work();
  assert.deepEqual([work.workItems[0].issue.status, work.workItems[0].issue.categoryText], ['In Review', 'In progress']);
  await eventually(async () => {
    const activity = (await open.priya.json('/api/v1/activity?q=DTE-500')).body;
    assert.ok(JSON.stringify(activity).includes('DTE-500 (WI-PRD-028-1) moved to'), 'it is in Activity');
  });
  // The same handoff event again makes nothing more.
  await open.app.noobly.devtools.sync.onHandoff({ handoffId: (await open.app.noobly.lifecycle.services.handoffOf({ handoffId: (await today(open.app.store, 'events')).find((e) => e.type === 'handoff.created').payload.handoffId })).id });
  assert.equal(issuePosts(open.fetch).length, 6);
});

test('step 1, the reverse: a run that starts for a work item moves its issue to In Progress in Jira', async () => {
  await open.app.noobly.events.emit('run.started', { system: 'factory', runId: 'run_x', itemId: 'PRD-028', workItemId: 'WI-PRD-028-2', summary: 'started run' }, { actor: 'system' });
  await open.app.noobly.syncSettled();
  assert.equal(open.fetch.state.issues.get('DTE-501').status, 'In Progress');
  assert.equal(open.fetch.writes().filter((c) => c.path.endsWith('/issue/DTE-501/transitions')).length, 1);
});

test('step 2: pull requests the Factory opens show their checks and reviewers, and people merging them in Bitbucket moves the item to Verify', async () => {
  // Platform decides where agents may open pull requests. None yet: the Factory's forge is refused.
  await open.app.noobly.platform.importRepositories();
  const refused = await open.app.noobly.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { title: 'picker', head: 'factory/issue-1/main', base: 'main', status: 'ready', body: 'x' }, itemId: 'PRD-028', workItemId: 'WI-PRD-028-1', runId: 'r1' });
  assert.deepEqual([refused.ok, /Agents may not open pull requests on examplews\/web-storefront/.test(refused.message)], [false, true]);
  for (const slug of REPOS) assert.equal((await patch(open.stevie, `/api/v1/platform/repositories/examplews__${slug}`, { access: 'read-prs', reason: 'pilot' })).status, 200);
  const work = await open.work();
  for (const [i, w] of work.workItems.entries()) {
    const slug = String(w.repo).split('/').pop();
    const r = await open.app.noobly.devtools.forge.openOrUpdatePullRequest({ slug, pr: { title: w.title, head: `factory/issue-${i + 1}/main`, base: 'main', status: 'ready', body: `For ${w.id}.` }, itemId: 'PRD-028', workItemId: w.id, runId: `r${i + 1}` });
    assert.deepEqual([r.sent, r.action], [true, 'created'], `${w.id}: ${r.message}`);
  }
  assert.equal(open.fetch.state.pullRequests.size, 6);
  const first = [...open.fetch.state.pullRequests.entries()][0];
  const [slug, id] = first[0].split('#');
  open.fetch.setStatuses(slug, Number(id), [{ name: 'Pipeline #12', state: 'SUCCESSFUL' }, { name: 'e2e', state: 'FAILED' }]);
  await post(open.priya, '/api/v1/devtools/sync');
  const seen = (await open.work()).workItems.find((w) => w.pr?.id === Number(id));
  assert.deepEqual(seen.pr.checks, { total: 2, passed: 1, failed: 1, running: 0, readable: true });
  assert.deepEqual(seen.pr.reviewers, [{ name: 'Thabo Reviewer', state: 'waiting' }]);
  // Five of six merged: still in Build.
  const all = [...open.fetch.state.pullRequests.keys()];
  for (const key of all.slice(0, 5)) open.fetch.merge(...key.split('#').map((v, i) => (i ? Number(v) : v)));
  await post(open.priya, '/api/v1/devtools/sync');
  assert.equal((await open.priya.json('/workflows/api/v1/items/PRD-028')).body.item.stage, 'build');
  // The last one merged by a person: Verify.
  open.fetch.merge(...all[5].split('#').map((v, i) => (i ? Number(v) : v)), { display_name: 'Naledi Khumalo', uuid: '{aaaaaaaa-0000-4000-8000-000000000002}' });
  await post(open.priya, '/api/v1/devtools/sync');
  const item = (await open.priya.json('/workflows/api/v1/items/PRD-028')).body.item;
  assert.equal(item.stage, 'verify');
  const events = await today(open.app.store, 'events');
  const merged = events.find((e) => e.type === 'item.merged');
  assert.match(merged.payload.summary, /moved to Verify: its pull requests were merged in Bitbucket by .*Naledi Khumalo/);
  assert.equal(events.filter((e) => e.type === 'pr.merged').length, 6);
  const audit = await today(open.app.store, 'audit');
  assert.ok(audit.some((a) => a.action === 'item.moved_by_merge' && a.target === 'PRD-028' && a.actor === 'bitbucket'));
  // Every issue NooblyJS made is Done in Jira, and NooblyJS never sent a merge.
  assert.ok([...open.fetch.state.issues.values()].every((i) => i.status === 'Done'));
  assert.ok(open.fetch.writes().every((c) => !/merge|decline|approve/.test(c.path)));
});

test('refuses: the lifecycle engine does not move an item for a merge with nobody named, or an agent\'s', async () => {
  const engine = open.app.noobly.lifecycle.services;
  await assert.rejects(() => engine.movedByMerge({ itemId: 'PRD-031', mergedBy: [] }), /Only a person's merge in Bitbucket/);
  await assert.rejects(() => engine.movedByMerge({ itemId: 'PRD-031', mergedBy: [{ name: 'Juno Park', kind: 'agent' }] }), /Only a person's merge/);
  const audit = await today(open.app.store, 'audit');
  assert.ok(audit.some((a) => a.action === 'access.refused' && /only a person's merge/.test(a.reason)));
});
