// Phase 24: FEEDBACK AFTER EVERY EDIT.
//
// The sooner the model sees its mistake, the cheaper the fix. Without this, a
// syntax error in an edit is found three tool calls later, when the tests run
// (or never). So after Edit/Write, noobly runs a quick CHECKER on that one file
// and appends what's wrong to the tool result:
//
//   Edited src/app.js: replaced 1 occurrence (first at line 12).
//
//   ⚠ New problems in src/app.js (node --check):
//   SyntaxError: Unexpected token '}'
//
// Only problems the edit INTRODUCED are reported: a file that was already broken
// shouldn't drown every edit in old noise. So the first time a file is edited,
// it is checked BEFORE the change too (the baseline), and line numbers are
// ignored when comparing (an edit above an old problem moves it).
//
// Checkers are commands per file pattern, with $FILE set to the file:
//   "feedback": { "checkers": { "*.ts": "npx tsc --noEmit --pretty false \"$FILE\"", "*.py": "python3 -m py_compile \"$FILE\"" } }
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const FEEDBACK_DEFAULTS = {
  enabled: true,
  timeout: 10, // seconds; a slower checker is skipped, never waited for
  checkers: {
    '*.js': 'node --check "$FILE"',
    '*.mjs': 'node --check "$FILE"',
    '*.cjs': 'node --check "$FILE"',
    '*.json': 'json', // built in: no process needed
  },
};

const MAX_PROBLEM_LINES = 20;

/**
 * @param {object} setting  the `feedback` setting
 * @param {{ cwd: string }} options
 */
export function createFeedback(setting = {}, { cwd }) {
  const config = { ...FEEDBACK_DEFAULTS, ...setting, checkers: { ...FEEDBACK_DEFAULTS.checkers, ...setting.checkers } };
  const baselines = new Map(); // file → problems before noobly's first change (normalised)

  const checkerFor = (file) => {
    const relative = path.relative(cwd, file);
    const entry = Object.entries(config.checkers).find(([glob, command]) => command && (path.matchesGlob(relative, glob) || path.matchesGlob(path.basename(file), glob)));
    return entry?.[1] ?? null;
  };

  async function problems(file, command) {
    if (!fs.existsSync(file)) return { lines: [] };
    if (command === 'json') {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
        return { lines: [] };
      } catch (error) {
        return { lines: [`JSON: ${error.message}`] };
      }
    }
    return new Promise((resolve) => {
      execFile('bash', ['-c', command], { cwd, env: { ...process.env, FILE: file }, timeout: config.timeout * 1000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error?.killed) return resolve({ timedOut: true, lines: [] });
        if (!error) return resolve({ lines: [] }); // exit 0: nothing to report
        const lines = `${stdout}\n${stderr}`.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
        resolve({ lines });
      });
    });
  }

  return {
    config,

    /** Edit/Write call this BEFORE changing a file: remember what was already wrong. */
    async before(file) {
      const command = config.enabled && checkerFor(file);
      if (!command || baselines.has(file)) return;
      const { lines } = await problems(file, command);
      baselines.set(file, new Set(lines.map(normalize)));
    },

    /**
     * …and this AFTER. Returns a note for the tool result (or null), and a count for the UI.
     * @returns {Promise<{ note: string | null, count: number }>}
     */
    async after(file) {
      const command = config.enabled && checkerFor(file);
      if (!command) return { note: null, count: 0 };
      const { lines, timedOut } = await problems(file, command);
      if (timedOut) return { note: `(The ${label(command)} check took over ${config.timeout}s and was skipped.)`, count: 0 };
      const old = baselines.get(file) ?? new Set();
      const fresh = lines.filter((line) => !old.has(normalize(line)));
      if (!fresh.length) return { note: null, count: 0 };
      const shown = fresh.slice(0, MAX_PROBLEM_LINES).join('\n') + (fresh.length > MAX_PROBLEM_LINES ? `\n… ${fresh.length - MAX_PROBLEM_LINES} more lines` : '');
      return { note: `⚠ New problems in ${path.relative(cwd, file) || file} (${label(command)}):\n${shown}`, count: fresh.length };
    },
  };
}

/** The same problem, wherever it moved to: line and column numbers don't count. */
export function normalize(line) {
  return line.replace(/:\d+(:\d+)?/g, ':N').replace(/\b(line|col|column) \d+/gi, '$1 N').trim();
}

const label = (command) => (command === 'json' ? 'JSON' : command.split(/\s+/).slice(0, 2).join(' '));
