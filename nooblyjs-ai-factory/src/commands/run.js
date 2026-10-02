// @ts-check
// Phase F03: `factory run <issue.md> --repo <path>`: one job, issue in, PR out.
// Phase F05: `factory run retry <run>`: carry on after a crash, an error or an interrupt.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createLocalForge } from '../forge/local.js';
import { retryRun, startJob } from '../job/run-job.js';
import { openStore } from '../store/events.js';

export const HELP = `Usage: factory run <issue.md> --repo <path> [options]
       factory run retry <run-id> [--from <station>]

File the issue in the local forge, let a builder agent resolve it in a fresh
workspace, check it with the repo's gates, and deliver a branch
(factory/issue-N/main) plus a PR file. Every step is recorded (factory logs <run>).

Options:
  --repo <path>            the repository to change (required)
  --line <name|file.json>  the stations to go through: default (triage → build → verify → deliver) | quick | a file
  --from <station>         (retry) start over from this station, keeping earlier results
  --routing <policy>     static | cheap-first | escalate | strong, or one from config (Phase F22)
  --autonomy <L0-L3>       how much happens without a person (default: your config, else L1)
  --base <ref>             branch or commit to start from (default: the repo's default branch)
  --driver <name>          subprocess (default) | in-process
  --provider <id> · --model <id> · --echo · --script <file.json>
  --max-turns <n> · --timeout <seconds> · --budget <usd>
  --allow <rule> · --deny <rule>     extra harness permission rules (repeatable)
  --allow-unsandboxed      without an OS sandbox, still run setup, gates and Bash-allowed agents`;

const OPTIONS = /** @type {const} */ ({
  repo: { type: 'string' },
  line: { type: 'string' },
  autonomy: { type: 'string' },
  routing: { type: 'string' },
  from: { type: 'string' },
  base: { type: 'string' },
  driver: { type: 'string' },
  provider: { type: 'string' },
  model: { type: 'string' },
  echo: { type: 'boolean' },
  script: { type: 'string' },
  'max-turns': { type: 'string' },
  timeout: { type: 'string' },
  budget: { type: 'string' },
  allow: { type: 'string', multiple: true },
  deny: { type: 'string', multiple: true },
  'allow-unsandboxed': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
});

/** @param {string[]} argv */
export async function runCommand(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
  if (values.help || !positionals[0]) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const dim = (text) => `\x1b[2m${text}\x1b[0m`;
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const live = { signal: controller.signal, log: (line) => process.stderr.write(dim(`${line}\n`)) };
  const store = openStore();
  const forge = createLocalForge();
  try {
    let job;
    if (positionals[0] === 'retry') {
      if (!positionals[1]) throw new Error('Usage: factory run retry <run-id>');
      job = await retryRun(store, positionals[1], { live, forge, from: values.from });
    } else {
      if (!values.repo) throw new Error('--repo <path> is required.');
      if (!fs.existsSync(positionals[0])) throw new Error(`No issue file "${positionals[0]}".`);
      job = await startJob(store, { issueFile: positionals[0], repo: values.repo, base: values.base, line: values.line, autonomy: values.autonomy, routing: values.routing, driver: values.driver, allowUnsandboxed: values['allow-unsandboxed'], agent: agentFromFlags(values) }, { live, forge });
    }
    console.log(`\n${job.status}${job.head ? ` · ${job.head}` : ''} · run ${job.runId}`);
    if (job.triage && !job.head) console.log(`triage: ${job.triage.kind} · ${job.triage.size}${job.triage.questions?.length ? `\nquestions (also on the issue):\n${job.triage.questions.map((q) => `  - ${q}`).join('\n')}` : ''}`);
    if (job.pr) console.log(`PR: ${job.pr.path}`);
    if (job.step?.kept) console.log(`workspace kept for inspection: ${job.step.workspace.path}`);
    console.log(dim(`details: factory logs ${job.runId}`));
    return job.status === 'delivered' ? 0 : 1;
  } finally {
    store.close();
  }
}

/** Flags → the agent part of a job request: plain data that can be saved and reused by a retry. */
function agentFromFlags(values) {
  const number = (name) => {
    if (values[name] === undefined) return undefined;
    const n = Number(values[name]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} needs a positive number.`);
    return n;
  };
  const timeout = number('timeout');
  return {
    model: values.model,
    provider: values.echo ? 'echo' : values.provider,
    script: values.script,
    allowedTools: values.allow,
    disallowedTools: values.deny,
    limits: { maxTurns: number('max-turns'), timeoutMs: timeout && timeout * 1000, budgetUsd: number('budget') },
  };
}
