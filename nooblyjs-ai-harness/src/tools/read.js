// Phase 04: the first tool. Read a text file and return it with line numbers.
//
// Why line numbers? The model can then refer to "line 42" precisely, and in
// Phase 05 it will use them to decide what to edit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { defineTool, ToolError } from './tool.js';
import { imageBlock, isImagePath } from './images.js';
import { resolveInsideProject } from './paths.js';

export const DEFAULT_LIMIT = 2000; // lines per read
const MAX_LINE_LENGTH = 2000; // characters; longer lines are cut
const MAX_FILE_BYTES = 10 * 1024 * 1024; // refuse anything bigger than 10 MB

export const readTool = defineTool({
  name: 'Read',
  isReadOnly: true,
  description: [
    'Read a text file from the project and return its contents with line numbers (like `cat -n`), starting at 1.',
    'Use this whenever you need to see what is in a file instead of guessing.',
    `By default it returns up to ${DEFAULT_LIMIT} lines from the start. For longer files, use \`offset\` and \`limit\` to read the next part.`,
    'Paths can be absolute or relative to the working directory, but must be inside the project.',
    'Images (.png, .jpg, .gif, .webp) are shown to you as images, e.g. screenshots or mockups. Other binary files (archives…) and directories can\'t be read.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path of the file to read' },
      offset: { type: 'integer', description: 'Line number to start from (1-based). Only for long files.' },
      limit: { type: 'integer', description: `How many lines to read (default ${DEFAULT_LIMIT})` },
    },
    required: ['file_path'],
    additionalProperties: false,
  },

  // Show paths inside the project relative to it ("src/cli.js"), anything else as given.
  summarize: (input, ctx) => {
    const relative = path.relative(ctx.cwd, path.resolve(ctx.cwd, input.file_path));
    return relative && !relative.startsWith('..') ? relative : input.file_path;
  },

  async call({ file_path, offset = 1, limit = DEFAULT_LIMIT }, ctx) {
    if (offset < 1) throw new ToolError('offset must be 1 or more (line numbers start at 1).');
    if (limit < 1) throw new ToolError('limit must be 1 or more.');

    // Phase 15: your skill folders (in ~/.noobly) may be read too.
    const fullPath = await resolveInsideProject(file_path, ctx.cwd, ctx.session?.readableDirs ?? []);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) throw new ToolError(`${file_path} is a directory, not a file.`);
    // Phase 28: an image comes back as an image block the model can SEE.
    if (isImagePath(fullPath)) return readImage(fullPath, file_path, stat, ctx);
    if (stat.size > MAX_FILE_BYTES) throw new ToolError(`${file_path} is too large to read (${stat.size} bytes).`);

    const bytes = await fs.readFile(fullPath);
    if (bytes.subarray(0, 8000).includes(0)) throw new ToolError(`${file_path} looks like a binary file, so it can't be shown as text.`);

    // Remember what was read and when. Phase 05 uses this: you must Read a file before you may overwrite it.
    ctx.session?.readFiles?.set(fullPath, stat.mtimeMs);

    const text = bytes.toString('utf8');
    if (text.length === 0) return { content: '(This file is empty.)', display: 'empty file' };

    const lines = text.replace(/\n$/, '').split('\n');
    const start = offset - 1;
    if (start >= lines.length) {
      throw new ToolError(`offset ${offset} is past the end of the file, which has ${lines.length} lines.`);
    }
    const shown = lines.slice(start, start + limit);

    const numbered = shown
      .map((line, i) => {
        const cut = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}… [line cut]` : line;
        return `${String(start + i + 1).padStart(6)}\t${cut}`;
      })
      .join('\n');

    const end = start + shown.length;
    const more =
      end < lines.length
        ? `\n\n(Showed lines ${offset}-${end} of ${lines.length}. Use offset=${end + 1} to read more.)`
        : '';

    return { content: numbered + more, display: `${shown.length} lines` };
  },
});

function readImage(fullPath, shown, stat, ctx) {
  if (ctx.session?.canSeeImages === false) {
    throw new ToolError(`${shown} is an image, and the current model can't see images. Describe what you need from it to the user, or switch to a model that can (e.g. /provider anthropic).`);
  }
  let block;
  try {
    block = imageBlock(fullPath);
  } catch (error) {
    throw new ToolError(error.message);
  }
  ctx.session?.readFiles?.set(fullPath, stat.mtimeMs);
  return {
    content: [{ type: 'text', text: `Image ${shown} (${(stat.size / 1024).toFixed(0)} KB):` }, block],
    display: `image · ${(stat.size / 1024).toFixed(0)} KB`,
  };
}
