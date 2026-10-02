// Reads the command-line flags and decides how to run:
//   noobly              -> interactive chat (the rich Ink UI)
//   noobly -p "..."     -> ask one question, print the answer, exit (good for scripts; Phase 17: json output, stdin)
//   noobly --continue   -> pick up the last conversation in this folder (Phase 09)
//   noobly config       -> show the effective settings and where each came from (Phase 10)
//   noobly trust        -> allow this project's hooks and MCP servers to run (Phases 12 and 14)
//
// The session itself is built by core/create-session.js, shared with the library API (src/index.js).
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { describeSettings, loadSettings } from './config/settings.js';
import { askToTrust, trust, untrustedItems } from './config/trust.js';
import { createSession, findExtensions } from './core/create-session.js';
import { splitRules } from './commands/custom.js';
import { PROVIDERS } from './providers/index.js';
import { findSession, listSessions } from './session-store/transcript.js';
import { OUTPUT_FORMATS, runHeadless } from './ui/headless.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `noobly ${pkg.version}: a learning AI harness

Usage
  noobly                 Start an interactive chat
  noobly -p "question"   Ask once, print the answer, exit (also works with /commands)
  cat file | noobly -p "explain this"   Piped input is added to the prompt (or is the prompt)
  noobly --continue      Continue the last conversation in this folder
  noobly config          Show your settings and where each one comes from
  noobly trust           Allow this project's hooks and MCP servers (.noobly/) to run

