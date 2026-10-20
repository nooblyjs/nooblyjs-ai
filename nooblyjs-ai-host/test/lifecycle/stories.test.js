// Phase 16c: stories (root product.md §3.2, §3.2a). From Design on, an item goes story by story: the Design section's
// stories are lifecycle items of their own (type story, linked to their item and their feature), each handed to
// Engineering on its own with Design's readiness checks, and the item follows its stories once the last has left
// Design. These tests write their own items and stand in for the Design section's readiness facts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const NOW = '2026-10-20T09:00:00.000Z';
const PERSON = (id) => ({ id, kind: 'person' });
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };

// What the Design section answers (design/ readinessFacts): changed by the tests.
const design = { facts: {} };
const allPass = () => ({
  'requirements-covered': { value: true },
  'decisions-decided': { value: true },
  'interfaces-complete': { value: true },
});

let env;
before(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-stories-'));
  const store = new FsStore(dir);
  const item = (id, stage) => ({
    id, type: 'spec', ref: id, title: `Item ${id}`, system: 'product', stage, status: 'active', owner: 'lerato-m', team: 'delivery-squad',
    createdAt: '2026-10-01T09:00:00.000Z', stageEnteredAt: '2026-10-15T09:00:00.000Z',
    history: [{ stage, enteredAt: '2026-10-15T09:00:00.000Z', by: 'lerato-m' }], version: 1, updatedAt: '2026-10-15T09:00:00.000Z',
  });
  await store.writeDoc(['items', 'PRD-031.md'], item('PRD-031', 'design'), '');
  await store.writeDoc(['items', 'PRD-040.md'], item('PRD-040', 'design'), '');
  const services = { design: { readinessFacts: async (itemId) => (itemId === 'PRD-031' ? { facts: design.facts } : null) } };
  const stand = createHost({ dataDir: dir, now: NOW, services });
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/workflows/api/v1`;
  const call = async (person, method, url, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { [PERSON_HEADER]: person, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  env = {
    dir, stand, hosted, call, s: hosted.services,
    view: async (id) => (await call('stevie', 'GET', `/items/${id}`)).body,
    stop: async () => {
      await hosted.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
});
after(async () => { await env?.stop(); });

const STORIES = [
  { id: 'STORY-031-1', title: 'See same-day capacity', feature: { id: 'FEAT-031-1', title: 'Same-day capacity' } },
  { id: 'STORY-031-2', title: 'Hold a slot while paying', feature: { id: 'FEAT-031-2', title: 'Slot holds' } },
  { id: 'STORY-031-3', title: 'Release evening capacity', feature: { id: 'FEAT-031-3', title: 'Evening capacity' } },
];

test('the Design section\'s stories become items in Design, linked to their item and feature; an agent and a Viewer may not change them', async () => {
  const done = await env.s.syncStories({ itemId: 'PRD-031', stories: STORIES, actor: PERSON('priya-s') });
  assert.deepEqual(done, { created: ['STORY-031-1', 'STORY-031-2', 'STORY-031-3'], updated: [], withdrawn: [] });
  const story = (await env.view('STORY-031-2')).item;
  assert.deepEqual([story.type, story.stage, story.parent.id, story.feature.id, story.system], ['story', 'design', 'PRD-031', 'FEAT-031-2', 'factory']);
  assert.equal(story.designHref, '/factory/design/stories/PRD-031');
  const parent = (await env.view('PRD-031')).item;
  assert.equal(parent.stories.text, '0 of 3 stories handed off');
  assert.equal(env.stand.eventLog.filter((e) => e.type === 'item.created' && e.payload.parentId === 'PRD-031').length, 3);
  await assert.rejects(env.s.syncStories({ itemId: 'PRD-031', stories: STORIES, actor: AGENT }), { code: 'people_only' });
  await assert.rejects(env.s.syncStories({ itemId: 'PRD-031', stories: STORIES, actor: PERSON('naledi-k') }), { code: 'forbidden' });
  // Unchanged: nothing written again.
  assert.deepEqual(await env.s.syncStories({ itemId: 'PRD-031', stories: STORIES, actor: PERSON('priya-s') }), { created: [], updated: [], withdrawn: [] });
});

test('a story merged away is withdrawn with its reason; a renamed one keeps its id', async () => {
  const merged = [{ ...STORIES[0], title: 'See capacity and hold a slot' }, STORIES[2], { id: 'STORY-031-4', title: 'Evening capacity, by store', feature: STORIES[2].feature }];
  const done = await env.s.syncStories({ itemId: 'PRD-031', stories: merged, reason: 'merged into STORY-031-1', actor: PERSON('priya-s') });
  assert.deepEqual(done, { created: ['STORY-031-4'], updated: ['STORY-031-1'], withdrawn: ['STORY-031-2'] });
  const gone = (await env.view('STORY-031-2')).item;
  assert.equal(gone.status, 'withdrawn');
  assert.ok(env.stand.eventLog.some((e) => e.type === 'item.withdrawn' && e.payload.itemId === 'STORY-031-2' && e.payload.reason === 'merged into STORY-031-1'));
  assert.equal((await env.view('PRD-031')).item.stories.total, 3);
  // Back to the three stories for the next tests.
  await env.s.syncStories({ itemId: 'PRD-031', stories: [STORIES[0], STORIES[2], merged[2]], actor: PERSON('priya-s') });
});

test('the item as a whole is not handed off, signed off or moved on once it has stories', async () => {
  const advance = await env.call('stevie', 'POST', '/items/PRD-031/advance', {});
  assert.equal(advance.status, 422);
  assert.equal(advance.body.error.code, 'per_story');
  assert.match(advance.body.error.message, /^PRD-031 goes on story by story: move on each of its 3 stories \(STORY-031-1, STORY-031-3, STORY-031-4\) instead\.$/);
  await assert.rejects(env.s.handoff({ itemId: 'PRD-031', workItems: [{ repo: 'slots-api', title: 'x' }], actor: PERSON('stevie') }), { code: 'per_story' });
  const view = await env.view('PRD-031');
  assert.equal(view.actions.canAdvance, false);
  assert.match(view.actions.perStory, /story by story/);
});

test('a story\'s Design handoff waits on Design\'s readiness, says which check fails, and refuses agents and Viewers', async () => {
  design.facts = { ...allPass(), 'interfaces-complete': { value: false, detail: 'IF-031-02 has no "to" side' } };
  const refused = await env.s.handoffStory({ storyId: 'STORY-031-1', actor: PERSON('thabo-n') }).catch((err) => err);
  assert.equal(refused.code, 'readiness_failed');
  assert.match(refused.message, /An interface has a side missing: IF-031-02 has no "to" side/);
  assert.equal((await env.view('STORY-031-1')).readiness.source, 'design');
  await assert.rejects(env.s.handoffStory({ storyId: 'STORY-031-1', actor: AGENT }), { code: 'people_only' });
  await assert.rejects(env.s.handoffStory({ storyId: 'STORY-031-1', actor: PERSON('naledi-k') }), { code: 'viewers_cannot_approve' });
  await assert.rejects(env.s.handoffStory({ storyId: 'PRD-031', actor: PERSON('thabo-n') }), /not a story/);
});

test('one story handed off moves to Engineer with its work items; the item stays in Design and says how far it is', async () => {
  design.facts = allPass();
  const result = await env.s.handoffStory({ storyId: 'STORY-031-1', workItems: [{ repo: 'slots-api', title: 'See same-day capacity' }, { repo: 'web-storefront', title: 'See same-day capacity' }], actor: PERSON('thabo-n') });
  assert.equal(result.outcome, 'approved');
  assert.equal(result.item.stage, 'engineer');
  assert.equal(result.approval.type, 'design-handoff');
  assert.deepEqual(result.approval.workItems.map((w) => w.repo), ['slots-api', 'web-storefront']);
  assert.equal(result.handoff, null, 'nothing goes to the Software Factory before the Engineering sign-off');
  const parent = (await env.view('PRD-031')).item;
  assert.equal(parent.stage, 'design');
  assert.equal(parent.stories.text, '1 of 3 stories handed off');
  assert.deepEqual(parent.stories.rows.map((r) => [r.id, r.stageLabel]), [['STORY-031-1', 'Engineer'], ['STORY-031-3', 'Design'], ['STORY-031-4', 'Design']]);
  // A story already handed off is left as it is by the next sync, even when it is no longer listed.
  assert.deepEqual(await env.s.syncStories({ itemId: 'PRD-031', stories: [STORIES[2], { id: 'STORY-031-4', title: 'Evening capacity, by store', feature: STORIES[2].feature }], actor: PERSON('priya-s') }), { created: [], updated: [], withdrawn: [] });
  await assert.rejects(env.s.handoffStory({ storyId: 'STORY-031-1', actor: PERSON('thabo-n') }), { code: 'wrong_stage' });
});

test('when the last story leaves Design the item follows its stories, on record but with no stage event', async () => {
  await env.s.handoffStory({ storyId: 'STORY-031-3', actor: PERSON('thabo-n') });
  assert.equal((await env.view('PRD-031')).item.stage, 'design', 'one story is still in Design');
  const before = env.stand.eventLog.filter((e) => e.type === 'item.stage_changed' && e.payload.itemId === 'PRD-031').length;
  await env.s.handoffStory({ storyId: 'STORY-031-4', actor: PERSON('stevie') });
  const parent = await env.view('PRD-031');
  assert.equal(parent.item.stage, 'engineer');
  assert.equal(parent.item.stories.text, '3 of 3 stories handed off');
  assert.equal(parent.history[0].kind, 'stories');
  assert.equal(env.stand.eventLog.filter((e) => e.type === 'item.stage_changed' && e.payload.itemId === 'PRD-031').length, before);
  assert.ok(env.stand.auditLog.some((r) => r.action === 'item.followed_stories' && r.target === 'PRD-031' && r.to === 'engineer'));
  // Stories are written in Design.
  await assert.rejects(env.s.syncStories({ itemId: 'PRD-031', stories: STORIES, actor: PERSON('priya-s') }), { code: 'wrong_stage' });
});

test('an item with no Design work has no Design checks, and keeps its own Design handoff', async () => {
  const view = await env.view('PRD-040');
  assert.equal(view.readiness.source, 'none');
  const result = await env.s.handoff({ itemId: 'PRD-040', workItems: [{ repo: 'slots-api', title: 'one' }], actor: PERSON('thabo-n') });
  assert.equal(result.item.stage, 'engineer');
});
