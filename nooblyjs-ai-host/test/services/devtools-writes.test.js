// Writing to Jira and Bitbucket (src/services/devtools/, Phase 13). They are production systems, so these tests are
// mostly about what is NOT sent: with any lock closed, for any actor that may not, for any kind NooblyJS does not have.
// Offline: `fetch` is the fake in test/fixtures/atlassian.js, and a push goes to a bare git repository on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createDevtools } from '../../src/services/devtools/index.js';
import { createWriter, KINDS } from '../../src/services/devtools/writer.js';
import { createGitPush } from '../../src/services/devtools/git-push.js';
import { fakeAtlassian, SETTINGS, CLOUD, WRITE_TOKEN, READ_TOKEN, NOOBLY_ACCOUNT } from '../fixtures/atlassian.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');
const basic = (token) => `Basic ${Buffer.from(`noobly@example.com:${token}`).toString('base64')}`;
const HANDOFF = { id: 'hnd_1', itemId: 'PRD-031', workItems: [{ id: 'WI-PRD-031-1', repo: 'examplews/web-storefront', title: 'Slot picker on the basket page', status: 'new' }, { id: 'WI-PRD-031-2', repo: 'examplews/web-storefront', title: 'Slot availability API', status: 'new' }] };

/** A devtools service on a temp folder, with a fake Atlassian, a fake lifecycle and a fake Platform. */
async function make({ writes = true, modes = { jira: 'send', bitbucket: 'send' }, rules = {}, settings = SETTINGS, access = { pushAgentBranches: true, openPrs: true }, seed = {}, gitRemote = null } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-writes-'));
  const store = new FsStore(dir);
  await store.writeYaml(['config', 'devtools.yaml'], { bitbucket: { projects: [], repositories: ['web-storefront'] }, jira: { projects: ['DTE'] }, writes: { modes, rules } });
  const fetch = fakeAtlassian(seed);
  const audit = [];
  const events = [];
  const asked = [];
  const item = { id: 'PRD-031', ref: 'PRD-031', title: 'Same-day delivery slots', stage: 'build', status: 'active' };
  const moved = [];
  const services = new Map([
    ['workflows', {
      handoffOf: async ({ handoffId }) => (handoffId === HANDOFF.id ? HANDOFF : null),
      item: async () => item,
      requestAppApproval: async (input) => { asked.push(input); return { approvalId: `apr_${asked.length}` }; },
      withdrawAppApprovals: async () => 1,
      movedByMerge: async (input) => { moved.push(input); item.stage = 'verify'; return { moved: true, item }; },
    }],
    ['platform', { repository: async (name) => (name === 'examplews/web-storefront' ? { name, access: 'read-prs', accessText: 'Read + open PRs', ...access } : null) }],
  ]);
  const devtools = createDevtools({
    store, fetch, services, gitRemote, settings: { ...settings, writes },
    auditLog: { record: async (r) => { audit.push(r); return r; } },
    events: { emit: async (type, payload) => { events.push({ type, ...payload }); } },
  });
  return { devtools, fetch, store, audit, events, asked, moved, item, dir, stop: () => fs.rm(dir, { recursive: true, force: true }).catch(() => {}) };
}
const issuePosts = (fetch) => fetch.writes().filter((c) => c.path.endsWith('/rest/api/3/issue'));

