// Phase F10: fan-out (tasks in parallel waves) and fan-in (merging, with an integrator for conflicts).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { nextWave, overlaps, planWaves } from '../src/line/fanout.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const t = (id, paths, dependsOn = []) => ({ id, title: id, requirements: [], paths, dependsOn });

// ---- planning: pure -----------------------------------------------------------------------------

test('waves: independent tasks together; dependencies and shared paths wait', () => {
  assert.deepEqual(planWaves([t('T1', ['a.js']), t('T2', ['b.js']), t('T3', ['a.js', 'c.js']), t('T4', ['d.js'], ['T1'])]), [['T1', 'T2'], ['T3', 'T4']]);
  assert.deepEqual(planWaves([t('T1', ['a.js']), t('T2', ['b.js']), t('T3', ['c.js'])], { limit: 1 }), [['T1'], ['T2'], ['T3']]);
  assert.ok(overlaps(t('A', ['src/']), t('B', ['./src/x.js'])), 'a folder overlaps the files in it');
  assert.deepEqual(nextWave([t('T1', ['a']), t('T2', ['b'], ['T1'])], { done: [], failed: ['T1'] }).map((x) => x.id), [], 'a failed dependency blocks its dependents');
});

// ---- helpers: a medium issue, a spec with the given tasks, one scripted builder per task -----------

const specDir = '.factory/specs/issue-1';
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });

