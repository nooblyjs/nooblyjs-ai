// LIVE (NooblyJS Phase 26): one Product draft per stage through a real model: a spec's rollout plan (Ada Quill), an
// item's container view (Rhea Voss), a UX flow and a UI screen (Juno Park, picked for the draft). Each is a teammate
// task billed to its teammate, through a real model's route. It costs a few cents and is not part of `npm test` (the
// name doesn't end in .test.js): run `npm run test:live:product`, which loads .env. It needs ANTHROPIC_API_KEY, and is
// skipped without one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, eventually } from '../helpers.js';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const product = '/product/api/v1';
let env;
let lerato;
let thabo;

before(async () => {
  if (!hasKey) return;
  process.env.AI_PROVIDER = 'anthropic';
  process.env.NODE_ENV = 'development';
  env = await startApp({
    env: { NODE_ENV: 'development' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    ],
  });
  [lerato, thabo] = [env.client(), env.client()];
  await lerato.signIn('lerato-m');
  await thabo.signIn('thabo-n');
});
after(async () => { await env?.stop(); });

const STAGES = [
  { stage: 'spec', who: () => lerato, url: `${product}/specs/PRD-031/drafts`, body: { kind: 'rollout-plan', teammateId: 'ada-quill' } },
  { stage: 'architecture', who: () => thabo, url: `${product}/architecture/PRD-025/drafts`, body: { kind: 'container-view', teammateId: 'rhea-voss' } },
  { stage: 'UX', who: () => lerato, url: `${product}/ux/PRD-031/drafts`, body: { kind: 'flow', brief: 'release extra evening capacity', teammateId: 'juno-park' } },
  { stage: 'UI', who: () => lerato, url: `${product}/ui/PRD-027/drafts`, body: { kind: 'screen', brief: 'order tracking map', teammateId: 'juno-park' } },
];

for (const s of STAGES) {
  test(`live: a ${s.stage} draft through a real model, billed to its teammate`, { skip: !hasKey && 'no ANTHROPIC_API_KEY', timeout: 240_000 }, async () => {
    const res = await s.who().request(s.url, { method: 'POST', json: s.body });
    assert.ok([200, 201, 202].includes(res.status), `${res.status} ${await res.clone().text()}`);
    const { draftId: id } = await res.json();
    const job = await eventually(async () => {
      const j = (await s.who().json(`${product}/drafts/${id}`)).body;
      assert.ok(['done', 'failed'].includes(j.status), j.status);
      return j;
    }, { ms: 220_000, every: 1000 });
    assert.equal(job.status, 'done', job.error ?? '');
    assert.equal(job.teammate?.id, s.body.teammateId);
    // A real model's route, not the scripted mock's (a small draft's cost can round to $0.00).
    assert.ok(job.modelRoute && !/mock|scripted/i.test(job.modelRoute), `the model route is ${job.modelRoute}`);
  });
}
