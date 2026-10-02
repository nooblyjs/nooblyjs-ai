// @ts-check
// Images in a conversation travel as content blocks, the same way text does:
//   { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0…" } }
// That's the Anthropic shape; the OpenAI adapters translate it with these helpers.
// Moved here from the harness's tools/images.js (harness Phase 28).

/**
 * Every image block in some content, including those inside tool results.
 * @param {unknown} content
 * @returns {Array<{ type: 'image', source: { media_type: string, data: string } }>}
 */
export function imagesIn(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => (block.type === 'image' ? [block] : block.type === 'tool_result' ? imagesIn(block.content) : []));
}

/**
 * A data: URL, the way OpenAI's APIs take images.
 * @param {{ source: { media_type: string, data: string } }} block
 */
export const dataUrl = (block) => `data:${block.source.media_type};base64,${block.source.data}`;