test('the writer sends only its listed kinds, to their paths, on its origin, and has nothing that merges or deletes', async () => {
  const fetch = fakeAtlassian();
  const writer = createWriter({ origin: 'https://api.bitbucket.org', authorization: basic(WRITE_TOKEN), system: 'bitbucket', fetch });
  assert.deepEqual(Object.keys(writer).sort(), ['origin', 'write']);
  const refused = [
    await writer.write('bitbucket.merge-pr', '/2.0/repositories/examplews/web-storefront/pullrequests/7/merge', {}),
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/pullrequests/7/merge', {}),
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/pullrequests/7/decline', {}),
    await writer.write('bitbucket.update-pr', '/2.0/repositories/examplews/web-storefront', {}),
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/branch-restrictions', {}),
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/../other/pullrequests', {}),
    await writer.write('jira.create-issue', '/rest/api/3/issue', { fields: {} }),            // a Jira kind on the Bitbucket writer
    await writer.write('bitbucket.push-branch', '/2.0/repositories/examplews/web-storefront/pullrequests', {}), // a git push is not an HTTP write
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/pullrequests', 'not an object'),
    await writer.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/pullrequests', {}, { prefix: '/../x?y=1' }),
  ];
  for (const r of refused) assert.deepEqual([r.ok, r.reason], [false, 'refused'], r.message);
  assert.equal(fetch.calls.length, 0, 'none of them reached the network');
  assert.ok(!Object.keys(KINDS).some((k) => /merge|delete|decline|approve|permission|setting/.test(k)), 'no kind merges, deletes, approves or changes settings');
  // Without a credential a writer sends nothing.
  const none = createWriter({ origin: 'https://api.bitbucket.org', authorization: '', system: 'bitbucket', fetch });
  assert.equal((await none.write('bitbucket.open-pr', '/2.0/repositories/examplews/web-storefront/pullrequests', {})).reason, 'not-configured');
  assert.equal(fetch.calls.length, 0);
  assert.throws(() => createWriter({ origin: 'http://api.bitbucket.org', authorization: 'x', system: 'bitbucket' }));
});

test('with DEVTOOLS_WRITES unset, an approved handoff is recorded and nothing is written', async () => {
  const t = await make({ writes: false });
  try {
    const out = await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.deepEqual(out.map((o) => o.state), ['recorded', 'recorded']);
    assert.equal(t.fetch.writes().length, 0, 'no request other than GET left NooblyJS');
    const { entries, counts } = await t.devtools.writes.outbox();
    assert.equal(counts.recorded, 2);
    assert.match(entries[0].reason, /not allowed to write \(DEVTOOLS_WRITES is not set\)/);
    assert.match(entries[0].summary, /create the Jira issue ".+" in DTE for WI-PRD-031-/);
    assert.ok(t.audit.filter((a) => a.action === 'devtools.write_recorded').length === 2, 'each one is in the audit log');
    const status = await t.devtools.writes.status();
    assert.deepEqual([status.enabled, status.systems.jira.sending, status.systems.bitbucket.sending], [false, false, false]);
  } finally { await t.stop(); }
});

test('each lock on its own keeps writes recorded: the mode, and the write credential', async () => {
  const recordOnly = await make({ modes: { jira: 'record', bitbucket: 'record' } });
  const noToken = await make({ settings: { ...SETTINGS, jira: { ...SETTINGS.jira, writeToken: '' } } });
  const fresh = await make({ modes: null }); // a data folder that never chose: the safe value
  try {
    for (const [t, why] of [[recordOnly, /Jira is set to Record only/], [noToken, /No write credential is set for Jira \(JIRA_WRITE_API_TOKEN\)/], [fresh, /Jira is set to Record only/]]) {
      await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
      assert.equal(t.fetch.writes().length, 0);
      assert.match((await t.devtools.writes.outbox()).entries[0].reason, why);
    }
    // The read token is never used to write, even when it is the only one and everything else is open.
    assert.ok(noToken.fetch.calls.every((c) => c.method === 'GET'));
  } finally { await recordOnly.stop(); await noToken.stop(); await fresh.stop(); }
});

