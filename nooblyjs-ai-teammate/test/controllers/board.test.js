// controllers/board.js and routes/board.js: the Team board over HTTP. Everyone reads it; Contributors and up post,
// reply and signal; only `approve` pins and hides; nothing edits a post's body; every write is audited and live.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, coreSignIn, ensureCoreUser } from '../helpers.js';

let app;
before(async () => {
  app = await startApp({ clock: () => Date.parse('2026-10-01T10:00:00Z') });
});
after(() => app.close());

const post = (body) => app.send('POST', '/api/v1/board/posts', body);
/** Signs in as `email` (a core user with `role`) and returns a caller with that session. */
const as = async (email, role) => {
  await ensureCoreUser(app.coreAuth, { email, fullName: email.split('@')[0], password: 'Board-Pass-1234', role });
  const res = await coreSignIn(app, email, 'Board-Pass-1234');
  return async (method, url, body) => {
    const r = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', Cookie: res.cookie, 'X-CSRF-Token': res.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
};

test('the seeded board: the feed with counts per kind, and the side column', async () => {
  const { status, body } = await app.get('/api/v1/board/posts');
  assert.equal(status, 200);
  assert.equal(body.total, 7);
  assert.deepEqual(body.counts, { all: 7, 'working-on': 2, done: 0, finding: 1, ask: 1, 'heads-up': 1, 'needs-person': 1, note: 1 });
  const finding = body.posts.find((p) => p.kind === 'finding');
  assert.equal(finding.author.name, 'Otis Fern');
  assert.equal(finding.kindLabel, 'Finding');
  assert.equal(finding.signals.useful, 3);
  assert.match(finding.preview, /61 of the 412/);

  const now = (await app.get('/api/v1/board/now')).body;
  assert.deepEqual(now.workingOn.map((p) => p.author.name).sort(), ['Ada Quill', 'Juno Park']);
  assert.equal(now.openAsks.length, 0, 'the seeded Ask was answered');
  assert.equal(now.needsPerson[0].author.name, 'Rhea Voss');

  const onItem = (await app.get('/api/v1/board/posts?topic=item:PRD-031&kind=heads-up')).body;
  assert.equal(onItem.posts.length, 1);
  assert.equal(onItem.counts.all, 5);
  const ask = (await app.get(`/api/v1/board/posts/${body.posts.find((p) => p.kind === 'ask').id}`)).body;
  assert.equal(ask.stateLabel, 'Answered');
  assert.equal(ask.answeredBy, ask.replies[0].id);
  assert.equal((await app.get('/api/v1/board/posts/pst_nothing_00')).status, 404);
  assert.ok((await app.get('/api/v1/board/topics?q=slot')).body.topics.some((t) => t.topic === '#slots'));
});

test('Team memory\'s suggestions: open Findings with two Useful signals, one from a person', async () => {
  const { posts } = (await app.get('/api/v1/board/suggestions')).body;
  assert.deepEqual(posts.map((p) => p.author.id), ['otis-fern']);
  assert.equal(posts[0].signalHolders, undefined, 'who gave which signal stays on the server');
});

test('the board\'s settings are an owner\'s, and checked', async () => {
  assert.deepEqual((await app.get('/api/v1/settings')).body.board, { standupTime: '09:00', digestTeammate: null, briefingTokens: 1500, agentPostsPerDay: 20, agentRepliesPerDay: 40, restAfterAgentReplies: 4, staleClaimHours: 24 });
  const bad = await app.send('PATCH', '/api/v1/settings', { board: { standupTime: 'nine', digestTeammate: 'nobody', restAfterAgentReplies: 0 } });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['board.digestTeammate', 'board.restAfterAgentReplies', 'board.standupTime']);
  const ok = await app.send('PATCH', '/api/v1/settings', { board: { standupTime: '', digestTeammate: 'otis-fern' } });
  assert.equal(ok.body.board.standupTime, '');
  assert.equal(ok.body.board.digestTeammate, 'otis-fern');
  await app.send('PATCH', '/api/v1/settings', { board: { standupTime: '09:00', digestTeammate: '' } });
});

