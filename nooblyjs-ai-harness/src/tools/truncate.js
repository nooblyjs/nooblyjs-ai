import fs from 'node:fs';
import path from 'node:path';

// Tool output can be enormous (a build log, `cat` of a huge file…). Every
// character we send back costs tokens and fills the context window, so long
// output is cut. We keep the START and the END, because that's usually where
// the useful part is (what ran, and how it finished or failed).

export const MAX_OUTPUT_CHARS = 30_000;

export function truncateMiddle(text, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  const omitted = text.length - 2 * half;
  return `${text.slice(0, half)}\n\n… [${omitted} characters omitted] …\n\n${text.slice(-half)}`;
}

// Phase 08: the limit for ANY tool result (on top of each tool's own limits).
// ~40,000 characters is roughly 10,000 tokens.
export const MAX_TOOL_RESULT_CHARS = 40_000;

/**
 * Cut an over-long tool result.
 *
 * Phase 26: with `saveTo` (a file path), the FULL output is saved there first, and
 * the model gets the start, the end, and the path: nothing is lost, it can Read the
 * middle with offset/limit or Grep it. Paging, not truncating.
 */
export function limitToolOutput(content, max = MAX_TOOL_RESULT_CHARS, { saveTo } = {}) {
  if (typeof content !== 'string' || content.length <= max) return content;
  if (!saveTo) {
    return (
      truncateMiddle(content, max) +
      '\n\n[This output was too long and was cut in the middle. Ask for less at a time: e.g. Read with offset/limit, Grep with head_limit or a narrower path.]'
    );
  }
  fs.mkdirSync(path.dirname(saveTo), { recursive: true });
  fs.writeFileSync(saveTo, content);
  const lines = content.split('\n');
  const head = previewLines(lines, 0, PREVIEW_HEAD_CHARS);
  const tail = previewLines(lines.slice(head.count), -1, PREVIEW_TAIL_CHARS);
  const skipped = lines.length - head.count - tail.count;
  return [
    head.text,
    `\n… [${skipped.toLocaleString()} lines not shown: lines ${head.count + 1}–${head.count + skipped} of ${lines.length.toLocaleString()}] …\n`,
    tail.text,
    '',
    `${SAVED_MARKER} ${saveTo} (${lines.length.toLocaleString()} lines, ${content.length.toLocaleString()} characters). Read it with offset/limit (e.g. offset=${head.count + 1}), or Grep it with path set to that file.]`,
  ].join('\n');
}

export const SAVED_MARKER = '[Output too long for one message. The full output is saved in';
const PREVIEW_HEAD_CHARS = 12_000;
const PREVIEW_TAIL_CHARS = 8_000;

/** Whole lines from the start (direction 0) or the end (-1), up to `budget` characters. */
function previewLines(lines, direction, budget) {
  const picked = [];
  let used = 0;
  const ordered = direction === 0 ? lines : [...lines].reverse();
  for (const line of ordered) {
    const cut = line.length > 2_000 ? `${line.slice(0, 2_000)}… [line cut]` : line;
    if (used + cut.length + 1 > budget && picked.length) break;
    picked.push(cut);
    used += cut.length + 1;
  }
  if (direction !== 0) picked.reverse();
  return { text: picked.join('\n'), count: picked.length };
}

/** The saved path in a limited result, if any (compaction keeps it: Phase 26). */
export function savedPathIn(content) {
  if (typeof content !== 'string') return null;
  const at = content.lastIndexOf(SAVED_MARKER);
  if (at === -1) return null;
  return content.slice(at + SAVED_MARKER.length).trim().split(' (')[0];
}
