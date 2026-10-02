// Phase 19: the eval harness. Each case is a folder:
//
//   cases/<name>/
//   ├── case.json    { description, prompt, tags }
//   ├── repo/        the starter project, copied to a temp folder for each run
//   ├── solution/    files that make the task done (only for --verify: proves the checker CAN pass)
//   └── check.js     export default async ({ dir, answer }) => ({ pass, message })
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSession } from '../../src/index.js';
import { summarizeTraces } from '../../src/core/trace.js';
import { MARKER } from './checks.js';

export const CASES_DIR = fileURLToPath(new URL('./cases/', import.meta.url));

export function loadCases(only) {
  return fs
    .readdirSync(CASES_DIR)
    .filter((name) => fs.existsSync(path.join(CASES_DIR, name, 'case.json')))
    .filter((name) => !only?.length || only.includes(name))
    .sort()
    .map((name) => ({ name, dir: path.join(CASES_DIR, name), ...JSON.parse(fs.readFileSync(path.join(CASES_DIR, name, 'case.json'), 'utf8')) }));
}

/** A fresh copy of the starter repo in a temp folder. */
export function prepareCase(evalCase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `noobly-eval-${evalCase.name}-`));
  fs.cpSync(path.join(evalCase.dir, 'repo'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ repo: path.join(evalCase.dir, 'repo') }));
  return dir;
}

/** Copy the reference solution over the work folder. Returns its ANSWER.txt, if any. */
export function applySolution(evalCase, dir) {
  fs.cpSync(path.join(evalCase.dir, 'solution'), dir, { recursive: true });
  const answer = path.join(dir, 'ANSWER.txt');
  return fs.existsSync(answer) ? fs.readFileSync(answer, 'utf8') : '';
}

export async function check(evalCase, dir, answer) {
  const { default: checker } = await import(pathToFileURL(path.join(evalCase.dir, 'check.js')).href);
  try {
    return await checker({ dir, answer });
  } catch (error) {
    return { pass: false, message: `checker crashed: ${error.message}` };
  }
}

/**
 * Run one case with the real agent.
 * @param {{ provider?: string, model?: string, settings?: object, appendSystem?: string, maxTurns?: number }} options
 */
export async function runCase(evalCase, options = {}) {
  const dir = prepareCase(evalCase);
  const started = Date.now();
  const session = await createSession({
    cwd: dir,
    provider: options.provider,
    model: options.model,
    settings: options.settings,
    maxTurns: options.maxTurns ?? 30,
    // Unattended, in a throwaway copy: nothing asks. (Deny rules still apply.)
    permissionMode: 'bypass',
  });
  // A/B experiments: e.g. an extra paragraph of instructions at the end of the system prompt.
  if (options.appendSystem) session.systemPrompt += `\n\n${options.appendSystem}`;

  let end = null;
  let error = null;
  try {
    end = await session.send(evalCase.prompt);
  } catch (caught) {
    error = caught.message;
  }
  const result = error ? { pass: false, message: `agent error: ${error}` } : await check(evalCase, dir, end?.text);
  const stats = summarizeTraces(session.traces);
  if (!options.keep) fs.rmSync(dir, { recursive: true, force: true });
  return {
    case: evalCase.name,
    pass: result.pass,
    message: result.message ?? null,
    durationMs: Date.now() - started,
    rounds: end?.rounds ?? 0,
    toolCalls: end?.toolCalls ?? 0,
    stopReason: end?.stopReason ?? null,
    tokens: stats.tokens,
    cost: session.cost,
    ...(options.keep && { dir }),
  };
}

/** Totals for a run. */
export function summarizeRun(results) {
  const passed = results.filter((r) => r.pass).length;
  const sum = (key) => results.reduce((total, r) => total + (typeof key === 'function' ? key(r) : r[key]), 0);
  return {
    cases: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    cost: sum('cost'),
    inputTokens: sum((r) => r.tokens.input + r.tokens.cacheRead + r.tokens.cacheWrite),
    outputTokens: sum((r) => r.tokens.output),
    toolCalls: sum('toolCalls'),
    durationMs: sum('durationMs'),
  };
}

/** Compare two saved runs (A/B): pass rate, cost and tokens, and which cases changed. */
export function compareRuns(a, b) {
  const byCase = (run) => new Map(run.results.flatMap((r) => (r.pass === undefined ? [] : [[r.case, r]])));
  const casesA = byCase(a);
  const casesB = byCase(b);
  const changed = [...casesA.keys()]
    .filter((name) => casesB.has(name) && casesA.get(name).pass !== casesB.get(name).pass)
    .map((name) => `${name}: ${casesA.get(name).pass ? 'pass' : 'fail'} → ${casesB.get(name).pass ? 'pass' : 'fail'}`);
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const delta = (x, y) => (x ? `${y >= x ? '+' : ''}${(((y - x) / x) * 100).toFixed(0)}%` : 'n/a');
  return [
    `            ${a.label.padEnd(20)} ${b.label.padEnd(20)} change`,
    `pass rate   ${pct(a.summary.passRate).padEnd(20)} ${pct(b.summary.passRate).padEnd(20)} ${((b.summary.passRate - a.summary.passRate) * 100).toFixed(0)} points`,
    `cost        $${a.summary.cost.toFixed(4).padEnd(19)} $${b.summary.cost.toFixed(4).padEnd(19)} ${delta(a.summary.cost, b.summary.cost)}`,
    `input tok.  ${String(a.summary.inputTokens).padEnd(20)} ${String(b.summary.inputTokens).padEnd(20)} ${delta(a.summary.inputTokens, b.summary.inputTokens)}`,
    `tool calls  ${String(a.summary.toolCalls).padEnd(20)} ${String(b.summary.toolCalls).padEnd(20)} ${delta(a.summary.toolCalls, b.summary.toolCalls)}`,
    changed.length ? `\nCases that changed:\n${changed.map((c) => `  ${c}`).join('\n')}` : '\nNo case changed result.',
  ].join('\n');
}
