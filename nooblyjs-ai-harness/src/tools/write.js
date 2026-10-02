// Phase 05: create a new file, or replace an existing one completely.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertReadAndUnchanged, rememberWrite } from './freshness.js';
import { resolveForWrite } from './paths.js';
import { defineTool, ToolError } from './tool.js';

export const writeTool = defineTool({
  name: 'Write',
  isReadOnly: false,
  description: [
    'Create a new file, or overwrite an existing file completely, with the given content.',
    'To change part of an existing file, use Edit instead: it is safer and much cheaper.',
    'If the file already exists you must Read it first; otherwise this tool refuses.',
    'Missing parent folders are created. Paths must be inside the project.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to write' },
      content: { type: 'string', description: 'The complete new content of the file' },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  },

  summarize: (input, ctx) => shortPath(input.file_path, ctx.cwd),

  async call({ file_path, content }, ctx) {
    const fullPath = await resolveForWrite(file_path, ctx.cwd, ctx.session?.writableDirs ?? []); // + memory (Phase 16)
    const exists = await fs.stat(fullPath).then((s) => s, () => null);

    if (exists?.isDirectory()) throw new ToolError(`${file_path} is a directory.`);
    if (exists) await assertReadAndUnchanged(ctx, fullPath, file_path);

    await ctx.session?.checkpoints?.beforeWrite(fullPath); // Phase 21: keep the old version (or "didn't exist"), for /rewind
    await ctx.session?.feedback?.before(fullPath); // Phase 24: what was already wrong
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    await rememberWrite(ctx, fullPath);
    const feedback = (await ctx.session?.feedback?.after(fullPath)) ?? { note: null, count: 0 };

    const lines = content === '' ? 0 : content.replace(/\n$/, '').split('\n').length;
    const verb = exists ? 'Overwrote' : 'Created';
    return {
      content: `${verb} ${file_path} (${lines} lines).${feedback.note ? `\n\n${feedback.note}` : ''}`,
      display: `${verb.toLowerCase()} · ${lines} lines${problemsLabel(feedback.count)}`,
      preview: content.split('\n').slice(0, 5).map((line) => `+ ${line}`),
    };
  },
});

/** Phase 24: " · ⚠ 2 new problems" for the tool line, or nothing. */
export function problemsLabel(count) {
  return count ? ` · ⚠ ${count} new problem${count === 1 ? '' : 's'}` : '';
}

export function shortPath(filePath, cwd) {
  const relative = path.relative(cwd, path.resolve(cwd, filePath));
  return relative && !relative.startsWith('..') ? relative : filePath;
}