function specFor(tasks) {
  const n = tasks.length;
  const req = `## R1: Notes\nAs a user, I want notes, so that I remember.\n${tasks.map((_, i) => `- R1.${i + 1} THE SYSTEM SHALL have note ${i + 1}`).join('\n')}\n`;
  const md = tasks.map((tk, i) => `- [ ] ${tk.id}: ${tk.title}\n  - Requirements: R1.${i + 1}\n  - Paths: ${tk.paths.join(', ')}\n  - Depends on: ${tk.dependsOn.join(', ') || 'none'}`).join('\n');
  return createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, req), write(`${specDir}/design.md`, `# Design\n\n${n} small files.\n`), write(`${specDir}/tasks.md`, `# Tasks\n\n${md}\n`)] }, { text: 'Done.' }]);
}
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"medium","clear":true,"outOfScope":false,"questions":[],"reason":"several files"}\n```' }]);
/** A builder that writes its files, slowly enough to overlap with others. (Existing files are
 *  Read first: the harness refuses to overwrite a file the session hasn't read.) */
const slowBuilder = (files, ms = 300, existing = []) =>
  createMockProvider([
    ...(existing.length ? [{ text: 'Reading first.', tools: existing.map(read) }] : []),
    { text: 'Writing, slowly…', tools: Object.entries(files).map(([f, c]) => write(f, c)), onChunk: () => new Promise((r) => setTimeout(r, ms / 6)) },
    { text: 'Done.' },
  ]);
function issueFile() {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, '---\ntitle: Add three notes\n---\nThree notes, please.\n');
  return file;
}
function envWith(config) {
  const env = testEnv();
  fs.mkdirSync(env.FACTORY_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.FACTORY_HOME, 'config.json'), JSON.stringify(config));
  return env;
}

async function threeTasks(taskConcurrency) {
  const env = envWith({ taskConcurrency });
  const store = openStore({ env });
  const tasks = [t('T1', ['one.md']), t('T2', ['two.md']), t('T3', ['three.md'])];
  const started = Date.now();
  const out = await runJob(
    { autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'one.md': '1\n' }), 'build:T2': slowBuilder({ 'two.md': '2\n' }), 'build:T3': slowBuilder({ 'three.md': '3\n' }) } },
    { env, store },
  );
  return { out, ms: Date.now() - started, store };
}

test('THREE INDEPENDENT TASKS run at the same time, and end in ONE integrated branch', async () => {
  const parallel = await threeTasks(3);
  const serial = await threeTasks(1);
  assert.equal(parallel.out.status, 'delivered');
  assert.equal(serial.out.status, 'delivered');
  const waves = (s) => s.store.read({ types: ['wave.started'] }).map((e) => e.data.tasks);
  assert.deepEqual(waves(parallel), [['T1', 'T2', 'T3']]);
  assert.deepEqual(waves(serial), [['T1'], ['T2'], ['T3']]);
  assert.ok(parallel.ms < serial.ms, `parallel ${parallel.ms}ms should beat serial ${serial.ms}ms`);
  const files = gitIn(parallel.out.run.request.repo, 'ls-tree', '--name-only', 'factory/issue-1/main').split('\n');
  for (const f of ['one.md', 'two.md', 'three.md']) assert.ok(files.includes(f), f);
  assert.deepEqual(parallel.out.run.steps.build.result.tasks.map((x) => x.outcome), ['success', 'success', 'success']);
});

test('a task that DEPENDS on another starts from its merged code', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const tasks = [t('T1', ['lib.js']), t('T2', ['use.js'], ['T1'])];
  const t2 = createMockProvider([{ text: 'Reading T1\'s lib.', tools: [read('lib.js')] }, { text: 'Using it.', tools: [write('use.js', "import './lib.js';\n")] }, { text: 'Done.' }]);
  const events = [];
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), agent: { onEvent: (e) => events.push(e) }, providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'lib.js': 'export const x = 1;\n' }, 10), 'build:T2': t2 } }, { env, store });
  assert.equal(out.status, 'delivered');
  const readLib = events.find((e) => e.type === 'tool_end' && e.name === 'Read');
  assert.equal(readLib.isError, false, 'lib.js was there for T2');
  assert.match(readLib.content, /export const x = 1/);
});

test('two tasks sharing a PATH are built one after the other, the second on the first\'s result', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const tasks = [t('T1', ['shared.js']), t('T2', ['shared.js'])];
  const t2 = createMockProvider([{ text: 'Reading.', tools: [read('shared.js')] }, { text: 'Appending.', tools: [write('shared.js', 'export const a = 1;\nexport const b = 2;\n')] }, { text: 'Done.' }]);
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'shared.js': 'export const a = 1;\n' }, 10), 'build:T2': t2 } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.deepEqual(store.read({ types: ['wave.started'] }).map((e) => e.data.tasks), [['T1'], ['T2']]);
  assert.equal(gitIn(out.run.request.repo, 'show', 'factory/issue-1/main:shared.js'), 'export const a = 1;\nexport const b = 2;');
});

test('A MERGE CONFLICT (both tasks touched an undeclared file) is resolved by the integrator, then verified', async () => {
  const env = testEnv();
  const store = openStore({ env });
  // "scope": "warn": this test is about INTEGRATION. Since F14 an undeclared file is a scope
  // violation, and here we want it recorded, not fixed.
  const repo = makeRepo({ 'README.md': '# app\n', '.factory/config.json': JSON.stringify({ scope: 'warn', gates: { both: 'grep -q one README.md && grep -q two README.md' } }) });
  const tasks = [t('T1', ['one.md']), t('T2', ['two.md'])];
  const integrate = createMockProvider([
    { text: 'Looking at the conflict.', tools: [read('README.md')] },
    { text: 'Keeping both lines.', tools: [write('README.md', '# app\n\nSee one.md.\nSee two.md.\n')] },
    { text: 'README.md: kept both tasks\' lines.' },
  ]);
  const out = await runJob(
    {
      autonomy: 'L2',
      issueFile: issueFile(),
      repo,
      allowUnsandboxed: true,
      providers: {
        review: await approve(),
        triage: triage(),
        spec: specFor(tasks),
        'build:T1': slowBuilder({ 'one.md': '1\n', 'README.md': '# app\n\nSee one.md.\n' }, 10, ['README.md']),
        'build:T2': slowBuilder({ 'two.md': '2\n', 'README.md': '# app\n\nSee two.md.\n' }, 10, ['README.md']),
        integrate,
      },
    },
    { env, store },
  );
  assert.equal(out.status, 'delivered', JSON.stringify(out.run.steps.build.result?.tasks ?? out.run.steps, null, 1).slice(0, 1500));
  assert.deepEqual(out.run.steps.build.result.conflicts, ['T2: README.md']);
  assert.match(JSON.stringify(integrate.requests[0].messages), /README\.md[\s\S]*conflict markers/);
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:README.md'), '# app\n\nSee one.md.\nSee two.md.');
  assert.equal(out.run.steps.verify.result.passed, true, 'gates ran on the integrated result');
  assert.deepEqual(out.run.steps.verify.result.scope.violations, [{ file: 'README.md', why: 'outside' }], 'F14: the broken promise is recorded');
});

test('an integrator that leaves conflict markers fails the build (never delivered half-merged)', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'README.md': '# app\n' });
  const tasks = [t('T1', ['one.md']), t('T2', ['two.md'])];
  const lazy = createMockProvider([{ text: 'Looks fine to me.' }]);
  await assert.rejects(
    runJob({ autonomy: 'L2', issueFile: issueFile(), repo, providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'README.md': 'one\n' }, 10, ['README.md']), 'build:T2': slowBuilder({ 'README.md': 'two\n' }, 10, ['README.md']), integrate: lazy } }, { env, store }),
    /left conflict markers in README\.md/,
  );
});

test('F14: a task that changes NOTHING is not done: it counts as a failure', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const tasks = [t('T1', ['one.md']), t('T2', ['two.md'])];
  const out = await runJob(
    { autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'one.md': '1\n' }, 10), 'build:T2': createMockProvider([{ text: 'All done, nothing needed.' }]) } },
    { env, store },
  );
  assert.equal(out.status, 'agent_failed');
  assert.deepEqual(out.run.steps.build.result.tasks.map((x) => [x.id, x.outcome]), [['T1', 'success'], ['T2', 'no_changes']]);
});

test('a task that fails: its dependents are not built; the PR is a draft that says so', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const tasks = [t('T1', ['one.md']), t('T2', ['two.md']), t('T3', ['three.md'], ['T2'])];
  const broken = createMockProvider([new Error('the model API is down')]);
  const out = await runJob(
    { autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage(), spec: specFor(tasks), 'build:T1': slowBuilder({ 'one.md': '1\n' }, 10), 'build:T2': broken, 'build:T3': createMockProvider([]) } },
    { env, store },
  );
  assert.equal(out.status, 'agent_failed');
  const result = out.run.steps.build.result;
  assert.deepEqual(result.tasks.map((x) => [x.id, x.outcome]), [['T1', 'success'], ['T2', 'error'], ['T3', 'not built']]);
  const pr = fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8');
  assert.match(pr, /status: draft/);
  assert.match(pr, /T3: not built \(a task it depends on failed\)/);
});