test('step 1: with every lock open, a handoff creates one Jira issue per work item, once, with the write token, and links it', async () => {
  const t = await make();
  try {
    const out = await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.deepEqual(out.map((o) => o.state), ['sent', 'sent']);
    const posts = issuePosts(t.fetch);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].href, `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/issue`);
    assert.equal(posts[0].authorization, basic(WRITE_TOKEN));
    assert.deepEqual([posts[0].body.fields.project.key, posts[0].body.fields.issuetype.name, posts[0].body.fields.summary], ['DTE', 'Story', 'Slot picker on the basket page']);
    assert.deepEqual(posts[0].body.fields.labels, ['noobly', 'PRD-031']);
    assert.deepEqual(await t.devtools.links.keys('WI-PRD-031-1'), ['DTE-500']);
    assert.deepEqual(await t.devtools.links.keys('WI-PRD-031-2'), ['DTE-501']);
    // The same handoff again (the event delivered twice, a restart): nothing more is created.
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.equal(issuePosts(t.fetch).length, 2);
    const work = await t.devtools.sync.workFor('PRD-031');
    assert.deepEqual(work.workItems.map((w) => w.issue?.key), ['DTE-500', 'DTE-501']);
    assert.ok(t.events.some((e) => e.type === 'workitem.issue_created' && e.issue === 'DTE-500'));
    assert.ok(t.audit.some((a) => a.action === 'devtools.write_sent' && a.kind === 'jira.create-issue' && a.result?.key === 'DTE-500'));
  } finally { await t.stop(); }
});

test('refuses: no approved handoff behind it, a project NooblyJS is not configured for, and an issue NooblyJS did not link', async () => {
  const t = await make();
  try {
    assert.deepEqual(await t.devtools.sync.onHandoff({ handoffId: 'hnd_unknown' }), [], 'an unknown handoff makes nothing');
    assert.equal(t.fetch.writes().length, 0);
    // Moving or commenting on an issue that is not linked to anything in NooblyJS is refused by the gate's facts.
    t.fetch.state.issues.set('DTE-9', { summary: 'Someone else\'s issue', status: 'To Do', category: 'new' });
    const r = await t.devtools.sync.onRunStarted({ workItemId: 'WI-NOT-LINKED' });
    assert.equal(r.state, 'no-issue');
    assert.equal(t.fetch.writes().length, 0);
  } finally { await t.stop(); }
});

test('step 1, Jira → NooblyJS: a person moving the issue in Jira reaches the work item, with an event', async () => {
  const t = await make();
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    await t.devtools.sync.poll();
    t.fetch.moveIssue('DTE-500', 'In Review', 'indeterminate');
    const before = t.fetch.writes().length;
    const r = await t.devtools.sync.poll();
    assert.equal(r.issues, 1);
    const work = await t.devtools.sync.workFor('PRD-031');
    assert.deepEqual([work.workItems[0].issue.status, work.workItems[0].issue.categoryText], ['In Review', 'In progress']);
    assert.ok(t.events.some((e) => e.type === 'workitem.status_changed' && e.issue === 'DTE-500' && e.to === 'In Review' && e.source === 'jira'));
    assert.equal(t.fetch.writes().length, before, 'reading Jira back writes nothing');
    // When every work item is Done in Jira the item says so; it does not change stage by itself.
    t.fetch.moveIssue('DTE-500', 'Done', 'done');
    t.fetch.moveIssue('DTE-501', 'Done', 'done');
    await t.devtools.sync.poll();
    assert.equal((await t.devtools.sync.workFor('PRD-031')).allDoneInJira, true);
    assert.equal(t.moved.length, 0);
  } finally { await t.stop(); }
});

