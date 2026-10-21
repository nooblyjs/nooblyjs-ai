// The paths that only run when something goes wrong or is unusual: a partner app failing mid-call, a restart with
// jobs in flight, files people broke by hand, mistakes in the diagram code, and edits refused for good reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApp } from './helpers.js';
import { seed } from '../src/seed/index.js';
import { parseC4 } from '../src/services/c4.js';
import { staleDraft } from '../src/services/draft-kinds.js';
import { validator, invalid } from '../src/util/validate.js';
import { conflict, notFound } from '../src/util/errors.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const API = '/product/api/v1';

// ---------- a partner app failing mid-call ----------

test('the NooblyJS lifecycle engine failing a decision: its own refusal is passed on; a crash is a 502 and nothing changes', async () => {
  const refusing = { decide: async () => { throw Object.assign(new Error('Stevie is not a reviewer of PRD-031.'), { status: 422 }); } };
  const t = await startApp({ seed: true, services: { workflows: refusing } });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } });
    assert.equal(res.status, 422);
    assert.equal(res.json.error.message, 'Stevie is not a reviewer of PRD-031.');
  } finally {
    await t.close();
  }
  const crashing = { decide: async () => { throw new Error('socket hang up'); } };
  const t2 = await startApp({ seed: true, services: { workflows: crashing } });
  try {
    const res = await t2.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } });
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, 'workflows_failed');
    assert.ok(t2.serverManager.lines.some((l) => l.level === 'error' && l.message.includes('socket hang up')));
    assert.equal((await t2.get(`${API}/specs/PRD-031`, { as: 'stevie' })).json.status, 'in-review');
  } finally {
    await t2.close();
  }
});

test('the NooblyJS lifecycle engine failing a handoff: back to draft, so it can be sent again', async () => {
  let fail = true;
  const workflows = { handoff: async () => { if (fail) throw new Error('timeout'); return { ok: true }; } };
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} });
    assert.equal(res.status, 502);
    assert.equal((await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json.status, 'draft');
    fail = false;
    assert.equal((await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} })).status, 202);
    assert.equal((await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' })).json.status, 'requested');
  } finally {
    await t.close();
  }
});

test('a platform budget that errors falls back to budget.yaml', async () => {
  const platform = { budgetFor: async () => { throw new Error('platform down'); } };
  const t = await startApp({ seed: true, services: { platform } });
  try {
    const { spend } = (await t.get(`${API}/summary`, { as: 'lerato-m' })).json;
    assert.equal(spend.budgetUsd, 1500);
    assert.ok(t.serverManager.lines.some((l) => l.level === 'warn' && l.message.includes('platform down')));
  } finally {
    await t.close();
  }
});

// ---------- restart with jobs in flight ----------

test('at start, a queued draft runs and a running one is failed with a reason', async () => {
  const job = (id, status) => `---\nid: ${id}\nitemId: PRD-031\nstage: product\nkind: ${id === 'drf_waitingjob' ? 'rollout-plan' : 'goals'}\nlabel: x\nstatus: ${status}\nprogress: 0\nteammate: { id: ada-quill, name: Ada Quill, kind: agent }\nrequestedBy: lerato-m\nbaseVersion: 4\nworkType: spec-drafting\ncostUsd: 0\ncreatedAt: ${new Date().toISOString()}\n---\n`;
  const t = await startApp({
    before: async (dir) => {
      await seed(new FsStore(dir));
      await fs.writeFile(path.join(dir, 'drafts', 'drf_waitingjob.md'), job('drf_waitingjob', 'queued'));
      await fs.writeFile(path.join(dir, 'drafts', 'drf_cutshortjob.md'), job('drf_cutshortjob', 'running'));
    },
  });
  try {
    await t.hosted.idle();
    const waiting = (await t.get(`${API}/drafts/drf_waitingjob`, { as: 'lerato-m' })).json;
    assert.equal(waiting.status, 'done');
    assert.equal((await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json.readiness.text, '7 of 7');
    const cut = (await t.get(`${API}/drafts/drf_cutshortjob`, { as: 'lerato-m' })).json;
    assert.deepEqual([cut.status, cut.text], ['failed', 'Stopped when the engine restarted. Ask again.']);
    // The seeded sample job is left as it is.
    assert.equal((await t.get(`${API}/drafts/drf_prd032spec`, { as: 'lerato-m' })).json.status, 'running');
  } finally {
    await t.close();
  }
});

// ---------- files people broke by hand ----------

test('unreadable versions, studies and history are skipped with a warning', async () => {
  const t = await startApp({ seed: true });
  try {
    await fs.writeFile(path.join(t.dataDir, 'specs', 'PRD-031', 'versions', 'v9.md'), '---\nversion: [broken\n---\n');
    await fs.writeFile(path.join(t.dataDir, 'ux', 'PRD-031', 'research', 'broken.md'), '---\ntitle: [broken\n---\n');
    await fs.writeFile(path.join(t.dataDir, 'flow', 'history.yaml'), '---\nat: [broken\n');
    assert.equal((await t.get(`${API}/specs/PRD-031/versions`, { as: 'lerato-m' })).json.versions.length, 4);
    assert.equal((await t.get(`${API}/ux/PRD-031/research`, { as: 'lerato-m' })).json.studies.length, 2);
    assert.deepEqual((await t.get(`${API}/handoffs`, { as: 'lerato-m' })).json.handoffs, []);
    const warnings = t.serverManager.lines.filter((l) => l.level === 'warn').map((l) => l.message).join('\n');
    assert.match(warnings, /v9\.md/);
    assert.match(warnings, /broken\.md/);
    assert.match(warnings, /flow history unreadable/);
  } finally {
    await t.close();
  }
});

test('a spec with a status the engine doesn\'t know says that status rather than failing', async () => {
  const t = await startApp({ seed: true });
  try {
    const file = path.join(t.dataDir, 'specs', 'PRD-025.md');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('status: approved', 'status: parked'));
    assert.equal((await t.get(`${API}/specs/PRD-025`, { as: 'lerato-m' })).json.statusText, 'parked');
  } finally {
    await t.close();
  }
});

