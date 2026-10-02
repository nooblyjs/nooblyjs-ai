// Phase 04: THE AGENT LOOP. This is the heart of every AI agent.
//
//   1. Send the conversation (and the list of tools) to the model.
//   2. If the reply ends with stop_reason "tool_use", the model is asking us to
//      run tools. Run each one and send back a `tool_result` for every `tool_use`.
//   3. Go back to 1. Stop when the model answers without asking for a tool
//      (or when we hit the round limit).
//
// One user message can therefore cause many requests ("rounds"):
//
//   user: "what's in package.json?"
//   assistant: [text "Let me look.", tool_use Read {file_path: "package.json"}]   ← round 1
//   user:      [tool_result "1 {\n 2  \"name\": ..."]
//   assistant: [text "The name is ..."]                                           ← round 2, done
//
// Phase 12 adds HOOKS at fixed points (your commands, see hooks/runner.js), and
// Phase 13 lets a tool report progress while it runs (a subagent inside Task).
import path from 'node:path';
import { contextUsage } from '../context/tokens.js';
import { collectReminders, withReminders } from '../context/reminders.js';
import { limitToolOutput } from '../tools/truncate.js';
import { isRetryable, withRetry } from '../providers/retry.js';
import { createChannel } from './channel.js';
import { createTrace } from './trace.js';
import { addUsage, costOf, emptyUsage } from './cost.js';
import { EVENT } from './events.js';
import { contentForHistory, textOf } from './messages.js';
import { decide, rememberAlways, suggestAlways } from '../permissions/gate.js';
import { validateInput, ToolError } from '../tools/tool.js';
import { finishedReminder } from '../tasks/registry.js';
import { imageBlock, imagePathsIn } from '../tools/images.js';

/**
 * Run one user turn to completion, yielding events as things happen.
 * Messages are collected in `pending` and only added to session.history at the
 * end, in a state the API will accept next time (every tool_use answered).
 *
 * @param {import('./session.js').Session} session
 * @param {string} text
 * @param {{ signal?: AbortSignal }} [options]
 */
