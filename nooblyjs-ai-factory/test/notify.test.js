// Phase F18: notifications (filters, batching, cursor) and GitHub comment commands.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { startFakeGitHub } from './fixtures/fake-github.js';
import { commandsFor } from './fixtures/github-helpers.js';
import { parseCommand } from '../src/forge/github/commands.js';
import { createGitHubClient } from '../src/forge/github/client.js';
import { createGitHubForge } from '../src/forge/github/forge.js';
import { openEntry } from '../src/humans/inbox.js';
import { submitJob } from '../src/job/run-job.js';
import { formatBatch } from '../src/notify/messages.js';
import { createNotifier } from '../src/notify/notifier.js';
import { createWebhookServer } from '../src/server/webhooks.js';
import { openStore } from '../src/store/events.js';
import { createFakeClock } from '../src/util/clock.js';
import { makeRepo, testEnv, tmpDir } from './helpers.js';

function issueFile(title = 'Add half') {
  const file = path.join(tmpDir(), `${crypto.randomUUID()}.md`);
  fs.writeFileSync(file, `# ${title}\n\nx\n`);
  return file;
}

/** A store with runs, and a notifier whose "fetch" records what it would send. */
function setup(targets) {
  const env = testEnv();
  const store = openStore({ env });
  const sent = [];
  const clock = createFakeClock(1_000_000);
  const fetch = async (url, init) => (sent.push({ url, body: JSON.parse(init.body) }), { ok: true, status: 200 });
  const notifier = createNotifier({ store, targets, env, fetch, clock, sleep: async () => {} });
  return { env, store, sent, clock, notifier, fetch };
}
const finish = (store, runId, status) => store.append(`run:${runId}`, 'run.finished', { runId, status, pr: `https://example/pull/${runId.slice(-3)}` });

test('filters: each target gets only the kinds (and repos) it asked for; steps and agent chatter never ping', async () => {
  const { store, sent, notifier } = setup([
    { name: 'humans', url: 'http://team', format: 'slack', events: ['inbox.opened', 'run.escalated'], batchMs: 0 },
    { name: 'prs', url: 'http://prs', format: 'discord', events: ['run.delivered'], batchMs: 0 },
  ]);
  const a = submitJob(store, { repo: makeRepo(), issueFile: issueFile('Add half') });
  store.append(`run:${a}`, 'step.started', { runId: a, step: 'build' });
  finish(store, a, 'delivered');
  openEntry(store, { runId: a, kind: 'question', gate: 'ask:build', title: '1.5 or 1?' });
  openEntry(store, { runId: a, kind: 'escalation', title: 'repairs used up' });
  assert.equal(notifier.poll(), 3);
  await notifier.flush();
  const byUrl = Object.groupBy(sent, (s) => s.url);
  assert.equal(byUrl['http://prs'].length, 1);
  assert.match(byUrl['http://prs'][0].body.content, /\*\*✅ Ready for review: Add half\*\*/, 'discord: **bold**, "content"');
  assert.equal(byUrl['http://team'].length, 1, 'batchMs 0 still sends one message per flush');
  assert.match(byUrl['http://team'][0].body.text, /2 updates[\s\S]*A question for: Add half[\s\S]*Needs a person: Add half/);
});

test('batching: notifications wait batchMs, then go as ONE message; a restart neither repeats nor loses any (the cursor)', async () => {
  const s = setup([{ name: 'team', url: 'http://team', events: ['run.delivered', 'run.failed'], batchMs: 60_000 }]);
  for (let i = 0; i < 3; i++) finish(s.store, submitJob(s.store, { repo: makeRepo(), issueFile: issueFile(`Item ${i}`) }), i === 2 ? 'gate_failed' : 'delivered');
  s.notifier.poll();
  assert.equal(await s.notifier.flush(), 0, 'too soon');
  s.clock.advance(30_000);
  assert.equal(await s.notifier.flush(), 0);
  s.clock.advance(30_000);
  assert.equal(await s.notifier.flush(), 1, 'one message');
  assert.match(s.sent[0].body.text, /3 updates[\s\S]*Item 0[\s\S]*Item 1[\s\S]*❌ gate_failed: Item 2/);

  // A new notifier (a restart) starts after the saved cursor.
  const again = createNotifier({ store: s.store, targets: [{ name: 'team', url: 'http://team', events: ['run.delivered'], batchMs: 0 }], env: s.env, fetch: s.fetch, clock: s.clock });
  assert.equal(again.poll(), 0, 'nothing repeated');
  finish(s.store, submitJob(s.store, { repo: makeRepo(), issueFile: issueFile('After') }), 'delivered');
  assert.equal(again.poll(), 1, 'nothing lost');
});

