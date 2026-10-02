// Phase 08: making room in the context window.
//
// When the conversation gets too big we have two tools, cheapest first:
//
//   1. CLEAR old tool output. A file read 30 messages ago is usually no longer
//      needed word for word. Replace big old tool results with a short note.
//      No model call needed.
//   2. SUMMARISE ("compact"). Ask a cheaper model to write a structured summary
//      of the conversation, then replace the history with that summary plus the
//      most recent turn(s), kept word for word.
//
// Both EDIT history, and that has two costs:
//   - Prompt caching (Phase 09) only works while the start of the request is
//     unchanged, so an edit means paying full price once more. That's why we
//     only do it when we are about to run out of room anyway.
//   - Newer Claude models "bind" their thinking blocks to the exact
//     conversation that produced them. Replaying a thinking block after
//     editing the history before it is rejected. So whenever we edit, we also
//     strip all thinking blocks from the history. The text and tool calls stay.
import fs from 'node:fs';
import path from 'node:path';
import { savedPathIn } from '../tools/truncate.js';
import { EVENT } from '../core/events.js';
import { textOf } from '../core/messages.js';
import { withRetry } from '../providers/retry.js';
import { PROVIDERS } from '../providers/index.js';
import { contextUsage, estimateTokens } from './tokens.js';

const OLD_OUTPUT_NOTE = '[Old tool output cleared to save space. Run the tool again if you need it.]';
// Phase 26: if the output is on disk, clearing it loses nothing: point to the file instead.
const savedNote = (file) => `[Old tool output cleared to save space. The full output is saved in ${file}: Read or Grep it if you need it again.]`;
const KEEP_RECENT_MESSAGES = 6; // tool output in the last few messages is never cleared
const CLEAR_ABOVE_CHARS = 1_000; // only clear results bigger than this
const KEEP_TAIL_SHARE = 0.2; // recent turns kept word for word may use up to 20% of the window

// ── Helpers ─────────────────────────────────────────────────────────────

/** Remove thinking blocks (see the note at the top). An assistant message left empty gets a placeholder. */
export function stripThinking(messages) {
  return messages.map((message) => {
    if (message.role !== 'assistant' || typeof message.content === 'string') return message;
    const content = message.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...message, content: content.length ? content : [{ type: 'text', text: '(no visible reply)' }] };
  });
}

/** Does the history contain any thinking blocks? */
export function hasThinking(messages) {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking'));
}

/**
 * A message where a new "turn" starts: a user message the USER wrote (not one
 * carrying tool results). Only here can history be cut without separating a
 * tool_use from its tool_result.
 */
export function isTurnStart(message) {
  if (message.role !== 'user') return false;
  return typeof message.content === 'string' || !message.content.some((b) => b.type === 'tool_result');
}

// ── Step 1: clear old tool output ───────────────────────────────────────

/** @returns {{ history: object[], cleared: number }} */
export function clearOldToolOutput(history, { save } = {}) {
  let cleared = 0;
  const cutoff = history.length - KEEP_RECENT_MESSAGES;
  const updated = history.map((message, index) => {
    if (index >= cutoff || message.role !== 'user' || !Array.isArray(message.content)) return message;
    const content = message.content.map((block) => {
      // Phase 28: an old image (e.g. a screenshot Read long ago) is cleared too.
      if (block.type === 'tool_result' && Array.isArray(block.content) && block.content.some((b) => b.type === 'image')) {
        cleared += 1;
        return { ...block, content: '[Old image cleared to save space. Read it again if you need to see it.]' };
      }
      if (block.type !== 'tool_result' || typeof block.content !== 'string' || block.content.length <= CLEAR_ABOVE_CHARS) return block;
      cleared += 1;
      const file = savedPathIn(block.content) ?? save?.(block);
      return { ...block, content: file ? savedNote(file) : OLD_OUTPUT_NOTE };
    });
    return { ...message, content };
  });
  return { history: cleared ? stripThinking(updated) : history, cleared };
}

// ── Step 2: summarise ───────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT =
  'You write summaries of conversations between a user and an AI coding agent, so the agent can continue the work after its earlier messages are removed.';

export function summaryPrompt(transcript, focus) {
  return [
    'Here is a conversation between a user and an AI coding agent:',
    '',
    '<conversation>',
    transcript,
    '</conversation>',
    '',
    'Write a summary the agent can continue from. Use these sections:',
    '1. Goal: what the user wants overall, in their words where possible.',
    '2. Done so far: what has been completed, and key decisions made (with reasons).',
    '3. Files: files read, created or changed, and what matters about each.',
    '4. Current state: where the work stands right now, including errors or failing tests.',
    '5. Next steps: what remains, in order.',
    '6. Details to keep: exact commands, names, paths, numbers and user preferences that will matter later.',
    focus ? `\nThe user asked you to focus on: ${focus}` : '',
    '',
    'Be specific and concise. Reply with the summary only.',
  ].join('\n');
}

