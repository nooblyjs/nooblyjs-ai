// Phase 21: /diff: everything noobly changed in this conversation, as a unified diff.
//
// The "before" side of each file is its first checkpoint (its content when noobly
// first touched it); the "after" side is the file as it is now. The comparing is
// done by `diff -u`, which every Linux and macOS has: writing a diff algorithm is
// a fine exercise, but not this phase's.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_LINES = 400;

/**
 * @param {Map<string, Buffer | null>} baseline  file → content before noobly's first change (null = didn't exist)
 * @param {string} cwd
 * @returns {string} the diff, or '' if nothing differs
 */
export function formatSessionDiff(baseline, cwd) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noobly-diff-'));
  try {
    const parts = [];
    for (const [file, before] of baseline) {
      const shown = path.relative(cwd, file) || file;
      const old = path.join(tmp, 'old');
      fs.writeFileSync(old, before ?? '');
      const now = fs.existsSync(file) ? file : '/dev/null';
      const { stdout } = spawnSync('diff', ['-u', '-L', before === null ? '/dev/null' : `a/${shown}`, '-L', now === '/dev/null' ? '/dev/null' : `b/${shown}`, before === null ? '/dev/null' : old, now], { encoding: 'utf8' });
      if (stdout) parts.push(stdout.trimEnd());
    }
    const lines = parts.join('\n').split('\n');
    if (!parts.length) return '';
    return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}\n… (${lines.length - MAX_LINES} more lines)` : lines.join('\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
