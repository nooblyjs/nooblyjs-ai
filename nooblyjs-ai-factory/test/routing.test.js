// Phase F22: cost-aware routing: signals, decisions, the wiring into runs, and per-tier metrics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config/factory-config.js';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { factoryMetrics } from '../src/metrics/factory-metrics.js';
import { POLICIES, policyFor, routeTier, signalsFor } from '../src/routing/policy.js';
import { openStore } from '../src/store/events.js';
import { approve, makeRepo, testEnv, tmpDir } from './helpers.js';

const names = (s) => s.map((x) => x.name);

test('signals, from a run\'s own history', () => {
  assert.deepEqual(signalsFor({ station: 'build', run: {}, triage: { size: 'small', confidence: 0.9 }, attempt: 1 }), []);
  assert.deepEqual(names(signalsFor({ station: 'build', run: {}, triage: { size: 'medium', confidence: 0.3 }, attempt: 2 })), ['retry', 'low_confidence', 'medium_or_large']);
  assert.deepEqual(signalsFor({ station: 'repair', run: { repairs: [{}, {}] }, triage: null, attempt: 1 }), [{ name: 'repair', weight: 2 }], 'the third repair: two attempts before it');
  assert.deepEqual(names(signalsFor({ station: 'repair', run: { repairs: [], humanReview: { body: 'x' } }, attempt: 1 })), ['human_review']);
  assert.deepEqual(signalsFor({ station: 'build', run: {}, triage: { confidence: 0.5 }, attempt: 1, lowConfidence: 0.4 }), [], 'the threshold is configurable');
});

test('decisions: static keeps the role tier; cheap-first starts low and climbs ONLY on its configured signals, capped at the top', () => {
  const all = [{ name: 'retry', weight: 1 }, { name: 'low_confidence', weight: 1 }, { name: 'human_review', weight: 1 }];
  assert.deepEqual(routeTier({ station: 'build', roleTier: 'balanced', policy: POLICIES.static, signals: all }), { tier: 'balanced', reason: 'role tier (balanced)', climbed: [] });
  const cheap = POLICIES['cheap-first'];
  assert.equal(routeTier({ station: 'build', roleTier: 'balanced', policy: cheap, signals: [] }).tier, 'fast');
  const climbed = routeTier({ station: 'build', roleTier: 'balanced', policy: cheap, signals: all });
  assert.equal(climbed.tier, 'strong', 'fast + retry + low_confidence');
  assert.deepEqual(climbed.climbed, ['retry', 'low_confidence'], 'human_review is not a build signal in this policy');
  assert.equal(climbed.reason, 'fast + retry, low_confidence → strong');
  assert.equal(routeTier({ station: 'repair', roleTier: 'balanced', policy: cheap, signals: [{ name: 'repair', weight: 5 }] }).tier, 'strong', 'capped');
  assert.equal(routeTier({ station: 'build', roleTier: 'balanced', policy: { stations: { build: { start: 'fast', climbOn: ['retry'], max: 'balanced' } } }, signals: [{ name: 'retry', weight: 3 }] }).tier, 'balanced', 'a policy can cap lower');
  assert.equal(routeTier({ station: 'review', roleTier: 'balanced', policy: cheap, signals: all }).tier, 'balanced', 'stations a policy leaves out keep their role tier');
  assert.equal(routeTier({ station: 'review', roleTier: 'fast', policy: POLICIES.strong, signals: [] }).tier, 'strong', '"*" applies everywhere');
});

test('which policy: the run\'s, else the config\'s, else static; custom ones from config; unknown ones are an error', () => {
  assert.equal(policyFor({}, {}).name, 'static');
  assert.equal(policyFor({}, { routing: { policy: 'escalate' } }).name, 'escalate');
  assert.equal(policyFor({ routing: 'strong' }, { routing: { policy: 'escalate' } }).name, 'strong');
  const mine = { stations: { build: { start: 'fast', climbOn: [] } } };
  assert.equal(policyFor({ routing: 'mine' }, { routing: { policies: { mine } } }).policy, mine);
  assert.throws(() => policyFor({ routing: 'nope' }, {}), /No routing policy "nope"/);
});

