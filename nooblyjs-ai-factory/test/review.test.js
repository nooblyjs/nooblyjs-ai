// Phase F11: review: tampering (deterministic), reviewer findings (validated), security review (when sensitive).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { formatReview, parseReview } from '../src/review/findings.js';
import { detectTampering } from '../src/review/tampering.js';
import { openStore } from '../src/store/events.js';
import { approve, commitFiles, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

// ---- tampering: deterministic -------------------------------------------------------------------

test('TAMPERING: removed assertions, deleted tests and new skips are blocking; adding tests is fine', async () => {
  const repo = makeRepo({
    'test/a.test.js': "test('a', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(0, 0), 0);\n});\n",
    'test/b.test.js': "test('b', () => assert.ok(true));\n",
    'src/x.js': 'x\n',
  });
  const base = gitIn(repo, 'rev-parse', 'HEAD');
  fs.rmSync(path.join(repo, 'test/b.test.js'));
  const head = commitFiles(repo, {
    'test/a.test.js': "test('a', () => {\n  assert.equal(add(1, 2), 3);\n});\ntest.skip('later', () => {});\n",
    'test/new.test.js': "test('n', () => assert.ok(true));\n",
    'src/x.js': 'y\n',
  });
  const found = await detectTampering(repo, base, head);
  const text = found.map((f) => f.rationale).join('\n');
  assert.ok(found.every((f) => f.severity === 'blocking'));
  assert.match(text, /The test file test\/b\.test\.js was deleted/);
  assert.match(text, /1 assertion\(s\) were removed from test\/a\.test\.js/);
  assert.match(text, /skipped or focused in test\/a\.test\.js: test\.skip/);
  assert.equal(found.length, 3, 'the new test file and the src change are not findings');
});

// ---- the reviewer's answer: validated -----------------------------------------------------------

test('parseReview: a valid review; each kind of mistake is named', () => {
  const ok = parseReview('```json\n{"verdict":"changes_requested","summary":"s","findings":[{"severity":"blocking","file":"d.js","line":2,"requirementId":"R2.2","rationale":"returns Infinity"}]}\n```', { requirementIds: ['R2', 'R2.2'] });
  assert.equal(ok.review?.findings[0].requirementId, 'R2.2');
  const bad = parseReview('```json\n{"verdict":"approve","findings":[{"severity":"fatal"},{"severity":"blocking","rationale":"x","requirementId":"R9.9"}]}\n```', { requirementIds: ['R1.1'] });
  const text = bad.problems.join('\n');
  for (const want of [/finding 1: "severity" must be one of/, /finding 1: "rationale" is required/, /"R9\.9" is not a requirement id/, /"approve" with a blocking finding contradicts itself/]) assert.match(text, want);
  assert.deepEqual(parseReview('Looks good to me!').problems, ['the answer has no JSON object in a ```json block']);
});

test('formatReview: sorted by severity, with who found it', () => {
  const md = formatReview([{ by: 'reviewer', verdict: 'changes_requested', summary: 'One problem.', findings: [{ severity: 'nit', rationale: 'naming', source: 'reviewer' }, { severity: 'blocking', file: 'd.js', line: 2, requirementId: 'R2.2', rationale: 'Infinity', suggestion: 'throw', source: 'reviewer' }] }]);
  assert.ok(md.indexOf('⛔ blocking') < md.indexOf('⚪ nit'));
  assert.match(md, /\| ⛔ blocking \| `d\.js:2` \| R2\.2 \| Infinity<br>→ throw \| reviewer \|/);
});

// ---- the stations, end to end -------------------------------------------------------------------

const triage = (size = 'small') => createMockProvider([{ text: `\`\`\`json\n${JSON.stringify({ kind: 'feature', size, clear: true, outOfScope: false, questions: [], reason: 'ok' })}\n\`\`\`` }]);
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });
function issueFile(title = 'Add divide') {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, `---\ntitle: ${title}\n---\ndivide(a, b); dividing by zero must throw.\n`);
  return file;
}
const builder = (files, existing = []) => createMockProvider([...(existing.length ? [{ text: 'Reading.', tools: existing.map(read) }] : []), { text: 'Writing.', tools: Object.entries(files).map(([f, c]) => write(f, c)) }, { text: 'Done, and it works.' }]);

