// Phase 05: run a shell command.
//
// The most powerful tool, and the most dangerous: it can do anything you can
// do in a terminal. Until Phase 06 adds permission prompts, it runs WITHOUT asking.
//
// Details that matter:
// - The working directory PERSISTS between calls ("cd src" then "ls" works).
//   After each command we ask bash for `pwd` on a separate channel (file
//   descriptor 3) so it never mixes with the command's own output.
// - Commands get no keyboard input (stdin is closed), so anything interactive
//   fails fast instead of hanging forever waiting for you to type.
// - Timeouts and Ctrl+C kill the whole PROCESS GROUP, including anything the
//   command started (e.g. `npm test` spawning node).
// - Output is capped, keeping the start and the end.
// - Your API keys (Anthropic, OpenAI, Grok) are removed from the environment the command sees.
// - Phase 20: the command runs inside the session's SANDBOX when there is one (sandbox/index.js).
// - Phase 22: `run_in_background` starts it as a background task and returns at once (tasks/registry.js).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { API_KEY_ENV_VARS } from '../providers/index.js';
import { isInside } from './paths.js';
import { defineTool, ToolError } from './tool.js';
import { truncateMiddle } from './truncate.js';

export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const SECRET_ENV_VARS = [...API_KEY_ENV_VARS, 'ANTHROPIC_AUTH_TOKEN', 'BRAVE_SEARCH_API_KEY', 'TAVILY_API_KEY'];

export const bashTool = defineTool({
  name: 'Bash',
  isReadOnly: false,
  description: [
    'Run a command in a bash shell and return its output (stdout and stderr together) and exit code.',
    'Use it to run programs and scripts (e.g. `node app.js`), tests, builds, git, package managers, and tools like `ps` or `ls -la`.',
    'For reading, searching and changing files, Read, Grep, Glob, Edit and Write are a better fit: they show the user exactly what happened.',
    'The working directory persists between calls. Commands cannot read keyboard input, so avoid interactive programs.',
    `Commands time out after ${DEFAULT_TIMEOUT_MS / 1000}s by default (\`timeout\` in ms, max ${MAX_TIMEOUT_MS / 1000}s).`,
    'For servers, watchers and long builds, set `run_in_background: true`: you get a task id at once and keep working. Read its output with TaskOutput (which can wait for a line like "ready"), and stop it with TaskStop. You are told when it exits.',
    'Long output is cut in the middle.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to run' },
      timeout: { type: 'integer', description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})` },
      description: { type: 'string', description: 'A few words saying what the command does, shown to the user' },
      run_in_background: { type: 'boolean', description: 'Start it as a background task and return at once (servers, watchers, long builds)' },
      dangerouslyDisableSandbox: {
        type: 'boolean',
        description: 'Run outside the sandbox (only if a command failed because of the sandbox and really needs more). The user is always asked.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },

  summarize: (input) => input.command.split('\n')[0].slice(0, 80),

  async call({ command, timeout = DEFAULT_TIMEOUT_MS, dangerouslyDisableSandbox = false, run_in_background = false, description }, ctx) {
    const session = ctx.session;
    if (run_in_background) return startInBackground(command, { description, dangerouslyDisableSandbox }, ctx);
    const notes = [];
    let cwd = session.shellCwd ?? ctx.cwd;
    if (!fs.existsSync(cwd)) {
      // A command deleted the folder the shell was in: start again from the project.
      notes.push(`Shell cwd ${cwd} no longer exists, so this ran in ${ctx.cwd}.`);
      cwd = ctx.cwd;
      session.shellCwd = ctx.cwd;
    }
    const timeoutMs = Math.min(Math.max(timeout, 1), MAX_TIMEOUT_MS);
    const sandbox = session.sandbox?.active && !dangerouslyDisableSandbox ? session.sandbox : null;
    const before = await session.checkpoints?.scan(); // Phase 21: which files will the command change?
    const result = await runCommand(command, { cwd, timeoutMs, signal: ctx.signal, sandbox });
    await session.checkpoints?.noteBash(before);

    if (result.newCwd && (result.newCwd !== cwd || !fs.existsSync(cwd))) {
      // Keep the shell inside the project, as Claude Code does.
      const root = fs.realpathSync(ctx.cwd);
      const real = realpathOrNull(result.newCwd);
      if (real && isInside(real, root)) session.shellCwd = result.newCwd;
      else {
        session.shellCwd = ctx.cwd;
        notes.push(`Shell cwd was reset to ${ctx.cwd} (${real ? 'it may not leave the project' : `${result.newCwd} no longer exists`}).`);
      }
    }
    if (result.timedOut) notes.push(`Command timed out after ${timeoutMs / 1000}s and was stopped.`);
    if (result.interrupted) notes.push('Command was interrupted by the user.');
    // Phase 20: if the sandbox caused the failure, say so (otherwise the model tends to retry forever).
    const sandboxNote = sandbox?.explainFailure(result.output, result.exitCode, sandbox.takeBlocked());
    if (sandboxNote) notes.push(sandboxNote);

    // Phase 26: not cut here any more: the loop saves long output to a file the model can page through.
    const output = result.output.trimEnd() || '(no output)';
    const status = result.exitCode === null ? 'killed' : `exit ${result.exitCode}`;
    const lineCount = result.output.trimEnd() ? result.output.trimEnd().split('\n').length : 0;

    const where = session.sandbox?.active ? (sandbox ? 'sandboxed · ' : '⚠ unsandboxed · ') : '';
    return {
      content: [output, `[${status}]`, ...notes].join('\n'),
      display: `${where}${status} · ${lineCount} line${lineCount === 1 ? '' : 's'}${notes.length ? ` · ${notes[0] === sandboxNote ? 'blocked by the sandbox?' : notes[0]}` : ''}`,
      preview: output === '(no output)' ? [] : output.split('\n').slice(0, 4),
    };
  },
});

function realpathOrNull(folder) {
  try {
    return fs.realpathSync(folder);
  } catch {
    return null;
  }
}

const EARLY_OUTPUT_MS = 500;

/** Phase 22: start a background task, and show what it printed in its first half second (a typo fails right away). */
async function startInBackground(command, { description, dangerouslyDisableSandbox }, ctx) {
  const session = ctx.session;
  if (!session.tasks) throw new ToolError('Background tasks are not available in this session.');
  const sandbox = session.sandbox?.active && !dangerouslyDisableSandbox ? session.sandbox : null;
  const task = await session.tasks.start(command, { cwd: session.shellCwd ?? ctx.cwd, sandbox, description });
  await session.tasks.wait(task.id, { ms: EARLY_OUTPUT_MS, signal: ctx.signal });
  const { text } = session.tasks.read(task.id);
  const running = task.status === 'running';
  if (!running) task.notified = true; // it ended already: this result says so
  const where = session.sandbox?.active ? (sandbox ? 'sandboxed · ' : '⚠ unsandboxed · ') : '';
  return {
    content: [
      running
        ? `Started background task ${task.id}. It keeps running while you work. Read new output with TaskOutput (task_id ${task.id}; it can wait for a line like "ready"), stop it with TaskStop. You'll be told when it exits.`
        : `Background task ${task.id} already exited with code ${task.exitCode ?? 'none (killed)'}.`,
      text.trimEnd() ? `Output so far:\n${truncateMiddle(text.trimEnd())}` : '(no output yet)',
    ].join('\n'),
    display: `${where}background task ${task.id} · ${running ? 'running' : `exited ${task.exitCode}`}`,
    preview: text.trimEnd().split('\n').slice(0, 4).filter(Boolean),
  };
}

