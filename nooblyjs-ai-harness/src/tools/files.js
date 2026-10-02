// Listing the project's files, shared by Glob and Grep.
//
// We skip files that git ignores (node_modules, build output, .env…) because
// they are almost never what the model is looking for and there can be
// hundreds of thousands of them. In a git repo, git itself tells us which files
// count. Outside a git repo, we walk the folders and skip the usual suspects.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

/** All project files as paths relative to `root`, using forward slashes. */
export async function listProjectFiles(root, { signal } = {}) {
  try {
    // -c tracked files, -o untracked files, --exclude-standard respects .gitignore, -z NUL-separated
    const { stdout } = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      signal,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split('\0').filter(Boolean);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return walk(root, '');
  }
}

async function walk(root, relativeDir) {
  const entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await walk(root, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/** Heuristic: a file with a NUL byte near the start is binary, not text. */
export function looksBinary(bytes) {
  return bytes.subarray(0, 8000).includes(0);
}