/** The conversation as plain text for the summariser (tool output shortened). */
export function transcriptText(history, { maxToolChars = 1_000 } = {}) {
  const shorten = (text) => (text.length > maxToolChars ? `${text.slice(0, maxToolChars)}… [${text.length - maxToolChars} more characters]` : text);
  const lines = [];
  for (const message of history) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    for (const block of blocks) {
      if (block.type === 'text') lines.push(`${message.role === 'user' ? 'User' : 'Agent'}: ${block.text}`);
      else if (block.type === 'tool_use') lines.push(`Agent used ${block.name}: ${JSON.stringify(block.input)}`);
      else if (block.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content : textOf(block.content ?? []);
        lines.push(`${block.is_error ? 'Tool error' : 'Tool result'}: ${shorten(text)}`);
      }
    }
  }
  return lines.join('\n\n');
}

/** Ask the (small) model for a summary. Returns the summary text and the cost. */
export async function summarize(session, history, { focus, signal } = {}) {
  const model = session.settings.smallModel ?? PROVIDERS[session.providerId]?.smallModel ?? session.model;
  const request = {
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    // One plain-text message: no tools, no thinking blocks, works with every provider.
    messages: [{ role: 'user', content: summaryPrompt(transcriptText(history), focus) }],
    tools: [],
    maxTokens: 8_000,
  };
  let message;
  for await (const event of withRetry(() => session.provider.stream(request, { signal }), { ...session.retry, signal })) {
    if (event.type === EVENT.MESSAGE) message = event.message;
  }
  return { summary: textOf(message.content).trim(), model: message.model ?? model, usage: message.usage };
}

/**
 * Which recent messages to keep word for word: whole turns from the end, while
 * they fit in KEEP_TAIL_SHARE of the window. Returns the index to cut at.
 */
export function chooseCut(history, windowTokens) {
  const budget = windowTokens * KEEP_TAIL_SHARE;
  let cut = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!isTurnStart(history[i])) continue;
    if (estimateTokens(history.slice(i)) > budget) break;
    cut = i;
  }
  return cut;
}

/** Index where the most recent turn begins (0 if there is only one turn). */
export function lastTurnStart(history) {
  for (let i = history.length - 1; i > 0; i--) if (isTurnStart(history[i])) return i;
  return 0;
}

/**
 * Make room: clear old tool output, and summarise if that isn't enough.
 * Updates session.history. `force` (for /compact) always summarises.
 * @returns {Promise<{ method: 'cleared' | 'summarized' | 'nothing', before: number, after: number, cost?: number }>}
 */
export async function compactSession(session, { focus, signal, force = false, trigger = force ? 'manual' : 'auto' } = {}) {
  const before = contextUsage(session).tokens;
  const threshold = session.settings.compactThreshold;

  // Phase 12: PreCompact hooks, e.g. to save a copy of the full conversation first. They can't stop it.
  const hookErrors = session.hooks?.has('PreCompact')
    ? (await session.hooks.run('PreCompact', { trigger, custom_instructions: focus ?? null }, { signal })).errors
    : [];

  if (!force) {
    // Phase 26: save each cleared result first (when the session can), so it stays one Read away.
    const dir = session.toolResultsDir;
    const save = dir
      ? (block) => {
          const file = path.join(dir, `${block.tool_use_id}.txt`);
          fs.mkdirSync(dir, { recursive: true });
          if (!fs.existsSync(file)) fs.writeFileSync(file, block.content);
          return file;
        }
      : undefined;
    const { history, cleared } = clearOldToolOutput(session.history, { save });
    if (cleared) {
      session.replaceHistory(history, { reason: `cleared ${cleared} old tool results` });
      const after = contextUsage(session);
      if (after.fraction < threshold * 0.75) return { method: 'cleared', before, after: after.tokens, cleared, hookErrors };
    }
  }

  if (session.history.length === 0) return { method: 'nothing', before, after: before, hookErrors };

  const { window } = contextUsage(session);
  let cut = chooseCut(session.history, window);
  // Everything fits in the "keep" budget? Still keep only the latest turn and summarise the rest.
  if (cut === 0) cut = lastTurnStart(session.history);
  const older = session.history.slice(0, cut);
  const recent = stripThinking(session.history.slice(cut));
  if (older.length === 0 && !force) return { method: 'nothing', before, after: before, hookErrors };

  const toSummarize = older.length ? older : session.history;
  const { summary, model, usage } = await summarize(session, toSummarize, { focus, signal });
  const kept = older.length ? recent : [];
  session.replaceHistory(withSummary(summary, kept), { reason: 'summarized', summaryUsage: { model, usage } });

  return { method: 'summarized', before, after: contextUsage(session).tokens, kept: kept.length, hookErrors };
}

const summaryBlock = (summary) => ({
  type: 'text',
  text: `<conversation-summary>\nThe earlier part of this conversation was summarized to save space:\n\n${summary}\n</conversation-summary>`,
});

/**
 * Put the summary at the very start of the history. It's merged into the first
 * kept user message, so messages still alternate user/assistant. With nothing
 * kept, it's a user message of its own; the user's next message follows it
 * (two user messages in a row are allowed: the API joins them).
 */
export function withSummary(summary, kept) {
  if (kept.length === 0) return [{ role: 'user', content: [summaryBlock(summary)] }];
  const [first, ...rest] = kept;
  const firstBlocks = typeof first.content === 'string' ? [{ type: 'text', text: first.content }] : first.content;
  return [{ ...first, content: [summaryBlock(summary), ...firstBlocks] }, ...rest];
}