const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
function issueFile() {
  const f = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(f, '# Add half\n\nx\n');
  return f;
}
const triage = (confidence) => createMockProvider([{ text: `\`\`\`json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"x","confidence":${confidence}}\n\`\`\`` }]);
const builder = () => createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Done.' }]);
const routes = (store, runId) => store.read({ stream: `run:${runId}`, types: ['route.decided'] }).map((e) => [e.data.step, e.data.tier, e.data.model]);

test('in a run: cheap-first puts a confident item on the fast model, and a low-confidence one a tier up; --model pins it; every decision is an event', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const sure = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', routing: 'cheap-first', providers: { triage: triage(0.9), build: builder(), review: await approve() } }, { env, store });
  assert.deepEqual(routes(store, sure.runId).find((r) => r[0] === 'build'), ['build', 'fast', DEFAULTS.models.fast]);
  assert.deepEqual(routes(store, sure.runId).find((r) => r[0] === 'review'), ['review', 'balanced', DEFAULTS.models.balanced], 'not in the policy: the role tier');

  const unsure = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', routing: 'cheap-first', providers: { triage: triage(0.3), build: builder(), review: await approve() } }, { env, store });
  assert.deepEqual(routes(store, unsure.runId).find((r) => r[0] === 'build'), ['build', 'balanced', DEFAULTS.models.balanced]);

  const pinned = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', routing: 'cheap-first', agent: { model: 'my-model' }, providers: { triage: triage(0.3), build: builder(), review: await approve() } }, { env, store });
  const e = store.read({ stream: `run:${pinned.runId}`, types: ['route.decided'] }).find((x) => x.data.step === 'build');
  assert.equal(e.data.model, 'my-model');
  assert.equal(e.data.reason, 'pinned (my-model)');

  const plain = await runJob({ issueFile: issueFile(), repo: makeRepo(), autonomy: 'L2', providers: { triage: triage(0.3), build: builder(), review: await approve() } }, { env, store });
  assert.deepEqual(routes(store, plain.runId).find((r) => r[0] === 'build'), ['build', 'balanced', DEFAULTS.models.balanced], 'static: the builder role\'s own tier');
});

test('metrics per station AND tier: what each tier cost, and how often its step succeeded', () => {
  const at = (m) => new Date(Date.parse('2026-09-29T09:00:00Z') + m * 60_000).toISOString();
  const run = (id, steps) => steps.map(([m, type, data]) => ({ type, at: at(m), data: { runId: id, ...data } }));
  const events = [
    ...run('a', [[0, 'run.queued', {}], [1, 'route.decided', { step: 'build', tier: 'fast' }], [1, 'step.started', { step: 'build' }], [5, 'step.finished', { step: 'build', result: { costUsd: 0.1, agent: { outcome: 'success' } } }],
      [6, 'route.decided', { step: 'repair', tier: 'fast' }], [8, 'repair.attempted', { costUsd: 0.05, outcome: 'success', sha: null }],
      [9, 'route.decided', { step: 'repair', tier: 'balanced' }], [12, 'repair.attempted', { costUsd: 0.3, outcome: 'success', sha: 'abc' }]]),
    ...run('b', [[0, 'run.queued', {}], [1, 'route.decided', { step: 'build', tier: 'fast' }], [1, 'step.started', { step: 'build' }], [3, 'step.finished', { step: 'build', result: { costUsd: 0.1, agent: { outcome: 'max_turns' } } }]]),
  ];
  const m = factoryMetrics(events, { since: '7d', now: Date.parse('2026-09-30T09:00:00Z') });
  assert.deepEqual(m.routes.map((x) => [x.station, x.tier, x.steps, x.successRate, Math.round(x.costPerStep * 100) / 100]), [
    ['build', 'fast', 2, 0.5, 0.1],
    ['repair', 'balanced', 1, 1, 0.3],
    ['repair', 'fast', 1, 0, 0.05],
  ]);
});
