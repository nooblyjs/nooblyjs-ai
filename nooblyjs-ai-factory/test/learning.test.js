// Phase F21: the learning loop: feedback → learnings → recurring patterns → a steering PR (with bench numbers).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalForge } from '../src/forge/local.js';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { clusterLearnings, learningsFromRun, similarity, tokens } from '../src/knowledge/learning.js';
import { CONVENTIONS, proposeRule, recurring, ruleFor } from '../src/knowledge/propose.js';
import { isSettled, runRetros } from '../src/knowledge/retro.js';
import { benchWith } from '../src/commands/learn.js';
import { builtInRoles } from '../src/roles/loader.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const L = (id, runId, text, slug = 'calc', extra = {}) => ({ id, runId, slug, source: 'human-review', text, ...extra });

test('words: endings trimmed, stopwords, paths and numbers dropped', () => {
  assert.deepEqual(tokens('Please use NAMED exports in `src/half.js`, not default exports (2nd time!)').sort(), ['default', 'export', 'named', 'time', 'use'].sort());
  assert.ok(similarity(tokens('use named exports, not default exports'), tokens('Default export again: we use named exports')) >= 0.5);
});

test('clustering synthetic learnings: the same lesson in different words groups; other lessons and other repos stay apart', () => {
  const learnings = [
    L('1', 'r1', 'Please use named exports, not default exports'),
    L('2', 'r2', 'Default export again: this repo uses named exports'),
    L('3', 'r3', 'use a named export here, never export default'),
    L('4', 'r2', 'Add a test for the empty list'),
    L('5', 'r4', 'Missing a test for the empty list'),
    L('8', 'r5', 'Tests for empty input are missing'),
    L('6', 'r9', 'Please use named exports, not default exports', 'other-repo'),
    L('7', 'r1', 'Typo in the README'),
  ];
  const clusters = clusterLearnings(learnings);
  const exports = clusters.find((c) => c.members.some((m) => m.id === '1'));
  assert.deepEqual(exports.members.map((m) => m.id).sort(), ['1', '2', '3']);
  assert.deepEqual(exports.runs.sort(), ['r1', 'r2', 'r3']);
  assert.match(exports.key, /^calc:.*export.*nam/);
  assert.ok(!exports.members.some((m) => m.id === '6'), 'another repo: another cluster');
  const empty = clusters.find((c) => c.members.some((m) => m.id === '4'));
  // '4' and '8' say the same thing in different words and don't meet directly (the limit of
  // word overlap, and why the retro role phrases lessons as rules, consistently)…
  assert.ok(similarity(tokens(learnings[3].text), tokens(learnings[5].text)) < 0.4);
  // …but single-link CHAINS: '5' is close to both, so all three are one group.
  assert.deepEqual(empty.members.map((m) => m.id).sort(), ['4', '5', '8']);
  assert.equal(clusters.find((c) => c.members.some((m) => m.id === '7')).members.length, 1);
  assert.equal(ruleFor(exports), 'Use named exports, not default exports.', '"please" dropped, a full stop added');
  assert.equal(ruleFor({ ...exports, members: exports.members.map((m) => ({ ...m, rule: 'Use named exports only.' })) }), 'Use named exports only.', "the retro's wording wins");
});

test('what a run teaches: human reviews, rejections, the reviewer\'s findings (not nits), failed checks', () => {
  const events = [
    { type: 'pr.changes_requested', data: { body: 'use n / 2', by: 'sam' } },
    { type: 'inbox.answered', data: { decision: 'rejected', feedback: 'The spec misses empty input', by: 'sam' } },
    { type: 'inbox.answered', data: { decision: 'approved' } },
    { type: 'step.finished', data: { step: 'review', result: { findings: [{ severity: 'major', title: 'No test for zero' }, { severity: 'nit', title: 'Rename x' }] } } },
    { type: 'repair.attempted', data: { trigger: 'gates', title: 'check "test" failed' } },
    { type: 'repair.attempted', data: { trigger: 'human', title: 'changes requested by sam' } },
  ];
  assert.deepEqual(learningsFromRun({ id: 'r', slug: 'calc' }, events).map((l) => [l.source, l.text]), [
    ['human-review', 'use n / 2'],
    ['human-review', 'The spec misses empty input'],
    ['review', 'No test for zero'],
    ['gates', 'check "test" failed'],
  ]);
});

