// Phase 8 in the real app (roadmap Phase 8 test script): the Wiki Platform hosted at /wiki is NooblyJS's Knowledge
// Repository. The sample export is imported with personal data redacted, a question is answered from three cited
// sources, the answer is added to PRD-031 and then reported as wrong, the L0 process model renders from the
// imported pages, and Ada's draft carries the knowledge it was given. Offline: no AI agent is configured in the
// wiki, so answers are the sources' own passages, and drafts are the seed's scripts. The steps run in order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let priya;
let viewer;
const K = '/wiki/api/v1/knowledge';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const spec = async () => (await lerato.json('/factory/product/api/v1/specs/PRD-031')).body;

before(async () => {
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: true },
    ],
  });
  [stevie, lerato, priya, viewer] = [env.client(), env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await priya.signIn('priya-s');
  await viewer.signIn('naledi-k');
});
after(async () => { await env?.stop(); });

test('the shell lists the Wiki with its Sources and Needs review rows; its API needs a sign-in', async () => {
  const app = (await stevie.json('/api/v1/shell')).body.apps.find((a) => a.name === 'wiki');
  assert.deepEqual([app.state, app.mountPath, app.label], ['ready', '/wiki', 'Wiki']);
  const rows = app.nav.map((n) => [n.key, n.path]);
  for (const row of [['sources', '/datasources/sources'], ['needs-review', '/datasources/needs-review']]) assert.ok(rows.some((r) => r[0] === row[0] && r[1] === row[1]), row[0]);
  assert.equal((await env.client().get(`${K}/sources`)).status, 401);
  // Deep links answer with the frame, so a refresh lands on the same screen.
  for (const page of ['/wiki/datasources/sources', '/wiki/datasources/needs-review', '/wiki/Enterprise%20Space/Business%20processes/L0%20Enterprise%20Process%20Model.md']) {
    const res = await stevie.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, page);
  }
});

test('step 1: the sample wiki export is imported; Sources shows its state and document counts', async () => {
  const { body } = await stevie.json(`${K}/sources`);
  assert.equal(body.sources.length, 1);
  const [source] = body.sources;
  assert.deepEqual([source.name, source.state, source.documents, source.by], ['Sample wiki export', 'Imported', 18, 'system']);
  assert.deepEqual(source.spaces.map((s) => [s.name, s.documents]), [['Acme Space', 5], ['Enterprise Space', 13]]);
  assert.equal(body.canImport, true);
  assert.equal((await lerato.json(`${K}/sources`)).body.canImport, false, 'importing is an Owner\'s');
  // Importing again is refused for anyone else and audited; an Owner's import is audited too.
  assert.equal((await post(lerato, `${K}/import`)).status, 403);
  const again = await post(stevie, `${K}/import`);
  assert.equal(again.status, 200);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.actor === 'lerato-m' && r.permission === 'change-repo-access'));
    assert.ok(audit.some((r) => r.action === 'knowledge.imported' && r.actor === 'stevie' && r.documents === 18));
  });
  // The sidebar card says what is there.
  const status = (await stevie.json('/api/v1/shell/status')).body.wiki;
  assert.match(status.card.items[0].value, /^18 documents · 1 source$/);
});

test('step 5: a document that arrived with a phone number, an email address and an ID number is stored with them redacted', async () => {
  const dir = path.join(env.dataDir, 'wiki');
  const files = (await fs.readdir(dir, { recursive: true })).map(String).filter((f) => f.endsWith('September support themes.md'));
  assert.equal(files.length, 1);
  const stored = await fs.readFile(path.join(dir, files[0]), 'utf8');
  assert.match(stored, /phone me on \[REDACTED PHONE\]/);
  assert.match(stored, /email \[REDACTED EMAIL\]/);
  assert.match(stored, /ID number is \[REDACTED ID\]/);
  for (const secret of ['082 555 0142', 'thandi.m@example.co.za', '8001015009087']) assert.ok(!stored.includes(secret));
  assert.deepEqual((await stevie.json(`${K}/sources`)).body.sources[0].redacted, { id: 1, email: 1, phone: 1 });
  // Everything it wrote is under data/wiki/.
  const root = await fs.readdir(env.dataDir);
  assert.ok(!root.includes('knowledge') && !root.includes('spaces') && !root.includes('imports'));
});

let answer;
test('step 2: "How is slot capacity calculated?" gets an answer with 3 citations; Add to PRD-031 puts them in the spec\'s linked knowledge', async () => {
  const res = await post(lerato, '/wiki/api/v1/ai/chat/search', { message: 'How is slot capacity calculated?' });
  assert.equal(res.status, 200);
  answer = await res.json();
  assert.equal(answer.sources.length, 3);
  for (const n of [1, 2, 3]) assert.ok(answer.response.includes(`[${n}]`));
  assert.equal(answer.sources[0].title, 'Slot capacity model');
  assert.match(answer.response, /Capacity per slot is pickers on shift multiplied by picks per hour/);
  assert.match(answer.response, /^No model is configured here/);

  const before = (await spec()).knowledge.map((k) => k.id);
  assert.equal((await post(viewer, `${K}/answers/${answer.answerId}/link`, { itemId: 'PRD-031' })).status, 403);
  const linked = await post(lerato, `${K}/answers/${answer.answerId}/link`, { itemId: 'PRD-031' });
  assert.equal(linked.status, 200);
  const result = await linked.json();
  assert.equal(result.added, 3);
  const after = await spec();
  const ids = after.knowledge.map((k) => k.id);
  assert.ok(ids.includes('acme-space.runbooks.slot-capacity-model'));
  assert.equal(ids.length, before.length + result.added);
  const link = after.knowledge.find((k) => k.id === 'acme-space.runbooks.slot-capacity-model');
  assert.deepEqual([link.title, link.kindLabel, link.text, link.flagged], ['Slot capacity model', 'Runbook', 'Runbook · Acme Space', null]);
  assert.equal((await (await post(lerato, `${K}/answers/${answer.answerId}/link`, { itemId: 'PRD-031' })).json()).added, 0);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'knowledge.answer_linked' && r.actor === 'lerato-m' && r.itemId === 'PRD-031')));
});