Options
  -p, --print            Non-interactive: answer the prompt and exit
      --output-format <f>  With -p: text (default), json (one result object) or stream-json (one event per line)
  -c, --continue         Continue the most recent conversation
  -r, --resume <id|n>    Continue a saved conversation (see /resume for the list)
      --provider <id>    anthropic, openai, grok, ollama or echo (default: the first with an API key)
  -m, --model <id>       Model to use (default: the provider's default, e.g. ${PROVIDERS.grok.defaultModel})
      --echo             Use the offline echo provider (same as --provider echo)
      --verbose          With -p: print the raw JSON request and the assembled response
      --max-turns <n>    Most model requests one message may trigger (default 25)
      --permission-mode <mode>        default, acceptEdits or plan
      --allow <rule>     Allow a tool call without asking, e.g. --allow "Bash(npm test:*)" (repeatable)
      --allowed-tools <rules>  The same, several at once: "Read, Edit, Bash(npm test:*)"
      --deny <rule>      Always block a tool call, e.g. --deny "Edit(package.json)" (repeatable)
      --dangerously-skip-permissions  Never ask (deny rules still apply). Use only in a sandbox
  -v, --version          Print the version
  -h, --help             Print this help

Exit codes (with -p): 0 success · 1 error, round limit or refusal · 130 interrupted

Settings files (later ones win; see .claude/docs/10-configuration.md)
  ~/.noobly/settings.json          your defaults for every project
  .noobly/settings.json            this project (commit it to share)
  .noobly/settings.local.json      this project, just you (git-ignore it)
  .noobly/mcp.json                 MCP servers for this project (~/.noobly/mcp.json: every project)
  .noobly/agents/ skills/ commands/  subagents, skills and slash commands (also in ~/.noobly/)

Environment
  ANTHROPIC_API_KEY      Anthropic key  (provider "anthropic", default model ${PROVIDERS.anthropic.defaultModel})
  OPENAI_API_KEY         OpenAI key     (provider "openai",    default model ${PROVIDERS.openai.defaultModel})
  XAI_API_KEY            xAI Grok key   (provider "grok",      default model ${PROVIDERS.grok.defaultModel}; GROK_API_KEY also works)
  OLLAMA_BASE_URL        A local Ollama server (provider "ollama", default http://localhost:11434/v1; no key)
  NOOBLY_PROVIDER        Provider to use when several keys are set
  NOOBLY_MODEL           Model to use
  NOOBLY_HOME            Where noobly keeps its files (default ~/.noobly)
  NOOBLY_DEBUG=1         Write a debug log to ~/.noobly/debug.log`;

let values, positionals;
try {
  ({ values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      print: { type: 'boolean', short: 'p' },
      'output-format': { type: 'string' },
      continue: { type: 'boolean', short: 'c' },
      resume: { type: 'string', short: 'r' },
      provider: { type: 'string' },
      model: { type: 'string', short: 'm' },
      echo: { type: 'boolean' },
      verbose: { type: 'boolean' },
      'max-turns': { type: 'string' },
      'permission-mode': { type: 'string' },
      allow: { type: 'string', multiple: true },
      'allowed-tools': { type: 'string', multiple: true },
      deny: { type: 'string', multiple: true },
      'dangerously-skip-permissions': { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (error) {
  fail(`${error.message}\nRun noobly --help for the options.`);
}

if (values.help) {
  console.log(HELP);
  process.exit(0);
}
if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

// Phase 10: settings from files, environment and flags (flags win).
const settingsInfo = loadSettings({ cwd: process.cwd(), flags: flagSettings() });

if (!values.print && positionals[0] === 'config') {
  console.log(describeSettings(settingsInfo));
  process.exit(0);
}
// Phase 30: `noobly acp`: speak the Agent Client Protocol on stdin/stdout, for editors.
if (!values.print && positionals[0] === 'acp') {
  const { runAcp } = await import('./ui/acp.js');
  await runAcp({ flags: flagSettings(), version: pkg.version });
  process.exit(0);
}
if (!values.print && positionals[0] === 'trust') {
  const items = untrustedItems(process.cwd(), findExtensions(process.cwd(), settingsInfo));
  for (const item of items) trust(process.cwd(), item.kind, item.value);
  console.log(items.length ? `Trusted:\n${items.flatMap((i) => i.lines).map((l) => `  • ${l}`).join('\n')}` : 'Nothing in this project needs trusting.');
  process.exit(0);
}
if (!values.print && positionals.length) fail(`Unknown command "${positionals[0]}". Did you mean: noobly -p "${positionals.join(' ')}"?`);
const outputFormat = values['output-format'] ?? 'text';
if (!OUTPUT_FORMATS.includes(outputFormat)) fail(`Unknown --output-format "${outputFormat}". Use one of: ${OUTPUT_FORMATS.join(', ')}.`);

let session;
try {
  session = await createSession({
    settingsInfo,
    applyEnv: true, // the "env" setting (a project's only once trusted)
    clientVersion: pkg.version,
    onWarning: (warning) => console.error(`\x1b[33m⚠ ${warning}\x1b[0m`),
    // A project's hooks/MCP servers: ask on the terminal (before the chat starts), never in print mode.
    askTrust: !values.print && process.stdin.isTTY ? (items) => askToTrust(process.cwd(), items) : undefined,
    // --verbose: show exactly what went over the wire (the key is in a header, so it is never printed).
    onExchange: values.verbose
      ? (request, response) => {
          console.error('--- request body ---\n' + JSON.stringify(request, null, 2));
          console.error('--- response ---\n' + JSON.stringify(response, null, 2));
        }
      : undefined,
  });
} catch (error) {
  fail(error.message);
}
process.on('exit', () => session.mcp.close()); // MCP servers are child processes
resumeIfAsked();

if (values.print) {
  // Ctrl+C sends SIGINT. Instead of dying instantly, cancel the request cleanly.
  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());
  const prompt = await promptFromArgsAndStdin();
  const code = await runHeadless(session, prompt, { outputFormat, signal: controller.signal });
  session.mcp.close();
  process.exitCode = code;
} else {
  const { startApp } = await import('./ui/start.jsx');
  startApp({ session, version: pkg.version });
}

/** Command-line flags, in the same shape as the settings files. */
function flagSettings() {
  const flags = {};
  if (values.echo) flags.provider = 'echo';
  else if (values.provider) flags.provider = values.provider;
  if (values.model) flags.model = values.model;
  if (values['max-turns']) {
    const n = Number(values['max-turns']);
    if (!Number.isInteger(n) || n < 1) fail('--max-turns needs a whole number, 1 or more.');
    flags.maxTurns = n;
  }
  const permissions = {};
  if (values['permission-mode']) permissions.defaultMode = values['permission-mode'];
  if (values['dangerously-skip-permissions']) permissions.defaultMode = 'bypass';
  const allow = [...(values.allow ?? []), ...(values['allowed-tools'] ?? []).flatMap(splitRules)];
  if (allow.length) permissions.allow = allow;
  if (values.deny) permissions.deny = values.deny;
  if (Object.keys(permissions).length) flags.permissions = permissions;
  return flags;
}

/**
 * Phase 17: the prompt is the words after -p, plus anything piped in:
 *   noobly -p "summarise"             → "summarise"
 *   git diff | noobly -p              → the diff
 *   git diff | noobly -p "review it"  → "review it" + the diff
 */
async function promptFromArgsAndStdin() {
  const fromArgs = positionals.join(' ').trim();
  // With a prompt given, only wait briefly for piped text: stdin may be an open pipe that never ends.
  const piped = process.stdin.isTTY ? '' : (await readStdin({ firstChunkMs: fromArgs ? 300 : Infinity })).trim();
  if (!fromArgs && !piped) fail('No prompt. Use noobly -p "your question", or pipe text in: echo "hi" | noobly -p');
  if (fromArgs && piped) return `${fromArgs}\n\n<stdin>\n${piped}\n</stdin>`;
  return fromArgs || piped;
}

/** All of stdin, or '' if nothing arrives within `firstChunkMs`. */
function readStdin({ firstChunkMs }) {
  return new Promise((resolve) => {
    let text = '';
    const timer = Number.isFinite(firstChunkMs) ? setTimeout(() => done(), firstChunkMs) : null;
    const done = () => {
      clearTimeout(timer);
      process.stdin.pause();
      resolve(text);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      clearTimeout(timer);
      text += chunk;
    });
    process.stdin.on('end', done);
  });
}

/** Phase 09: --continue / --resume. */
function resumeIfAsked() {
  if (!values.continue && !values.resume) return;
  const found = values.resume ? findSession(process.cwd(), values.resume) : listSessions(process.cwd())[0];
  if (!found) fail(values.resume ? `No saved conversation matches "${values.resume}".` : 'No saved conversation in this folder yet.');
  session.resume(found.file);
  session.resumedFrom = found;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