test('retro: only settled runs; incremental (later feedback is learned once); the retro role phrases rules and drops one-offs', async () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  assert.equal(isSettled({ status: 'running' }, { now }), false);
  assert.equal(isSettled({ status: 'merged' }, { now }), true);
  assert.equal(isSettled({ status: 'delivered', endedAt: '2026-09-30T11:00:00Z' }, { now }), false, 'people may still review it');
  assert.equal(isSettled({ status: 'delivered', endedAt: '2026-09-29T11:00:00Z' }, { now }), true);

  const env = testEnv();
  const store = openStore({ env });
  const runId = await closedRun(store, env);
  store.append(`run:${runId}`, 'pr.changes_requested', { runId, body: 'Please use named exports', by: 'sam' });
  assert.equal((await runRetros(store, { settleHours: 0 })).length, 1);
  assert.equal((await runRetros(store, { settleHours: 0 })).length, 0, 'nothing new');
  store.append(`run:${runId}`, 'pr.changes_requested', { runId, body: 'Typo in a comment', by: 'sam' });
  store.append(`run:${runId}`, 'pr.changes_requested', { runId, body: 'Exports should be named', by: 'sam' });
  const retro = createMockProvider([{ text: '```json\n{ "rules": [null, "Use named exports; never default exports."] }\n```' }]);
  const later = await runRetros(store, { settleHours: 0, roles: builtInRoles(), provider: retro });
  assert.deepEqual(later.map((l) => [l.text, l.rule]), [['Exports should be named', 'Use named exports; never default exports.']], 'the typo was a one-off');
  assert.match(JSON.stringify(retro.requests[0].messages), /1\. \[human-review, sam\] Typo in a comment[\s\S]*2\. \[human-review, sam\] Exports should be named/);
});

const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"x"}\n```' }]);
async function closedRun(store, env, repo = makeRepo({ 'package.json': '{ "type": "module" }' }), n = 1) {
  const issue = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(issue, `# Add f${n}\n\nx\n`);
  const build = createMockProvider([{ text: 'x', tools: [write(`f${n}.js`, `export default function f${n}() {}\n`)] }, { text: 'Done.' }]);
  const out = await runJob({ issueFile: issue, repo, autonomy: 'L2', providers: { triage: triage(), build, review: await approve() } }, { env, store });
  assert.equal(out.status, 'delivered');
  return out.runId;
}

test('CHECKPOINT: three PRs get the same review comment → a draft steering PR proposing the rule, with bench numbers; it only touches steering; merged, the next builder reads it', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'package.json': '{ "type": "module" }' });
  const comments = ['Please use named exports, not default exports.', 'Default export again: this repo uses named exports.', 'We use named exports here, never export default.'];
  for (const [i, body] of comments.entries()) {
    const runId = await closedRun(store, env, repo, i + 1);
    store.append(`run:${runId}`, 'pr.changes_requested', { runId, body, by: 'sam' });
  }
  await runRetros(store, { settleHours: 0 });
  assert.deepEqual(recurring(store, { minRuns: 4 }), [], 'three runs: not yet at K = 4');
  const [pattern] = recurring(store, { minRuns: 3 });
  assert.equal(pattern.runs.length, 3);

  const forge = createLocalForge({ env });
  const out = await proposeRule(store, pattern, { forge, env, bench: benchWith({ agent: 'oracle', cases: ['add-subtract'], allowUnsandboxed: true }) });
  assert.equal(out.rule, 'Use named exports, not default exports.');
  assert.deepEqual(out.changed, [CONVENTIONS], 'the PR only touches steering');
  const pr = fs.readFileSync(out.pr, 'utf8');
  assert.match(pr, /> Use named exports, not default exports\./);
  assert.match(pr, /same feedback on 3 different runs/);
  for (const c of comments) assert.ok(pr.includes(c.replace(/\.$/, '')), `evidence: ${c}`);
  assert.match(pr, /without the rule: 1 cases[\s\S]*resolved\s+100%[\s\S]*with the rule: 1 cases[\s\S]*resolved\s+100%/, 'bench numbers, with and without');
  assert.match(pr, /Nothing changes until you merge this/);
  assert.deepEqual(recurring(store, { minRuns: 3 }), [], 'never proposed twice');

  // A person merges it. The next agent's prompt carries the rule.
  gitIn(repo, 'merge', '-q', '--no-ff', '-m', 'Adopt the convention', out.head);
  assert.match(fs.readFileSync(path.join(repo, CONVENTIONS), 'utf8'), /## Learned rules\n- Use named exports, not default exports\./);
  const issue = path.join(tmpDir(), 'next.md');
  fs.writeFileSync(issue, '# Add g\n\nx\n');
  const build = createMockProvider([{ text: 'x', tools: [write('g.js', 'export function g() {}\n')] }, { text: 'Done.' }]);
  await runJob({ issueFile: issue, repo, autonomy: 'L2', providers: { triage: triage(), build, review: await approve() } }, { env, store });
  assert.match(JSON.stringify(build.requests[0]), /conventions\.md[\s\S]*Use named exports, not default exports/);
});