// ---------- diagram code ----------

test('C4 mistakes: no header, an unclosed quote, an unsupported element, a missing label', () => {
  assert.deepEqual(parseC4('Container(a, "A")').errors[0], { line: 1, message: 'The diagram starts with C4Container.' });
  assert.match(parseC4('C4Container\nContainer(a, "A)').errors[0].message, /quote is not closed/);
  assert.equal(parseC4('C4Container\nDeployment_Node(x, "X")').errors[0].message, "Deployment_Node(…) isn't supported here.");
  assert.equal(parseC4('C4Container\nContainer(a)').errors[0].message, 'a needs a label.');
  assert.equal(parseC4('C4Container\nContainer(a, "A")\nContainer(a, "B")').errors[0].message, 'a is defined twice.');
  assert.deepEqual(parseC4('').errors, [{ line: 1, message: 'The diagram is empty. Start with C4Container.' }]);
  assert.equal(parseC4('C4Container\n%% a comment\nContainer(a, "A")').errors.length, 0);
});

test('the standards check before there is a container view says so for every check', async () => {
  const t = await startApp({ seed: true });
  try {
    const s = (await t.get(`${API}/architecture/PRD-025/standards-check`, { as: 'thabo-n' })).json;
    assert.equal(s.text, 'Not checked yet');
    assert.ok(s.checks.every((c) => c.passed === null && c.text === 'No container view yet'));
  } finally {
    await t.close();
  }
});

test('Rhea\'s container view is not saved over a newer human edit', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const teammates = { runTask: async () => { await gate; return { output: { code: 'C4Container\nContainer(a, "A")' }, costUsd: 1, modelRoute: 'architecture-drafting' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    const asked = await t.post(`${API}/architecture/PRD-031/drafts`, { as: 'thabo-n', body: { kind: 'container-view' } });
    const d = await t.get(`${API}/architecture/PRD-031/diagram`, { as: 'thabo-n' });
    await t.put(`${API}/architecture/PRD-031/diagram`, { as: 'thabo-n', headers: { 'if-match': d.etag }, body: { code: d.json.code.replace('"Slot API"', '"Slots"') } });
    release();
    await t.hosted.idle();
    const job = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'thabo-n' })).json;
    assert.equal(job.status, 'failed');
    assert.match(job.text, /container view changed while the agent was drafting/);
    assert.ok((await t.get(`${API}/architecture/PRD-031/diagram`, { as: 'thabo-n' })).json.nodes.some((n) => n.label === 'Slots'));
  } finally {
    release();
    await t.close();
  }
});

// ---------- UX and UI edits ----------

test('UX research and questions are replaced as lists; a quick test stays linked to its question', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'quick-test', questionId: 'hold-timer-everywhere' } });
    await t.hosted.idle();
    const studies = await t.put(`${API}/ux/PRD-031/research`, {
      as: 'lerato-m', body: { studies: [{ id: 'usability-slot-picker', kind: 'usability', title: 'Usability test · 8 people', participants: 8, headline: '7 of 8', finding: 'Same as before.' }] },
    });
    assert.equal(studies.status, 200);
    assert.deepEqual(studies.json.studies.map((s) => s.id), ['usability-slot-picker']);
    assert.equal((await t.put(`${API}/ux/PRD-031/research`, { as: 'lerato-m', body: { studies: [{ title: 'x', kind: 'astrology' }] } })).status, 422);
    assert.equal((await t.put(`${API}/ux/PRD-031/research`, { as: 'lerato-m', body: {} })).status, 422);

    const q = await t.get(`${API}/ux/PRD-031/questions`, { as: 'lerato-m' });
    const saved = await t.put(`${API}/ux/PRD-031/questions`, {
      as: 'lerato-m', headers: { 'if-match': q.etag },
      body: { questions: [{ id: 'hold-timer-everywhere', text: 'Should the hold timer be visible on every screen?', status: 'answered', answer: 'Only on the basket and checkout.' }, { text: 'Do store managers need a phone view?' }] },
    });
    assert.equal(saved.status, 200);
    assert.ok(saved.json.questions[0].quickTest, 'the quick test stays linked');
    assert.equal(saved.json.questions[1].id, 'do-store-managers-need-a-phone-view');
    const answered = await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'quick-test', questionId: 'hold-timer-everywhere' } });
    assert.equal(answered.status, 409);
  } finally {
    await t.close();
  }
});

