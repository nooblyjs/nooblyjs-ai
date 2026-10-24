import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addScore, readScores, summarize, validateScore } from '../lib/scores.js';
import { pickSentence, SENTENCES } from '../lib/sentences.js';

const run = (wpm, accuracy = 95, at = '2026-01-01T00:00:00.000Z') => ({
  at, wpm, accuracy, errors: 1, keystrokes: 20, seconds: 30, score: Math.round((wpm * accuracy) / 100), sentence: 'x',
});

const goodBody = { wpm: 40.4, accuracy: 97.6, errors: 2, keystrokes: 60, seconds: 45.25, sentence: 'Hello there.' };

test('readScores returns an empty list when there is no file yet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typetest-'));
  assert.deepEqual(await readScores(join(dir, 'missing.json')), []);
});

test('addScore saves runs to the file and keeps the older ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typetest-'));
  const file = join(dir, 'data', 'scores.json');
  await addScore(file, run(30));
  const all = await addScore(file, run(40));
  assert.equal(all.length, 2);
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(onDisk.map((r) => r.wpm), [30, 40]);
});

test('readScores reports a broken file instead of hiding it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'typetest-'));
  const file = join(dir, 'scores.json');
  await writeFile(file, '{not json');
  await assert.rejects(readScores(file));
});

test('validateScore accepts a sensible run and works out the score', () => {
  const { value, error } = validateScore(goodBody);
  assert.equal(error, undefined);
  assert.equal(value.wpm, 40);
  assert.equal(value.accuracy, 98);
  assert.equal(value.score, 39); // 40 x 98%
  assert.equal(value.sentence, 'Hello there.');
  assert.ok(value.at);
});

test('validateScore rejects missing or out-of-range values', () => {
  assert.ok(validateScore(undefined).error);
  assert.ok(validateScore({ ...goodBody, wpm: -1 }).error);
  assert.ok(validateScore({ ...goodBody, accuracy: 101 }).error);
  assert.ok(validateScore({ ...goodBody, sentence: 42 }).error);
  assert.ok(validateScore({ ...goodBody, wpm: '40' }).error);
});

test('summarize says so when there are no runs', () => {
  assert.deepEqual(summarize([]), { runs: 0 });
});

test('summarize finds the best run and the average', () => {
  const summary = summarize([run(30, 90), run(50, 98), run(40, 94)]);
  assert.equal(summary.runs, 3);
  assert.equal(summary.best.wpm, 50);
  assert.equal(summary.averageWpm, 40);
});

test('summarize shows improvement by comparing early and recent runs', () => {
  const runs = [run(20, 80), run(22, 82), run(30, 90), run(34, 93)];
  const summary = summarize(runs);
  assert.equal(summary.earlyWpm, 21); // first two runs (window is half the runs, here 2)
  assert.equal(summary.recentWpm, 32); // last two runs
  assert.equal(summary.wpmChange, 11);
  assert.equal(summary.accuracyChange, 11);
});

test('summarize has no trend with only one run', () => {
  const summary = summarize([run(30)]);
  assert.equal(summary.wpmChange, null);
});

test('summarize uses at most five runs at each end', () => {
  const runs = Array.from({ length: 12 }, (_, i) => run(i < 6 ? 20 : 60));
  const summary = summarize(runs);
  assert.equal(summary.earlyWpm, 20);
  assert.equal(summary.recentWpm, 60);
});

test('pickSentence avoids repeating the sentence just shown', () => {
  const list = ['one', 'two'];
  assert.equal(pickSentence(list, () => 0.99, 'two'), 'one');
  assert.equal(pickSentence(list, () => 0.99, 'one'), 'two');
});

test('pickSentence still works when there is only one sentence', () => {
  assert.equal(pickSentence(['only'], () => 0.5, 'only'), 'only');
});

test('every built-in sentence is non-empty and under the length limit', () => {
  for (const text of SENTENCES) {
    assert.ok(text.length > 0 && text.length <= 500);
  }
});
