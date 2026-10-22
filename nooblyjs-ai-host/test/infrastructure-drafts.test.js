// Phase 26 in the real app (root roadmap Phase 26, steps 1–3): Ines Tau is hired in Digital Teammates; Thabo asks her
// for a new draft of INF-031, which she drafts from PRD-031's architecture (Product's designInputs) as her teammate task:
// version 3, waiting for its approvals, version 2 kept, her work and its cost on her timesheet and in Activity. Accepting
// ADR-014 offers a new draft without drafting one. An agent can't ask. Product, Design, Teammates and Infrastructure
// are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let thabo;
let naledi;
let stevie;
const infra = '/infrastructure/api/v1';

before(async () => {
  process.env.INFRA_MOCK_STEP_MS = '0';
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
    ],
  });
  [thabo, naledi, stevie] = [env.client(), env.client(), env.client()];
  await thabo.signIn('thabo-n');
  await stevie.signIn('stevie');
  await naledi.signIn('naledi-k');
});
after(async () => {
  await env?.stop();
  delete process.env.INFRA_MOCK_STEP_MS;
});

test('Ines Tau is hired in Teammates', async () => {
  const { teammates } = (await naledi.json('/teammates/api/v1/teammates')).body;
  const ines = teammates.find((t) => t.id === 'ines-tau');
  assert.ok(ines, teammates.map((t) => t.id).join(', '));
  assert.equal(ines.role, 'Infrastructure agent');
});

test('step 2: accepting ADR-014 offers a new draft of INF-031, saying why; nothing drafts by itself', async () => {
  const decided = await thabo.request('/workflows/api/v1/approvals/apr_adr014/decision', { method: 'POST', json: { decision: 'approve' } });
  assert.equal(decided.status, 200, await decided.clone().text());
  const d = await eventually(async () => {
    const x = (await naledi.json(`${infra}/designs/INF-031`)).body;
    assert.ok(x.redraft, JSON.stringify(x.redraft));
    return x;
  });
  assert.match(d.redraft.text, /^A new draft is suggested: ADR-014 was accepted/);
  assert.equal(d.version, 2);
});

test('step 1: Thabo asks Ines for a new draft: v3 from the architecture, waiting for approvals, v2 kept, her task and cost recorded', async () => {
  const res = await thabo.request(`${infra}/designs/INF-031/drafts`, { method: 'POST', json: {} });
  assert.equal(res.status, 201, await res.clone().text());
  const r = await res.json();
  assert.deepEqual([r.version, r.draftedBy.id], [3, 'ines-tau']);
  const d = (await naledi.json(`${infra}/designs/INF-031`)).body;
  assert.deepEqual([d.version, d.status, d.draftedBy.name, d.redraft], [3, 'waiting-approval', 'Ines Tau', null]);
  const versions = (await naledi.json(`${infra}/designs/INF-031/versions`)).body.versions.map((v) => v.version);
  assert.ok(versions.includes(2) && versions.includes(3), versions.join(', '));
  // Her teammate task (scripted, no model here) is on her timesheet with its work type, and Activity says it.
  const teammates = env.noobly.hosted.apps.find((a) => a.name === 'teammates').internals;
  const work = await eventually(async () => {
    const entries = await teammates.repos.timesheets.listRange('ines-tau', '2000-01-01', '2999-12-31');
    const e = entries.find((x) => x.workId && /infrastructure/i.test(`${x.workType ?? ''} ${x.system ?? ''} ${x.task ?? ''}`));
    assert.ok(e, JSON.stringify(entries.slice(-3)));
    return e;
  });
  assert.ok(work.workId);
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'agent.action' && e.payload.system === 'infrastructure' && e.payload.designId === 'INF-031'));
  assert.ok(events.some((e) => e.type === 'infra_design.updated' && /drafted by Ines Tau/.test(e.payload.summary ?? '')));
  // The lifecycle's approval follows the new version: the platform owner (Stevie) is asked for v3.
  await eventually(async () => {
    const { rows } = (await stevie.json('/workflows/api/v1/approvals')).body;
    assert.ok(rows.some((x) => x.type === 'infra-design' && x.title === 'INF-031 v3 · Approve & provision Test'), JSON.stringify(rows.filter((x) => x.type === 'infra-design').map((x) => x.title)));
  });
});

test('step 3: a Viewer can\'t ask for a draft', async () => {
  assert.equal((await naledi.request(`${infra}/designs/INF-031/drafts`, { method: 'POST', json: {} })).status, 403);
});
