// Phase F12: humans in the loop: autonomy levels, parking, approve/reject, policy gaps, L3 merge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { autonomyFor } from '../src/humans/autonomy.js';
import { answerEntry, openEntries, openEntry } from '../src/humans/inbox.js';
import { continueRun, runJob } from '../src/job/run-job.js';
import { createLocalForge } from '../src/forge/local.js';
import { resumeRun } from '../src/scheduler/kill-switch.js';
import { pickRuns } from '../src/scheduler/pick.js';
import { sandboxStatus } from '../src/exec/sandbox.js';
import { DEFAULTS, loadFactoryConfig } from '../src/config/factory-config.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

// ---- autonomy: the operator gives it; an issue can only lower it -----------------------------------

test('autonomy: default L1; config per repo; --autonomy; an issue label can LOWER it, never raise it', () => {
  const config = { autonomy: 'L2', repos: { calc: { autonomy: 'L3' } } };
  assert.deepEqual(autonomyFor({ config: {}, slug: 'x' }), { level: 'L1', why: 'default' });
  assert.equal(autonomyFor({ config, slug: 'other' }).level, 'L2');
  assert.equal(autonomyFor({ config, slug: 'calc' }).level, 'L3');
  assert.equal(autonomyFor({ config, slug: 'calc', requested: 'L1' }).level, 'L1');
  assert.deepEqual(autonomyFor({ config, slug: 'calc', labels: ['bug', 'autonomy:L0'] }), { level: 'L0', why: 'issue label autonomy:L0 (labels can only lower it)' });
  assert.equal(autonomyFor({ config: {}, slug: 'x', labels: ['autonomy:L3'] }).level, 'L1', 'a label cannot raise it');
});

// ---- helpers ------------------------------------------------------------------------------------

const specDir = '.factory/specs/issue-1';
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });
const triage = (size) => createMockProvider([{ text: `\`\`\`json\n${JSON.stringify({ kind: 'feature', size, clear: true, outOfScope: false, questions: [], reason: 'ok' })}\n\`\`\`` }]);
const REQ_V1 = '## R1: Parse\nAs a user, I want to parse numbers, so that I can use them.\n- R1.1 WHEN parse(s) is called with a numeric string THE SYSTEM SHALL return the number\n';
const REQ_V2 = REQ_V1 + '- R1.2 IF parse(s) is called with an empty string THEN THE SYSTEM SHALL throw a TypeError\n';
const TASKS = '- [ ] T1: Add parse()\n  - Requirements: R1\n  - Paths: parse.js\n';
function issueFile(extra = '') {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, `---\ntitle: Add parse\n${extra}---\nparse(s) turns a string into a number.\n`);
  return file;
}

