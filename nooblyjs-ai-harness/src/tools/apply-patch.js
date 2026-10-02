// Phase 25: ApplyPatch. Change, add, delete and move files with one patch (see patch.js).
// Offered to OpenAI models instead of Edit/MultiEdit (tools/index.js), because it is
// the format they were trained on. Same rules as Edit: files must be Read first,
// paths stay in the project, and nothing is written unless the WHOLE patch applies.
import fs from 'node:fs/promises';
import { commitChanges } from './commit-changes.js';
import { assertReadAndUnchanged } from './freshness.js';
import { resolveForWrite, resolveInsideProject } from './paths.js';
import { applyChunks, parsePatch, patchPaths } from './patch.js';
import { defineTool, ToolError } from './tool.js';
import { problemsLabel } from './write.js';

export const applyPatchTool = defineTool({
  name: 'ApplyPatch',
  isReadOnly: false,
  description: [
    'Edit files with a patch. Format:',
    '*** Begin Patch',
    '*** Update File: path/to/file.js',
    '@@ (optional: a line near the change, e.g. the function name)',
    ' unchanged context line',
    '-removed line',
    '+added line',
    '*** Add File: path/to/new.js',
    '+every line starts with +',
    '*** Delete File: path/to/old.js',
    '*** End Patch',
    'Use "*** Move to: new/path" right after "*** Update File:" to rename. No line numbers: each chunk is found by its context and "-" lines, so include 1-3 unchanged lines around each change.',
    'Files you update or delete must have been Read first. The patch is applied completely or not at all.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: { patch: { type: 'string', description: 'The whole patch, from "*** Begin Patch" to "*** End Patch"' } },
    required: ['patch'],
    additionalProperties: false,
  },
  summarize: ({ patch }) => {
    const paths = patchPaths(patch);
    return paths.length ? `${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` +${paths.length - 3}` : ''}` : 'patch';
  },

  async call({ patch }, ctx) {
    const ops = parsePatch(patch);
    const writable = ctx.session?.writableDirs ?? [];
    const changes = [];
    const summary = [];
    for (const op of ops) {
      if (op.type === 'add') {
        const fullPath = await resolveForWrite(op.path, ctx.cwd, writable);
        if (await exists(fullPath)) throw new ToolError(`${op.path} already exists: use "*** Update File:" to change it.`);
        changes.push({ fullPath, shown: op.path, content: op.lines.join('\n') + '\n' });
        summary.push(`added ${op.path}`);
        continue;
      }
      const fullPath = await resolveInsideProject(op.path, ctx.cwd, writable);
      await assertReadAndUnchanged(ctx, fullPath, op.path);
      if (op.type === 'delete') {
        changes.push({ fullPath, shown: op.path, content: null });
        summary.push(`deleted ${op.path}`);
        continue;
      }
      const updated = applyChunks(await fs.readFile(fullPath, 'utf8'), op.chunks, op.path);
      if (op.moveTo) {
        const target = await resolveForWrite(op.moveTo, ctx.cwd, writable);
        if (await exists(target)) throw new ToolError(`Can't move ${op.path} to ${op.moveTo}: it already exists.`);
        changes.push({ fullPath: target, shown: op.moveTo, content: updated }, { fullPath, shown: op.path, content: null });
        summary.push(`moved ${op.path} → ${op.moveTo}`);
      } else {
        changes.push({ fullPath, shown: op.path, content: updated });
        summary.push(`updated ${op.path} (${op.chunks.length} chunk${op.chunks.length === 1 ? '' : 's'})`);
      }
    }
    const { notes, problems } = await commitChanges(ctx, changes);
    return {
      content: [`Applied the patch: ${summary.join('; ')}.`, ...notes].join('\n\n'),
      display: `${summary.length} file${summary.length === 1 ? '' : 's'}${problemsLabel(problems)}`,
      preview: summary.slice(0, 5),
    };
  },
});

const exists = (file) => fs.stat(file).then(() => true, () => false);
