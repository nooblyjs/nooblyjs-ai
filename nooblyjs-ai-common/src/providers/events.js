// @ts-check
// The events a provider yields while a reply streams in.
//
// Instead of one big answer at the end, a provider YIELDS small events as they
// happen, so an app can show the reply as it's written:
//
//   for await (const event of provider.stream(request)) {
//     if (event.type === 'text_delta') process.stdout.write(event.text);
//   }
//
// The last event is always `message`: the complete reply, Anthropic-shaped
// whichever provider wrote it (see the adapters for the translation).
// Moved here from the harness's core/events.js, which adds the agent loop's own events.

/**
 * @typedef {{ type: 'message_start', model: string, usage: object }} MessageStartEvent  request accepted, reply starting
 * @typedef {{ type: 'text_delta', text: string }} TextDeltaEvent                       a few more characters of the reply
 * @typedef {{ type: 'thinking_delta', text: string }} ThinkingDeltaEvent               a piece of the model's thinking summary
 * @typedef {{ type: 'message', message: Message }} MessageEvent                        the complete reply, always last
 * @typedef {{ type: 'retry', attempt: number, delayMs: number, error: string }} RetryEvent  a request failed; trying again soon (withRetry)
 *
 * @typedef {Object} Message
 * @property {string} [model]           the model that answered (with fallbacks, maybe not the one asked for)
 * @property {Array<{ type: string, [key: string]: any }>} content  text, tool_use, thinking… blocks
 * @property {string | null} stop_reason  end_turn, tool_use, max_tokens, refusal…
 * @property {object} [stop_details]
 * @property {import('../cost.js').Usage} usage
 */

export const EVENT = Object.freeze({
  MESSAGE_START: 'message_start',
  TEXT_DELTA: 'text_delta',
  THINKING_DELTA: 'thinking_delta',
  MESSAGE: 'message',
  RETRY: 'retry',
});
