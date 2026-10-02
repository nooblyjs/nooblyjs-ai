// Phase 05: search inside files with a regular expression.
//
// If ripgrep (`rg`) is installed we use it: it's extremely fast. Otherwise we
// fall back to a simple JavaScript search. Both produce the same output format,
// so the model can't tell the difference (test/grep.test.js checks this).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isReadDenied } from '../permissions/gate.js';
import { listProjectFiles, looksBinary } from './files.js';
import { resolveInsideProject } from './paths.js';
import { defineTool, ToolError } from './tool.js';
import { truncateMiddle } from './truncate.js';

const DEFAULT_HEAD_LIMIT = 200;

export const grepTool = defineTool({
  name: 'Grep',
  isReadOnly: true,
  description: [
    'Search file contents for a regular expression (e.g. "function\\s+\\w+", "TODO", "import .* from").',
    'output_mode: "files_with_matches" (default) lists files that match; "content" shows matching lines as path:line:text; "count" shows matches per file.',
    'Narrow the search with `path` (a folder or file) and/or `glob` (e.g. "*.js", "src/**/*.ts"). Set `ignore_case` for case-insensitive search.',
    `Results are capped at \`head_limit\` lines (default ${DEFAULT_HEAD_LIMIT}). Files ignored by git are skipped.`,
    'This is the tool for searching file contents.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'File or folder to search (default: the working directory)' },
      glob: { type: 'string', description: 'Only search files matching this glob, e.g. "*.js"' },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'] },
      ignore_case: { type: 'boolean', description: 'Case-insensitive search' },
      head_limit: { type: 'integer', description: `Maximum result lines (default ${DEFAULT_HEAD_LIMIT})` },
    },
    required: ['pattern'],
    additionalProperties: false,
  },

  summarize: (input) => [JSON.stringify(input.pattern), input.glob && `glob ${input.glob}`, input.path && `in ${input.path}`].filter(Boolean).join(', '),

  async call(input, ctx) {
    const { output_mode: mode = 'files_with_matches', head_limit: limit = DEFAULT_HEAD_LIMIT } = input;
    // Phase 26: the saved output of an earlier tool call (outside the project) may be searched too.
    const target = await resolveInsideProject(input.path ?? '.', ctx.cwd, ctx.session?.readableDirs ?? []);
    // The real (symlink-free) project folder, like `target`, so results are shown relative to it.
    const cwd = await fs.realpath(ctx.cwd);
    // Files you can't Read (e.g. .env, by a deny rule) are left out of the results.
    const skip = (file) => isReadDenied(ctx.session, file);
    const search = (await hasRipgrep()) ? searchWithRipgrep : searchWithJavaScript;
    const lines = await search({ ...input, mode, target, cwd, signal: ctx.signal, skip });

    // Same order no matter which search ran: by path, then by line number.
    lines.sort(compareResultLines);

    if (lines.length === 0) return { content: `No matches for ${input.pattern}.`, display: 'no matches' };
    const shown = lines.slice(0, limit);
    const more = lines.length > limit ? `\n(${lines.length - limit} more lines not shown. Narrow the search or raise head_limit.)` : '';
    const unit = mode === 'content' ? 'line' : 'file';
    return {
      content: truncateMiddle(shown.join('\n') + more),
      display: `${lines.length} ${unit}${lines.length === 1 ? '' : 's'}`,
    };
  },
});

function compareResultLines(a, b) {
  const [fileA, lineA] = a.split(':');
  const [fileB, lineB] = b.split(':');
  return fileA.localeCompare(fileB) || Number(lineA) - Number(lineB);
}

let ripgrepAvailable;
export async function hasRipgrep() {
  ripgrepAvailable ??= new Promise((resolve) => execFile('rg', ['--version'], (error) => resolve(!error)));
  return ripgrepAvailable;
}

// ── ripgrep ─────────────────────────────────────────────────────────────
export function searchWithRipgrep({ pattern, glob, ignore_case, mode, target, cwd, signal, skip = () => false }) {
  // --null puts a NUL after each file name, so we can tell the name apart from the rest of the line.
  const args = ['--hidden', '--glob', '!.git', '--no-heading', '--color', 'never', '--null'];
  if (mode === 'files_with_matches') args.push('--files-with-matches');
  if (mode === 'count') args.push('--count', '--with-filename');
  if (mode === 'content') args.push('--line-number', '--with-filename');
  if (ignore_case) args.push('--ignore-case');
  if (glob) args.push('--glob', glob);
  args.push('--regexp', pattern, path.relative(cwd, target) || '.');

  return new Promise((resolve, reject) => {
    execFile('rg', args, { cwd, signal, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      // rg exit codes: 0 = found, 1 = nothing found, 2 = error (e.g. bad regex)
      if (error && error.code !== 1) return reject(new ToolError(`Search failed: ${stderr.trim() || error.message}`));
      // files_with_matches: "a.js\0b.js\0"; content and count: "a.js\012:text\n"
      const entries = mode === 'files_with_matches' ? stdout.split('\0').map((file) => [file]) : stdout.split('\n').map((line) => line.split('\0'));
      const lines = [];
      for (const [file, rest] of entries) {
        if (!file) continue;
        const shown = file.replace(/^\.\//, '');
        if (!skip(shown)) lines.push(rest === undefined ? shown : `${shown}:${rest}`);
      }
      resolve(lines);
    });
  });
}

// ── JavaScript fallback ─────────────────────────────────────────────────
export async function searchWithJavaScript({ pattern, glob, ignore_case, mode, target, cwd, signal, skip = () => false }) {
  let regex;
  try {
    regex = new RegExp(pattern, ignore_case ? 'i' : '');
  } catch (error) {
    throw new ToolError(`Invalid regular expression: ${error.message}`);
  }

  const stat = await fs.stat(target);
  const files = stat.isDirectory()
    ? (await listProjectFiles(target, { signal })).map((file) => path.join(target, file))
    : [target];

  const results = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const shown = path.relative(cwd, file);
    if (glob && !path.matchesGlob(shown, glob) && !path.matchesGlob(path.basename(file), glob)) continue;
    if (skip(shown)) continue;
    // Like ripgrep, don't follow symlinks: one could lead outside the project (to ~/.ssh/id_rsa).
    if (file !== target && (await fs.lstat(file).catch(() => null))?.isSymbolicLink()) continue;

    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes || looksBinary(bytes)) continue;

    const lines = bytes.toString('utf8').split('\n');
    let count = 0;
    lines.forEach((line, i) => {
      if (!regex.test(line)) return;
      count += 1;
      if (mode === 'content') results.push(`${shown}:${i + 1}:${line}`);
    });
    if (count === 0) continue;
    if (mode === 'files_with_matches') results.push(shown);
    if (mode === 'count') results.push(`${shown}:${count}`);
  }
  return results;
}