test('journey and flow fields are checked', async () => {
  const t = await startApp({ seed: true });
  try {
    const j = await t.get(`${API}/ux/PRD-031/journey`, { as: 'lerato-m' });
    const bad = await t.put(`${API}/ux/PRD-031/journey`, { as: 'lerato-m', headers: { 'if-match': j.etag }, body: { steps: [{ name: 'Plan', outOfScope: 'somewhere else' }, { doing: 'x' }] } });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.json.error.details), ['steps[0]', 'steps[1]']);
    const flow = await t.put(`${API}/ux/PRD-031/flows/Bad Id`, { as: 'lerato-m', headers: { 'if-match': '"x"' }, body: { title: 'x' } });
    assert.equal(flow.status, 422);
    const nodes = await t.put(`${API}/ux/PRD-031/flows/new-flow`, { as: 'lerato-m', headers: { 'if-match': '"PRD-031.flow.new-flow@0"' }, body: { title: 'New', nodes: [{ id: 'a', kind: 'popup', label: 'A' }] } });
    assert.equal(nodes.status, 422);
  } finally {
    await t.close();
  }
});

test('the handoff plan is edited with If-Match, checked, and frozen once sent', async () => {
  const workflows = { handoff: async () => ({ ok: true }) };
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    const overview = (await t.get(`${API}/ui/PRD-031`, { as: 'lerato-m' })).json;
    assert.deepEqual([overview.canvasUrl, overview.lead], [null, 'Four screens for the slot flow, built from the design system and ready to hand off.']);
    const h = await t.get(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m' });
    const plan = await t.put(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m', headers: { 'if-match': h.etag }, body: { workItems: [{ repo: 'slots-api', title: 'All of it' }] } });
    assert.equal(plan.status, 200);
    assert.equal(plan.json.text, 'Estimated $3–$4 · 1 repo');
    assert.equal((await t.put(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m', headers: { 'if-match': plan.etag }, body: { workItems: [{ repo: 'Not A Repo!', title: 'x' }] } })).status, 422);
    await t.post(`${API}/ui/PRD-031/handoff`, { as: 'lerato-m', body: {} });
    const frozen = await t.put(`${API}/ui/PRD-031/handoff-preview`, { as: 'lerato-m', headers: { 'if-match': '"PRD-031.handoff@3"' }, body: { workItems: [] } });
    assert.equal(frozen.status, 409);
    assert.equal(frozen.json.error.code, 'already_sent');
    assert.equal((await t.post(`${API}/ui/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'handoff-plan' } })).status, 409);
  } finally {
    await t.close();
  }
});

test('the acceptance-criteria draft turns free-text criteria into given / when / then', async () => {
  const t = await startApp({ seed: true });
  try {
    const before = (await t.get(`${API}/specs/PRD-029`, { as: 'lerato-m' })).json;
    await t.put(`${API}/specs/PRD-029`, { as: 'lerato-m', headers: { 'if-match': `"PRD-029@${before.version}"` }, body: { acceptanceCriteria: [{ text: 'Keyboard users can pay.' }] } });
    await t.post(`${API}/specs/PRD-029/drafts`, { as: 'lerato-m', body: { kind: 'acceptance-criteria' } });
    await t.hosted.idle();
    const spec = (await t.get(`${API}/specs/PRD-029`, { as: 'lerato-m' })).json;
    assert.equal(spec.acceptanceCriteria[0].when, 'Keyboard users can pay.');
    assert.match(spec.acceptanceCriteria[0].given, /\[PLACEHOLDER/);
  } finally {
    await t.close();
  }
});

// ---------- small units ----------

test('staleDraft turns only a version conflict into stale_draft', () => {
  assert.equal(staleDraft('PRD-031', conflict('x')).code, 'stale_draft');
  const other = notFound('gone');
  assert.equal(staleDraft('PRD-031', other), other);
});

test('validator lists: not a list, and too many items', () => {
  assert.throws(() => validator({ tags: 'a' }).list('tags', (v) => v).result(), (err) => err.details.tags === 'tags must be a list');
  assert.throws(() => validator({ tags: [1, 2, 3] }).list('tags', (v) => v, { max: 2 }).result(), (err) => err.details.tags === 'tags can have at most 2 items');
  assert.throws(() => validator({ tags: ['', 'ok'] }).list('tags', (v) => (v ? v : invalid('empty'))).result(), (err) => err.details['tags[0]'] === 'empty');
});
