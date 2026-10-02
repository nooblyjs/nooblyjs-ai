#!/usr/bin/env node
// @ts-check
// Phase F04: the Stop hook. "You're not done: the checks fail."
//
// The harness runs Stop hooks when the model is about to end its turn
// (harness Phase 12). Exit code 2 means "block": the hook's stderr is shown to
// the model, and the loop continues so it can fix things (at most 3 times).
//
// The factory installs this script as a Stop hook in every workspace that has
// fast gates:
//
//   node /…/src/exec/gates/stop-hook.js /…/workspaces/<id>/gates.json
//
// It runs the FAST gates in the workspace and, if one fails, tells the agent
// exactly what failed. So the agent fixes its own mistakes BEFORE it hands the
// work back, which is cheaper than a failed job and a repair round.
//
// This does not replace the gate runner: after the agent stops, the factory
// runs ALL gates again itself. The hook is a hint to the agent; the gate runner
// is the verdict.
//
// gates.json lives in the workspace folder, OUTSIDE the checkout, so the agent
// can't edit which checks run. (It could edit .factory/config.json in its
// checkout, but the factory read that file from the pinned base commit.)
import fs from 'node:fs';
import { runGates } from './runner.js';

const [file] = process.argv.slice(2);
try {
  // The harness sends the hook event as JSON on stdin; we don't need it, but read it so the pipe closes cleanly.
  fs.readFileSync(0);
} catch {
  // no stdin: fine
}

try {
  const { gates, network, allowUnsandboxed } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { passed, results } = await runGates(gates, { cwd: process.cwd(), network, allowUnsandboxed, fastOnly: true });
  if (passed) process.exit(0);
  const bad = results.find((r) => r.status !== 'passed' && r.status !== 'skipped');
  process.stderr.write(
    `The factory's checks failed, so the work is not done yet.\n` +
      `Check "${bad?.name}" (\`${bad?.command}\`) ${bad?.status === 'timeout' ? 'timed out' : 'failed'}:\n\n${bad?.excerpt}\n\n` +
      `Fix the cause (not the check), then finish again. Do not weaken or skip tests to make them pass.`,
  );
  process.exit(2);
} catch (error) {
  // Exit 1: "the hook itself broke". The harness tells the operator, not the model; the gate runner still decides.
  process.stderr.write(`factory stop hook: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
