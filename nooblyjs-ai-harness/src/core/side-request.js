// A one-off request to the (small) model, outside the conversation: no tools,
// no history. Used for side jobs like "extract the answer from this web page"
// (Phase 18). The cost is returned so the caller can add it to the turn.
import { withRetry } from '../providers/retry.js';
import { PROVIDERS } from '../providers/index.js';
import { costOf } from './cost.js';
import { EVENT } from './events.js';
import { textOf } from './messages.js';

/** @returns {Promise<{ text: string, usage: object, cost: number, model: string }>} */
export async function sideRequest(session, { system, prompt, maxTokens = 4_000, signal }) {
  const model = session.settings.smallModel ?? PROVIDERS[session.providerId]?.smallModel ?? session.model;
  const request = { model, system, messages: [{ role: 'user', content: prompt }], tools: [], maxTokens };
  let message;
  for await (const event of withRetry(() => session.provider.stream(request, { signal }), { ...session.retry, signal })) {
    if (event.type === EVENT.MESSAGE) message = event.message;
  }
  const used = message.model ?? model;
  return { text: textOf(message.content).trim(), usage: message.usage, cost: costOf(used, message.usage), model: used };
}
