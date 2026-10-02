// @ts-check
// Phase F19: `factory bench`
//
//   factory bench --verify                          every case's checker: fails on the start, passes on the solution
//   factory bench --label baseline --repeat 3       the real thing (a model; costs money)
//        [--provider anthropic] [--model …] [--case id]… [--tag bug]… [--budget usd] [--allow-unsandboxed]
//   factory bench --agent oracle|null --label …     the ceiling / the floor, no model needed
//   factory bench --compare a.json b.json           two results, per case, with the noise called out
//   factory bench --routing cheap-first --label …   the same bench under a routing policy (Phase F22)
//   factory bench mine --repo <path> [--limit 10]   propose cases from a repo's history (bench/proposed/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CASES_DIR, loadCases, verifyCase } from '../bench/cases.js';
import { compare, formatComparison, formatSummary, summarise } from '../bench/compare.js';
import { mineCases } from '../bench/miner.js';
import { runBench } from '../bench/runner.js';

const RESULTS = path.resolve(import.meta.dirname, '../../bench/results');

/** @param {string[]} argv */
export async function benchCommand(argv) {
  if (argv[0] === 'mine') return mine(argv.slice(1));
  const { values } = parseArgs({
    args: argv,
    options: {
      verify: { type: 'boolean' }, compare: { type: 'string', multiple: true }, label: { type: 'string' }, repeat: { type: 'string' },
      agent: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, driver: { type: 'string' },
      case: { type: 'string', multiple: true }, tag: { type: 'string', multiple: true }, cases: { type: 'string' },
      budget: { type: 'string' }, routing: { type: 'string' }, 'allow-unsandboxed': { type: 'boolean' }, keep: { type: 'boolean' }, out: { type: 'string' },
    },
  });
  if (values.compare) {
    if (values.compare.length !== 2) throw new Error('Usage: factory bench --compare a.json --compare b.json');
    const [a, b] = values.compare.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    console.log(formatComparison(compare(a, b)));
    return 0;
  }
  const cases = loadCases(values.cases ?? CASES_DIR, { only: values.case ?? [], tags: values.tag ?? [] });
  if (!cases.length) throw new Error('No cases matched.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-bench-'));

  if (values.verify) {
    const checks = await Promise.all(cases.map((c) => verifyCase(c, tmp)));
    for (const r of checks) console.log(`${r.ok ? '✓' : '✗'} ${r.id.padEnd(28)} ${[!r.starterGatesPass && "the repo's own tests fail at the start", !r.starterFails && 'hidden tests PASS on the start (measures nothing)', !r.solutionPasses && `hidden tests FAIL on the solution\n${r.detail}`].filter(Boolean).join('; ') || 'start: fails · solution: passes'}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    const bad = checks.filter((r) => !r.ok).length;
    console.log(`\n${checks.length - bad}/${checks.length} cases are sound.`);
    return bad ? 1 : 0;
  }

  const kind = values.agent ?? 'model';
  if (!['model', 'oracle', 'null'].includes(kind)) throw new Error('--agent is oracle, null, or (default) model.');
  const label = values.label ?? kind;
  const repeats = Number(values.repeat ?? 1);
  console.log(`bench "${label}": ${cases.length} case(s) × ${repeats} · agent ${kind}${kind === 'model' ? ` (${values.provider ?? 'default provider'}${values.model ? `, ${values.model}` : ''})` : ''}`);
  const bench = await runBench(cases, {
    label, repeats, tmp, keep: values.keep, routing: values.routing, allowUnsandboxed: values['allow-unsandboxed'], budgetUsd: values.budget ? Number(values.budget) : undefined,
    agent: { kind: /** @type {any} */ (kind), provider: values.provider, model: values.model, driver: values.driver },
    onResult: (r) => console.log(`  ${r.resolved ? '✓' : '✗'} ${r.case.padEnd(24)} #${r.repeat}  ${String(r.status).padEnd(16)} $${r.costUsd.toFixed(4)}  ${(r.durationMs / 1000).toFixed(1)}s${r.error ? `  ${r.error}` : ''}`),
  });
  const out = values.out ?? path.join(RESULTS, `${bench.finishedAt.slice(0, 16).replace(/[:T]/g, '-')}-${label}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(bench, null, 2)}\n`);
  console.log(`\n${formatSummary(summarise(bench))}\n\nSaved: ${out}`);
  if (!values.keep) fs.rmSync(tmp, { recursive: true, force: true });
  return 0;
}

async function mine(argv) {
  const { values } = parseArgs({ args: argv, options: { repo: { type: 'string' }, limit: { type: 'string' }, out: { type: 'string' }, since: { type: 'string' } } });
  if (!values.repo) throw new Error('Usage: factory bench mine --repo <path> [--limit 10] [--since 2026-01-01] [--out bench/proposed]');
  const out = path.resolve(values.out ?? path.join(CASES_DIR, '..', 'proposed'));
  const found = await mineCases(path.resolve(values.repo), { out, limit: Number(values.limit ?? 10), since: values.since });
  for (const p of found) console.log(`proposed ${p.id}\n  tests: ${p.tests.join(', ')}\n  code:  ${p.code.join(', ')}`);
  console.log(found.length ? `\n${found.length} proposal(s) in ${out}. Rewrite each issue.md, check it with factory bench --verify --cases ${out}, then move the good ones to bench/cases/.` : 'No commits changed both code and tests (small ones, without deletions).');
  return 0;
}
