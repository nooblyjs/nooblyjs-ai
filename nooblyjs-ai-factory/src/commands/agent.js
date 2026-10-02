// @ts-check
// Phase F01: `factory agent`: run ONE agent through a driver and watch it.
//
// A debugging tool for the seam between factory and harness. Later phases run
// agents from stations; this lets you poke the same code path by hand.
//
//   factory agent "What does src/cli.js do?"                          subprocess driver, your API key
//   factory agent --echo "read package.json"                          offline, the harness's echo model
//   factory agent --script examples/scripts/add-greeting.json --cwd x offline, a scripted model (in-process)
//   factory agent --budget 0.05 --timeout 120 "…"                     limits
//   factory agent --repo ../my-app "…"                                Phase F02: in a fresh workspace + branch
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDriver } from '../exec/harness/driver.js';
import { runStep } from '../exec/step-runner.js';
import { loadScriptedProvider } from '../exec/harness/script.js';

export const HELP = `Usage: factory agent [options] "<prompt>"

Run one noobly agent through a driver and print what it does.

Options:
  --driver <name>          subprocess (default) | in-process
  --cwd <dir>              where the agent works (default: here)
  --provider <id>          anthropic | openai | grok | ollama | echo
  --model <id>             e.g. claude-sonnet-5-5
  --echo                   the harness's offline echo model (same as --provider echo)
  --script <file.json>     a scripted model: a JSON array of replies (in-process; "delayMs" slows a reply down)
  --permission-mode <m>    default | acceptEdits | plan
  --allow <rule>           a harness allow rule, e.g. "Bash(npm test:*)" (repeatable)
  --deny <rule>            a harness deny rule (repeatable)
  --max-turns <n>          model requests
  --timeout <seconds>      wall-clock limit
  --budget <usd>           spending limit, e.g. 0.25
  --json                   print only the result, as JSON

Workspace options (Phase F02):
  --repo <path|url>        work in a fresh, isolated workspace of this repo (a worktree + branch)
  --base <ref>             branch or commit to start from (default: the repo's default branch)
  --keep-workspace         keep the checkout afterwards (always kept when the run fails)
  --allow-unsandboxed      without an OS sandbox, still run setup and Bash-allowed agents`;

const dim = (text) => `\x1b[2m${text}\x1b[0m`;

/** @param {string[]} argv */
export async function agentCommand(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      driver: { type: 'string' },
      cwd: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      echo: { type: 'boolean' },
      script: { type: 'string' },
      'permission-mode': { type: 'string' },
      allow: { type: 'string', multiple: true },
      deny: { type: 'string', multiple: true },
      'max-turns': { type: 'string' },
      timeout: { type: 'string' },
      budget: { type: 'string' },
      json: { type: 'boolean' },
      repo: { type: 'string' },
      base: { type: 'string' },
      'keep-workspace': { type: 'boolean' },
      'allow-unsandboxed': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const run = agentRunFromFlags(values, positionals.join(' '));
  const driverName = values.script ? 'in-process' : (values.driver ?? 'subprocess');

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); // Ctrl+C = the caller's stop button
  const live = { ...run, signal: controller.signal, onEvent: values.json ? undefined : printEvent };

  let result;
  let step = null;
  if (values.repo) {
    const log = (line) => !values.json && process.stderr.write(dim(`${line}\n`));
    const { cwd, ...agent } = live;
    step = await runStep({ repo: values.repo, base: values.base, driver: driverName, keepWorkspace: values['keep-workspace'], allowUnsandboxed: values['allow-unsandboxed'], log, agent });
    result = step.result;
  } else {
    result = await (await createDriver(driverName)).run(live);
  }

  if (values.json) console.log(JSON.stringify(step ? { ...result, workspace: step.workspace.id, branch: step.branch, commits: step.commits, kept: step.kept } : result, null, 2));
  else {
    const cost = `$${result.costUsd.toFixed(4)}${result.costIsEstimate ? ' (estimate)' : ''}`;
    process.stderr.write(`\n${dim(`${driverName} · ${result.model ?? '?'} · ${result.turns} turn(s) · ${result.toolCalls} tool call(s) · ${cost} · ${(result.durationMs / 1000).toFixed(1)}s · `)}${result.outcome}\n`);
    if (result.outcome === 'error') process.stderr.write(`${result.text}\n`);
    if (step) {
      const where = step.kept ? `kept at ${step.workspace.path}` : 'checkout removed';
      process.stderr.write(step.commits ? `branch ${step.branch}: ${step.commits} commit(s) · ${where}\n${dim(step.stat)}\n` : `no changes · ${where}\n`);
    }
  }
  return result.outcome === 'success' ? 0 : 1;
}

/**
 * Flags → an AgentRun (without signal/onEvent).
 * @param {Record<string, any>} values
 * @param {string} prompt
 * @returns {import('../exec/harness/driver.js').AgentRun}
 */
export function agentRunFromFlags(values, prompt) {
  const number = (name) => {
    if (values[name] === undefined) return undefined;
    const n = Number(values[name]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} needs a positive number.`);
    return n;
  };
  const provider = values.script ? loadScriptedProvider(values.script) : values.echo ? 'echo' : values.provider;
  const timeout = number('timeout');
  return {
    cwd: path.resolve(values.cwd ?? '.'),
    prompt,
    provider,
    model: values.model,
    permissionMode: values['permission-mode'],
    allowedTools: values.allow,
    disallowedTools: values.deny,
    limits: { maxTurns: number('max-turns'), timeoutMs: timeout && timeout * 1000, budgetUsd: number('budget') },
  };
}

let midLine = false;
/** A compact live view: the answer on stdout, tools on stderr. */
function printEvent(/** @type {any} */ event) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text);
    midLine = !event.text.endsWith('\n');
  } else if (event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'notice') {
    if (midLine) process.stdout.write('\n');
    midLine = false;
    if (event.type === 'tool_start') process.stderr.write(dim(`● ${event.name}(${event.summary ?? ''})\n`));
    else if (event.type === 'tool_end') process.stderr.write(`${event.isError ? '\x1b[31m' : '\x1b[2m'}  ⎿ ${event.display ?? ''}\x1b[0m\n`);
    else process.stderr.write(dim(`${event.text}\n`));
  }
}
