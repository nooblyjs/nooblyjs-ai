// Phase 07: facts about the machine and project that the model can't see.
//
// All of this is captured ONCE when the session starts. It then stays the same
// for every request, which keeps the start of the prompt identical, and that is
// what prompt caching (Phase 09) needs. The flip side: git status is a snapshot
// and can go stale; the model can always run `git status` for a fresh view.
import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_STATUS_LINES = 30;

async function git(args, cwd) {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 3000 });
    return stdout.trimEnd();
  } catch {
    return null;
  }
}

/** @returns {Promise<object>} everything the "Environment" section of the system prompt shows */
export async function getEnvironment(cwd, { now = new Date() } = {}) {
  const isGit = (await git(['rev-parse', '--is-inside-work-tree'], cwd)) === 'true';
  const environment = {
    cwd,
    platform: `${os.platform()} ${os.release()}`,
    shell: process.env.SHELL ?? 'unknown',
    date: now.toISOString().slice(0, 10),
    isGit,
  };
  if (!isGit) return environment;

  const [branch, status, commits] = await Promise.all([
    git(['branch', '--show-current'], cwd),
    git(['status', '--short'], cwd),
    git(['log', '--oneline', '-5'], cwd),
  ]);
  const statusLines = status ? status.split('\n') : [];
  return {
    ...environment,
    branch: branch || '(detached HEAD)',
    status:
      statusLines.length > MAX_STATUS_LINES
        ? [...statusLines.slice(0, MAX_STATUS_LINES), `… and ${statusLines.length - MAX_STATUS_LINES} more (run git status)`].join('\n')
        : status || '(clean)',
    recentCommits: commits || '(no commits yet)',
  };
}
