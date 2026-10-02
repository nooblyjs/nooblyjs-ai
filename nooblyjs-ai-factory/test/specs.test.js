// Phase F08: specs (requirements → design → tasks), checked and traced, before any code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { checkSpec, parseRequirements, parseTasks } from '../src/specs/schema.js';
import { coverage, formatCoverage } from '../src/specs/trace.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const REQ = `# Requirements: subtract

## R1: Subtract two numbers
As a calc user, I want to subtract numbers, so that I can compute differences.
- R1.1 WHEN subtract(a, b) is called with two numbers THE SYSTEM SHALL return a minus b
- R1.2 IF an argument is not a number THEN THE SYSTEM SHALL throw a TypeError
`;
const DESIGN = '# Design\n\nA new `subtract.js`, exported like `add.js`. Type checks with `typeof`.\n';
const TASKS = `# Tasks

- [ ] T1: Add subtract()
  - Requirements: R1.1, R1.2
  - Paths: subtract.js
  - Depends on: none
- [ ] T2: Test subtract()
  - _Requirements: R1_
  - Paths: test/subtract.test.js
  - Depends on: T1
`;

// ---- the format ---------------------------------------------------------------------------------

test('a good spec parses and passes', () => {
  const v = checkSpec({ requirements: REQ, design: DESIGN, tasks: TASKS });
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.requirements[0].criteria.map((c) => c.id), ['R1.1', 'R1.2']);
  assert.deepEqual(v.tasks.map((t) => [t.id, t.dependsOn]), [['T1', []], ['T2', ['T1']]]);
});

test('every EARS form is accepted; prose is not', () => {
  const forms = ['THE SYSTEM SHALL log each call', 'WHEN a is 0 THE SYSTEM SHALL return -b', 'WHILE offline THE SYSTEM SHALL queue writes', 'IF b is NaN THEN THE SYSTEM SHALL throw', 'WHERE debug is on THE SYSTEM SHALL print the inputs', 'It should subtract'];
  const md = `## R1: x\nAs a user, I want x, so that y.\n${forms.map((f, i) => `- R1.${i + 1} ${f}`).join('\n')}\n`;
  assert.deepEqual(parseRequirements(md).problems, ['R1.6 is not in EARS form (WHEN/WHILE/IF…THEN/WHERE … THE SYSTEM SHALL …): "It should subtract"']);
});

test('the problems a spec-writer gets back are specific', () => {
  const bad = checkSpec({
    requirements: '## R1: x\n- R1.1 WHEN a THE SYSTEM SHALL b\n- R2.1 WHEN c THE SYSTEM SHALL d\n',
    design: '',
    tasks: '- [ ] T1: a\n  - Requirements: R1.1, R7.7\n  - Depends on: T2\n- [ ] T2: b\n  - Requirements: R1.1\n  - Paths: x.js\n  - Depends on: T1\n',
  });
  const text = bad.problems.join('\n');
  for (const want of [/R1 has no user story/, /R2\.1 is listed under R1/, /design\.md is missing or empty/, /T1 declares no Paths/, /circle: T1 → T2 → T1/, /T1 refers to R7\.7/]) assert.match(text, want);
});

test('trace: "R1" on a task covers all of R1; uncovered criteria are found; the PR table shows the matrix', () => {
  const { requirements } = parseRequirements(REQ + '\n## R2: Docs\nAs a reader, I want docs, so that I find it.\n- R2.1 THE SYSTEM SHALL mention subtract in the README\n');
  const { tasks } = parseTasks(TASKS);
  const t = coverage(requirements, tasks);
  assert.deepEqual(t.criteria.map((c) => [c.id, c.tasks]), [['R1.1', ['T1', 'T2']], ['R1.2', ['T1', 'T2']], ['R2.1', []]]);
  assert.deepEqual(t.uncovered.map((c) => c.id), ['R2.1']);
  assert.match(formatCoverage(t, '.factory/specs/issue-1'), /\| R2\.1 \| THE SYSTEM SHALL mention subtract in the README \| ⚠️ none \|/);
});

// ---- the spec station ---------------------------------------------------------------------------