export async function* runTurn(session, text, { signal } = {}) {
  const started = Date.now();
  const hookNotes = []; // Phase 12: what hooks want the model to know, as reminders

  // Phase 12: SessionStart (first message of a conversation) and UserPromptSubmit hooks.
  if (session.hooks) {
    if (session.pendingSessionStart) {
      const hook = await session.hooks.run('SessionStart', { source: session.pendingSessionStart }, { signal });
      session.pendingSessionStart = null;
      yield* hookErrors(hook);
      hookNotes.push(...hook.context.map((c) => `A SessionStart hook added this context:\n${c}`));
    }
    const hook = await session.hooks.run('UserPromptSubmit', { prompt: text }, { signal });
    yield* hookErrors(hook);
    if (hook.blocked) {
      // The message never reaches the model (and isn't saved).
      yield { type: EVENT.NOTICE, text: `A UserPromptSubmit hook blocked this message: ${hook.reasons.join(' ')}` };
      yield { type: EVENT.TURN_END, text: '', stopReason: 'blocked', usage: emptyUsage(), cost: 0, durationMs: Date.now() - started, interrupted: false, rounds: 0, toolCalls: 0 };
      return;
    }
    hookNotes.push(...hook.context.map((c) => `A UserPromptSubmit hook added this context:\n${c}`));
  }
  session.pendingSessionStart = null;

  // Phase 07: attach any <system-reminder> notes (mode changed, files changed on disk).
  const reminders = [...collectReminders(session), ...hookNotes];
  const pending = [{ role: 'user', content: withImages(withReminders(text, reminders), session) }];

  // Phase 08: if this message would push the context window past the threshold,
  // make room first. Only at the START of a turn: never between a tool call
  // and its result.
  if (session.settings.autoCompact && session.history.length > 0) {
    const usage = contextUsage(session, pending);
    if (usage.fraction >= session.settings.compactThreshold) {
      yield { type: EVENT.COMPACT_START, tokens: usage.tokens, window: usage.window };
      const result = await session.compact({ signal, trigger: 'auto' });
      yield* hookErrors({ errors: result.hookErrors ?? [] });
      yield { type: EVENT.COMPACT, ...result, window: usage.window };
      // Compaction can produce new reminders (Phase 11: the todo list), and they belong in THIS message.
      const more = collectReminders(session);
      if (more.length) pending[0] = { role: 'user', content: withImages(withReminders(text, [...reminders, ...more]), session) };
    }
  }
  // Phase 21: a new checkpoint, so this turn's file changes can be rewound. (A subagent's changes belong to its parent's turn.)
  if (!session.isSubagent) session.checkpoints?.startTurn({ historyLength: session.history.length, prompt: text });

  const totals = { usage: emptyUsage(), cost: 0, rounds: 0, toolCalls: 0 };
  const trace = createTrace(); // Phase 19: timings, for /stats and evals
  const live = { text: '' }; // text of the reply currently streaming (kept if the user interrupts)
  let allText = '';
  let stopReason = null;
  let interrupted = false;
  let stopHookContinues = 0; // Phase 12: how often a Stop hook sent the model back to work
  let cutOffToolCalls = 0; // Phase 18: replies cut off by max_tokens in the middle of a tool call

  try {
    while (true) {
      if (totals.rounds >= session.maxTurns) {
        stopReason = 'max_turns';
        yield { type: EVENT.NOTICE, text: `Stopped after ${session.maxTurns} rounds (maxTurns). Send another message to continue.` };
        break;
      }
      totals.rounds += 1;

      // ── 1. Ask the model ──────────────────────────────────────────────
      const request = {
        model: session.model,
        system: session.systemPrompt,
        messages: [...session.history, ...pending],
        tools: session.tools.toApiSchemas(),
        maxTokens: session.maxTokens,
      };

      const { message, timing } = yield* askModel(session, request, signal, live);

      totals.usage = addUsage(totals.usage, message.usage);
      const requestCost = costOf(message.model ?? session.model, message.usage);
      totals.cost += requestCost;
      trace.requests.push({ model: message.model ?? session.model, ...timing, usage: message.usage, cost: requestCost, stopReason: message.stop_reason });
      stopReason = message.stop_reason;
      allText += textOf(message.content);

      // A refusal is not saved: the API asks us to discard any partial output.
      if (stopReason === 'refusal') {
        const category = message.stop_details?.category ? ` (category: ${message.stop_details.category})` : '';
        yield { type: EVENT.NOTICE, text: `The model declined to continue with this request${category}. Try rephrasing, or another model.` };
        break;
      }

      // Only run tools if the model actually finished asking for them. If it was
      // cut off (e.g. max_tokens), a tool_use may be incomplete, so drop it.
      const toolUses = message.content.filter((block) => block.type === 'tool_use');
      const content = stopReason === 'tool_use' ? message.content : message.content.filter((b) => b.type !== 'tool_use');
      if (content.length > 0) pending.push({ role: 'assistant', content: contentForHistory(content) });

      // Phase 18: the API paused a long turn (e.g. server-side tools). Send it back as-is to let it continue.
      if (stopReason === 'pause_turn') continue;

      // Phase 18: the reply hit max_tokens while writing a tool call (often a huge Write). Don't just stop:
      // tell the model why nothing ran, once, so it can retry in smaller pieces.
      if (stopReason === 'max_tokens' && toolUses.length > 0 && cutOffToolCalls < 1) {
        cutOffToolCalls += 1;
        yield { type: EVENT.NOTICE, text: 'The reply was cut off (max_tokens) in the middle of a tool call, so it was not run. Asking the model to continue in smaller steps.' };
        pending.push({
          role: 'user',
          content: [{ type: 'text', text: '<system-reminder>\nYour last reply reached the output limit (max_tokens) while writing a tool call, so that call was NOT run. Continue in smaller steps: e.g. create a big file with a short Write, then add to it with Edit.\n</system-reminder>' }],
        });
        continue;
      }

      if (stopReason !== 'tool_use' || toolUses.length === 0) {
        // Phase 12: the model is done. A Stop hook may disagree ("the tests fail") and send it back to work.
        if (stopReason !== 'end_turn' || !session.hooks?.has('Stop')) break;
        const hook = await session.hooks.run('Stop', { stop_hook_active: stopHookContinues > 0, last_assistant_message: textOf(message.content) }, { signal });
        yield* hookErrors(hook);
        if (!hook.blocked) break;
        if (stopHookContinues >= MAX_STOP_HOOK_CONTINUES) {
          yield { type: EVENT.NOTICE, text: `A Stop hook still objects after ${MAX_STOP_HOOK_CONTINUES} tries, so noobly stops here: ${hook.reasons.join(' ')}` };
          break;
        }
        stopHookContinues += 1;
        yield { type: EVENT.NOTICE, text: `Stop hook: not done yet. ${hook.reasons.join(' ')}` };
        pending.push({
          role: 'user',
          content: [{ type: 'text', text: `<system-reminder>\nA Stop hook (a check the user configured) says the task is not finished:\n${hook.reasons.join('\n')}\nKeep working until this is resolved.\n</system-reminder>` }],
        });
        continue;
      }

      // ── 2. Run the tools, one tool_result per tool_use ────────────────
      // Read-only tools next to each other run at the same time (Phase 05);
      // anything that changes things runs alone, in the order the model asked.
      const results = [];
      for (const batch of batchTools(session, toolUses)) {
        if (signal?.aborted) {
          for (const toolUse of batch) results.push(toolResult(toolUse.id, 'Interrupted by user before this tool ran.', true));
          continue;
        }
        // Tools may report progress while they run (Phase 13); it arrives through this channel.
        const progress = createChannel();
        const ctx = { cwd: session.cwd, signal, session, emit: (event) => progress.push(event) };
        for (const toolUse of batch) yield startEvent(session, toolUse, ctx);
        const running = Promise.all(batch.map((toolUse) => runTool(session, toolUse, ctx))).finally(() => progress.close());
        yield* progress;
        const outcomes = await running;
        for (const outcome of outcomes) {
          yield* outcome.notices;
          yield outcome.event;
          trace.tools.push({ name: outcome.event.name, durationMs: outcome.event.durationMs, isError: outcome.event.isError, ...(outcome.cost && { cost: outcome.cost }) });
          results.push(outcome.result);
          // A subagent's tokens are paid for too (Phase 13): add them to this turn.
          if (outcome.usage) totals.usage = addUsage(totals.usage, outcome.usage);
          totals.cost += outcome.cost ?? 0;
        }
        totals.toolCalls += batch.length;
      }
      // Phase 22: a background task ended while tools ran? Say so now, not only with the next user message.
      const finished = session.tasks?.takeFinished() ?? [];
      if (finished.length && results.length) {
        const last = results.at(-1);
        results[results.length - 1] = { ...last, content: appendText(last.content, `<system-reminder>\n${finishedReminder(finished)}\n</system-reminder>`) };
      }
      // All results go back together, in ONE user message.
      pending.push({ role: 'user', content: results });

      // ── 3. Loop: the model sees the results and decides what to do next ──
      signal?.throwIfAborted();
    }
  } catch (error) {
    if (!signal?.aborted) {
      commit(session, pending, '');
      session.recordTurn(totals.usage, totals.cost, trace);
      throw error;
    }
    interrupted = true;
  }

  commit(session, pending, live.text);
  allText += live.text;
  session.usage = addUsage(session.usage, totals.usage);
  session.cost += totals.cost;
  session.turns += 1;
  session.recordTurn(totals.usage, totals.cost, trace);

  yield {
    type: EVENT.TURN_END,
    text: allText,
    stopReason: interrupted ? null : stopReason,
    usage: totals.usage,
    cost: totals.cost,
    durationMs: Date.now() - started,
    interrupted,
    rounds: totals.rounds,
    toolCalls: totals.toolCalls,
    trace,
  };
}

