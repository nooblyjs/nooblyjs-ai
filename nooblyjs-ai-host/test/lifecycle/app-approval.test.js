// NooblyJS Phase 9a: an approval another app asks for on its own artefact (an Infrastructure design version for one kind
// of environment). It shows with the other approvals, the app carries the decision out before it is recorded (so the
// app's refusals are the same here), an agent and a missing permission are refused, and it moves no stage.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { ANCHOR } from '../../src/lifecycle/seed/index.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

let dir;
let server;
let base;
let stand;
let hosted;
const carried = [];
let refuseNext = null;
const REF = { app: 'infrastructure', designId: 'INF-031', version: 2, kind: 'test', kindLabel: 'Test' };

const call = async (person, method, url, body) => {
  const res = await fetch(`${base}/workflows/api/v1${url}`, { method, headers: { [PERSON_HEADER]: person, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const events = (type) => stand.eventLog.filter((e) => e.type === type);

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-lifecycle-app-'));
  stand = createHost({
    dataDir: dir,
    now: ANCHOR,
    services: {
      infrastructure: {
        async decideApproval(input) {
          if (refuseNext) {
            const err = Object.assign(new Error(refuseNext), { status: 422, code: 'policy_failed' });
            refuseNext = null;
            throw err;
          }
          carried.push({ ...input, person: input.person.id });
          return { text: 'Approved. A run for test-slots started.' };
        },
      },
    },
  });
  const app = express();
  app.use(express.json());
  hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await hosted?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('an app opens an approval on its artefact; it waits on the people with the rule\'s permission, once per artefact and kind', async () => {
  const opened = await hosted.services.requestAppApproval({
    type: 'infra-design', itemId: 'PRD-031', title: 'Slot availability', subject: 'INF-031 v2', ref: REF, link: '/factory/infrastructure/designs/INF-031',
    requestedBy: { id: 'infrastructure', name: 'Infrastructure', kind: 'app' },
  });
  assert.deepEqual(opened.reviewers.map((r) => r.id), ['stevie']);
  assert.equal((await hosted.services.requestAppApproval({ type: 'infra-design', itemId: 'PRD-031', ref: REF })).existing, true);
  await assert.rejects(hosted.services.requestAppApproval({ type: 'spec', itemId: 'PRD-031', ref: REF }), { status: 400 });
  const { body } = await call('stevie', 'GET', '/approvals');
  const row = body.rows.find((r) => r.id === opened.approvalId);
  assert.deepEqual([row.tag, row.title], ['Infra', 'INF-031 v2 · Approve & provision Test']);
  const detail = (await call('stevie', 'GET', `/approvals/${opened.approvalId}`)).body.approval;
  assert.deepEqual([detail.decide.approveLabel, detail.links.artefact, detail.links.artefactLabel], ['Approve & provision Test', '/factory/infrastructure/designs/INF-031', 'Open INF-031 v2']);
});

test('deciding it: an agent and a Contributor are refused; the app\'s refusal is the answer; then the app carries it out and no stage moves', async () => {
  const approval = (await call('stevie', 'GET', '/approvals')).body.rows.find((r) => r.type === 'infra-design');
  const before = (await hosted.services.item({ itemId: 'PRD-031' })).stage;
  assert.equal((await call('ada-quill', 'POST', `/approvals/${approval.id}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await call('priya-s', 'POST', `/approvals/${approval.id}/decision`, { decision: 'approve' })).status, 403);
  refuseNext = 'A policy check is failing: encryption at rest.';
  const refused = await call('stevie', 'POST', `/approvals/${approval.id}/decision`, { decision: 'approve' });
  assert.deepEqual([refused.status, refused.body.error.message], [422, 'A policy check is failing: encryption at rest.']);
  assert.equal(carried.length, 0);
  const ok = await call('stevie', 'POST', `/approvals/${approval.id}/decision`, { decision: 'approve' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.outcome, ok.body.text], ['approved', 'Approved. A run for test-slots started.']);
  assert.deepEqual(carried.map((c) => [c.designId, c.version, c.kind, c.decision, c.person]), [['INF-031', 2, 'test', 'approve', 'stevie']]);
  assert.equal((await hosted.services.item({ itemId: 'PRD-031' })).stage, before);
  const decided = events('approval.decided').at(-1).payload;
  assert.deepEqual([decided.type, decided.ref.designId, decided.summary], ['infra-design', 'INF-031', 'approved INF-031 v2 for Test']);
});

test('decided on the app\'s own screen: the open approval closes with that decision, and the app is not asked again', async () => {
  const ref = { ...REF, kind: 'staging', kindLabel: 'Staging' };
  const { approvalId } = await hosted.services.requestAppApproval({ type: 'infra-design', itemId: 'PRD-031', subject: 'INF-031 v2', ref });
  const closed = await hosted.services.closeAppApproval({ type: 'infra-design', ref, decision: 'approve', actor: { id: 'stevie' } });
  assert.deepEqual([closed.id, closed.status, closed.decidedVia], [approvalId, 'approved', 'infrastructure']);
  assert.equal(carried.length, 1);
  assert.equal(events('approval.decided').at(-1).payload.via, 'infrastructure');
  assert.equal(await hosted.services.closeAppApproval({ type: 'infra-design', ref, decision: 'approve', actor: { id: 'stevie' } }), null);
  await assert.rejects(hosted.services.closeAppApproval({ type: 'infra-design', ref, decision: 'approve', actor: { id: 'ada-quill', kind: 'agent' } }), { status: 403 });
});

test('a newer version replaces the waiting one; withdrawing closes what is open', async () => {
  const v3 = { ...REF, version: 3 };
  const first = await hosted.services.requestAppApproval({ type: 'infra-design', itemId: 'PRD-031', subject: 'INF-031 v3', ref: v3 });
  const v4 = await hosted.services.requestAppApproval({ type: 'infra-design', itemId: 'PRD-031', subject: 'INF-031 v4', ref: { ...REF, version: 4 } });
  assert.notEqual(first.approvalId, v4.approvalId);
  assert.ok(events('approval.withdrawn').some((e) => e.payload.approvalId === first.approvalId));
  assert.equal(await hosted.services.withdrawAppApprovals({ type: 'infra-design', ref: { app: 'infrastructure', designId: 'INF-031' }, reason: 'design archived' }), 1);
});
