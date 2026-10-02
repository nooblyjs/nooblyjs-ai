// Phase 17: HEADLESS mode. The same agent loop, with no chat screen.
//
//   noobly -p "question"                            answer on stdout, progress on stderr
//   noobly -p "question" --output-format json       ONE JSON object at the end (for scripts)
//   noobly -p "question" --output-format stream-json  one JSON event per line, as they happen
//   echo "list TODOs" | noobly -p --output-format json | jq .result
//
// This is the payoff of "the loop emits events; it never prints" (Architecture
// principle 2): the chat UI, this file, the transcript and the tests are all
// just different consumers of the same events.
//
// Exit codes tell scripts what happened:
//   0    success
//   1    error: an exception, the round limit (maxTurns), a refusal, or a blocked prompt
//   130  interrupted (Ctrl+C), the usual code for "stopped by SIGINT"
import { isCommand, runCommand } from '../commands/index.js';
import { formatCost, hasPrice } from '../core/cost.js';
import { EVENT } from '../core/events.js';
import { temporarilyAllow } from '../permissions/gate.js';

export const OUTPUT_FORMATS = ['text', 'json', 'stream-json'];

const dim = (text) => `\x1b[2m${text}\x1b[0m`;

/**
 * Run one prompt to completion and write the output.
 * @param {import('../core/session.js').Session} session
 * @param {string} prompt
 * @param {{ outputFormat?: string, signal?: AbortSignal, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} options
 * @returns {Promise<number>} the exit code
 */
export async function runHeadless(session, prompt, { outputFormat = 'text', signal, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!OUTPUT_FORMATS.includes(outputFormat)) throw new Error(`Unknown output format "${outputFormat}". Use one of: ${OUTPUT_FORMATS.join(', ')}.`);
  const writer = WRITERS[outputFormat]({ session, stdout, stderr });
  const started = Date.now();

  // Slash commands work here too: noobly -p "/review" or noobly -c -p "/cost".
  let undo = () => {};
  if (isCommand(prompt)) {
    const result = await runCommand(prompt, session);
    if (result.action !== 'prompt') {
      writer.commandOutput?.(result.text ?? '');
      return writer.finish(resultObject(session, { text: result.text ?? '', stopReason: 'command', durationMs: Date.now() - started }));
    }
    prompt = result.prompt;
    undo = temporarilyAllow(session, result.allow);
  }

  writer.start?.();
  let end = null;
  try {
    for await (const event of session.stream(prompt, { signal })) {
      writer.event(event);
      if (event.type === EVENT.TURN_END) end = event;
    }
  } catch (error) {
    return writer.finish(resultObject(session, { error: error.message, durationMs: Date.now() - started }));
  } finally {
    undo();
  }
  return writer.finish(resultObject(session, end));
}

/**
 * The final result, the same for json and stream-json.
 * `subtype` says how it ended: success | error_max_turns | refusal | blocked | interrupted | error
 */
export function resultObject(session, end) {
  const subtype = end.error
    ? 'error'
    : end.interrupted
      ? 'interrupted'
      : ({ max_turns: 'error_max_turns', refusal: 'refusal', blocked: 'blocked' }[end.stopReason] ?? 'success');
  return {
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    result: end.error ?? end.text ?? '',
    stop_reason: end.stopReason ?? null,
    num_rounds: end.rounds ?? 0,
    num_tool_calls: end.toolCalls ?? 0,
    duration_ms: end.durationMs ?? 0,
    usage: end.usage ?? {},
    total_cost_usd: end.cost ?? 0,
    model: session.model,
    session_id: session.transcript?.id ?? null,
  };
}

export function exitCodeFor(result) {
  if (result.subtype === 'interrupted') return 130;
  return result.is_error ? 1 : 0;
}

const WRITERS = {
  // The answer goes to stdout and everything else to stderr, so `noobly -p … > out.txt` saves only the answer.
  text: ({ session, stdout, stderr }) => {
    let wroteText = false;
    let thinking = false; // a thinking summary is being printed (end it with a line break)
    return {
      commandOutput: (text) => stdout.write(`${text}\n`),
      event(event) {
        if (thinking && event.type !== EVENT.THINKING_DELTA) {
          stderr.write('\n');
          thinking = false;
        }
        if (event.type === EVENT.TEXT_DELTA) {
          stdout.write(event.text);
          wroteText = true;
        } else if (event.type === EVENT.THINKING_DELTA) {
          stderr.write(dim(event.text));
          thinking = true;
        } else if (event.type === EVENT.TOOL_START) {
          if (wroteText) stdout.write('\n');
          wroteText = false;
        } else if (event.type === EVENT.TOOL_END) {
          // In print mode nobody can answer a permission question, so "ask" means no (see Session).
          stderr.write(`${event.isError ? '\x1b[31m' : '\x1b[2m'}● ${event.name}(${event.summary}) ⎿ ${event.display}\x1b[0m\n`);
        } else if (event.type === EVENT.SUBAGENT && event.event.type === EVENT.TOOL_END) {
          stderr.write(`${dim(`    ⎿ [${event.agent}] ${event.event.name}(${event.event.summary}) ${event.event.display ?? ''}`)}\n`);
        } else if (event.type === EVENT.NOTICE) {
          stderr.write(`${dim(`${event.text}`)}\n`);
        } else if (event.type === EVENT.STREAM_RESET) {
          stdout.write('\n');
          stderr.write(`${dim(`${event.error}. The reply restarts:`)}\n`);
        } else if (event.type === EVENT.COMPACT) {
          stderr.write(`${dim(`✻ Context compacted (${event.method}): ~${event.before} → ~${event.after} tokens`)}\n`);
        } else if (event.type === EVENT.RETRY) {
          stderr.write(`${dim(`${event.error}. Retrying in ${(event.delayMs / 1000).toFixed(1)}s (attempt ${event.attempt})`)}\n`);
        } else if (event.type === EVENT.TURN_END) {
          stdout.write('\n');
          const status = event.interrupted ? 'interrupted' : event.stopReason;
          const tools = event.toolCalls ? ` · ${event.toolCalls} tool call(s) in ${event.rounds} rounds` : '';
          const cost = hasPrice(session.model) ? formatCost(event.cost) : 'price unknown';
          const cached = event.usage.cache_read_input_tokens ? ` · cache read: ${event.usage.cache_read_input_tokens}` : '';
          stderr.write(`${dim(`${session.model} · in: ${event.usage.input_tokens ?? 0} · out: ${event.usage.output_tokens ?? 0}${cached} · ${cost}${tools} · ${status}`)}\n`);
        }
      },
      finish(result) {
        if (result.subtype === 'error') stderr.write(`Error: ${result.result}\n`);
        return exitCodeFor(result);
      },
    };
  },

  // Nothing until the end, then one object. Warnings still go to stderr.
  json: ({ stdout }) => ({
    event() {},
    finish(result) {
      stdout.write(`${JSON.stringify(result)}\n`);
      return exitCodeFor(result);
    },
  }),

  // Every event as its own line of JSON ("JSON Lines"), so a program can follow along live.
  'stream-json': ({ session, stdout }) => {
    const line = (value) => stdout.write(`${JSON.stringify(value)}\n`);
    return {
      start: () =>
        line({
          type: 'system',
          subtype: 'init',
          session_id: session.transcript?.id ?? null,
          cwd: session.cwd,
          model: session.model,
          permission_mode: session.permissions.mode,
          tools: session.tools.list().map((t) => t.name),
        }),
      event: line,
      finish(result) {
        line(result);
        return exitCodeFor(result);
      },
    };
  },
};
