// Phase F19: the factory bench. Offline: the checkers, the runner (oracle and null agents), scoring, the miner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadCases, verifyCase } from '../src/bench/cases.js';
import { compare, summarise } from '../src/bench/compare.js';
import { isTest, mineCases } from '../src/bench/miner.js';
import { runCase } from '../src/bench/runner.js';
import { commitFiles, makeRepo, tmpDir, writeFiles } from './helpers.js';

test('--verify: every case\'s hidden tests FAIL on the start and PASS on the reference solution (and the start is green)', async () => {
  const cases = loadCases();
  assert.ok(cases.length >= 20, `at least 20 cases (${cases.length})`);
  const tmp = tmpDir();
  const checks = await Promise.all(cases.map((c) => verifyCase(c, tmp)));
  for (const r of checks) assert.ok(r.ok, `${r.id}: starter fails ${r.starterFails}, solution passes ${r.solutionPasses}, gates green ${r.starterGatesPass}\n${r.detail}`);
});

test('a case that measures nothing is caught: its hidden test passes on the start', async () => {
  const dir = tmpDir();
  writeFiles(path.join(dir, 'lazy'), {
    'case.json': '{ "id": "lazy", "title": "x" }',
    'issue.md': '# x\n',
    'repo/package.json': '{ "type": "module" }',
    'repo/a.js': 'export const a = 1;\n',
    'hidden/test/a.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { a } from '../a.js';\ntest('a', () => assert.equal(a, 1));\n",
    'solution/a.js': 'export const a = 1;\n',
  });
  const [c] = loadCases(dir);
  const r = await verifyCase(c, tmpDir());
  assert.equal(r.ok, false);
  assert.equal(r.starterFails, false);
});

test('the runner: the ORACLE (reference solution) resolves, through the whole line; the NULL agent does not', async () => {
  const [c] = loadCases(undefined, { only: ['fix-clamp'] });
  const oracle = await runCase(c, { agent: { kind: 'oracle' }, allowUnsandboxed: true });
  assert.equal(oracle.resolved, true, JSON.stringify(oracle));
  assert.equal(oracle.status, 'merged', 'autonomy L3');
  assert.deepEqual(oracle.protectedChanged, []);
  assert.ok(oracle.costUsd > 0 && oracle.durationMs > 0);
  const nothing = await runCase(c, { agent: { kind: 'null' }, allowUnsandboxed: true });
  assert.equal(nothing.resolved, false);
  assert.equal(nothing.status, 'no_changes');
});

const results = (label, rows) => ({ label, results: rows.map(([c, repeat, resolved, costUsd = 0.1, durationMs = 1000]) => ({ case: c, repeat, resolved, costUsd, durationMs, status: resolved ? 'merged' : 'gate_failed' })) });

test('scoring: mean and spread over repeats, cost per resolve, median time', () => {
  const s = summarise(results('a', [['x', 1, true], ['y', 1, false], ['x', 2, true], ['y', 2, true], ['x', 3, false, 0.3, 5000], ['y', 3, false]]));
  assert.equal(s.runs, 6);
  assert.equal(s.repeats, 3);
  assert.equal(Math.round(s.resolveRate * 100), 50); // 50%, 100%, 0%
  assert.deepEqual([s.spread.min, s.spread.max], [0, 1]);
  assert.equal(Math.round(s.costPerResolve * 1000) / 1000, Math.round((0.8 / 3) * 1000) / 1000, 'failures cost money too');
  assert.equal(s.medianMs, 1000);
  assert.deepEqual(s.perCase, { x: 2 / 3, y: 1 / 3 });
});

test('compare: per-case flips, and a difference inside the spread is called noise', () => {
  const a = results('a', [['x', 1, true], ['y', 1, false], ['z', 1, true], ['x', 2, true], ['y', 2, false], ['z', 2, false]]);
  const b = results('b', [['x', 1, false], ['y', 1, true], ['z', 1, true], ['x', 2, false], ['y', 2, true], ['z', 2, true]]);
  const c = compare(a, b);
  assert.deepEqual(c.flips.lost, ['x']);
  assert.deepEqual(c.flips.gained, ['y']);
  assert.equal(c.withinNoise, true, 'a scored 67% and 33%, b 67% and 67%: the ranges overlap, so +17 points is noise');
  const low = results('low', [['x', 1, false], ['y', 1, false], ['x', 2, true], ['y', 2, false]]);
  const high = results('high', [['x', 1, true], ['y', 1, true], ['x', 2, true], ['y', 2, true]]);
  assert.equal(compare(low, high).withinNoise, false, '0–50% vs 100%: a real difference');
  const same = compare(a, a);
  assert.equal(same.delta, 0);
  assert.equal(same.withinNoise, true);
});

test('the miner: a commit that changed code AND tests becomes a proposed case (start, hidden tests, solution, a draft issue)', async () => {
  const repo = makeRepo({ 'package.json': '{ "type": "module" }', 'src/sum.js': 'export const sum = (xs) => xs.reduce((a, b) => a + b);\n' });
  commitFiles(repo, { 'README.md': '# docs only\n' }, 'Docs only');
  commitFiles(repo, {
    'src/sum.js': 'export const sum = (xs) => xs.reduce((a, b) => a + b, 0);\n',
    'test/sum.test.js': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sum } from '../src/sum.js';\ntest('empty', () => assert.equal(sum([]), 0));\n",
  }, 'Fix sum of an empty list\n\nreduce without an initial value throws on [].');
  const out = tmpDir();
  const found = await mineCases(repo, { out, limit: 5 });
  assert.equal(found.length, 1, 'only the commit with code and tests');
  const [p] = found;
  assert.match(p.id, /^fix-sum-of-an-empty-list-[0-9a-f]{7}$/);
  const dir = path.join(out, p.id);
  assert.match(fs.readFileSync(path.join(dir, 'repo/src/sum.js'), 'utf8'), /\(a, b\) => a \+ b\);/, 'the start: before the fix');
  assert.equal(fs.existsSync(path.join(dir, 'repo/test/sum.test.js')), false, 'the tests are hidden');
  assert.match(fs.readFileSync(path.join(dir, 'solution/src/sum.js'), 'utf8'), /, 0\)/);
  assert.match(fs.readFileSync(path.join(dir, 'issue.md'), 'utf8'), /# Fix sum of an empty list[\s\S]*DRAFT/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8')).needsReview, true);
  const [mined] = loadCases(out);
  const verdict = await verifyCase(mined, tmpDir());
  assert.equal(verdict.starterFails && verdict.solutionPasses, true, 'a sound case, once curated');
  assert.equal(isTest('src/a.spec.ts') && isTest('__tests__/x.js') && !isTest('src/testing.js'), true);
});