const specDir = '.factory/specs/issue-1';
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const triage = (size) => createMockProvider([{ text: `\`\`\`json\n${JSON.stringify({ kind: 'feature', size, clear: true, outOfScope: false, questions: [], reason: 'ok' })}\n\`\`\`` }]);
function issueFile() {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, '---\ntitle: Add subtract\n---\ncalc needs subtract(a, b).\n');
  return file;
}
// The spec has two tasks (T2 depends on T1), so since F10 the build FANS OUT: one builder per task.
const builders = () => ({
  'build:T1': createMockProvider([
    { text: 'Reading the spec.', tools: [{ name: 'Read', input: { file_path: `${specDir}/tasks.md` } }] },
    { text: 'Implementing T1.', tools: [write('subtract.js', "export const subtract = (a, b) => { if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers only'); return a - b; };\n")] },
    { text: 'Done: T1.' },
  ]),
  'build:T2': createMockProvider([
    { text: 'Testing T1\'s subtract.', tools: [write('test/subtract.test.js', "import { subtract } from '../subtract.js';\n")] },
    { text: 'Done: T2.' },
  ]),
});

test('THE SPEC STATION: medium item → spec (a mistake, sent back, fixed) → build FROM the spec → PR with spec + code + coverage', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'add.js': 'export const add = (a, b) => a + b;\n' });
  const TASKS_MISSING_R12 = TASKS.replace('Requirements: R1.1, R1.2', 'Requirements: R1.1').replace('_Requirements: R1_', 'Requirements: R1.1');
  const spec = createMockProvider([
    { text: 'Writing the spec.', tools: [write(`${specDir}/requirements.md`, REQ), write(`${specDir}/design.md`, DESIGN), write(`${specDir}/tasks.md`, TASKS_MISSING_R12)] },
    { text: 'Spec written.' },
    // The fix is a FRESH session: it must Read tasks.md before overwriting it (the harness's
    // read-before-write rule). A session that could be resumed (harness track H34) would remember.
    { text: 'Let me see the tasks.', tools: [{ name: 'Read', input: { file_path: `${specDir}/tasks.md` } }] },
    { text: 'Covering R1.2.', tools: [write(`${specDir}/tasks.md`, TASKS)] },
    { text: 'Fixed.' },
  ]);
  const b = builders();
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, providers: { review: await approve(), triage: triage('medium'), spec, ...b } }, { env, store });
  assert.equal(out.status, 'delivered');

  const fixPrompt = JSON.stringify(spec.requests[2].messages);
  assert.match(fixPrompt, /R1\.2 is not covered by any task/, 'the check told the spec-writer exactly what was wrong');

  const s = out.run.steps.spec.result;
  assert.deepEqual(s.tasks.map((t) => t.id), ['T1', 'T2']);
  assert.equal(s.trace.uncovered.length, 0);

  assert.match(JSON.stringify(b['build:T1'].requests[0].messages), /You are building ONE task of it: T1: Add subtract/);
  assert.match(JSON.stringify(b['build:T1'].requests[1].messages), /T1: Add subtract\(\)/, 'the builder could read the spec: it was in its checkout');

  const head = 'factory/issue-1/main';
  const log = gitIn(repo, 'log', '--topo-order', '--format=%s', `main..${head}`).split('\n'); // topo: commits made in the same second
  // have the same date, and date order doesn't promise parents after children
  assert.equal(log.at(-1), 'Spec: Add subtract', 'the spec commit first…');
  assert.deepEqual(log.filter((l) => l.startsWith('Merge')), ['Merge T2: Test subtract()', 'Merge T1: Add subtract()'], '…then one merge per wave (T2 depends on T1: two waves)');
  const pr = fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8');
  assert.match(pr, /^base: main$/m, 'the PR is FOR main, though the builder started from the spec commit');
  assert.match(pr, /git diff main\.\.\.factory\/issue-1\/main/);
  assert.match(pr, /requirements\.md/, 'the PR changes include the spec…');
  assert.match(pr, /subtract\.js/, '…and the code');
  assert.match(pr, /## Requirements → tasks → tests[\s\S]*\| R1\.2 \| IF an argument is not a number/, 'F14: the coverage table, now with a Tests column');
});

test('a SMALL item skips the spec and goes straight to the builder', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const spec = createMockProvider([]);
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage('small'), spec, build: createMockProvider([{ text: 'x', tools: [write('subtract.js', 'x\n')] }, { text: 'Done.' }]) } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.equal(spec.requests.length, 0);
  assert.equal(out.run.steps.spec, undefined);
});

