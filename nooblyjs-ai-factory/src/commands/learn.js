// @ts-check
// Phase F21: `factory learn`, the learning loop.
//
//   factory learn                    retro every settled run (feedback → learnings), then list recurring patterns
//        [--now]                     don't wait for runs to settle (default: merged, or closed 24h ago)
//        [--agent] [--provider p] [--model m]   let the retro role phrase each lesson as a rule
//        [--min-runs 3]              how many different runs make a pattern
//   factory learn --propose          …and open a draft steering PR for each recurring pattern
//        [--bench] [--bench-agent oracle|null|model] [--bench-case id]… [--allow-unsandboxed]
//                                    …with bench numbers, with and without the rule
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadCases } from '../bench/cases.js';
import { compare, formatSummary } from '../bench/compare.js';
import { runBench } from '../bench/runner.js';
import { loadFactoryConfig } from '../config/factory-config.js';
import { forgeFor } from '../forge/index.js';
import { proposeRule, recurring, ruleFor } from '../knowledge/propose.js';
import { runRetros } from '../knowledge/retro.js';
import { builtInRoles } from '../roles/loader.js';
import { openStore } from '../store/events.js';

/** @param {string[]} argv */
export async function learnCommand(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      now: { type: 'boolean' }, agent: { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' }, 'min-runs': { type: 'string' },
      propose: { type: 'boolean' }, bench: { type: 'boolean' }, 'bench-agent': { type: 'string' }, 'bench-case': { type: 'string', multiple: true }, 'allow-unsandboxed': { type: 'boolean' },
    },
  });
  const config = loadFactoryConfig();
  const minRuns = Number(values['min-runs'] ?? config.learning?.minRuns ?? 3);
  const store = openStore();
  try {
    const learned = await runRetros(store, { roles: builtInRoles(), provider: values.agent ? (values.provider ?? 'anthropic') : undefined, model: values.model, settleHours: values.now ? 0 : (config.learning?.settleHours ?? 24), log: (l) => console.log(l) });
    console.log(`${learned.length} new learning(s).`);
    const patterns = recurring(store, { minRuns });
    if (!patterns.length) {
      console.log(`No pattern has recurred in ${minRuns}+ runs yet.`);
      return 0;
    }
    for (const c of patterns) console.log(`\n↻ ${c.runs.length} runs · ${c.key}\n  rule: ${ruleFor(c)}\n${c.members.map((m) => `  - [${m.source}] ${m.text.slice(0, 100)}`).join('\n')}`);
    if (!values.propose) {
      console.log('\nTo open a draft steering PR for each: factory learn --propose [--bench]');
      return 0;
    }
    for (const c of patterns) {
      const first = c.members[0];
      const out = await proposeRule(store, c, {
        forge: forgeFor({ forge: first.forge }),
        bench: values.bench ? benchWith({ agent: values['bench-agent'] ?? 'model', provider: values.provider, model: values.model, cases: values['bench-case'], allowUnsandboxed: values['allow-unsandboxed'] }) : undefined,
        log: (l) => console.log(l),
      });
      console.log(`\nPR (draft): ${out.pr}\n  changes: ${out.changed.join(', ')}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

/** A bench function for proposeRule: the same cases, without and with the proposed files. */
export function benchWith({ agent = 'model', provider, model, cases: only, allowUnsandboxed, repeats = 1 }) {
  return async (overlay) => {
    const cases = loadCases(undefined, { only: only ?? [] });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-learn-bench-'));
    const options = { repeats, tmp, allowUnsandboxed, agent: { kind: /** @type {any} */ (agent), provider, model } };
    try {
      const without = await runBench(cases, { ...options, label: 'without the rule' });
      const withRule = await runBench(cases, { ...options, label: 'with the rule', overlay });
      const c = compare(without, withRule);
      return [
        `${cases.length} case(s) × ${repeats} · agent: ${agent}${agent === 'model' ? ` (${provider ?? 'default'}${model ? `, ${model}` : ''})` : ' (a scripted agent: it checks the rule breaks nothing in the pipeline, not whether it helps a model)'}`,
        '',
        '```',
        formatSummary(c.a),
        '',
        formatSummary(c.b),
        '```',
        '',
        `Δ resolved: ${c.delta > 0 ? '+' : ''}${Math.round(c.delta * 100)} points${c.withinNoise ? ' (within noise)' : ''} · gained: ${c.flips.gained.join(', ') || '—'} · lost: ${c.flips.lost.join(', ') || '—'}`,
      ].join('\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}