test('first start begins at the END of the log; a failing target is retried, then dropped without stopping anything', async () => {
  const env = testEnv();
  const store = openStore({ env });
  finish(store, submitJob(store, { repo: makeRepo(), issueFile: issueFile('Old') }), 'delivered');
  let calls = 0;
  const logs = [];
  const n = createNotifier({ store, env, targets: [{ name: 'down', url: 'http://down', events: ['*'], batchMs: 0 }, { name: 'nourl', urlEnv: 'NOT_SET' }], fetch: async () => (calls++, { ok: false, status: 503 }), sleep: async () => {}, log: (l) => logs.push(l) });
  assert.equal(n.poll(), 0, 'no ping for history');
  finish(store, submitJob(store, { repo: makeRepo(), issueFile: issueFile('New') }), 'delivered');
  n.poll();
  assert.equal(await n.flush(), 0);
  assert.equal(calls, 3, 'three tries');
  assert.ok(logs.some((l) => /nourl" has no URL/.test(l)));
  assert.ok(logs.some((l) => /down unreachable; 1 notification\(s\) dropped/.test(l)));
});

test('budget.exceeded: recorded once a day per budget, and notified', async () => {
  const { store, notifier, sent } = setup([{ name: 'ops', url: 'http://ops', events: ['budget.exceeded'], batchMs: 0 }]);
  const { createScheduler } = await import('../src/scheduler/scheduler.js');
  const { DEFAULTS } = await import('../src/config/factory-config.js');
  submitJob(store, { repo: makeRepo(), issueFile: issueFile() });
  store.append('system', 'effect.done', {}); // (unrelated noise)
  const scheduler = createScheduler({ store, config: { ...DEFAULTS, dailyBudgetUsd: 0 }, execute: async () => {} });
  scheduler.tick();
  scheduler.tick();
  assert.equal(store.read().filter((e) => e.type === 'budget.exceeded').length, 1, 'once, not every tick');
  notifier.poll();
  await notifier.flush();
  assert.match(sent[0].body.text, /Budget reached[\s\S]*daily budget: \$0\.00 spent/);
});

test('formats: slack { text }, discord { content } (≤ 2000), json { notifications }', () => {
  const n = { kind: 'run.delivered', title: 'Ready', text: 'x'.repeat(3000), runId: 'r', slug: null, seq: 1, at: '' };
  assert.deepEqual(Object.keys(formatBatch('slack', [n])), ['text']);
  assert.ok(formatBatch('discord', [n]).content.length <= 2000);
  assert.deepEqual(formatBatch('json', [n]).notifications, [n]);
});

// ---- chatops ------------------------------------------------------------------------------------

test('the command grammar: fixed words, one command, "fix" takes the rest', () => {
  assert.deepEqual(parseCommand('@factory run'), { command: 'run', args: '' });
  assert.deepEqual(parseCommand('Thanks!\n@factory explain\nlater'), { command: 'explain', args: '' });
  assert.deepEqual(parseCommand('@factory fix use n / 2\nand add a test for 3'), { command: 'fix', args: 'use n / 2\nand add a test for 3' });
  assert.equal(parseCommand('please @factory run it'), null, 'a command must start its line');
  assert.equal(parseCommand('nothing here'), null);
  assert.match(parseCommand('@factory deploy').error, /don't know "deploy"[\s\S]*@factory run/);
  assert.match(parseCommand('@factory fix').error, /what to change/);
});

test('comment commands on GitHub: run → a run + a reply; explain → the timeline; stop; a stranger gets a polite no; a redelivery is not answered twice', async () => {
  const gh = await startFakeGitHub();
  const env = { ...testEnv(), GITHUB_TOKEN: gh.token };
  const store = openStore({ env });
  const forge = createGitHubForge({ client: createGitHubClient({ token: gh.token, apiUrl: gh.url }), owner: 'acme', name: 'calc' });
  const server = createWebhookServer({ store, secret: 's', settings: { label: 'factory', allowedUsers: ['sam'], apiUrl: gh.url }, repoPath: () => makeRepo(), reply: (o, n, num, text, key) => forge.comment('', num, text, { key }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hook = commandsFor(server, 's');
  const repository = { name: 'calc', owner: { login: 'acme' }, clone_url: 'https://github.com/acme/calc.git' };
  const comment = (body, login = 'sam', number = 7, pr = false) => ({ action: 'created', comment: { body, user: { login } }, issue: { number, title: 'Add half', body: 'half(n)', labels: [], ...(pr && { pull_request: {} }) }, repository });
  const replies = () => (gh.state.comments.get(7) ?? []).map((c) => c.body);
  try {
    const ran = await hook('issue_comment', comment('@factory run'), 'd1');
    assert.equal(ran.body.handled, true, JSON.stringify(ran.body));
    const runId = ran.body.runId;
    assert.equal(store.get('runs', runId).status, 'queued');
    await hook('issue_comment', comment('@factory run'), 'd1'); // GitHub redelivers
    assert.equal(replies().length, 1, 'one reply per delivery');
    assert.match(replies()[0], /On it \(run `run-/);
    assert.match((await hook('issue_comment', comment('@factory run'), 'd2')).body.reply ?? replies().at(-1), /Already on it/);

    await hook('issue_comment', comment('@factory explain'), 'd3');
    assert.match(replies().at(-1), /\*\*queued\*\*[\s\S]*```[\s\S]*queued/);

    await hook('issue_comment', comment('@factory stop'), 'd4');
    assert.equal(store.get('runs', runId).status, 'cancelled');
    assert.match(replies().at(-1), /Stopped run/);

    const stranger = await hook('issue_comment', comment('@factory run', 'mallory'), 'd5');
    assert.equal(stranger.body.handled, false);
    assert.match(replies().at(-1), /Sorry @mallory, only @sam can give the factory commands here/);
    assert.equal(store.list('runs').length, 1, 'nothing started for a stranger');

    await hook('issue_comment', comment('@factory fix make it faster', 'sam', 7, true), 'd6');
    assert.match(replies().at(-1), /can't find a factory PR/);
    await hook('issue_comment', comment('just a normal comment'), 'd7');
    assert.equal(replies().length, 6, 'ordinary comments are ignored, silently');
  } finally {
    server.close();
    await gh.close();
  }
});