test('THE CHECKPOINT (L1): the spec PARKS the run; reject "also handle empty input"; the revised spec includes it; approve; build proceeds', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo();
  const spec = createMockProvider([
    { text: 'Spec v1.', tools: [write(`${specDir}/requirements.md`, REQ_V1), write(`${specDir}/design.md`, '# Design\nparse.js\n'), write(`${specDir}/tasks.md`, TASKS)] },
    { text: 'Spec written.' },
    // after the rejection: a new session, starting from v1 (so it Reads before editing)
    { text: 'Reading v1.', tools: [read(`${specDir}/requirements.md`)] },
    { text: 'Adding the empty-input case.', tools: [write(`${specDir}/requirements.md`, REQ_V2)] },
    { text: 'Revised: R1.2 covers empty input.' },
  ]);
  const build = createMockProvider([{ text: 'Implementing.', tools: [write('parse.js', "export const parse = (s) => { if (s === '') throw new TypeError('empty'); return Number(s); };\n")] }, { text: 'Done.' }]);
  const providers = { triage: triage('medium'), spec, build, review: await approve() };

  // 1. The run parks at the approval gate. Nothing is built; nothing is held.
  const first = await runJob({ issueFile: issueFile(), repo, providers }, { env, store });
  assert.equal(first.status, 'parked');
  assert.equal(build.requests.length, 0, 'the builder was never paid for');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM leases').get().n, 0, 'no lease held while waiting');
  assert.equal(pickRuns({ queued: [], running: store.list('runs').filter((r) => r.status === 'running'), config: DEFAULTS, spentAll: 0, spentBySlug: {}, stopped: false }).start.length, 0);
  assert.equal(store.list('runs').filter((r) => r.status === 'running').length, 0, 'a parked run holds no slot');
  const [ask] = openEntries(store);
  assert.equal(ask.kind, 'approval');
  assert.match(ask.body, /R1\.1 WHEN parse\(s\) is called/);
  assert.match(gitIn(repo, 'show', `factory/issue-1/spec:${specDir}/requirements.md`), /R1\.1/, 'the spec is readable in the repo, on factory/issue-1/spec');

  // 2. Reject, with feedback. The run goes back to the spec station, with the feedback.
  answerEntry(store, ask.id, 'rejected', { feedback: 'Also handle empty input.', by: 'sam' });
  resumeRun(store, first.runId);
  const logs = [];
  const second = await continueRun(store, first.runId, { live: { providers, log: (l) => logs.push(l) } }).catch((e) => { console.error(logs.join('\n')); throw e; });
  assert.equal(second.status, 'parked', 'the REVISED spec comes back for approval');
  assert.match(JSON.stringify(spec.requests[2].messages), /REJECTED it[\s\S]*Also handle empty input\.[\s\S]*\(sam\)/, "the person's feedback reached the spec-writer");
  const [ask2] = openEntries(store);
  assert.match(ask2.body, /R1\.2 IF parse\(s\) is called with an empty string/, 'the revised spec includes it');

  // 3. Approve. Build proceeds.
  answerEntry(store, ask2.id, 'approved', { by: 'sam' });
  resumeRun(store, first.runId);
  const done = await continueRun(store, first.runId, { live: { providers } });
  assert.equal(done.status, 'delivered');
  assert.equal(done.run.steps.approve.result.by, 'sam');
  const story = store.read({ stream: `run:${first.runId}` }).map((e) => e.type);
  assert.deepEqual(story.filter((t) => ['run.parked', 'inbox.answered', 'run.rewound', 'run.finished'].includes(t)), ['run.parked', 'inbox.answered', 'run.rewound', 'run.parked', 'inbox.answered', 'run.finished']);
});

test('a rejection needs feedback; an entry can be answered only once', () => {
  const store = openStore({ env: testEnv() });
  const id = openEntry(store, { runId: 'r', kind: 'approval', gate: 'plan', title: 't' });
  assert.throws(() => answerEntry(store, id, 'rejected', {}), /needs --feedback/);
  answerEntry(store, id, 'approved');
  assert.throws(() => answerEntry(store, id, 'approved'), /already approved/);
  const q = openEntry(store, { runId: 'r', kind: 'question', title: 'Which folder?' });
  assert.equal(answerEntry(store, q, 'answered', { answer: 'src/' }).answer, 'src/');
});

test('L2: no plan approval (straight on); a small item at L1 has nothing to approve', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const spec = createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, REQ_V1), write(`${specDir}/design.md`, '# D\nx\n'), write(`${specDir}/tasks.md`, TASKS)] }, { text: 'Done.' }]);
  const build = () => createMockProvider([{ text: 'x', tools: [write('parse.js', 'x\n')] }, { text: 'Done.' }]);
  const l2 = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { triage: triage('medium'), spec, build: build(), review: await approve() } }, { env, store });
  assert.equal(l2.status, 'delivered');
  assert.equal(l2.run.steps.approve.result.decision, 'auto');
  const small = await runJob({ issueFile: issueFile(), repo: makeRepo(), providers: { triage: triage('small'), build: build(), review: await approve() } }, { env, store });
  assert.equal(small.status, 'delivered');
});

test('L0 (via an issue label): the spec is the output: the run ends "suggested", nothing is built', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo();
  const spec = createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, REQ_V1), write(`${specDir}/design.md`, '# D\nx\n'), write(`${specDir}/tasks.md`, TASKS)] }, { text: 'Done.' }]);
  const build = createMockProvider([]);
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile('labels: [autonomy:L0]\n'), repo, providers: { triage: triage('medium'), spec, build } }, { env, store });
  assert.equal(out.status, 'suggested');
  assert.equal(build.requests.length, 0);
  assert.match(gitIn(repo, 'show', `factory/issue-1/spec:${specDir}/requirements.md`), /R1\.1/);
  assert.match(createLocalForge({ env }).comments(out.run.itemId.split('#')[0], 1), /autonomy L0: it suggests, a person decides/);
});

