// @ts-check
// Prompt caching. Moved here from the harness's context/cache.js (harness Phase 09).
//
// Every request re-sends the same long start: tool definitions, system prompt,
// and the conversation so far. Providers can CACHE that start: if the next
// request begins with exactly the same bytes, those tokens are read from the
// cache at a fraction of the price (Anthropic: 10% or less of the input price).
//
//   request 1:  [tools][system][msg1][msg2]                 → writes the cache
//   request 2:  [tools][system][msg1][msg2][msg3][msg4]     → reads [tools…msg2] from cache
//
// OpenAI and xAI do this automatically. Anthropic asks you to mark where the
// cacheable part ends with `cache_control` "breakpoints" (at most 4). We mark:
//   1. the last tool definition   (tools rarely change)
//   2. the system prompt          (fixed for the session, see Phase 07)
//   3. the last block of the last message (so the NEXT request can reuse everything up to here)
//
// Caching needs the start to stay byte-for-byte identical. So anything that
// changes from request to request (e.g. a teammate's memory) goes in `context`:
// it's sent as a second system block AFTER the breakpoint, and doesn't spoil the
// cached system prompt in front of it.
// Note: very short prompts (under ~1-4k tokens, depending on the model) aren't cached at all.

const BREAKPOINT = { type: 'ephemeral' };

/**
 * Returns copies of system/tools/messages with cache breakpoints added.
 * Nothing in the caller's history is modified.
 * @param {{ system?: string, context?: string, tools?: any[], messages: any[] }} request
 */
export function addCacheBreakpoints({ system, context, tools = [], messages }) {
  const cachedTools = tools.length ? [...tools.slice(0, -1), { ...tools.at(-1), cache_control: BREAKPOINT }] : tools;
  /** @type {Array<{ type: 'text', text: string, cache_control?: object }>} */
  const systemBlocks = [];
  if (system) systemBlocks.push({ type: 'text', text: system, cache_control: BREAKPOINT });
  if (context) systemBlocks.push({ type: 'text', text: context });
  const cachedSystem = systemBlocks.length ? systemBlocks : system;

  let cachedMessages = messages;
  if (messages.length) {
    const last = messages.at(-1);
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
    if (blocks.length) {
      const marked = [...blocks.slice(0, -1), { ...blocks.at(-1), cache_control: BREAKPOINT }];
      cachedMessages = [...messages.slice(0, -1), { ...last, content: marked }];
    }
  }
  return { system: cachedSystem, tools: cachedTools, messages: cachedMessages };
}
