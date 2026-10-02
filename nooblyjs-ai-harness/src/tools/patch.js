// Phase 25: the "apply_patch" format, which OpenAI's models are trained to write.
//
//   *** Begin Patch
//   *** Update File: src/app.js
//   @@ function main
//    const a = 1;          ← " " context: must be there, stays
//   -const b = 2;          ← "-" removed
//   +const b = 3;          ← "+" added
//   *** Add File: src/new.js
//   +export const x = 1;
//   *** Delete File: src/old.js
//   *** Update File: src/a.js
//   *** Move to: src/b.js
//   …
//   *** End Patch
//
// Unlike a classic unified diff there are no line NUMBERS (models are bad at
// counting): each chunk is found by its context and removed lines, searching
// forward from the previous chunk. Like Edit, the old lines must be found; like
// the Phase 25 fallback, trailing and then surrounding whitespace may differ.
import { ToolError } from './tool.js';

/**
 * Parse a patch into operations.
 * @returns {Array<{ type: 'add', path: string, lines: string[] } | { type: 'delete', path: string }
 *   | { type: 'update', path: string, moveTo?: string, chunks: Array<{ old: string[], new: string[] }> }>}
 */
export function parsePatch(text) {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines[0]?.trim() !== '*** Begin Patch') throw new ToolError('A patch must start with "*** Begin Patch".');
  if (lines.at(-1)?.trim() !== '*** End Patch') throw new ToolError('A patch must end with "*** End Patch".');
  const ops = [];
  let op = null;
  let chunk = null;
  const header = (line, prefix) => (line.startsWith(prefix) ? line.slice(prefix.length).trim() : null);

  for (const [index, line] of lines.slice(1, -1).entries()) {
    let file;
    if ((file = header(line, '*** Add File:')) !== null) ops.push((op = { type: 'add', path: file, lines: [] }));
    else if ((file = header(line, '*** Delete File:')) !== null) ops.push((op = { type: 'delete', path: file }));
    else if ((file = header(line, '*** Update File:')) !== null) {
      ops.push((op = { type: 'update', path: file, chunks: [] }));
      chunk = null;
    } else if ((file = header(line, '*** Move to:')) !== null && op?.type === 'update') op.moveTo = file;
    else if (line.startsWith('*** End of File')) continue;
    else if (op?.type === 'add') {
      if (!line.startsWith('+')) throw new ToolError(`Line ${index + 2}: every line of an added file must start with "+".`);
      op.lines.push(line.slice(1));
    } else if (op?.type === 'update') {
      if (line.startsWith('@@')) {
        op.chunks.push((chunk = { old: [], new: [] }));
        continue;
      }
      if (!chunk) op.chunks.push((chunk = { old: [], new: [] }));
      const [mark, rest] = [line[0] ?? ' ', line.slice(1)];
      if (mark === ' ') chunk.old.push(rest), chunk.new.push(rest);
      else if (mark === '-') chunk.old.push(rest);
      else if (mark === '+') chunk.new.push(rest);
      else throw new ToolError(`Line ${index + 2}: a changed line must start with " ", "-" or "+" (got: ${JSON.stringify(line.slice(0, 40))}).`);
    } else if (line.trim()) throw new ToolError(`Line ${index + 2}: expected "*** Add File:", "*** Update File:" or "*** Delete File:".`);
  }
  if (!ops.length) throw new ToolError('The patch changes no files.');
  return ops;
}

/** Apply one Update's chunks to a file's text. */
export function applyChunks(content, chunks, label) {
  const lines = content.split('\n');
  let from = 0;
  for (const [i, chunk] of chunks.entries()) {
    if (!chunk.old.length) {
      // Only additions: append at the end (before a final newline).
      const end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
      lines.splice(end, 0, ...chunk.new);
      continue;
    }
    const at = findLines(lines, chunk.old, from);
    if (at === -1) throw new ToolError(`Chunk ${i + 1} of ${label}: these lines were not found:\n${chunk.old.slice(0, 5).join('\n')}\nRead the file again and make the context and "-" lines match it.`);
    lines.splice(at, chunk.old.length, ...chunk.new);
    from = at + chunk.new.length;
  }
  return lines.join('\n');
}

/** Exactly, then ignoring trailing whitespace, then ignoring surrounding whitespace. */
function findLines(lines, wanted, from) {
  for (const same of [(a, b) => a === b, (a, b) => a.trimEnd() === b.trimEnd(), (a, b) => a.trim() === b.trim()]) {
    for (let i = from; i + wanted.length <= lines.length; i++) {
      if (wanted.every((line, j) => same(line, lines[i + j]))) return i;
    }
  }
  return -1;
}

/** The files a patch touches (for the permission gate). */
export function patchPaths(text) {
  try {
    return parsePatch(text).flatMap((op) => [op.path, ...(op.moveTo ? [op.moveTo] : [])]);
  } catch {
    return [];
  }
}