const MAX_STREAM_RESTARTS = 2;

/**
 * Phase 18: one model request, streamed, with two layers of recovery:
 *   - withRetry: the request failed BEFORE anything arrived (429, 529, network) → wait, try again
 *   - here: the connection broke MID-reply → tell the UI to throw away the partial reply
 *     (stream_reset), and ask again. Only for temporary errors, and at most twice.
 * Returns the complete message.
 */
async function* askModel(session, request, signal, live) {
  const started = Date.now();
  for (let restart = 0; ; restart++) {
    live.text = '';
    let message = null;
    let firstTokenAt = null; // Phase 19: time to first token, the latency you FEEL
    try {
      const events = withRetry(() => session.provider.stream(request, { signal }), { ...session.retry, signal });
      for await (const event of events) {
        if (firstTokenAt === null && (event.type === EVENT.TEXT_DELTA || event.type === EVENT.THINKING_DELTA)) firstTokenAt = Date.now();
        if (event.type === EVENT.TEXT_DELTA) live.text += event.text;
        if (event.type === EVENT.MESSAGE) message = event.message;
        else yield event;
      }
    } catch (error) {
      if (signal?.aborted || restart >= MAX_STREAM_RESTARTS || !isRetryable(error)) throw error;
      yield { type: EVENT.STREAM_RESET, error: `The connection broke mid-reply (${error.message})`, attempt: restart + 1 };
      continue;
    }
    live.text = '';
    if (!message) throw new Error('The model API ended the reply without a complete message.');
    const now = Date.now();
    return { message, timing: { ttftMs: (firstTokenAt ?? now) - started, durationMs: now - started, restarts: restart } };
  }
}