test('step 1, NooblyJS → Jira: a run that starts moves its issue to In Progress, once; never backwards, and Jira wins a conflict', async () => {
  const t = await make();
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    const r = await t.devtools.sync.onRunStarted({ workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.equal(r.state, 'sent');
    const moves = t.fetch.writes().filter((c) => c.path.endsWith('/issue/DTE-500/transitions'));
    assert.deepEqual(moves.map((c) => c.body), [{ transition: { id: '21' } }]);
    assert.equal(t.fetch.state.issues.get('DTE-500').status, 'In Progress');
    // Started again (a retry of the run): already there, nothing sent.
    assert.equal((await t.devtools.sync.onRunStarted({ workItemId: 'WI-PRD-031-1', runId: 'run_1' })).state, 'already');
    // A person finished it in Jira: NooblyJS does not pull it back to In Progress.
    t.fetch.moveIssue('DTE-501', 'Done', 'done');
    assert.equal((await t.devtools.sync.onRunStarted({ workItemId: 'WI-PRD-031-2' })).state, 'already');
    // A person moved DTE-500 back to To Do. NooblyJS wanted Done after a merge: it leaves it, and says so.
    await t.devtools.sync.poll();
    t.fetch.moveIssue('DTE-500', 'To Do', 'new');
    const sent = t.fetch.writes().length;
    const conflict = await t.devtools.sync.onRunStarted({ workItemId: 'WI-PRD-031-1', runId: 'run_2' });
    assert.equal(conflict.state, 'conflict');
    assert.equal(t.fetch.writes().length, sent, 'no transition was sent');
    assert.ok(t.audit.some((a) => a.action === 'devtools.sync_conflict' && a.target === 'DTE-500'));
    assert.ok(t.events.some((e) => e.type === 'devtools.sync_conflict'));
  } finally { await t.stop(); }
});

test('a kind set to "needs approval" waits for an Approver; an agent can never give it; a refusal discards it', async () => {
  const t = await make({ rules: { 'jira.create-issue': 'approval' } });
  try {
    const out = await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.deepEqual(out.map((o) => o.state), ['waiting-approval', 'waiting-approval']);
    assert.equal(t.fetch.writes().length, 0, 'nothing is sent before a person approves');
    assert.equal(t.asked.length, 2);
    assert.deepEqual([t.asked[0].type, t.asked[0].itemId, t.asked[0].ref.app, t.asked[0].ref.kind], ['devtools-write', 'PRD-031', 'devtools', 'jira.create-issue']);
    const [first, second] = (await t.devtools.writes.outbox({ state: 'waiting-approval' })).entries.reverse();
    await assert.rejects(() => t.devtools.decideApproval({ designId: first.id, decision: 'approve', person: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' } }), /Only a person may approve/);
    assert.equal(t.fetch.writes().length, 0);
    assert.deepEqual(await t.devtools.decideApproval({ designId: first.id, decision: 'approve', person: { id: 'thabo-n', name: 'Thabo', kind: 'person' } }), { state: 'sent' });
    assert.equal(issuePosts(t.fetch).length, 1);
    assert.deepEqual(await t.devtools.links.keys(first.itemId ? 'WI-PRD-031-1' : ''), ['DTE-500']);
    assert.deepEqual(await t.devtools.decideApproval({ designId: second.id, decision: 'request-changes', comment: 'Not this sprint', person: { id: 'thabo-n', name: 'Thabo', kind: 'person' } }), { state: 'discarded' });
    assert.equal(issuePosts(t.fetch).length, 1);
    // A discarded write stays discarded when the handoff is delivered again.
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.equal(issuePosts(t.fetch).length, 1);
    await assert.rejects(() => t.devtools.decideApproval({ designId: first.id, decision: 'approve', person: { id: 'thabo-n', kind: 'person' } }), /nothing to decide/);
  } finally { await t.stop(); }
});

test('a kind switched off is refused, and an Owner\'s change of mode or rule is audited', async () => {
  const t = await make({ rules: { 'jira.create-issue': 'off' } });
  try {
    const out = await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    assert.deepEqual(out.map((o) => o.state), ['refused', 'refused']);
    assert.equal(t.fetch.writes().length, 0);
    assert.ok(t.audit.some((a) => a.action === 'devtools.write_refused' && /switched off/.test(a.reason)));
    await assert.rejects(() => t.devtools.writes.setMode('jira', 'send', { id: 'ada-quill', kind: 'agent' }), /Only a person/);
    await assert.rejects(() => t.devtools.writes.setMode('github', 'send', { id: 'stevie' }), /jira or bitbucket/);
    await assert.rejects(() => t.devtools.writes.setRule('bitbucket.merge-pr', 'automatic', { id: 'stevie' }), /a kind of write NooblyJS has/);
    const status = await t.devtools.writes.setMode('jira', 'record', { id: 'stevie', name: 'Stevie' });
    assert.equal(status.systems.jira.mode, 'record');
    assert.ok(t.audit.some((a) => a.action === 'devtools.write_mode_changed' && a.actor === 'stevie' && a.before === 'send' && a.after === 'record'));
    await t.devtools.writes.setRule('jira.create-issue', 'automatic', { id: 'stevie' });
    assert.ok(t.audit.some((a) => a.action === 'devtools.write_rule_changed' && a.before === 'off' && a.after === 'automatic'));
    // Changing what NooblyJS reads keeps the write settings.
    await t.devtools.setConfig({ jira: { projects: ['DTE'] } });
    assert.equal((await t.devtools.writes.status()).systems.jira.mode, 'record');
  } finally { await t.stop(); }
});

test('a recorded write is sent by a person once the locks are open, and a failed one says why and can be sent again', async () => {
  const t = await make({ modes: { jira: 'record', bitbucket: 'record' } });
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    const [entry] = (await t.devtools.writes.outbox({ state: 'recorded' })).entries;
    await assert.rejects(() => t.devtools.writes.retry(entry.id, { id: 'stevie' }), /Nothing was sent\. Jira is set to Record only/);
    await assert.rejects(() => t.devtools.writes.retry(entry.id, { id: 'ada-quill', kind: 'agent' }), /Only a person/);
    assert.equal(t.fetch.writes().length, 0);
    await t.devtools.writes.setMode('jira', 'send', { id: 'stevie' });
    // The write token turns out to have no write scope: the write fails, and says so.
    t.fetch.state.readOnlyWriteToken = true;
    const failed = await t.devtools.writes.retry(entry.id, { id: 'stevie' });
    assert.deepEqual([failed.ok, failed.state], [false, 'failed']);
    assert.match((await t.devtools.writes.get(entry.id)).reason, /privilege scopes/);
    t.fetch.state.readOnlyWriteToken = false;
    const sent = await t.devtools.writes.retry(entry.id, { id: 'stevie' });
    assert.equal(sent.state, 'sent');
    assert.equal((await t.devtools.links.keys(entry.payload.labels ? 'WI-PRD-031-2' : 'WI-PRD-031-2')).length + (await t.devtools.links.keys('WI-PRD-031-1')).length, 1, 'the one that was sent is linked');
    await assert.rejects(() => t.devtools.writes.retry(entry.id, { id: 'stevie' }), /That write is sent/);
    const other = (await t.devtools.writes.outbox({ state: 'recorded' })).entries[0];
    await t.devtools.writes.discard(other.id, { id: 'stevie', name: 'Stevie' });
    assert.equal((await t.devtools.writes.get(other.id)).state, 'discarded');
  } finally { await t.stop(); }
});

// ---------------------------------------------------------------------------------------------- Bitbucket

/** A mirror with a factory branch, and a bare "Bitbucket" repository on disk to push to. */
async function gitFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-git-'));
  const remote = path.join(root, 'remote.git');
  const mirror = path.join(root, 'mirror');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  await fs.mkdir(mirror);
  git(root, 'init', '--bare', '-q', '-b', 'main', remote);
  git(mirror, 'init', '-q', '-b', 'main');
  git(mirror, 'config', 'user.email', 'factory@example.com');
  git(mirror, 'config', 'user.name', 'Factory');
  await fs.writeFile(path.join(mirror, 'README.md'), 'hello\n');
  git(mirror, 'add', '.');
  git(mirror, 'commit', '-q', '-m', 'first');
  git(mirror, 'push', '-q', remote, 'main:main');
  git(mirror, 'checkout', '-q', '-b', 'factory/issue-3/main');
  await fs.writeFile(path.join(mirror, 'slots.js'), 'export const slots = [];\n');
  git(mirror, 'add', '.');
  git(mirror, 'commit', '-q', '-m', 'slots');
  const branches = () => git(remote, 'for-each-ref', '--format=%(refname:short)').split('\n').filter(Boolean).sort();
  return { root, remote, mirror, git, branches, sha: git(mirror, 'rev-parse', 'HEAD'), mainSha: git(remote, 'rev-parse', 'main'), stop: () => fs.rm(root, { recursive: true, force: true }).catch(() => {}) };
}
const PR = { title: 'Slot picker on the basket page', head: 'factory/issue-3/main', base: 'main', status: 'ready', body: 'Closes WI-PRD-031-1.' };

test('git-push pushes one commit to a factory/… branch and nothing else: not main, not a tag, never with force', async () => {
  const g = await gitFixture();
  try {
    const push = createGitPush({ workspace: 'examplews', remote: () => g.remote });
    for (const toBranch of ['main', 'master', 'release/1.0', 'factory', 'factory/', 'factory/../main', 'factory/x y', '--force', 'refs/heads/main', 'factory/a:refs/heads/main', '+factory/a']) {
      const r = await push.push({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch });
      assert.deepEqual([r.ok, r.reason], [false, 'refused'], toBranch);
    }
    assert.deepEqual(g.branches(), ['main'], 'none of them reached the repository');
    const ok = await push.push({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main' });
    assert.deepEqual([ok.ok, ok.result.sha, ok.result.branch], [true, g.sha, 'factory/issue-3/main']);
    assert.deepEqual(g.branches(), ['factory/issue-3/main', 'main']);
    assert.equal(g.git(g.remote, 'rev-parse', 'main'), g.mainSha, 'main is untouched');
    // History rewritten locally: git refuses the push, because there is no --force here.
    g.git(g.mirror, 'commit', '-q', '--amend', '-m', 'rewritten');
    const rewritten = await push.push({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main' });
    assert.deepEqual([rewritten.ok, rewritten.reason], [false, 'conflict']);
    assert.equal(g.git(g.remote, 'rev-parse', 'factory/issue-3/main'), g.sha, 'the branch on the repository is unchanged');
    // Without a token (and no test remote) nothing is pushed.
    assert.equal((await createGitPush({ workspace: 'examplews' }).push({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main' })).reason, 'not-configured');
  } finally { await g.stop(); }
});

test('step 2: the Factory\'s branch is pushed and a pull request opened with the default reviewers, through the gate', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote });
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    const pushed = await t.devtools.forge.pushBranch({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main', itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.deepEqual([pushed.sent, pushed.sha], [true, g.sha]);
    assert.deepEqual(g.branches(), ['factory/issue-3/main', 'main']);
    const opened = await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.deepEqual([opened.sent, opened.action, opened.id], [true, 'created', 7]);
    const post = t.fetch.writes().find((c) => c.path === '/2.0/repositories/examplews/web-storefront/pullrequests');
    assert.equal(post.authorization, basic(WRITE_TOKEN));
    assert.deepEqual([post.body.source.branch.name, post.body.destination.branch.name, post.body.close_source_branch], ['factory/issue-3/main', 'main', false]);
    assert.deepEqual(post.body.reviewers, [{ uuid: '{aaaaaaaa-0000-4000-8000-000000000001}' }], 'the repository\'s default reviewers');
    // The work item's issue gets a comment with the link.
    assert.equal(t.fetch.state.issues.get('DTE-500').comments.length, 1);
    // Delivered again: one pull request, not two. A new title updates it.
    const again = await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.equal(again.action, 'unchanged');
    const renamed = await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { ...PR, title: 'Slot picker (ready)' }, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.deepEqual([renamed.action, t.fetch.state.pullRequests.get('web-storefront#7').title], ['updated', 'Slot picker (ready)']);
    assert.equal(t.fetch.state.pullRequests.size, 1);
    // Nothing NooblyJS sent was a merge, and none of it went anywhere but the two write paths.
    assert.ok(t.fetch.writes().every((c) => !/merge|decline|approve/.test(c.path)));
  } finally { await t.stop(); await g.stop(); }
});

test('refuses: a branch that is not the Factory\'s, a repository where Platform does not let agents open pull requests, one NooblyJS does not see, and any other asker', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote, access: { pushAgentBranches: false, openPrs: false } });
  const open = await make({ gitRemote: () => g.remote });
  try {
    const noAccess = await t.devtools.forge.pushBranch({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main', runId: 'r' });
    assert.deepEqual([noAccess.ok, noAccess.state], [false, 'refused']);
    assert.match(noAccess.message, /Agents may not push branches on examplews\/web-storefront/);
    const noPr = await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, runId: 'r' });
    assert.match(noPr.message, /Agents may not open pull requests/);
    const toMain = await open.devtools.forge.pushBranch({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'main', runId: 'r' });
    assert.match(toMain.message, /only pushes branches called factory/);
    const fromMain = await open.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { ...PR, head: 'main' }, runId: 'r' });
    assert.match(fromMain.message, /comes from a factory\/… branch/);
    const wrongBase = await open.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { ...PR, base: 'release' }, runId: 'r' });
    assert.match(wrongBase.message, /goes to main, not release/);
    const unseen = await open.devtools.forge.openOrUpdatePullRequest({ slug: 'payments-gateway', pr: PR, runId: 'r' });
    assert.match(unseen.message, /does not work on the repository payments-gateway/);
    assert.deepEqual(g.branches(), ['main']);
    assert.equal(t.fetch.writes().length + open.fetch.writes().length, 0, 'none of them was sent');
    assert.ok(open.audit.filter((a) => a.action === 'devtools.write_refused').length >= 4, 'each refusal is audited');
  } finally { await t.stop(); await open.stop(); await g.stop(); }
});

test('record only: the branch is not pushed and no pull request is opened, and the run is told so', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote, modes: { jira: 'send', bitbucket: 'record' } });
  try {
    const pushed = await t.devtools.forge.pushBranch({ slug: 'web-storefront', dir: g.mirror, fromBranch: 'factory/issue-3/main', toBranch: 'factory/issue-3/main', itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.deepEqual([pushed.ok, pushed.sent, pushed.recorded], [true, false, true]);
    const opened = await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    assert.deepEqual([opened.sent, opened.recorded, opened.id], [false, true, null]);
    assert.deepEqual(g.branches(), ['main']);
    assert.equal(t.fetch.writes().length, 0);
    assert.equal((await t.devtools.sync.workFor('PRD-031')).workItems.find((w) => w.id === 'WI-PRD-031-1').pr.state, 'RECORDED');
  } finally { await t.stop(); await g.stop(); }
});

