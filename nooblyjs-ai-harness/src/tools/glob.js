// Phase 05: find files by name pattern, e.g. "src/**/*.js".
import fs from 'node:fs/promises';
import path from 'node:path';
import { listProjectFiles } from './files.js';
import { resolveInsideProject } from './paths.js';
import { defineTool } from './tool.js';

const MAX_RESULTS = 100;

export const globTool = defineTool({
  name: 'Glob',
  isReadOnly: true,
  description: [
    'Find files whose path matches a glob pattern, e.g. "**/*.js", "src/**/*.test.js" or "*.md".',
    '`*` matches within one folder name, `**` matches any number of folders.',
    `Returns matching paths relative to the working directory, most recently modified first (max ${MAX_RESULTS}).`,
    'Files ignored by git (node_modules, build output…) are skipped.',
    'Use this to find files by name. To search inside files, use Grep.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.js"' },
      path: { type: 'string', description: 'Folder to search in (default: the working directory)' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  summarize: (input) => (input.path ? `${input.pattern} in ${input.path}` : input.pattern),

  async call({ pattern, path: folder = '.' }, ctx) {
    const root = await resolveInsideProject(folder, ctx.cwd);
    const cwd = await fs.realpath(ctx.cwd); // real, like root, so paths are shown relative to the project
    const files = await listProjectFiles(root, { signal: ctx.signal });
    const matches = files.filter((file) => path.matchesGlob(file, pattern));

    // Most recently changed first: those are usually the files you are working on.
    const withTimes = await Promise.all(
      matches.map(async (file) => {
        const full = path.join(root, file);
        const stat = await fs.stat(full).catch(() => null); // git can list files that were just deleted
        return stat && { shown: path.relative(cwd, full), mtime: stat.mtimeMs };
      }),
    );
    const sorted = withTimes.filter(Boolean).sort((a, b) => b.mtime - a.mtime || a.shown.localeCompare(b.shown));

    if (sorted.length === 0) return { content: `No files match ${pattern}.`, display: '0 files' };
    const shown = sorted.slice(0, MAX_RESULTS).map((f) => f.shown);
    const more = sorted.length > MAX_RESULTS ? `\n(${sorted.length - MAX_RESULTS} more not shown. Use a more specific pattern.)` : '';
    return { content: shown.join('\n') + more, display: `${sorted.length} file${sorted.length === 1 ? '' : 's'}` };
  },
});