test('a person posts and replies; topics are tidied; the write is audited and goes live', async () => {
  const res = await post({ kind: 'finding', topics: ['item:PRD-031', 'team:Delivery squad', 'Slots'], body: 'Peak demand is Saturday morning.', sources: [{ label: 'Orders export', href: 'https://example.com/orders' }] });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.topics, ['item:PRD-031', 'team:delivery-squad', '#slots']);
  assert.deepEqual(res.body.author, { kind: 'person', id: 'stevie@example.com', name: 'Stevie' });
  assert.equal(res.body.state, 'open');
  assert.ok(app.host.auditLog.some((a) => a.action === 'board.post' && a.target === res.body.id && a.actor === 'stevie@example.com'));
  assert.ok(app.host.eventLog.some((e) => e.type === 'teammates.board_changed' && e.payload.live.postId === res.body.id));
  assert.ok(app.host.eventLog.some((e) => e.type === 'board.post_created' && e.payload.postId === res.body.id));

  const reply = await app.send('POST', `/api/v1/board/posts/${res.body.id}/replies`, { body: 'Also Sunday evening.' });
  assert.equal(reply.status, 201);
  const fix = await app.send('POST', `/api/v1/board/posts/${res.body.id}/replies`, { body: 'Correction: Sunday afternoon.', correctionOf: reply.body.id });
  assert.equal(fix.status, 201);
  const thread = (await app.get(`/api/v1/board/posts/${res.body.id}`)).body;
  assert.equal(thread.replies.length, 2);
  assert.equal(thread.replies[1].correctionOf, reply.body.id);
  assert.equal(thread.replyCount, 2);
  assert.equal(thread.body, 'Peak demand is Saturday morning.');
});

test('posts are checked: topics, length, secrets, and sources', async () => {
  const noTopic = await post({ kind: 'note', topics: [], body: 'Hello' });
  assert.equal(noTopic.status, 422);
  assert.ok(noTopic.body.error.details.topics);
  assert.equal((await post({ kind: 'note', topics: ['item:'], body: 'Hello' })).status, 422);
  assert.equal((await post({ kind: 'note', topics: ['#a', '#b', '#c', '#d', '#e', '#f'], body: 'Hello' })).status, 422);
  assert.equal((await post({ kind: 'gossip', topics: ['#a'], body: 'Hello' })).status, 422);
  assert.equal((await post({ kind: 'note', topics: ['#a'], body: 'x'.repeat(4001) })).status, 422);
  assert.equal((await post({ kind: 'note', topics: ['#a'], body: 'Hello', sources: [{ label: 'x', href: 'javascript:alert(1)' }] })).status, 422);
  assert.equal((await post({ kind: 'note', topics: ['#a'], body: 'Hello', sources: [{ label: 'x', href: '//evil.example/x' }] })).status, 422);
  assert.equal((await post({ kind: 'note', topics: ['#a'], body: 'Hello', sources: [{ label: 'x', href: '/home/lifecycle/PRD-031' }] })).status, 201);
  for (const secret of ['the key is AKIAABCDEFGHIJKLMNOP', 'password: hunter2hunter2', 'postgres://app:s3cretpass@db.internal/orders', 'use sk-abcdefghijklmnopqrstuvwxyz123']) {
    const res = await post({ kind: 'note', topics: ['#a'], body: secret });
    assert.equal(res.status, 422, secret);
    assert.equal(res.body.error.code, 'looks_like_secret');
  }
});

test('nothing edits a post body or a reply, and nobody corrects what someone else wrote', async () => {
  const { body } = await post({ kind: 'note', topics: ['#a'], body: 'Original text' });
  assert.equal((await app.send('PATCH', `/api/v1/board/posts/${body.id}`, { body: 'Changed' })).status, 404);
  assert.equal((await app.send('PUT', `/api/v1/board/posts/${body.id}`, { body: 'Changed' })).status, 404);
  assert.equal((await app.send('DELETE', `/api/v1/board/posts/${body.id}`)).status, 404);
  const contributor = await as('cora@example.com', 'contributor');
  const fix = await contributor('POST', `/api/v1/board/posts/${body.id}/replies`, { body: 'Not yours', correctionOf: body.id });
  assert.equal(fix.status, 403);
  assert.equal(fix.body.error.code, 'not_yours');
  assert.equal((await app.get(`/api/v1/board/posts/${body.id}`)).body.body, 'Original text');
});

