// @ts-check
// The command line: `factory <command> [options]`.
//
// Phase F00: only --help and --version. Each phase adds its commands to COMMANDS.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { agentCommand } from './commands/agent.js';
import { dbCommand, eventsCommand, logsCommand, runsCommand } from './commands/history.js';
import { cancelCommand, pauseCommand, resumeAllCommand, resumeCommand, serveCommand, statusCommand, stopAllCommand, submitCommand } from './commands/queue.js';
import { initCommand } from './commands/init.js';
import { githubCommand } from './commands/github.js';
import { mcpCommand } from './commands/mcp.js';
import { dashboardCommand } from './commands/dashboard.js';
import { notifyCommand } from './commands/notify.js';
import { benchCommand } from './commands/bench.js';
import { metricsCommand } from './commands/metrics.js';
import { learnCommand } from './commands/learn.js';
import { workerCommand } from './commands/worker.js';
import { auditCommand } from './commands/audit.js';
import { campaignCommand } from './commands/campaign.js';
import { answerCommand, approveCommand, inboxCommand, rejectCommand } from './commands/inbox.js';
import { runCommand } from './commands/run.js';
import { workspaceCommand } from './commands/workspace.js';
import { harnessVersion } from './harness.js';
import { loadFactoryConfig } from './config/factory-config.js';

const pkg = createRequire(import.meta.url)('../package.json');

/**
 * Each command: a one-line description (for --help) and a run(args) function
 * that gets the words after the command name and returns an exit code.
 * @type {Record<string, { summary: string, run: (args: string[]) => Promise<number> }>}
 */
const COMMANDS = {
  init: { summary: 'Draft steering files and repo config, as a PR to edit (Phase F08)', run: initCommand },
  agent: { summary: 'Run one noobly agent, optionally in a fresh workspace (Phases F01, F02)', run: agentCommand },
  run: { summary: 'Issue in, PR out, through a line of stations (F03–F07); `run retry <id> [--from <station>]`', run: runCommand },
  submit: { summary: 'Put issues in the queue for factory serve (Phase F06)', run: submitCommand },
  serve: { summary: 'The scheduler and its workers: run the queue (Phase F06)', run: serveCommand },
  dashboard: { summary: 'The dashboard in your browser: the line, runs, inbox, metrics, live (Phase F17)', run: dashboardCommand },
  notify: { summary: '`notify test|once`: outgoing webhooks to Slack/Discord (Phase F18)', run: notifyCommand },
  worker: { summary: 'Run agent steps for a factory on another machine; `worker list|revoke` (Phase F23)', run: workerCommand },
  campaign: { summary: 'One change across many repos: `campaign create|status|list` (Phase F25)', run: campaignCommand },
  status: { summary: "What's running, what's waiting and why, spend today (Phase F06)", run: statusCommand },
  'stop-all': { summary: 'Stop everything: no new runs, running ones interrupted (Phase F06)', run: stopAllCommand },
  'resume-all': { summary: 'Start taking work again (Phase F06)', run: resumeAllCommand },
  cancel: { summary: 'Cancel one run (Phase F06)', run: cancelCommand },
  pause: { summary: 'Pause a run after its current station (Phase F07)', run: pauseCommand },
  resume: { summary: 'Put a paused run back in the queue (Phase F07)', run: resumeCommand },
  github: { summary: '`github poll --repo owner/name`: queue labelled issues without webhooks (Phase F15)', run: githubCommand },
  mcp: { summary: 'The factory as an MCP server: `--operator` for your noobly chat; `--step` is started by agents (Phase F16)', run: mcpCommand },
  inbox: { summary: "What's waiting for a person: approvals, questions, policy gaps (Phase F12)", run: inboxCommand },
  approve: { summary: 'Approve an inbox entry [--now] (Phase F12)', run: approveCommand },
  reject: { summary: 'Reject an inbox entry --feedback "…" [--now] (Phase F12)', run: rejectCommand },
  answer: { summary: "Answer an agent's question [--now] (Phase F12)", run: answerCommand },
  bench: { summary: 'End-to-end benchmark: cases with hidden tests, repeats, compare; `bench mine` (Phase F19)', run: benchCommand },
  metrics: { summary: 'Flow and agent metrics: lead time, station times, first-pass gates, acceptance, human edits, cost (Phase F20)', run: metricsCommand },
  learn: { summary: 'The learning loop: feedback → learnings → recurring patterns → a draft steering PR [--propose --bench] (Phase F21)', run: learnCommand },
  audit: { summary: '`audit export|verify`: security-relevant events, hash-chained (Phase F24)', run: auditCommand },
  runs: { summary: 'Runs, newest first (Phase F05)', run: runsCommand },
  logs: { summary: "One run's story, from the event log (Phase F05)", run: logsCommand },
  events: { summary: 'The raw event log, one JSON event per line (Phase F05)', run: eventsCommand },
  db: { summary: '`db rebuild`: replay the event log into fresh tables (Phase F05)', run: dbCommand },
  workspace: { summary: 'Create, list, release and clean isolated workspaces (Phase F02)', run: workspaceCommand },
};

const HELP = () => `factory ${pkg.version}: an agentic software factory, built on noobly ${harnessVersion()}

Usage: factory <command> [options]

Commands:
${Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(12)}${c.summary}`).join('\n') || '  (none yet)'}

Options:
  -h, --help       Show this help (or: factory <command> --help)
  -v, --version    Show the version

Environment:
  FACTORY_HOME     Where the factory keeps its files (default ~/.factory)
  FACTORY_DEBUG=1  Write a debug log to ~/.factory/debug.log`;

export async function main(argv = process.argv.slice(2)) {
  // Phase F23: "isolation": { "image": "node:24-slim" } in the config → repo commands run in containers.
  try {
    const image = loadFactoryConfig().isolation?.image;
    if (image && !process.env.FACTORY_CONTAINER_IMAGE) process.env.FACTORY_CONTAINER_IMAGE = image;
  } catch {
    // a broken config is reported by the command that needs it
  }
  const [name, ...rest] = argv;
  if (name && COMMANDS[name]) return COMMANDS[name].run(rest);

  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
  if (values.version) {
    console.log(pkg.version);
    return 0;
  }
  if (values.help || !name) {
    console.log(HELP());
    return 0;
  }
  console.error(`Unknown command "${name}". Run factory --help for the list.`);
  return 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