/**
 * Split tool calls into batches that may run together: a run of read-only
 * tools is one batch, each other tool is a batch of its own.
 *   [Read, Grep, Edit, Read, Read] → [Read, Grep] [Edit] [Read, Read]
 */
export function batchTools(session, toolUses) {
  const batches = [];
  for (const toolUse of toolUses) {
    const tool = session.tools.get(toolUse.name);
    // Unknown tools just return an error. A tool can decide per call (Phase 13: Task is safe with read-only agents).
    const readOnly = tool ? (tool.isConcurrencySafe?.(toolUse.input, session) ?? tool.isReadOnly) : true;
    const last = batches.at(-1);
    if (readOnly && last?.readOnly) last.items.push(toolUse);
    else batches.push({ readOnly, items: [toolUse] });
  }
  return batches.map((batch) => batch.items);
}

function startEvent(session, toolUse, ctx) {
  const tool = session.tools.get(toolUse.name);
  let summary = '';
  try {
    summary = tool?.summarize?.(toolUse.input, ctx) ?? '';
  } catch {} // a bad input can break summarize(); validation reports it properly below
  return { type: EVENT.TOOL_START, id: toolUse.id, name: toolUse.name, input: toolUse.input, summary };
}

/** Run a single tool call and turn whatever happens into a tool_result block plus a tool_end event. */
async function runTool(session, toolUse, ctx) {
  const tool = session.tools.get(toolUse.name);
  const { summary } = startEvent(session, toolUse, ctx);
  let started = Date.now();

  let output;
  let isError = false;
  const notices = [];
  try {
    if (!tool) {
      const names = session.tools.list().map((t) => t.name).join(', ');
      throw new ToolError(`There is no tool called "${toolUse.name}". Available tools: ${names}.`);
    }
    let input = toolUse.input;
    let problem = validateInput(tool.inputSchema, input);
    if (problem) throw new ToolError(`Invalid input for ${tool.name}: ${problem}`);

    // Phase 12: PreToolUse hooks may block the call, change its input, or pre-approve it.
    let hookAllowed = false;
    if (session.hooks?.has('PreToolUse')) {
      const hook = await session.hooks.run('PreToolUse', { tool_name: tool.name, tool_input: input }, { signal: ctx.signal });
      notices.push(...hookErrorNotices(hook));
      if (hook.blocked) {
        const reason = hook.reasons.join(' ');
        throw new ToolError(`A PreToolUse hook (a check the user configured) blocked this ${tool.name} call: ${reason}`, { display: `Blocked by hook: ${reason}` });
      }
      if (hook.updatedInput) {
        input = { ...input, ...hook.updatedInput };
        problem = validateInput(tool.inputSchema, input);
        if (problem) throw new ToolError(`A PreToolUse hook changed the input of this ${tool.name} call, and it is now invalid: ${problem}`);
      }
      hookAllowed = hook.allowed;
    }

    // Phase 06: may this call run? (See permissions/gate.js.)
    await checkPermission(session, tool, input, summary, ctx.signal, { hookAllowed, toolUseId: toolUse.id });

    started = Date.now(); // Phase 19: time the tool itself, not the wait for the user's answer
    output = await tool.call(input, { ...ctx, toolUseId: toolUse.id });

    // Phase 12: PostToolUse hooks can give the model feedback on what just happened ("lint failed…").
    if (session.hooks?.has('PostToolUse')) {
      const hook = await session.hooks.run('PostToolUse', { tool_name: tool.name, tool_input: input, tool_response: output.content }, { signal: ctx.signal });
      notices.push(...hookErrorNotices(hook));
      const feedback = [...hook.reasons, ...hook.context];
      if (feedback.length) {
        output = { ...output, content: appendText(output.content, `<system-reminder>\nA PostToolUse hook (a check the user configured) reported:\n${feedback.join('\n')}\n</system-reminder>`) };
        notices.push({ type: EVENT.NOTICE, text: `PostToolUse hook: ${feedback.join(' ').slice(0, 200)}` });
      }
    }
  } catch (error) {
    // Never crash the loop because a tool failed: tell the model, and let it try something else.
    isError = true;
    const message = error instanceof ToolError ? error.message : `${tool?.name ?? 'Tool'} failed: ${error.message}`;
    output = { content: message, display: error.display ?? message };
  }

  const event = {
    type: EVENT.TOOL_END,
    id: toolUse.id,
    name: toolUse.name,
    summary,
    content: output.content,
    display: output.display,
    preview: output.preview,
    isError,
    durationMs: Date.now() - started,
  };
  // Phase 08: one size limit for every tool's output, whatever the tool.
  // Phase 26: …and too-long output is saved to a file the model can page through, instead of being cut.
  const saveTo = session.toolResultsDir ? path.join(session.toolResultsDir, `${toolUse.id}.txt`) : undefined;
  return { event, notices, usage: output.usage, cost: output.cost, result: toolResult(toolUse.id, limitToolOutput(output.content, undefined, { saveTo }), isError) };
}