test('viewers read; contributors post, reply and signal but cannot pin or hide; approvers hide with a reason', async () => {
  const viewer = await as('vera@example.com', 'viewer');
  assert.equal((await viewer('GET', '/api/v1/board/posts')).status, 200);
  const refused = await viewer('POST', '/api/v1/board/posts', { kind: 'note', topics: ['#a'], body: 'Hi' });
  assert.equal(refused.status, 403);
  assert.ok(app.host.auditLog.some((a) => a.action === 'access.refused' && a.permission === 'draft'));

  const contributor = await as('cora@example.com', 'contributor');
  const mine = await contributor('POST', '/api/v1/board/posts', { kind: 'ask', topics: ['item:PRD-031'], body: 'Is the pilot date set?' });
  assert.equal(mine.status, 201);
  assert.equal((await contributor('PUT', `/api/v1/board/posts/${mine.body.id}/signals/same`)).body.signals.same, 1);
  assert.equal((await contributor('PUT', `/api/v1/board/posts/${mine.body.id}/signals/take`)).body.takenBy[0], 'person:cora@example.com');
  assert.equal((await contributor('DELETE', `/api/v1/board/posts/${mine.body.id}/signals/same`)).body.signals.same, undefined);
  assert.equal((await contributor('PUT', `/api/v1/board/posts/${mine.body.id}/signals/clap`)).status, 400);
  assert.equal((await contributor('POST', `/api/v1/board/posts/${mine.body.id}/pin`, { pinned: true })).status, 403);
  assert.equal((await contributor('POST', `/api/v1/board/posts/${mine.body.id}/hide`, { reason: 'x' })).status, 403);

  const reply = await contributor('POST', `/api/v1/board/posts/${mine.body.id}/replies`, { body: 'Answering my own question: yes.' });
  assert.equal((await contributor('POST', `/api/v1/board/posts/${mine.body.id}/answer`, { replyId: reply.body.id })).body.state, 'answered');

  assert.equal((await app.send('POST', `/api/v1/board/posts/${mine.body.id}/hide`, {})).status, 422, 'a reason is needed');
  const hidden = await app.send('POST', `/api/v1/board/posts/${mine.body.id}/hide`, { reason: 'Posted by mistake' });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.hidden.reason, 'Posted by mistake');
  const shown = (await viewer('GET', `/api/v1/board/posts/${mine.body.id}`)).body;
  assert.equal(shown.body, '');
  assert.equal(shown.hidden.by.name, 'Stevie');
  assert.equal((await contributor('POST', `/api/v1/board/posts/${mine.body.id}/replies`, { body: 'More' })).status, 409);
  const file = await app.repos.board.get(mine.body.id);
  assert.equal(file.body, 'Is the pilot date set?', 'the text stays in the file');
});

test('a person resolves a Needs-a-person post by saying where they acted, and promotes a Finding to team memory', async () => {
  const { posts } = (await app.get('/api/v1/board/posts?kind=needs-person')).body;
  assert.equal((await app.send('POST', `/api/v1/board/posts/${posts[0].id}/resolve`, { where: { kind: 'somewhere' } })).status, 422);
  const resolved = await app.send('POST', `/api/v1/board/posts/${posts[0].id}/resolve`, { where: { kind: 'approval', id: 'APR-14', href: '/home/approvals' } });
  assert.equal(resolved.body.state, 'resolved');
  assert.deepEqual(resolved.body.resolution.where, { kind: 'approval', id: 'APR-14', href: '/home/approvals' });
  assert.equal((await app.send('POST', `/api/v1/board/posts/${posts[0].id}/resolve`, { where: { kind: 'approval', id: 'APR-14' } })).status, 409);

  const finding = (await app.get('/api/v1/board/posts?kind=finding&author=otis-fern')).body.posts[0];
  const promoted = await app.send('POST', `/api/v1/board/posts/${finding.id}/promote`);
  assert.equal(promoted.body.state, 'promoted');
  const memory = (await app.get('/api/v1/team-memory')).body.items.find((m) => m.id === promoted.body.promotedTo);
  assert.match(memory.text, /61 of the 412/);
  assert.match(memory.text, /Zendesk export/);
  assert.equal(memory.source, finding.id);
  assert.equal(memory.contributor, 'Otis Fern');

  const headsUp = (await app.get('/api/v1/board/posts?kind=heads-up')).body.posts[0];
  assert.equal((await app.send('POST', `/api/v1/board/posts/${headsUp.id}/acknowledge`)).body.state, 'acknowledged');
});

test('API keys cannot reach the board', async () => {
  const { key } = await app.auth.createKey({ name: 'CI' });
  const res = await fetch(`${app.url}/api/v1/board/posts`, { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'key_not_allowed');
});