test('THE CHECKPOINT: tests pass, but an acceptance criterion is not met → a BLOCKING finding naming the requirement; the PR is a draft', async () => {
  const env = testEnv({ repairAttempts: 0 }); // F13 would repair it: this test is about what the REVIEW finds
  const store = openStore({ env });
  const specDir = '.factory/specs/issue-1';
  const REQ = '## R1: Divide\nAs a user, I want to divide, so that I get ratios.\n- R1.1 WHEN divide(a, b) is called with b not 0 THE SYSTEM SHALL return a divided by b\n- R1.2 IF b is 0 THEN THE SYSTEM SHALL throw a RangeError\n';
  const spec = createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, REQ), write(`${specDir}/design.md`, '# Design\nOne file.\n'), write(`${specDir}/tasks.md`, '- [ ] T1: divide\n  - Requirements: R1\n  - Paths: divide.js, test/divide.test.js\n')] }, { text: 'Done.' }]);
  // The builder "forgets" R1.2, and its test only covers R1.1: the gate passes.
  const build = builder({ 'divide.js': 'export const divide = (a, b) => a / b;\n', 'test/divide.test.js': "import assert from 'node:assert';\nimport { divide } from '../divide.js';\nassert.equal(divide(6, 3), 2);\n" });
  const review = createMockProvider([
    { text: 'Reading the code.', tools: [read('divide.js')] },
    { text: '```json\n' + JSON.stringify({ verdict: 'changes_requested', summary: 'R1.2 is not implemented.', findings: [{ severity: 'blocking', file: 'divide.js', line: 1, requirementId: 'R1.2', rationale: 'divide(1, 0) returns Infinity; R1.2 requires a RangeError, and no test covers it.', suggestion: "if (b === 0) throw new RangeError('division by zero')" }] }) + '\n```' },
  ]);
  const repo = makeRepo({ '.factory/config.json': JSON.stringify({ gates: { test: 'node test/divide.test.js' } }) });
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage('medium'), spec, build, review } }, { env, store });
  assert.equal(out.run.steps.verify.result.passed, true, 'the gates pass…');
  assert.equal(out.status, 'changes_requested', '…but the review blocks it');
  const pr = fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8');
  assert.match(pr, /status: draft/);
  assert.match(pr, /The review found 1 blocking problem/);
  assert.match(pr, /\| ⛔ blocking \| `divide\.js:1` \| R1\.2 \| divide\(1, 0\) returns Infinity/);
  assert.match(JSON.stringify(review.requests[0].messages), /R1\.2 IF b is 0 THEN THE SYSTEM SHALL throw a RangeError[\s\S]*```diff/, 'the reviewer saw the criteria and the diff');
});

test('the reviewer is READ-ONLY; an invalid answer is sent back and re-asked', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const events = [];
  const review = createMockProvider([
    { text: 'I will just fix it.', tools: [write('GREETING.md', 'fixed by the reviewer\n')] },
    { text: 'LGTM!' },
    { text: '```json\n{"verdict":"approve","summary":"Fine.","findings":[]}\n```' },
  ]);
  const out = await runJob({ issueFile: issueFile('Add a greeting'), repo: makeRepo(), agent: { onEvent: (e) => events.push(e) }, providers: { triage: triage(), build: builder({ 'GREETING.md': 'Hello\n' }), review } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.ok(events.find((e) => e.type === 'tool_end' && e.name === 'Write' && e.isError && /GREETING/.test(JSON.stringify(e))), 'its Write was refused');
  assert.match(JSON.stringify(review.requests[2].messages), /Your review could not be used:[\s\S]*no JSON object/);
  assert.equal(gitIn(out.run.request.repo, 'show', 'factory/issue-1/main:GREETING.md'), 'Hello');
});

test('TAMPERING blocks even when the reviewer approves', async () => {
  const env = testEnv({ repairAttempts: 0 }); // about the finding, not the repair (F13)
  const store = openStore({ env });
  const repo = makeRepo({ 'test/add.test.js': "assert.equal(add(1, 2), 3);\nassert.equal(add(2, 2), 4);\n" });
  const cheat = builder({ 'test/add.test.js': 'assert.equal(add(1, 2), 3);\n' }, ['test/add.test.js']);
  const out = await runJob({ issueFile: issueFile('Make the tests pass'), repo, providers: { triage: triage(), build: cheat, review: await approve() } }, { env, store });
  assert.equal(out.status, 'changes_requested');
  const findings = out.run.steps.review.result.findings;
  assert.deepEqual(findings.map((f) => [f.severity, f.source]), [['blocking', 'tampering-check']]);
});

test('SECURITY review runs only for sensitive paths or dependency changes (from the ORIGINAL base\'s config)', async () => {
  const run = async (files) => {
    const env = testEnv();
    const store = openStore({ env });
    const security = await approve([{ severity: 'minor', rationale: 'Consider rate limiting.' }]);
    const repo = makeRepo({ '.factory/config.json': JSON.stringify({ review: { sensitive: ['src/auth/**'] } }), 'package.json': '{}' });
    const out = await runJob({ issueFile: issueFile('Change'), repo, providers: { triage: triage(), build: builder(files, Object.keys(files).filter((f) => f === 'package.json')), review: await approve(), security } }, { env, store });
    return { out, security };
  };
  const plain = await run({ 'src/app.js': 'x\n' });
  assert.equal(plain.security.requests.length, 0);
  assert.equal(plain.out.run.steps.security, undefined);
  const auth = await run({ 'src/auth/login.js': 'x\n' });
  assert.equal(auth.security.requests.length, 1);
  assert.deepEqual(auth.out.run.steps.review.result.sensitiveFiles, ['src/auth/login.js']);
  assert.match(fs.readFileSync(/** @type {string} */ (auth.out.pr?.path), 'utf8'), /security-reviewer/);
  const deps = await run({ 'package.json': '{"dependencies":{"left-pad":"1.3.0"}}\n' });
  assert.equal(deps.security.requests.length, 1, 'a dependency change is sensitive by default');
});
