// Score storage and progress summary. Scores are kept in a JSON file, so they
// survive restarts. Nothing here knows about Express, so it is easy to test.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_FILE = fileURLToPath(new URL('../data/scores.json', import.meta.url));

/** Read every saved run. A missing file means no runs yet. */
export async function readScores(file = DATA_FILE) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Add one run to the file and return the full list. */
export async function addScore(file, entry) {
  const scores = await readScores(file);
  scores.push(entry);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(scores, null, 2));
  return scores;
}

/**
 * Check a run sent by the browser. Returns { value } when it is fine, or { error }.
 * The score is worked out here (speed x accuracy), so the browser cannot choose it.
 */
export function validateScore(body) {
  const { wpm, accuracy, errors, keystrokes, seconds, sentence } = body ?? {};
  const inRange = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (
    !inRange(wpm, 0, 400) || !inRange(accuracy, 0, 100) || !inRange(errors, 0, 100000) ||
    !inRange(keystrokes, 0, 100000) || !inRange(seconds, 0, 86400) ||
    typeof sentence !== 'string' || sentence.length > 500
  ) {
    return { error: 'That score is not valid' };
  }
  const rounded = Math.round(wpm);
  const acc = Math.round(accuracy);
  return {
    value: {
      at: new Date().toISOString(),
      wpm: rounded,
      accuracy: acc,
      errors: Math.round(errors),
      keystrokes: Math.round(keystrokes),
      seconds: Math.round(seconds * 10) / 10,
      score: Math.round((rounded * acc) / 100),
      sentence,
    },
  };
}

const average = (list, key) =>
  list.length === 0 ? null : Math.round(list.reduce((sum, run) => sum + run[key], 0) / list.length);

/**
 * Summarise progress. Compares the first few runs with the most recent few,
 * so you can see whether you are getting faster and more accurate.
 */
export function summarize(scores) {
  if (scores.length === 0) return { runs: 0 };

  const best = scores.reduce((top, run) => (run.score > top.score ? run : top));
  // Compare up to 5 early runs with up to 5 recent runs, never overlapping.
  const window = Math.min(5, Math.floor(scores.length / 2));
  const early = scores.slice(0, Math.max(window, 1));
  const recent = scores.slice(-Math.max(window, 1));
  const hasTrend = scores.length >= 2;

  return {
    runs: scores.length,
    best: { wpm: best.wpm, accuracy: best.accuracy, score: best.score, at: best.at },
    averageWpm: average(scores, 'wpm'),
    averageAccuracy: average(scores, 'accuracy'),
    earlyWpm: hasTrend ? average(early, 'wpm') : null,
    recentWpm: hasTrend ? average(recent, 'wpm') : null,
    wpmChange: hasTrend ? average(recent, 'wpm') - average(early, 'wpm') : null,
    accuracyChange: hasTrend ? average(recent, 'accuracy') - average(early, 'accuracy') : null,
  };
}