/**
 * Run `command` with bash. Resolves with the combined output, exit code and
 * the shell's final working directory.
 */
export async function runCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal, sandbox = null } = {}) {
  // After the command, print its directory to fd 3, then exit with the command's status.
  const script = `${command}\n__noobly_status=$?\npwd >&3\nexit $__noobly_status`;

  const child = await startProcess(script, { cwd, sandbox });

  return new Promise((resolve) => {
    let output = '';
    let newCwd = '';
    let timedOut = false;
    let interrupted = false;
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.stdio[3].on('data', (chunk) => (newCwd += chunk));

    const killGroup = (why) => {
      if (why === 'timeout') timedOut = true;
      else interrupted = true;
      stopProcess(child);
    };
    const timer = setTimeout(() => killGroup('timeout'), timeoutMs);
    const onAbort = () => killGroup('abort');
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (error) => (output += `Failed to start the command: ${error.message}\n`));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ output, exitCode: code, newCwd: newCwd.trim(), timedOut, interrupted });
    });
  });
}

/**
 * Start `script` with bash, in the sandbox if there is one (Phase 20). Also used by
 * background tasks (Phase 22). The result has stdout, stderr and stdio[3] streams,
 * 'error' and 'close' events, and killGroup(signal).
 */
export async function startProcess(script, { cwd, sandbox = null }) {
  const env = { ...process.env, NOOBLY: '1', PAGER: 'cat', GIT_PAGER: 'cat', GIT_EDITOR: 'true' };
  for (const name of SECRET_ENV_VARS) delete env[name];
  if (sandbox) return sandbox.spawn(script, { cwd, env });

  const child = spawn('bash', ['-c', script], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'], // stdin closed; stdout, stderr, and fd 3 for pwd
    detached: true, // start a new process group, so we can kill everything it spawns
  });
  child.killGroup = (signal) => process.kill(-child.pid, signal); // minus = the whole process group
  return child;
}

/** Stop a process and everything it started: SIGTERM, then SIGKILL 2s later if it's still there. */
export function stopProcess(child) {
  try {
    child.killGroup('SIGTERM');
    setTimeout(() => {
      try {
        child.killGroup('SIGKILL');
      } catch {}
    }, 2000).unref();
  } catch {}
}
