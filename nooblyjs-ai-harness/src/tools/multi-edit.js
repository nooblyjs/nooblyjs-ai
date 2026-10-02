// Phase 25: MultiEdit. Several changes to ONE file in one call.
//
// Renaming a function and updating its three callers in the same file is four
// Edit calls: four round trips, and if the third fails the file is half-changed.
// MultiEdit applies the edits in order, in memory, and writes the file only if
// every one of them succeeded: all or nothing.
import fs from 'node:fs/promises';
import { commitChanges } from './commit-changes.js';
import { assertReadAndUnchanged } from './freshness.js';
import { resolveInsideProject } from './paths.js';
import { replaceText } from './replace.js';
import { defineTool, ToolError } from './tool.js';
import { problemsLabel, shortPath } from './write.js';

export const multiEditTool = defineTool({
  name: 'MultiEdit',
  isReadOnly: false,
  description: [
    'Make several exact-text replacements in ONE file in a single call. The edits are applied in order, each to the result of the one before, and the file is only written if ALL of them succeed.',
    'Each edit works like Edit (old_string must match exactly and be unique unless replace_all). You must Read the file first.',
    'Prefer this over several Edit calls to the same file.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to change' },
      edits: {
        type: 'array',
        description: 'The replacements, applied in order',
        items: {
          type: 'object',
          properties: { old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['file_path', 'edits'],
    additionalProperties: false,
  },
  summarize: (input, ctx) => `${shortPath(input.file_path, ctx.cwd)} (${input.edits?.length ?? 0} edits)`,

  async call({ file_path, edits }, ctx) {
    if (!edits.length) throw new ToolError('edits is empty: give at least one { old_string, new_string }.');
    const fullPath = await resolveInsideProject(file_path, ctx.cwd, ctx.session?.writableDirs ?? []);
    await assertReadAndUnchanged(ctx, fullPath, file_path);
    let content = await fs.readFile(fullPath, 'utf8');
    let replaced = 0;
    const fuzzy = [];
    for (const [i, edit] of edits.entries()) {
      if (typeof edit?.old_string !== 'string' || typeof edit?.new_string !== 'string') throw new ToolError(`Edit ${i + 1} needs old_string and new_string (strings).`);
      try {
        const result = replaceText(content, edit.old_string, edit.new_string, { replaceAll: edit.replace_all, fileLabel: `${file_path} (after the edits before it)` });
        content = result.content;
        replaced += result.count;
        if (result.fuzzy) fuzzy.push(i + 1);
      } catch (error) {
        throw new ToolError(`Edit ${i + 1} of ${edits.length} failed, so none were applied: ${error.message}`);
      }
    }
    const { notes, problems } = await commitChanges(ctx, [{ fullPath, shown: file_path, content }]);
    return {
      content: [
        `Edited ${file_path}: ${edits.length} edit${edits.length === 1 ? '' : 's'}, ${replaced} replacement${replaced === 1 ? '' : 's'}.`,
        fuzzy.length ? `Edit${fuzzy.length === 1 ? '' : 's'} ${fuzzy.join(', ')} matched only when ignoring whitespace at the start and end of lines (re-indented to fit).` : '',
        ...notes,
      ].filter(Boolean).join('\n\n'),
      display: `${edits.length} edits${problemsLabel(problems)}`,
      preview: edits.slice(0, 3).flatMap((edit) => [`- ${edit.old_string.split('\n')[0]}`, `+ ${edit.new_string.split('\n')[0]}`]),
    };
  },
});