const MAX_STOP_HOOK_CONTINUES = 3;

/** Add text to a tool result, which is a string, or (Phase 28, e.g. an image) a list of blocks. */
function appendText(content, text) {
  return Array.isArray(content) ? [...content, { type: 'text', text }] : `${content}\n\n${text}`;
}

/**
 * Phase 28: image files named in your message (typed, or dragged into the terminal) go with it,
 * so the model sees them. Too big, or a model without eyes: a note instead.
 */
function withImages(content, session) {
  const text = typeof content === 'string' ? content : content[0].text;
  const files = imagePathsIn(text, session.cwd);
  if (!files.length) return content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : [...content];
  for (const file of files) {
    if (!session.canSeeImages) {
      blocks.push({ type: 'text', text: `<system-reminder>\nThe user referred to the image ${file}, but the current model can't see images.\n</system-reminder>` });
      continue;
    }
    try {
      blocks.splice(1, 0, imageBlock(file));
    } catch (error) {
      blocks.push({ type: 'text', text: `<system-reminder>\nThe image ${file} was not attached: ${error.message}\n</system-reminder>` });
    }
  }
  return blocks;
}

/** Hooks that broke are shown to the user (not the model). */
function hookErrorNotices(hook) {
  return hook.errors.map((error) => ({ type: EVENT.NOTICE, text: `⚠ ${error}` }));
}
function* hookErrors(hook) {
  yield* hookErrorNotices(hook);
}

/**
 * Ask the permission gate; if it says "ask", ask the user (the UI shows a dialog,
 * print mode says no). A denial throws a ToolError whose message tells the model
 * what happened, so it can change course instead of retrying the same thing.
 */
async function checkPermission(session, tool, input, summary, signal, { hookAllowed = false, toolUseId } = {}) {
  const decision = decide(session, tool, input);
  if (decision.behavior === 'allow') return;
  // A PreToolUse hook said "allow": don't ask. (Deny rules and plan mode still win: they said "deny" above.)
  if (decision.behavior === 'ask' && hookAllowed) return;
  if (decision.behavior === 'deny') {
    throw new ToolError(`Permission denied: ${decision.reason}`, { display: `Denied: ${decision.reason}` });
  }

  const suggestion = suggestAlways(session, tool, input);
  const answer = await session.requestPermission({ tool, input, summary, suggestion, signal, toolUseId });
  if (answer.behavior === 'allowAlways') rememberAlways(session, suggestion);
  if (answer.behavior !== 'deny') return;

  if (answer.message) {
    throw new ToolError(`The user denied this ${tool.name} call and said: "${answer.message}"`, { display: `Denied by you: ${answer.message}` });
  }
  throw new ToolError(
    answer.reason ?? `The user denied this ${tool.name} call. Don't retry it unchanged: try another approach or ask the user what they want.`,
    { display: answer.reason ? `Denied: ${answer.reason}` : 'Denied by you' },
  );
}

function toolResult(toolUseId, content, isError = false) {
  return { type: 'tool_result', tool_use_id: toolUseId, content, ...(isError && { is_error: true }) };
}

/**
 * Save this turn's messages to history.
 * - Nothing to save if the turn never got past the user's message (failed or cancelled immediately).
 * - If a reply was interrupted mid-stream, keep the text the user already saw.
 */
function commit(session, pending, partialText) {
  if (partialText) pending.push({ role: 'assistant', content: [{ type: 'text', text: partialText }] });
  if (pending.length > 1) {
    session.history.push(...pending);
    session.recordMessages(pending); // Phase 09: save to the transcript
  }
}
