#!/usr/bin/env node
// Phase 19: run the evals.
//
//   npm run eval -- --verify                         offline: every checker fails on the starter repo and passes on the solution
//   npm run eval                                     run every case against the real model (costs money; needs an API key)
//   npm run eval -- --case fix-crash --model claude-sonnet-5-5
//   npm run eval -- --label baseline --repeat 3      run each case 3 times (models vary: one run proves little)
//   npm run eval -- --label concise --append-system prompts/concise.md    an A/B variant
//   npm run eval -- --settings variant.json          another variant: settings overrides, e.g. {"compactThreshold": 0.5}
//   npm run eval -- --compare results/a.json results/b.json
//
// Results are saved to test/evals/results/<time>-<label>.json for comparing over time.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applySolution, check, compareRuns, loadCases, prepareCase, runCase, summarizeRun } from './lib.js';

const { values } = parseArgs({
  options: {
    verify: { type: 'boolean' },
    case: { type: 'string', multiple: true },
    provider: { type: 'string' },
    model: { type: 'string' },
    label: { type: 'string' },
    repeat: { type: 'string' },
    'append-system': { type: 'string' },
    settings: { type: 'string' },
    keep: { type: 'boolean' },
    compare: { type: 'string', multiple: true },
  },
});

const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));

if (values.compare) {
  if (values.compare.length !== 2) throw new Error('--compare needs two result files: --compare a.json --compare b.json');
  const [a, b] = values.compare.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(compareRuns(a, b));
  process.exit(0);
}

const cases = loadCases(values.case);
if (!cases.length) throw new Error(`No eval cases found${values.case ? ` named ${values.case.join(', ')}` : ''}.`);

if (values.verify) {
  // Offline: a checker that passes on the untouched repo, or fails on the solution, is broken.
  let broken = 0;
  for (const evalCase of cases) {
    const untouched = prepareCase(evalCase);
    const before = await check(evalCase, untouched, '');
    const solved = prepareCase(evalCase);
    const answer = applySolution(evalCase, solved);
    const after = await check(evalCase, solved, answer);
    const ok = !before.pass && after.pass;
    if (!ok) broken += 1;
    console.log(`${ok ? '✓' : '✗'} ${evalCase.name.padEnd(22)} starter: ${before.pass ? 'PASSES (bad)' : `fails (${before.message})`} · solution: ${after.pass ? 'passes' : `FAILS: ${after.message}`}`);
    for (const dir of [untouched, solved]) fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(broken ? 1 : 0);
}

const options = {
  provider: values.provider,
  model: values.model,
  keep: values.keep,
  appendSystem: values['append-system'] ? fs.readFileSync(values['append-system'], 'utf8') : undefined,
  settings: values.settings ? JSON.parse(fs.readFileSync(values.settings, 'utf8')) : undefined,
};
const repeat = Number(values.repeat ?? 1);
const label = values.label ?? 'run';
console.log(`Running ${cases.length} case(s) × ${repeat}${values.model ? ` with ${values.model}` : ''} (label "${label}"). This uses the real API and costs money.\n`);

const results = [];
for (let i = 0; i < repeat; i++) {
  for (const evalCase of cases) {
    const result = await runCase(evalCase, options);
    results.push(result);
    console.log(
      `${result.pass ? '✓' : '✗'} ${evalCase.name.padEnd(22)} ${(result.durationMs / 1000).toFixed(1).padStart(5)}s  ${String(result.toolCalls).padStart(3)} tools  $${result.cost.toFixed(4)}${result.pass ? '' : `  ${result.message}`}`,
    );
  }
}

const summary = summarizeRun(results);
console.log(`\nPassed ${summary.passed}/${summary.cases} (${(summary.passRate * 100).toFixed(0)}%) · $${summary.cost.toFixed(4)} · ${summary.inputTokens.toLocaleString()} input / ${summary.outputTokens.toLocaleString()} output tokens · ${summary.toolCalls} tool calls`);

fs.mkdirSync(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`);
fs.writeFileSync(file, JSON.stringify({ label, date: new Date().toISOString(), options: { ...options, appendSystem: values['append-system'] ?? null }, summary, results }, null, 2));
console.log(`Saved ${path.relative(process.cwd(), file)}`);