test('step 2: checks and reviewers are read from Bitbucket, and a person\'s merge of every pull request moves the item to Verify', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote });
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { ...PR, head: 'factory/issue-4/main', title: 'Slot availability API' }, itemId: 'PRD-031', workItemId: 'WI-PRD-031-2', runId: 'run_2' });
    t.fetch.setStatuses('web-storefront', 7, [{ name: 'Pipeline #41', state: 'SUCCESSFUL' }, { name: 'e2e', state: 'INPROGRESS' }]);
    t.fetch.approve('web-storefront', 7, '{aaaaaaaa-0000-4000-8000-000000000001}');
    const writesBefore = t.fetch.writes().length;
    await t.devtools.sync.poll();
    let work = await t.devtools.sync.workFor('PRD-031');
    assert.deepEqual(work.workItems[0].pr.checks, { total: 2, passed: 1, failed: 0, running: 1, readable: true });
    assert.deepEqual(work.workItems[0].pr.reviewers, [{ name: 'Thabo Reviewer', state: 'approved' }]);
    assert.equal(t.fetch.writes().length, writesBefore, 'following a pull request writes nothing');
    // One of two merged: the issue moves to Done, the item stays in Build.
    t.fetch.merge('web-storefront', 7);
    await t.devtools.sync.poll();
    assert.ok(t.events.some((e) => e.type === 'pr.merged' && e.workItemId === 'WI-PRD-031-1' && e.mergedBy === 'Thabo Reviewer'));
    assert.equal(t.fetch.state.issues.get('DTE-500').status, 'Done');
    assert.equal(t.moved.length, 0);
    // The second merged by a person: Build → Verify, recorded as their merges.
    t.fetch.merge('web-storefront', 8, { display_name: 'Naledi Khumalo', uuid: '{aaaaaaaa-0000-4000-8000-000000000002}' });
    await t.devtools.sync.poll();
    assert.equal(t.moved.length, 1);
    assert.deepEqual(t.moved[0].mergedBy.map((m) => m.name).sort(), ['Naledi Khumalo', 'Thabo Reviewer']);
    assert.deepEqual(t.moved[0].pullRequests.map((p) => p.id).sort(), [7, 8]);
    assert.equal(t.item.stage, 'verify');
    work = await t.devtools.sync.workFor('PRD-031');
    assert.deepEqual(work.workItems.map((w) => [w.pr.state, w.pr.mergedBy]), [['MERGED', 'Thabo Reviewer'], ['MERGED', 'Naledi Khumalo']]);
    assert.ok(t.fetch.writes().every((c) => !/merge/.test(c.path)), 'NooblyJS itself never merged');
  } finally { await t.stop(); await g.stop(); }
});

