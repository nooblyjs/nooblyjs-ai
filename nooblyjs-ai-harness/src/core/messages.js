// Helpers for the Messages API data shape.
//
// A message is { role: 'user' | 'assistant', content }. `content` is either a
// string or an array of blocks like { type: 'text', text: '...' }. The model can
// also return other block types (e.g. 'thinking'); we keep them in history
// untouched but only show the text blocks.

/** Join all text blocks of a message's content into one string. */
export function textOf(content) {
  if (typeof content === 'string') return content;
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Prepare a finished reply's content for saving to history.
 *
 * If the main model declined partway and a fallback model took over, the reply
 * contains a `fallback` block marking the switch. Before that marker only the
 * text blocks may be sent back to the API; after it, everything is kept.
 */
export function contentForHistory(content) {
  const boundary = content.findLastIndex((block) => block.type === 'fallback');
  if (boundary === -1) return content;
  return [...content.slice(0, boundary).filter((block) => block.type === 'text'), ...content.slice(boundary + 1)];
}
