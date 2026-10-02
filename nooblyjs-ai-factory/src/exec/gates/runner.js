// @ts-check
// Phase F04: DETERMINISTIC GATES. Checks a program can decide, run by the
// factory, outside the agent.
//
// An agent's "All tests pass!" is a claim. `npm test` exiting 0 is a fact.
// The factory only trusts facts, so after the agent stops, the factory runs
// the repo's declared checks itself:
//
//   - in a FRESH shell, in the workspace, in the harness sandbox (it's the repo's code)
//   - in the declared ORDER, cheapest first (lint before a 5-minute test suite)
//   - FAIL FAST: at the first failure the rest are skipped. More failures rarely help,
//     and each costs time
//   - each with a TIME LIMIT; a hung test counts as a failure, not a hang
//   - with a failure EXCERPT (head + tail) that goes in the PR, and to the agent
//
// "Deterministic" is the point: same code, same result, whatever the model thinks.
import { runCommand } from '../sandbox.js';
import { excerpt } from './excerpt.js';

/**
 * @typedef {Object} GateResult
 * @property {string} name
 * @property {string} command
 * @property {'passed' | 'failed' | 'timeout' | 'skipped' | 'error'} status
 * @property {number | null} exitCode
 * @property {number} durationMs
 * @property {string} excerpt     for failed / timeout / error
 */

/**
 * @param {import('../workspace/repo-config.js').Gate[]} gates
 * @param {{ cwd: string, network?: any, allowUnsandboxed?: boolean, fastOnly?: boolean, run?: typeof runCommand }} options
 * @returns {Promise<{ passed: boolean, results: GateResult[] }>}
 */
export async function runGates(gates, { cwd, network = 'none', allowUnsandboxed = false, fastOnly = false, run = runCommand }) {
  const selected = fastOnly ? gates.filter((g) => g.fast) : gates;
  /** @type {GateResult[]} */
  const results = [];
  let failed = false;
  for (const gate of selected) {
    if (failed) {
      results.push({ name: gate.name, command: gate.command, status: 'skipped', exitCode: null, durationMs: 0, excerpt: '' });
      continue;
    }
    const started = Date.now();
    try {
      const r = await run(gate.command, { cwd, network, allowUnsandboxed, timeoutMs: gate.timeoutMs });
      const status = r.timedOut ? 'timeout' : r.code === 0 ? 'passed' : 'failed';
      const note = r.timedOut ? `\n(stopped after ${Math.round(gate.timeoutMs / 1000)}s: the gate's time limit)` : '';
      results.push({ name: gate.name, command: gate.command, status, exitCode: r.timedOut ? null : r.code, durationMs: Date.now() - started, excerpt: status === 'passed' ? '' : excerpt(r.output) + note });
      failed = status !== 'passed';
    } catch (error) {
      // Couldn't run at all (e.g. no sandbox and not allowed): that's a failure too, never a pass.
      results.push({ name: gate.name, command: gate.command, status: 'error', exitCode: null, durationMs: Date.now() - started, excerpt: error instanceof Error ? error.message : String(error) });
      failed = true;
    }
  }
  return { passed: !failed, results };
}

/** A GateResult list as a Markdown table plus the first failure's excerpt: for PRs and for the agent. */
export function formatGates(results) {
  if (!results.length) return '## Checks\n\n⚠️ No checks are configured (`gates` in `.factory/config.json`), so nothing verified this change.';
  const icon = { passed: '✅', failed: '❌', timeout: '⏱️', skipped: '⏭️', error: '⚠️' };
  const rows = results.map((r) => `| ${icon[r.status]} ${r.name} | \`${r.command.replace(/\|/g, '\\|')}\` | ${r.status} | ${(r.durationMs / 1000).toFixed(1)}s |`);
  const firstBad = results.find((r) => r.status !== 'passed' && r.status !== 'skipped');
  const detail = firstBad ? `\n\n**${firstBad.name}** (${firstBad.status}):\n\n\`\`\`\n${firstBad.excerpt}\n\`\`\`` : '';
  return `## Checks\n\n| Gate | Command | Result | Time |\n|---|---|---|---|\n${rows.join('\n')}${detail}`;
}
