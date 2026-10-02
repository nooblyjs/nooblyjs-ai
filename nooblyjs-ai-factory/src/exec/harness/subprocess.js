// @ts-check
// Phase F01: the SUBPROCESS driver. The harness as a separate program.
//
//   noobly -p --output-format stream-json --model … --max-turns … -- "<prompt>"
//
// stdout:  {"type":"system","subtype":"init",…}      one line first
//          {"type":"text_delta",…} {"type":"tool_start",…} …   every event, one per line
//          {"type":"result","subtype":"success",…}      one line last
// exit:    0 success · 1 error / max turns / refusal / blocked · 130 interrupted
//
// Why bother, when the library is right there? ISOLATION. A separate process
// can crash, leak memory or hang without taking the factory down, and we can
// always kill it. It's also exactly the shape that moves into a container or
// onto another machine later (Phase F23): a command, some env, a stream of lines.
//
// Stopping it is polite first, then not:
//   SIGINT   the harness aborts the turn cleanly and prints a result (exit 130)
//   SIGKILL  after `graceMs`, if it hasn't exited
import { agentEnv } from '../../security/agent-env.js';
import { spawn } from 'node:child_process';
import { EVENT, nooblyBin } from '../../harness.js';
import { debug } from '../../util/log.js';
import { createLastText, outcomeOf } from './driver.js';
import { createLimits } from './limits.js';
import { createNdjsonParser } from './ndjson.js';

const DEFAULT_GRACE_MS = 5_000;
const STDERR_KEEP = 4_000; // characters of stderr kept for error messages

/** harness result.subtype → the fields outcomeOf() understands */
const SUBTYPES = {
  success: {},
  error_max_turns: { stopReason: 'max_turns' },
  refusal: { stopReason: 'refusal' },
  blocked: { stopReason: 'blocked' },
  interrupted: { interrupted: true },
};

/**
 * The noobly command line for a run.
 * @param {import('./driver.js').AgentRun} run
 */
export function nooblyArgs(run) {
  const args = ['-p', '--output-format', 'stream-json'];
  if (run.provider === 'echo') args.push('--echo');
  else if (typeof run.provider === 'string') args.push('--provider', run.provider);
  if (run.model) args.push('--model', run.model);
  if (run.limits?.maxTurns) args.push('--max-turns', String(run.limits.maxTurns));
  if (run.permissionMode) args.push('--permission-mode', run.permissionMode);
  if (run.allowedTools?.length) args.push('--allowed-tools', run.allowedTools.join(', '));
  for (const rule of run.disallowedTools ?? []) args.push('--deny', rule);
  // `--` ends the options, so a prompt starting with "-" is still a prompt.
  args.push('--', run.prompt);
  return args;
}

/** @type {import('./driver.js').HarnessDriver & { graceMs: number }} */
export const subprocessDriver = {
  name: 'subprocess',
  graceMs: DEFAULT_GRACE_MS,

  run(run) {
    if (typeof run.provider === 'object') throw new Error('The subprocess driver needs a provider id (a string), not a provider object. Use the in-process driver for scripted providers.');
    const started = Date.now();
    const limits = createLimits({ signal: run.signal, ...run.limits, model: run.model });
    // Phase F24: a SCRUBBED environment: the factory's own secrets never reach the agent.
    const env = { ...agentEnv(process.env), ...run.env, ...(run.harnessHome && { NOOBLY_HOME: run.harnessHome }) };
    const bin = nooblyBin(env);

    /** @type {any} */ let init = null;
    /** @type {any} */ let result = null;
    /** @type {any} */ let turnEnd = null;
    let events = 0;
    const lastText = createLastText();
    let stderr = '';

    return new Promise((resolve) => {
      // stdin is /dev/null: with a prompt given, noobly would otherwise wait briefly for piped text.
      const child = spawn(process.execPath, [bin, ...nooblyArgs(run)], { cwd: run.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      debug('subprocess start', { pid: child.pid, cwd: run.cwd, bin });

      const parser = createNdjsonParser(
        (value) => {
          if (value.type === 'system' && value.subtype === 'init') init = value;
          else if (value.type === 'result') result = value;
          else {
            events++;
            limits.observe(value);
            lastText.observe(value);
            run.onEvent?.(value);
            if (value.type === EVENT.TURN_END) turnEnd = value;
          }
        },
        (line) => debug('subprocess: not JSON', { line: line.slice(0, 200) }),
      );
      child.stdout.on('data', (chunk) => parser.push(chunk));
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP);
      });

      let killTimer = null;
      limits.signal.addEventListener('abort', () => {
        child.kill('SIGINT');
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.graceMs);
      });

      let finished = false;
      const finish = (/** @type {number | null} */ code, /** @type {string | null} */ signal, /** @type {string} [spawnError] */ spawnError) => {
        // A failed spawn emits 'error' AND 'close': only the first one counts.
        if (finished) return;
        finished = true;
        parser.end();
        clearTimeout(killTimer);
        limits.dispose();
        const end = result
          ? { ...(SUBTYPES[result.subtype] ?? { error: result.result || `noobly ended with "${result.subtype}"` }) }
          : { error: spawnError ?? `noobly exited (${signal ?? `code ${code}`}) without a result.${stderr.trim() ? `\n${stderr.trim()}` : ''}` };
        resolve({
          outcome: outcomeOf(end, limits.stopped),
          text: end.error ?? (lastText.value || result?.result || ''),
          usage: result?.usage ?? turnEnd?.usage ?? {},
          // The result line has the exact total; without it, our running estimate is all there is.
          costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : limits.spent,
          costIsEstimate: typeof result?.total_cost_usd !== 'number' && limits.isEstimate,
          turns: result?.num_rounds ?? turnEnd?.rounds ?? 0,
          toolCalls: result?.num_tool_calls ?? turnEnd?.toolCalls ?? 0,
          durationMs: Date.now() - started,
          sessionId: result?.session_id ?? init?.session_id ?? null,
          model: result?.model ?? init?.model ?? run.model ?? null,
          events,
        });
      };
      child.on('error', (error) => finish(null, null, `Could not start noobly (${bin}): ${error.message}`));
      child.on('close', (code, signal) => finish(code, signal));
    });
  },
};
