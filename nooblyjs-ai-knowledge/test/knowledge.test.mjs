// NooblyJS Phase 8: Knowledge on top of the wiki (src/wiki/knowledge, routes/knowledgeRoutes.js), on a real nooblyjs-core
// registry the way NooblyJS hands it over. No AI agent is configured, so answers are the sources' own passages.
// One registry per process, so this file starts the app once and the tests run in order on one data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express5';
import { register } from '../index.mjs';
import { createHost, PERSON_HEADER } from './fixtures/host.mjs';

const require = createRequire(import.meta.url);
const registry = require('nooblyjs-core');
const { parseBlock, modelFor } = require('../src/wiki/knowledge/processModel.js');
const { bestPassage, knowledgeId, linkFor, kindOf } = require('../src/wiki/knowledge/answers.js');

const API = '/wiki/api/v1/knowledge';
let t;
const linked = []; // what the stand-in Product Factory was asked to link
const guardrails = { 'redact-on-ingest': true }; // the stand-in NooblyJS Platform's guardrails

before(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nooblyjs-ai-knowledge-k-'));
  const dataDir = path.join(rootDir, 'wiki');
  await fs.mkdir(dataDir, { recursive: true });
  const app = express();
  app.set('query parser', 'extended');
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    const id = req.get(PERSON_HEADER);
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id, username: id, email: `${id}@noobly.local`, name: id, roles: id === 'stevie' ? ['admin'] : ['user'], isAdmin: id === 'stevie', isActive: true };
    next();
  });
  registry.setDefaultProvider('logging', 'console', { logDir: path.join(rootDir, 'logs'), log: { level: 'error' } });
  registry.initialize(app, new EventEmitter(), {
    logDir: path.join(rootDir, 'logs'),
    dataDir: path.join(rootDir, 'core'),
    security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } },
  });
  registry.authservice('file', { dataDir: path.join(rootDir, 'core', 'auth') });
  const stand = createHost({
    rootDir,
    services: {
      product: {
        artefactsFor: async (itemId) => (itemId === 'PRD-031' ? { title: 'Same-day delivery slots' } : null),
        linkKnowledge: async ({ itemId, links, actor }) => {
          if (itemId !== 'PRD-031') throw Object.assign(new Error(`There is no spec ${itemId}.`), { status: 404 });
          const fresh = links.filter((l) => !linked.some((k) => k.id === l.id));
          linked.push(...fresh.map((l) => ({ ...l, by: actor.id })));
          return { added: fresh.length, links: linked };
        },
        adrFor: async (id) => (id === 'ADR-014' ? { id, title: 'Cache slot capacity in Redis', href: '/product/architecture/PRD-031' } : null),
      },
      workflows: { item: async ({ itemId }) => (itemId === 'PRD-031' ? { id: itemId, title: 'Same-day delivery slots' } : null) },
      platform: { guardrail: async (key) => (key in guardrails ? { key, on: guardrails[key] } : null) },
    },
  });
  const hosted = await register(app, registry, { dataDir, host: stand.hostFor(dataDir) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { as = 'stevie', body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(as ? { [PERSON_HEADER]: as } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const ask = (message, as = 'lerato-m') => call('POST', '/wiki/api/v1/ai/chat/search', { as, body: { message } });
  t = { rootDir, dataDir, hosted, stand, server, call, ask };
});

after(async () => {
  await t?.hosted.close();
  await new Promise((resolve) => t.server.close(resolve));
});

test('the process-model block and the model around a page (pure)', () => {
  const page = (p, fields) => ({ path: p, markdown: `# x\n\n\`\`\`process-model\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\`\n` });
  assert.equal(parseBlock('# no block'), null);
  assert.equal(parseBlock('```process-model\nlevel: L9\n```'), null, 'an unknown level is not a model page');
  assert.deepEqual(parseBlock(page('a.md', { level: 'l1', code: 'VC-02', name: 'Supply', band: 'value CHAIN', parent: './BP/L0.md', order: 2, 'linked-items': 'PRD-031, nope, ADR-014' }).markdown),
    { level: 'L1', code: 'VC-02', name: 'Supply', band: 'Value chain', parent: 'BP/L0.md', order: 2, linkedItems: ['PRD-031', 'ADR-014'] });
  const pages = [
    page('BP/L0.md', { level: 'L0', name: 'Model' }),
    page('BP/L1/Sell.md', { level: 'L1', name: 'Sell', band: 'Value chain', parent: 'BP/L0.md', order: 2 }),
    page('BP/L1/Supply.md', { level: 'L1', name: 'Supply', band: 'Value chain', parent: 'BP/L0.md', order: 1 }),
    page('BP/L1/HR.md', { level: 'L1', name: 'HR', band: 'Support', parent: 'BP/L0.md', order: 1 }),
    page('BP/L2/Capacity.md', { level: 'L2', name: 'Capacity', band: 'Value chain', parent: 'BP/L1/Supply.md', order: 1 }),
    page('BP/loop-a.md', { level: 'L2', name: 'A', parent: 'BP/loop-b.md' }),
    page('BP/loop-b.md', { level: 'L2', name: 'B', parent: 'BP/loop-a.md' }),
    { path: 'BP/notes.md', markdown: '# not a model page' },
  ];
  const l0 = modelFor(pages, 'BP/L0.md');
  assert.deepEqual(l0.bands.map((b) => [b.name, b.processes.map((p) => [p.name, p.children])]), [['Enterprise', []], ['Value chain', [['Supply', 1], ['Sell', 0]]], ['Support', [['HR', 0]]]]);
  const l2 = modelFor(pages, 'BP/L2/Capacity.md');
  assert.deepEqual([l2.parents.map((p) => p.name), l2.children, l2.bands], [['Model', 'Supply'], [], null]);
  assert.deepEqual(modelFor(pages, 'BP/loop-a.md').parents.map((p) => p.name), ['B'], 'a loop in the data stops the walk');
  assert.equal(modelFor(pages, 'BP/notes.md'), null);
});

test('a passage is the sentences that share words with the question; a source becomes a link a spec can keep (pure)', () => {
  const doc = '# Title\n\nType: Runbook · Owner: x\n\nBananas are yellow. Capacity per slot is pickers times picks per hour. Apples are red.\n\n```\ncode: slot capacity\n```\n';
  assert.equal(bestPassage('How is slot capacity calculated?', doc), 'Capacity per slot is pickers times picks per hour.');
  assert.equal(knowledgeId('Acme Space', 'Runbooks/Slot capacity model.md'), 'acme-space.runbooks.slot-capacity-model');
  assert.match(knowledgeId('S', `${'x'.repeat(200)}.md`), /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/);
  assert.deepEqual(['Runbooks/a.md', 'Decisions/b.md', 'Customer insights/c.md', 'Other/d.md'].map(kindOf), ['runbook', 'adr', 'customer-insight', 'doc']);
  assert.deepEqual(linkFor({ spaceName: 'Acme Space', path: 'Decisions/ADR-013 Event-driven slot release.md', title: 'ADR-013 · Event-driven slot release' }),
    { id: 'ADR-013', title: 'Event-driven slot release', kind: 'adr', detail: 'Acme Space' });
});

test('step 1: the seed imports the sample export once; Sources shows its state and counts; only an Owner imports', async () => {
  await t.hosted.seed();
  const first = (await t.call('GET', `${API}/sources`)).json;
  assert.equal(first.sources.length, 1);
  const [source] = first.sources;
  assert.deepEqual([source.id, source.name, source.state, source.kind, source.from], ['sample-wiki-export', 'Sample wiki export', 'Imported', 'folder', 'sample-export']);
  assert.deepEqual(source.spaces.map((s) => [s.name, s.documents]), [['Acme Space', 5], ['Enterprise Space', 13]]);
  assert.equal(source.documents, 18);
  assert.deepEqual([first.canImport, first.status.sources, first.status.documents, first.status.needsReview], [true, 1, 18, 0]);
  await t.hosted.seed();
  assert.equal((await t.call('GET', `${API}/sources`)).json.sources[0].lastRunAt, source.lastRunAt, 'the seed imports once');

  // The spaces are the wiki's own: the sample pages are there to browse.
  const spaces = (await t.call('GET', '/wiki/api/v1/spaces')).json;
  const names = (Array.isArray(spaces) ? spaces : spaces.spaces ?? spaces.data ?? []).map((s) => s.name);
  for (const name of ['Enterprise Space', 'Acme Space']) assert.ok(names.includes(name), `${name} is a wiki space`);

  // Import again: an Owner may; it updates the same source and makes no second space.
  for (const who of ['lerato-m', 'priya-s', 'naledi-k', 'ada-quill']) assert.equal((await t.call('POST', `${API}/import`, { as: who, body: {} })).status, 403, who);
  assert.ok(t.stand.auditLog.some((r) => r.action === 'access.refused' && r.actor === 'lerato-m' && r.permission === 'change-repo-access'));
  assert.equal((await t.call('POST', `${API}/import`, { as: null, body: {} })).status, 401);
  const again = await t.call('POST', `${API}/import`, { body: {} });
  assert.deepEqual([again.status, again.json.source.documents, again.json.source.spaces.map((s) => s.created)], [200, 18, [false, false]]);
  assert.equal((await t.call('GET', `${API}/sources`)).json.sources.length, 1);
  assert.ok(t.stand.auditLog.some((r) => r.action === 'knowledge.imported' && r.actor === 'stevie' && r.documents === 18));
  // A path is never taken from the request.
  for (const name of ['../../etc', 'C:\\Windows', '/tmp/x']) assert.equal((await t.call('POST', `${API}/import`, { body: { name } })).status, 400, name);
  assert.equal((await t.call('POST', `${API}/import`, { body: { name: 'not-there' } })).status, 422);
});

test('step 5: personal data in an imported document is redacted before it is stored', async () => {
  const source = (await t.call('GET', `${API}/sources`)).json.sources[0];
  assert.deepEqual(source.redacted, { id: 1, email: 1, phone: 1 });
  const files = (await fs.readdir(t.dataDir, { recursive: true })).map(String).filter((f) => f.endsWith('September support themes.md'));
  assert.equal(files.length, 1);
  const stored = await fs.readFile(path.join(t.dataDir, files[0]), 'utf8');
  assert.match(stored, /Please phone me on \[REDACTED PHONE\] or\n> email \[REDACTED EMAIL\]\. My ID number is \[REDACTED ID\]/);
  // Not anywhere under the wiki's data folder: not in the file, the index or the records.
  for (const file of (await fs.readdir(t.dataDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile())) {
    const text = await fs.readFile(path.join(file.parentPath ?? file.path, file.name), 'utf8').catch(() => '');
    for (const secret of ['082 555 0142', 'thandi.m@example.co.za', '8001015009087']) assert.ok(!text.includes(secret), `${secret} in ${file.name}`);
  }
  // An operator's own export folder goes through the same step.
  const drop = path.join(t.dataDir, 'imports', 'ops-export', 'Ops Space');
  await fs.mkdir(drop, { recursive: true });
  await fs.writeFile(path.join(drop, 'Contact.md'), '# Contact\n\nThe duty manager is on +27 21 555 0199 and duty@example.org.\n');
  const res = await t.call('POST', `${API}/import`, { body: { name: 'ops-export' } });
  assert.deepEqual([res.status, res.json.source.id, res.json.source.redacted, res.json.source.spaces], [200, 'ops-export', { id: 0, email: 1, phone: 1 }, [{ name: 'Ops Space', documents: 1, created: true }]]);
  const page = await fs.readFile(path.join(t.dataDir, 'spaces', 'ops-space', 'files', 'Contact.md'), 'utf8');
  assert.equal(page, '# Contact\n\nThe duty manager is on [REDACTED PHONE] and [REDACTED EMAIL].\n');
});

let answer;
test('step 2: with no model, "How is slot capacity calculated?" is answered from three sources, cited by number, and kept', async () => {
  const status = (await t.call('GET', '/wiki/api/v1/ai/chat/status')).json;
  assert.deepEqual([status.configured, status.searchWithoutModel], [false, true]);
  const res = await t.ask('How is slot capacity calculated?');
  assert.equal(res.status, 200, res.text);
  answer = res.json;
  assert.equal(answer.sources.length, 3);
  assert.deepEqual(answer.sources.map((s) => s.index), [1, 2, 3]);
  assert.ok(answer.sources.every((s) => s.spaceName && s.title && s.path.endsWith('.md')));
  assert.deepEqual([answer.sources[0].spaceName, answer.sources[0].title], ['Acme Space', 'Slot capacity model']);
  assert.match(answer.response, /^No model is configured here, so this is what the sources say, not a written answer\./);
  assert.match(answer.response, /Capacity per slot is pickers on shift multiplied by picks per hour, divided by the average basket size.* \[1\]/);
  for (const n of [1, 2, 3]) assert.ok(answer.response.includes(`[${n}]`), `cites [${n}]`);
  assert.deepEqual([answer.model, answer.provider], [null, null]);
  assert.match(answer.answerId, /^ans_[0-9a-f]{12}$/);
  // It is in the person's chat history like any other answer, with its id.
  const history = (await t.call('GET', '/wiki/api/v1/ai/chat/history', { as: 'lerato-m' })).json;
  const last = (history.history ?? history.messages ?? history.data ?? []).at(-1);
  assert.equal(last.context.answerId, answer.answerId);
  // A question nothing matches says so, and keeps nothing.
  const none = (await t.ask('zzqqxx vvwwyy')).json;
  assert.deepEqual([none.sources, none.answerId, none.response], [[], null, 'Nothing in the wiki matches that question.']);
  assert.equal((await t.ask('anything', null)).status, 401);
});

test('step 2: Add to PRD-031 links the answer\'s sources to the spec, once; a Viewer and an agent are refused', async () => {
  const url = `${API}/answers/${answer.answerId}/link`;
  for (const who of ['naledi-k', 'ada-quill']) assert.equal((await t.call('POST', url, { as: who, body: { itemId: 'PRD-031' } })).status, 403, who);
  assert.ok(t.stand.auditLog.some((r) => r.action === 'access.refused' && r.actor === 'ada-quill' && /Agents propose/.test(r.reason)));
  assert.equal(linked.length, 0);
  const res = await t.call('POST', url, { as: 'lerato-m', body: { itemId: 'prd-031' } });
  assert.deepEqual([res.status, res.json.itemId, res.json.added], [200, 'PRD-031', 3], res.text);
  assert.deepEqual(linked[0], { id: 'acme-space.runbooks.slot-capacity-model', title: 'Slot capacity model', kind: 'runbook', detail: 'Acme Space', by: 'lerato-m' });
  assert.ok(linked.every((l) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(l.id)));
  assert.equal((await t.call('POST', url, { as: 'lerato-m', body: { itemId: 'PRD-031' } })).json.added, 0, 'nothing is linked twice');
  assert.ok(t.stand.auditLog.some((r) => r.action === 'knowledge.answer_linked' && r.actor === 'lerato-m' && r.itemId === 'PRD-031'));
  assert.equal((await t.call('POST', url, { as: 'lerato-m', body: { itemId: 'not an id' } })).status, 400);
  assert.equal((await t.call('POST', url, { as: 'lerato-m', body: { itemId: 'PRD-999' } })).status, 404, 'the Product Factory\'s own refusal');
  assert.equal((await t.call('POST', `${API}/answers/ans_000000000000/link`, { as: 'lerato-m', body: { itemId: 'PRD-031' } })).status, 404);
});

test('Save as page writes the answer with its sources into a space, where search finds it', async () => {
  const url = `${API}/answers/${answer.answerId}/save`;
  assert.equal((await t.call('POST', url, { as: 'naledi-k', body: { spaceName: 'Acme Space' } })).status, 403);
  assert.equal((await t.call('POST', url, { as: 'priya-s', body: {} })).status, 400);
  assert.equal((await t.call('POST', url, { as: 'priya-s', body: { spaceName: 'No Such Space' } })).status, 403);
  const res = await t.call('POST', url, { as: 'priya-s', body: { spaceName: 'Acme Space', title: 'How slot capacity is worked out: a/b?' } });
  assert.deepEqual([res.status, res.json.path], [200, 'Answers/How slot capacity is worked out a b.md'], res.text);
  assert.equal(res.json.href, '/wiki/#/Acme%20Space/Answers/How%20slot%20capacity%20is%20worked%20out%20a%20b.md');
  const page = await fs.readFile(path.join(t.dataDir, 'spaces', 'acme-space', 'files', 'Answers', 'How slot capacity is worked out a b.md'), 'utf8');
  assert.match(page, /^# How slot capacity is worked out a b\n\n> Saved from an answer by Priya S\. on \d{4}-\d{2}-\d{2}\./);
  assert.match(page, /## Question\n\nHow is slot capacity calculated\?/);
  assert.match(page, /## Sources\n\n1\. Slot capacity model \(Acme Space · Runbooks\/Slot capacity model\.md\)/);
});

test('step 3: This is wrong is recorded, flags each cited document for review and tells NooblyJS; an Approver clears a flag', async () => {
  const url = `${API}/answers/${answer.answerId}/wrong`;
  for (const who of ['naledi-k', 'ada-quill']) assert.equal((await t.call('POST', url, { as: who, body: { reason: 'x' } })).status, 403, who);
  assert.deepEqual((await t.call('GET', `${API}/needs-review`, { as: 'naledi-k' })).json.flags, []);
  const res = await t.call('POST', url, { as: 'priya-s', body: { reason: 'The van cap is missing from this.' } });
  assert.deepEqual([res.status, res.json.flags.length], [200, 3], res.text);
  const event = t.stand.eventLog.find((e) => e.type === 'knowledge.answer_flagged');
  assert.deepEqual([event.actor, event.payload.answerId, event.payload.reason, event.payload.sourceIds.length, event.payload.sourceIds[0]],
    ['priya-s', answer.answerId, 'The van cap is missing from this.', 3, 'acme-space.runbooks.slot-capacity-model']);
  assert.ok(event.payload.sourceIds.every((id) => linked.some((l) => l.id === id)), 'the ids a spec was given are the ids that are flagged');

  const review = (await t.call('GET', `${API}/needs-review`, { as: 'priya-s' })).json;
  assert.deepEqual([review.flags.length, review.canResolve], [3, false]);
  const flag = review.flags.find((f) => f.title === 'Slot capacity model');
  assert.deepEqual([flag.spaceName, flag.path, flag.reason, flag.by, flag.status, flag.reports, flag.href],
    ['Acme Space', 'Runbooks/Slot capacity model.md', 'The van cap is missing from this.', 'Priya S.', 'open', 1, '/wiki/#/Acme%20Space/Runbooks/Slot%20capacity%20model.md']);
  assert.deepEqual((await t.hosted.status()).badges, { 'needs-review': 3 });
  // A second report of the same page adds to its flag instead of making another.
  await t.call('POST', url, { as: 'lerato-m', body: {} });
  const twice = (await t.call('GET', `${API}/needs-review`, { as: 'lerato-m' })).json;
  assert.deepEqual([twice.flags.length, twice.flags[0].reports, twice.canResolve], [3, 2, true]);

  assert.equal((await t.call('POST', `${API}/needs-review/resolve`, { as: 'priya-s', body: { id: flag.id } })).status, 403);
  const done = await t.call('POST', `${API}/needs-review/resolve`, { as: 'lerato-m', body: { id: flag.id } });
  assert.deepEqual([done.status, done.json.flag.status, done.json.flag.reviewedBy], [200, 'reviewed', 'Lerato M.']);
  assert.equal((await t.call('POST', `${API}/needs-review/resolve`, { as: 'lerato-m', body: { id: flag.id } })).status, 404);
  assert.equal((await t.call('GET', `${API}/needs-review`)).json.flags.length, 2);
  assert.ok(t.stand.auditLog.some((r) => r.action === 'knowledge.flag_reviewed' && r.actor === 'lerato-m'));
});

test('step 4: the L0 model renders from the imported pages: three bands, Supply drills down, Used across NooblyJS', async () => {
  const get = (p) => t.call('GET', `${API}/process-model?spaceName=${encodeURIComponent('Enterprise Space')}&path=${encodeURIComponent(p)}`, { as: 'naledi-k' });
  const l0 = (await get('Business processes/L0 Enterprise Process Model.md')).json.model;
  assert.deepEqual(l0.bands.map((b) => [b.name, b.processes.map((p) => p.name)]), [
    ['Enterprise', ['Enterprise Management']],
    ['Value chain', ['Plan and Source', 'Supply', 'Sell', 'Serve Customers']],
    ['Support', ['Develop and Manage Human Capital', 'Manage Financial Resources', 'Manage Information Technology']],
  ]);
  assert.deepEqual(l0.usedIn, [
    { id: 'PRD-031', title: 'Same-day delivery slots', href: '/home/lifecycle/PRD-031' },
    { id: 'ADR-014', title: 'Cache slot capacity in Redis', href: '/product/architecture/PRD-031' },
  ]);
  const supply = l0.bands[1].processes.find((p) => p.name === 'Supply');
  assert.deepEqual([supply.level, supply.code, supply.children, supply.href], ['L1', '[PLACEHOLDER VC-02]', 3, '/wiki/#/Enterprise%20Space/Business%20processes/L1/Supply.md']);

  const l1 = (await get(supply.path)).json.model;
  assert.deepEqual([l1.page.name, l1.parents.map((p) => p.name), l1.children.map((c) => c.name), l1.bands],
    ['Supply', ['Enterprise Process Model'], ['Plan store replenishment', 'Manage delivery capacity', 'Distribute to stores'], null]);
  const l2 = (await get(l1.children[1].path)).json.model;
  assert.deepEqual([l2.parents.map((p) => p.name), l2.usedIn.map((u) => u.id)], [['Enterprise Process Model', 'Supply'], ['PRD-031']]);

  assert.equal((await get('Standards/Integration standard v2.md')).status, 404, 'a page with no block is not a model page');
  assert.equal((await get('../../secrets.md')).status, 400);
  assert.equal((await t.call('GET', `${API}/process-model?spaceName=Enterprise%20Space&path=x.md`, { as: null })).status, 401);
});

test('step 6: other apps get knowledge for an item, with a passage and a link to each page, and nothing private', async () => {
  const { services, provides } = t.hosted;
  assert.deepEqual(provides, ['knowledge']);
  const byQuery = await services.contextFor({ query: 'How is slot capacity calculated?' });
  assert.equal(byQuery.length, 3);
  assert.deepEqual(Object.keys(byQuery[0]).sort(), ['detail', 'href', 'id', 'kind', 'passage', 'path', 'space', 'title']);
  assert.deepEqual([byQuery[0].id, byQuery[0].kind, byQuery[0].href], ['acme-space.runbooks.slot-capacity-model', 'runbook', '/wiki/#/Acme%20Space/Runbooks/Slot%20capacity%20model.md']);
  assert.match(byQuery[0].passage, /Capacity per slot/);
  // With only an item, the question is the item's title.
  const byItem = await services.contextFor({ itemId: 'PRD-031' });
  assert.ok(byItem.length >= 1 && byItem.length <= 3);
  assert.deepEqual(await services.contextFor({ itemId: 'PRD-999' }), []);
  assert.deepEqual(await services.contextFor({}), []);
  assert.ok((await services.search('slot capacity', { limit: 2 })).length === 2);
  assert.equal((await services.flagged()).length, 2);
  const status = await services.status();
  assert.deepEqual([status.sources, status.needsReview], [2, 2]);
});

test('NooblyJS Architecture · Knowledge: find files and folders, locate one, and read linked knowledge as context', async () => {
  const { services } = t.hosted;
  const found = await services.find('standards');
  assert.deepEqual(found.folders.map((f) => [f.space, f.path, f.title]), [['Enterprise Space', 'Standards', 'Standards']]);
  assert.equal(found.folders[0].href, '/wiki/#/Enterprise%20Space/Standards');
  assert.ok(found.folders[0].documents >= 1);
  const supply = await services.find('supply');
  assert.ok(supply.folders.some((f) => f.path === 'Business processes/L2/Supply'), JSON.stringify(supply.folders));
  assert.ok(supply.files.some((f) => f.kind === 'file' && f.space === 'Enterprise Space'));
  assert.deepEqual(await services.find('x'), { files: [], folders: [] });

  const file = await services.locate({ kind: 'file', space: 'Enterprise Space', path: 'Standards/Integration standard v2.md' });
  assert.deepEqual([file.kind, file.space, file.href], ['file', 'Enterprise Space', '/wiki/#/Enterprise%20Space/Standards/Integration%20standard%20v2.md']);
  assert.equal((await services.locate({ kind: 'folder', space: 'Enterprise Space', path: 'Standards' })).title, 'Standards');
  assert.equal(await services.locate({ kind: 'folder', space: 'Enterprise Space', path: 'Nowhere' }), null);
  assert.equal(await services.locate({ kind: 'file', space: 'Enterprise Space', path: '../secrets.md' }), null);

  const context = await services.contextOf([
    { kind: 'file', space: 'Enterprise Space', path: 'Standards/Integration standard v2.md', note: 'Data relating to application standard' },
    { kind: 'folder', space: 'Enterprise Space', path: 'Business processes/L2/Supply' },
    { kind: 'file', space: 'Enterprise Space', path: 'Standards/Gone.md' },
  ]);
  assert.deepEqual(context.map((c) => [c.kind, c.readable]), [['file', true], ['folder', true], ['file', false]]);
  assert.equal(context[0].note, 'Data relating to application standard');
  assert.ok(context[0].text.length > 50);
  assert.match(context[1].text, /^Documents in this folder: Business processes\/L2\/Supply\//);
  const small = await services.contextOf([{ kind: 'file', space: 'Enterprise Space', path: 'Standards/Integration standard v2.md' }], { maxChars: 1000 });
  assert.ok(small[0].text.length <= 1000);
});

test('NooblyJS Phase 9: with Platform\'s "Redact personal data on ingest" off, an import is stored as it is, and its source says so', async () => {
  const drop = path.join(t.dataDir, 'imports', 'contacts-export', 'Contacts Space');
  await fs.mkdir(drop, { recursive: true });
  await fs.writeFile(path.join(drop, 'Duty.md'), '# Duty\n\nCall +27 21 555 0199.\n');
  guardrails['redact-on-ingest'] = false;
  try {
    const res = await t.call('POST', `${API}/import`, { body: { name: 'contacts-export' } });
    assert.deepEqual([res.status, res.json.source.redaction, res.json.source.redacted], [200, 'off', { id: 0, email: 0, phone: 0 }]);
    assert.equal(await fs.readFile(path.join(t.dataDir, 'spaces', 'contacts-space', 'files', 'Duty.md'), 'utf8'), '# Duty\n\nCall +27 21 555 0199.\n');
  } finally {
    guardrails['redact-on-ingest'] = true;
  }
  const again = await t.call('POST', `${API}/import`, { body: { name: 'contacts-export' } });
  assert.deepEqual([again.json.source.redaction, again.json.source.redacted.phone], ['on', 1]);
});