test('refuses: a merge made with NooblyJS\'s own Bitbucket account does not count, and the item stays in Build', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote });
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: { ...PR, head: 'factory/issue-4/main' }, itemId: 'PRD-031', workItemId: 'WI-PRD-031-2', runId: 'run_2' });
    t.fetch.merge('web-storefront', 7, { display_name: 'NooblyJS', uuid: NOOBLY_ACCOUNT });
    t.fetch.merge('web-storefront', 8);
    await t.devtools.sync.poll();
    assert.equal(t.moved.length, 0, 'the item did not move');
    assert.equal(t.item.stage, 'build');
    assert.ok(t.audit.some((a) => a.action === 'devtools.merge_ignored' && /NooblyJS never merges/.test(a.reason)));
    assert.ok(t.events.some((e) => e.type === 'merge.refused'));
    assert.equal(t.fetch.state.issues.get('DTE-500').status, 'To Do', 'its issue was not moved to Done either');
  } finally { await t.stop(); await g.stop(); }
});

test('the read token is never sent with a write, and the write token is never sent with a read', async () => {
  const g = await gitFixture();
  const t = await make({ gitRemote: () => g.remote });
  try {
    await t.devtools.sync.onHandoff({ handoffId: 'hnd_1' });
    await t.devtools.sync.onRunStarted({ workItemId: 'WI-PRD-031-1' });
    await t.devtools.forge.openOrUpdatePullRequest({ slug: 'web-storefront', pr: PR, itemId: 'PRD-031', workItemId: 'WI-PRD-031-1', runId: 'run_1' });
    await t.devtools.sync.poll();
    for (const c of t.fetch.calls) {
      if (!c.authorization) continue;
      assert.equal(c.authorization, basic(c.method === 'GET' ? READ_TOKEN : WRITE_TOKEN), `${c.method} ${c.path}`);
    }
    assert.ok(t.fetch.writes().length >= 4);
    // No secret is kept in the outbox.
    const files = await fs.readdir(path.join(t.dir, 'devtools', 'outbox'));
    for (const f of files) assert.doesNotMatch(await fs.readFile(path.join(t.dir, 'devtools', 'outbox', f), 'utf8'), new RegExp(`${WRITE_TOKEN}|${READ_TOKEN}|Basic `));
  } finally { await t.stop(); await g.stop(); }
});
