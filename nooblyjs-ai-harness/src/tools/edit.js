// Phase 05: change part of a file by exact string replacement.
//
// Why "find this exact text, replace it with that" instead of line numbers or
// diffs? Line numbers shift as soon as anything above changes, and models are
// bad at writing valid diffs. An exact string either matches or it doesn't, and
// if it matches more than once we refuse, so the edit can't land in the wrong place.
import fs from 'node:fs/promises';
import { assertReadAndUnchanged, rememberWrite } from './freshness.js';
import { resolveInsideProject } from './paths.js';
import { replaceText } from './replace.js';
import { defineTool } from './tool.js';
import { problemsLabel, shortPath } from './write.js';

export const editTool = defineTool({
  name: 'Edit',
  isReadOnly: false,
  description: [
    'Replace an exact piece of text in a file with new text. You must Read the file first.',
    '`old_string` must match the file EXACTLY, including indentation and line breaks. Do not include the line-number prefixes that Read shows.',
    '`old_string` must appear exactly once, so include enough surrounding lines to make it unique. Set `replace_all` to change every occurrence (e.g. renaming a variable).',
    'For changes to existing files, this is safer and cheaper than rewriting the whole file with Write.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to change' },
      old_string: { type: 'string', description: 'The exact text to replace' },
      new_string: { type: 'string', description: 'The text to put in its place' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },

  summarize: (input, ctx) => shortPath(input.file_path, ctx.cwd),

  async call({ file_path, old_string, new_string, replace_all = false }, ctx) {
    const fullPath = await resolveInsideProject(file_path, ctx.cwd, ctx.session?.writableDirs ?? []); // + memory (Phase 16)
    await assertReadAndUnchanged(ctx, fullPath, file_path);
    const original = await fs.readFile(fullPath, 'utf8');
    // Phase 25: exact first; if the whitespace differs, an unambiguous whole-line match (replace.js).
    const { content: updated, count, fuzzy, firstLine: where } = replaceText(original, old_string, new_string, { replaceAll: replace_all, fileLabel: file_path });

    await ctx.session?.checkpoints?.beforeWrite(fullPath); // Phase 21: keep the old version, for /rewind
    await ctx.session?.feedback?.before(fullPath); // Phase 24: what was already wrong
    await fs.writeFile(fullPath, updated, 'utf8');
    await rememberWrite(ctx, fullPath);
    const feedback = (await ctx.session?.feedback?.after(fullPath)) ?? { note: null, count: 0 };

    const removed = old_string.split('\n');
    const added = new_string.split('\n');
    const note = fuzzy ? ' old_string matched only when ignoring whitespace at the start and end of lines, so the new text was re-indented to fit; Read the result if the indentation matters.' : '';
    return {
      content: `Edited ${file_path}: replaced ${count} occurrence${count === 1 ? '' : 's'} (first at line ${where}).${note}${feedback.note ? `\n\n${feedback.note}` : ''}`,
      display: `${count === 1 ? '' : `${count} occurrences · `}−${removed.length} +${added.length} lines${problemsLabel(feedback.count)}`,
      preview: [...removed.slice(0, 6).map((line) => `- ${line}`), ...added.slice(0, 6).map((line) => `+ ${line}`)],
    };
  },
});