test('the spec-writer can ONLY write in its spec folder', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const events = [];
  const spec = createMockProvider([
    { text: 'Also fixing the code while I am here.', tools: [write('add.js', 'hacked\n'), write(`${specDir}/requirements.md`, REQ), write(`${specDir}/design.md`, DESIGN), write(`${specDir}/tasks.md`, TASKS)] },
    { text: 'Spec written.' },
  ]);
  const repo = makeRepo({ 'add.js': 'export const add = (a, b) => a + b;\n' });
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, agent: { onEvent: (e) => events.push(e) }, providers: { review: await approve(), triage: triage('large'), spec, ...builders() } }, { env, store });
  const denied = events.find((e) => e.type === 'tool_end' && e.name === 'Write' && e.isError);
  assert.ok(denied, 'the write to add.js was refused by the permission rules');
  assert.equal(out.status, 'delivered');
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:add.js'), 'export const add = (a, b) => a + b;');
});

test('a spec that stays broken fails the station (and its retry), never reaches the builder', async () => {
  const env = testEnv();
  const store = openStore({ env });
  // Each session: write the same useless file, say "Done." (3 sessions per try: 1 + 2 fixes; 2 tries.)
  const spec = createMockProvider(Array.from({ length: 6 }, () => [{ text: 'Writing.', tools: [write(`${specDir}/requirements.md`, 'nothing here\n')] }, { text: 'Done.' }]).flat());
  const b = builders();
  await assert.rejects(runJob({ autonomy: 'L2', issueFile: issueFile(), repo: makeRepo(), providers: { review: await approve(), triage: triage('medium'), spec, ...b } }, { env, store }), /spec: the spec still has/);
  assert.equal(b['build:T1'].requests.length, 0);
  const failures = store.read({ types: ['step.failed'] }).filter((e) => e.data.step === 'spec');
  assert.equal(failures.length, 2, 'tried twice (retries: 1)');
});

test('STEERING from the base commit reaches the spec-writer and the builder', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ '.factory/steering/tech.md': '# Tech\n\nUse node:test. Never add dependencies.\n' });
  const spec = createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, REQ), write(`${specDir}/design.md`, DESIGN), write(`${specDir}/tasks.md`, TASKS)] }, { text: 'Done.' }]);
  const b = builders();
  await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, providers: { review: await approve(), triage: triage('medium'), spec, ...b } }, { env, store });
  for (const p of [spec, b['build:T1']]) assert.match(JSON.stringify(p.requests[0].messages), /<steering file=\\".factory\/steering\/tech.md\\">[\s\S]*Never add dependencies/);
});

// ---- factory init -------------------------------------------------------------------------------

test('INIT drafts config + steering from what the repo has, as a draft PR; never overwrites', async () => {
  const { initRepo } = await import('../src/knowledge/init.js');
  const { createLocalForge } = await import('../src/forge/local.js');
  const env = testEnv();
  const repo = makeRepo({
    'package.json': JSON.stringify({ name: 'calc', description: 'A tiny calculator.', type: 'module', scripts: { test: 'node --test', lint: 'eslint .' } }),
    'package-lock.json': '{}',
    'README.md': '# calc\n\nAdds numbers, reliably.\n',
    'src/add.js': 'x',
    'test/add.test.js': 'x',
    '.factory/steering/tech.md': '# Tech (written by a human)\n',
  });
  const out = await initRepo({ repo, env, forge: createLocalForge({ env }) });
  assert.deepEqual(out.written.sort(), ['.factory/config.json', '.factory/steering/product.md', '.factory/steering/structure.md']);
  const show = (f) => gitIn(repo, 'show', `factory/init/main:${f}`);
  assert.deepEqual(JSON.parse(show('.factory/config.json')).gates, { lint: 'npm run lint', test: 'npm run test' }, 'cheapest first, only what exists');
  assert.equal(JSON.parse(show('.factory/config.json')).setup.command, 'npm ci');
  assert.match(show('.factory/steering/product.md'), /A tiny calculator\.[\s\S]*> Adds numbers, reliably\.[\s\S]*TODO \(a human\)/);
  assert.match(show('.factory/steering/structure.md'), /`src\/` \(1 file\): source code\n- `test\/` \(1 file\): tests/);
  assert.equal(show('.factory/steering/tech.md'), '# Tech (written by a human)', 'untouched');
  assert.match(fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8'), /status: draft[\s\S]*Please edit before merging/);
});
