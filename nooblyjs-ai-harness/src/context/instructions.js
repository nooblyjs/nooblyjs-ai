// Phase 07: project instruction files (noobly's version of CLAUDE.md).
//
// A NOOBLY.md file is a note TO THE AGENT, read at the start of every session:
// how to run the tests, code style, things to avoid. They are loaded from:
//
//   1. ~/.noobly/NOOBLY.md                  your personal preferences, for every project
//   2. every folder from / down to the project, e.g. /work/NOOBLY.md, then
//      /work/my-app/NOOBLY.md               (closest to the project = loaded last = wins arguments)
//
// In each folder, AGENTS.md is used if there's no NOOBLY.md (a common cross-tool name).
//
// A line that is just "@path/to/file.md" is replaced by that file's contents
// ("imports"), so a NOOBLY.md can pull in e.g. @docs/style-guide.md.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const INSTRUCTION_FILES = ['NOOBLY.md', 'AGENTS.md'];
const MAX_IMPORT_DEPTH = 3;

/**
 * @returns {Promise<Array<{ path: string, scope: 'user' | 'project' | 'parent', content: string }>>}
 */
export async function loadInstructions(cwd, { home = os.homedir() } = {}) {
  const found = [];

  const personal = path.join(home, '.noobly', 'NOOBLY.md');
  const personalText = await readIfExists(personal);
  if (personalText !== null) found.push({ path: personal, scope: 'user', content: await expandImports(personalText, personal) });

  // Folders from the filesystem root down to the project.
  const folders = [];
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    folders.unshift(dir);
    if (dir === path.dirname(dir)) break;
  }

  for (const dir of folders) {
    for (const name of INSTRUCTION_FILES) {
      const file = path.join(dir, name);
      if (file === personal) continue;
      const text = await readIfExists(file);
      if (text === null) continue;
      found.push({ path: file, scope: dir === path.resolve(cwd) ? 'project' : 'parent', content: await expandImports(text, file) });
      break; // NOOBLY.md wins over AGENTS.md in the same folder
    }
  }
  return found;
}

/** Replace "@some/file" lines with that file's contents (relative to the importing file). */
export async function expandImports(text, fromFile, depth = 0, seen = new Set([fromFile])) {
  const lines = await Promise.all(
    text.split('\n').map(async (line) => {
      const match = line.trim().match(/^@(\S+)$/);
      if (!match) return line;
      const target = match[1].startsWith('~/')
        ? path.join(os.homedir(), match[1].slice(2))
        : path.resolve(path.dirname(fromFile), match[1]);
      if (depth >= MAX_IMPORT_DEPTH) return `(import of ${match[1]} skipped: imports nested too deeply)`;
      if (seen.has(target)) return `(import of ${match[1]} skipped: it imports itself)`;
      const imported = await readIfExists(target);
      if (imported === null) return `(import of ${match[1]} skipped: file not found)`;
      return expandImports(imported.trimEnd(), target, depth + 1, new Set([...seen, target]));
    }),
  );
  return lines.join('\n');
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}
