// Phase 16: MEMORY. Things worth knowing next time, kept between sessions.
//
// Every conversation starts from nothing: the model is stateless (Phase 02) and
// a new session has an empty history. Memory is how noobly carries lessons
// across sessions: "the user prefers tabs", "run tests with npm run test:unit",
// "don't touch the generated/ folder".
//
// There is no special memory tool and no database. Memory is just FILES plus
// CONTEXT ENGINEERING:
//
//   ~/.noobly/projects/<project-slug>/memory/
//   ├── MEMORY.md              the index: one line per memory. Loaded into EVERY system prompt.
//   ├── prefers-tabs.md        one fact per file, with frontmatter (name, description, type)
//   └── test-command.md
//
// The system prompt explains the conventions; the model reads and writes the
// files with the ordinary Read, Write and Edit tools. Only the index is always
// in context (cheap); a memory file is read when it looks relevant (the same
// progressive disclosure as skills, Phase 15).
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../util/frontmatter.js';
import { nooblyHome, projectSlug } from '../util/paths.js';

export const INDEX_FILE = 'MEMORY.md';
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
const MAX_INDEX_LINES = 200; // the index is sent with every request: keep it short

/** Where this project's memories live. Outside the project, so they're never committed by accident. */
export function memoryDir(cwd, nooblyDir = nooblyHome()) {
  return path.join(nooblyDir, 'projects', projectSlug(cwd), 'memory');
}

/**
 * Load the memory index for the system prompt.
 * @returns {{ dir: string, index: string | null, truncated: boolean }}
 */
export function loadMemory(cwd, { nooblyDir } = {}) {
  return readMemoryIndex(memoryDir(cwd, nooblyDir));
}

/** Read (or re-read, e.g. on /clear) the index of a memory folder. */
export function readMemoryIndex(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, INDEX_FILE), 'utf8').trim();
  } catch {
    return { dir, index: null, truncated: false };
  }
  const lines = text.split('\n');
  const truncated = lines.length > MAX_INDEX_LINES;
  return { dir, index: (truncated ? lines.slice(0, MAX_INDEX_LINES) : lines).join('\n') || null, truncated };
}

/** Every memory file with its frontmatter, for /memory. */
export function listMemories(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== INDEX_FILE)
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      return { file, name: data.name ?? name.slice(0, -3), description: data.description ?? body.trim().split('\n')[0], type: data.type ?? data.metadata ?? '?' };
    });
}

/** The "Memory" section of the system prompt: the conventions, then the index. */
export function memoryPrompt({ dir, index, truncated }) {
  return [
    '# Memory',
    `You have a persistent memory for this project in ${dir}/ (outside the project; Read, Write and Edit work there without asking). Use it to remember what will help in FUTURE sessions.`,
    '',
    'How to remember something:',
    `1. Write one fact per file, e.g. ${dir}/prefers-tabs.md, starting with frontmatter:`,
    '   ---',
    '   name: prefers-tabs',
    '   description: one line, used to judge relevance later',
    `   type: ${MEMORY_TYPES.join(' | ')}`,
    '   ---',
    '   then the fact. For feedback and project memories, add why it matters and how to apply it.',
    `2. Add one line to ${dir}/${INDEX_FILE}: "- [Title](file.md) — short hook". (Read it first if it exists.)`,
    '',
    'Types: user = who the user is and their preferences; feedback = how they want you to work (corrections and confirmed approaches); project = goals, decisions and constraints you can\'t see in the code; reference = pointers to outside resources.',
    'Save when the user asks you to remember something, or corrects you in a way that will matter again. Don\'t save what the code, git history or NOOBLY.md already record, or what only matters for this conversation. Update an existing memory instead of adding a duplicate, and delete memories that turn out to be wrong.',
    'Memories may be out of date: check them against the code before relying on them.',
    '',
    index
      ? `Contents of ${INDEX_FILE}${truncated ? ` (first ${MAX_INDEX_LINES} lines; shorten it)` : ''}:\n${index}`
      : `${INDEX_FILE} does not exist yet: nothing has been remembered for this project.`,
  ].join('\n');
}
