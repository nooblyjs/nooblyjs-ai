// Phase 08: counting tokens and knowing how much room there is.
//
// Every request re-sends the system prompt, the tool definitions and the whole
// conversation. A model can only read so much at once: its CONTEXT WINDOW.
// We need to know roughly how full it is BEFORE sending, so we can make room.
//
// Exact counts depend on each provider's tokenizer. A good-enough estimate for
// English and code is ~4 characters per token. (Anthropic also offers a
// count_tokens endpoint for exact numbers, at the cost of an extra request.)
//
// estimateTokens and contextWindowFor now live in nooblyjs-ai-common (src/tokens.js),
// shared with the other nooblyjs AI projects. What stays here is the harness's own
// part: measuring a Session's next request against its model's window.
import { estimateTokens, contextWindowFor } from 'nooblyjs-ai-common/tokens';

export { CHARS_PER_TOKEN, contextWindowFor, estimateTokens } from 'nooblyjs-ai-common/tokens';

/**
 * Estimated size of the next request: system prompt + tools + history
 * (+ the new message, if given).
 */
export function estimateContext(session, extraMessages = []) {
  return (
    estimateTokens(session.systemPrompt) +
    estimateTokens(session.tools.toApiSchemas()) +
    estimateTokens(session.history) +
    estimateTokens(extraMessages)
  );
}

/** How full the context window is: { tokens, window, fraction }. */
export function contextUsage(session, extraMessages) {
  const tokens = estimateContext(session, extraMessages);
  const window = contextWindowFor(session.model, session.settings.contextWindow);
  return { tokens, window, fraction: tokens / window };
}