test('step 3: This is wrong is recorded, the documents get a review flag, and the spec that links them says so', async () => {
  const res = await post(priya, `${K}/answers/${answer.answerId}/wrong`, { reason: 'It leaves out the van cap.' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).flags.length, 3);
  const review = (await priya.json(`${K}/needs-review`)).body;
  assert.equal(review.flags.length, 3);
  assert.deepEqual([review.flags.every((f) => f.reason === 'It leaves out the van cap.' && f.by === 'Priya S.'), review.canResolve], [true, false]);
  assert.deepEqual((await stevie.json('/api/v1/shell/status')).body.wiki.badges, { 'needs-review': 3 });
  // NooblyJS heard, and the Product Factory marked the links on PRD-031.
  await eventually(async () => {
    const events = await today(env.store, 'events');
    const flagged = events.find((e) => e.type === 'knowledge.answer_flagged');
    assert.deepEqual([flagged.actor, flagged.payload.answerId, flagged.payload.sourceIds.length], ['priya-s', answer.answerId, 3]);
    const link = (await spec()).knowledge.find((k) => k.id === 'acme-space.runbooks.slot-capacity-model');
    assert.equal(link.flagged?.reason, 'It leaves out the van cap.');
  });
  // An Approver reviews one; a Contributor may not.
  const flag = review.flags.find((f) => f.title === 'Slot capacity model');
  assert.equal((await post(priya, `${K}/needs-review/resolve`, { id: flag.id })).status, 403);
  assert.equal((await post(lerato, `${K}/needs-review/resolve`, { id: flag.id })).status, 200);
  assert.equal((await lerato.json(`${K}/needs-review`)).body.flags.length, 2);
});

test('step 4: Enterprise Space → L0 renders three bands from the imported files; Supply drills down; Used across NooblyJS lists PRD-031 and ADR-014', async () => {
  const get = async (p) => (await viewer.json(`${K}/process-model?spaceName=${encodeURIComponent('Enterprise Space')}&path=${encodeURIComponent(p)}`)).body.model;
  const l0 = await get('Business processes/L0 Enterprise Process Model.md');
  assert.deepEqual(l0.bands.map((b) => [b.name, b.processes.length]), [['Enterprise', 1], ['Value chain', 4], ['Support', 3]]);
  assert.deepEqual(l0.usedIn.map((u) => [u.id, u.href]), [['PRD-031', '/home/lifecycle/PRD-031'], ['ADR-014', '/factory/product/architecture/PRD-031']]);
  assert.ok(l0.usedIn.every((u) => typeof u.title === 'string' && u.title.length > 3), 'NooblyJS knows both by name');
  const supply = l0.bands[1].processes.find((p) => p.name === 'Supply');
  const l1 = await get(supply.path);
  assert.deepEqual(l1.children.map((c) => c.name), ['Plan store replenishment', 'Manage delivery capacity', 'Distribute to stores']);
  assert.deepEqual(l1.parents.map((p) => p.level), ['L0']);
});

test('step 6: Ada drafts for PRD-031; the draft carries the knowledge documents it was given, and they are on the spec', async () => {
  const knowledge = await env.noobly.hosted.apps.find((a) => a.name === 'wiki').services.contextFor({ itemId: 'PRD-031' });
  assert.ok(knowledge.length >= 1, 'Knowledge has documents for the item, found by its title');
  const before = (await spec()).knowledge.map((k) => k.id);
  const queued = await post(lerato, '/factory/product/api/v1/specs/PRD-031/drafts', { kind: 'rollout-plan' });
  assert.equal(queued.status, 202);
  const queuedBody = await queued.json();
  const draftId = queuedBody.draft?.id ?? queuedBody.id;
  let draft;
  await eventually(async () => {
    const got = (await lerato.json(`/factory/product/api/v1/drafts/${draftId}`)).body;
    draft = got.draft ?? got;
    assert.equal(draft.status, 'done');
  }, { ms: 20_000, every: 200 });
  assert.equal(draft.teammate.id, 'ada-quill');
  assert.deepEqual(draft.sources.map((s) => s.id), knowledge.map((k) => k.id));
  assert.ok(draft.sources.every((s) => s.title && s.href.startsWith('/wiki/#/')));
  assert.match(draft.text, new RegExp(` · from ${draft.sources.length} Knowledge source`));
  const after = (await spec()).knowledge.map((k) => k.id);
  for (const s of draft.sources) assert.ok(after.includes(s.id), `${s.id} is linked on the spec`);
  assert.equal(after.length, before.length + draft.sourcesLinked);
});