test('L3: a green, clean change is MERGED by the factory; protected paths or blocking findings are not', async () => {
  const env = testEnv({ repairAttempts: 0 }); // the blocked case must stay blocked (no F13 repair)
  const store = openStore({ env });
  const small = triage('small');
  // green + clean → merged into the repo's main
  const repo = makeRepo();
  const ok = await runJob({ autonomy: 'L3', issueFile: issueFile(), repo, providers: { triage: small, build: createMockProvider([{ text: 'x', tools: [write('parse.js', 'x\n')] }, { text: 'Done.' }]), review: await approve() } }, { env, store });
  assert.equal(ok.status, 'merged');
  assert.equal(gitIn(repo, 'show', 'main:parse.js'), 'x');
  assert.match(gitIn(repo, 'log', '-1', '--format=%s', 'main'), /^Merge factory\/issue-1\/main/);
  // touches .github/ → a person merges
  const repo2 = makeRepo();
  const prot = await runJob({ autonomy: 'L3', issueFile: issueFile(), repo: repo2, providers: { triage: triage('small'), build: createMockProvider([{ text: 'x', tools: [write('.github/workflows/ci.yml', 'on: push\n')] }, { text: 'Done.' }]), review: await approve() } }, { env, store });
  // Since F14 the scope guard stops it at VERIFY (earlier than the merge station would).
  assert.equal(prot.status, 'gate_failed');
  assert.deepEqual(prot.run.steps.verify.result.scope.violations, [{ file: '.github/workflows/ci.yml', why: 'protected' }]);
  assert.equal(gitIn(repo2, 'ls-tree', '--name-only', 'main').includes('.github'), false);
  // a blocking finding → not delivered → not merged
  const repo3 = makeRepo();
  const blocked = await runJob({ autonomy: 'L3', issueFile: issueFile(), repo: repo3, providers: { triage: triage('small'), build: createMockProvider([{ text: 'x', tools: [write('parse.js', 'x\n')] }, { text: 'Done.' }]), review: await approve([{ severity: 'blocking', rationale: 'wrong' }]) } }, { env, store });
  assert.equal(blocked.status, 'changes_requested');
});

test('POLICY GAP: a refused command becomes an inbox entry; approving it adds the rule to the role', { skip: sandboxStatus().available && 'with a sandbox, Bash is allowed inside it: no gap' }, async () => {
  const env = testEnv();
  const store = openStore({ env });
  const build = createMockProvider([{ text: 'Installing first.', tools: [{ name: 'Bash', input: { command: 'npm install left-pad' } }] }, { text: 'x', tools: [write('parse.js', 'x\n')] }, { text: 'Done.' }]);
  const out = await runJob({ line: 'quick', issueFile: issueFile(), repo: makeRepo(), providers: { build } }, { env, store });
  assert.equal(out.status, 'delivered');
  const [gap] = openEntries(store);
  assert.equal(gap.kind, 'policy');
  assert.match(gap.title, /The builder was refused Bash\(npm install left-pad\)/);
  assert.equal(gap.detail.rule, 'Bash(npm install:*)', "the harness's own suggestion: a prefix rule");
  // `factory approve <id>` for a policy entry adds the rule to the operator's config:
  const saved = process.env.FACTORY_HOME;
  process.env.FACTORY_HOME = env.FACTORY_HOME;
  try {
    const { approveCommand } = await import('../src/commands/inbox.js');
    const log = console.log;
    console.log = () => {};
    await approveCommand([gap.id]).finally(() => (console.log = log));
    assert.deepEqual(loadFactoryConfig(env).roles.builder.allow, ['Bash(npm install:*)']);
  } finally {
    if (saved === undefined) delete process.env.FACTORY_HOME;
    else process.env.FACTORY_HOME = saved;
  }
});
