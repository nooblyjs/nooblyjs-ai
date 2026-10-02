// Phase 03: the events that flow from the model to the UI.
//
// Instead of one big answer at the end, a provider now YIELDS small events as
// they happen. The Session passes them on, and adds its own. Anything that
// wants to follow along (the Ink UI, print mode, tests) just loops over them:
//
//   for await (const event of session.stream('hi')) { ... }
//
// From Phase 04 on, tool calls will be reported through these same events.
import { EVENT as PROVIDER_EVENT } from 'nooblyjs-ai-common/providers/events';

/**
 * Events a provider yields:
 * @typedef {{ type: 'message_start', model: string, usage: object }} MessageStartEvent  request accepted, reply starting
 * @typedef {{ type: 'text_delta', text: string }} TextDeltaEvent                       a few more characters of the reply
 * @typedef {{ type: 'thinking_delta', text: string }} ThinkingDeltaEvent               a piece of the model's thinking summary (Phase 18)
 * @typedef {{ type: 'message', message: object }} MessageEvent                         the complete reply, always last
 *
 * Events the agent loop adds (Phase 04):
 * @typedef {{ type: 'tool_start', id: string, name: string, input: object, summary: string }} ToolStartEvent  about to run a tool
 * @typedef {{ type: 'tool_end', id: string, name: string, summary: string, content: string, display?: string, preview?: string[],
 *             isError: boolean, durationMs: number }} ToolEndEvent                                        a tool finished
 * @typedef {{ type: 'notice', text: string }} NoticeEvent                                                  something worth telling the user
 *
 * Events for compaction (Phase 08):
 * @typedef {{ type: 'compact_start', tokens: number, window: number }} CompactStartEvent   about to make room
 * @typedef {{ type: 'compact', method: string, before: number, after: number, window: number }} CompactEvent  room was made
 *
 * Events from a subagent, forwarded while the Task tool runs (Phase 13):
 * @typedef {{ type: 'subagent', parentId: string, agent: string, event: object }} SubagentEvent
 *
 * Events the Session adds:
 * @typedef {{ type: 'retry', attempt: number, delayMs: number, error: string }} RetryEvent  a request failed, trying again soon
 * @typedef {{ type: 'stream_reset', error: string, attempt: number }} StreamResetEvent     the connection dropped MID-reply; the reply starts again (Phase 18)
 * @typedef {{ type: 'turn_end', text: string, stopReason: string | null, usage: object,
 *             cost: number, durationMs: number, interrupted: boolean,
 *             rounds: number, toolCalls: number }} TurnEndEvent                           the turn is over
 *
 * @typedef {MessageStartEvent | TextDeltaEvent | MessageEvent | ToolStartEvent | ToolEndEvent
 *           | NoticeEvent | RetryEvent | TurnEndEvent} Event
 */

// The provider events (message_start, text_delta, thinking_delta, message, retry) are
// defined in nooblyjs-ai-common, with the adapters that yield them; the rest are noobly's own.
export const EVENT = Object.freeze({
  ...PROVIDER_EVENT,
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  NOTICE: 'notice',
  COMPACT_START: 'compact_start',
  COMPACT: 'compact',
  SUBAGENT: 'subagent',
  STREAM_RESET: 'stream_reset',
  TURN_END: 'turn_end',
});
