// Phase 25: finding the text to replace, shared by Edit and MultiEdit.
//
// Exact matching (Phase 05) is the safe default: an edit either lands exactly
// where the model meant, or not at all. But models often get WHITESPACE wrong:
// a tab for spaces, a missing trailing space, two levels of indentation instead
// of three. Each miss costs a round trip ("old_string was not found", Read again,
// try again). So when the exact text isn't found, we try once more comparing
// lines with their leading/trailing whitespace ignored, and apply it ONLY if
// exactly one place matches. An ambiguous guess is still refused.
import { ToolError } from './tool.js';

/**
 * Replace `oldString` with `newString` in `content`.
 * @returns {{ content: string, count: number, fuzzy: boolean, firstLine: number }}
 */
export function replaceText(content, oldString, newString, { replaceAll = false, fileLabel = 'the file' } = {}) {
  if (oldString === '') throw new ToolError('old_string is empty. To create a new file, use Write.');
  if (oldString === newString) throw new ToolError('old_string and new_string are identical, so there is nothing to change.');

  const count = content.split(oldString).length - 1;
  if (count > 1 && !replaceAll) {
    throw new ToolError(`old_string appears ${count} times in ${fileLabel}. Include more surrounding lines to make it unique, or set replace_all to true to change all of them.`);
  }
  if (count > 0) {
    // split/join instead of String.replace: replace() treats "$&", "$1"… in the new text as patterns.
    const firstLine = content.slice(0, content.indexOf(oldString)).split('\n').length;
    return { content: content.split(oldString).join(newString), count, fuzzy: false, firstLine };
  }

  const fuzzy = fuzzyReplace(content, oldString, newString);
  if (fuzzy) return { ...fuzzy, count: 1, fuzzy: true };
  throw new ToolError(`old_string was not found in ${fileLabel}. It must match exactly, including whitespace and indentation. Read the file again to check.`);
}

/**
 * Match whole lines, ignoring leading and trailing whitespace. Only a single match counts.
 * The new text is re-indented by the difference between what the model wrote and what the file has.
 */
export function fuzzyReplace(content, oldString, newString) {
  const lines = content.split('\n');
  const wanted = oldString.replace(/\n$/, '').split('\n');
  const key = (line) => line.trim();
  if (wanted.every((line) => !line.trim())) return null;
  const matches = [];
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((line, j) => key(line) === key(lines[i + j]))) matches.push(i);
  }
  if (matches.length !== 1) return null;
  const at = matches[0];
  // Each indentation the model used → the indentation the file really has at that line ("    " → "\t").
  const indent = (line) => line.match(/^\s*/)[0];
  const levels = new Map();
  wanted.forEach((line, j) => line.trim() && !levels.has(indent(line)) && levels.set(indent(line), indent(lines[at + j])));
  const firstWanted = wanted.findIndex((line) => line.trim());
  const [gave, have] = [indent(wanted[firstWanted]), indent(lines[at + firstWanted])];
  const reindented = newString
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      const own = indent(line);
      if (levels.has(own)) return levels.get(own) + line.slice(own.length);
      return line.startsWith(gave) ? have + line.slice(gave.length) : line; // a new, deeper level: shift like the first line
    });
  const updated = [...lines.slice(0, at), ...reindented, ...lines.slice(at + wanted.length)];
  return { content: updated.join('\n'), firstLine: at + 1 };
}
