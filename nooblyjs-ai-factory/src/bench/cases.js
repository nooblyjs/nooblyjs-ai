// @ts-check
// Phase F19: bench CASES, and checking them.
//
//   bench/cases/<id>/
//     case.json    { id, title, tags, budgetUsd, hidden?: { timeoutMs } }
//     issue.md     what a person would write (the factory's only instructions)
//     repo/        the starting snapshot (made into a fresh git repo for every run)
//     hidden/      tests the factory NEVER sees, copied in only to SCORE the result
//     solution/    a reference solution (files laid over repo/), only to check the checker
//
// (The Roadmap imagined repo.bundle; a plain folder is easier to read, review and diff,
// and becomes a one-commit repo in milliseconds.)
//
// Hidden tests are the point: the factory's own gates run ITS tests, which it may have
// written to fit its own code. The bench asks the question the issue's author would:
// does it actually do what I asked?
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const CASES_DIR = path.resolve(import.meta.dirname, '../../bench/cases');

/** @typedef {{ id: string, title: string, tags: string[], budgetUsd: number, dir: string, issueFile: string, hidden: { timeoutMs?: number } }} BenchCase */

/** @returns {BenchCase[]} */
export function loadCases(dir = CASES_DIR, { only = [], tags = [] } = {}) {
  return fs.readdirSync(dir).sort()
    .filter((id) => fs.existsSync(path.join(dir, id, 'case.json')))
    .map((id) => {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, id, 'case.json'), 'utf8'));
      return { tags: [], budgetUsd: 1, hidden: {}, ...meta, id: meta.id ?? id, dir: path.join(dir, id), issueFile: path.join(dir, id, 'issue.md') };
    })
    .filter((c) => (!only.length || only.includes(c.id)) && (!tags.length || tags.some((t) => c.tags.includes(t))));
}

/** Every file under a folder, as paths relative to it. */
export function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort();
}

function copyTree(from, to) {
  for (const rel of filesIn(from)) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(to, rel));
  }
}

const git = (cwd, ...args) => run('git', args, { cwd }).then((r) => r.stdout.trim());

/** The case's starting snapshot as a fresh git repo on `main` (optionally with the solution laid over it). */
export async function materialise(c, dir, { solution = false, overlay = {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  copyTree(path.join(c.dir, 'repo'), dir);
  if (solution) copyTree(path.join(c.dir, 'solution'), dir);
  // Phase F21: extra files in the starting commit (e.g. a proposed steering file, to bench it).
  for (const [rel, content] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'add', '-A');
  await git(dir, '-c', 'user.name=bench', '-c', 'user.email=bench@factory.local', 'commit', '-q', '-m', solution ? 'reference solution' : 'start');
  return dir;
}

/**
 * Score a checkout: copy the hidden tests in, run them. Pass = every hidden test passes.
 * @returns {Promise<{ pass: boolean, output: string, durationMs: number }>}
 */
export async function runHidden(c, checkout) {
  const hidden = filesIn(path.join(c.dir, 'hidden'));
  copyTree(path.join(c.dir, 'hidden'), checkout);
  const started = Date.now();
  try {
    const out = await run(process.execPath, ['--test', ...hidden], { cwd: checkout, timeout: c.hidden.timeoutMs ?? 60_000, env: cleanEnv() });
    return { pass: true, output: tail(out.stdout), durationMs: Date.now() - started };
  } catch (error) {
    const e = /** @type {any} */ (error);
    return { pass: false, output: tail(`${e.stdout ?? ''}${e.stderr ?? ''}`) || String(e.message), durationMs: Date.now() - started };
  }
}

/** The environment without node:test's own marker (a nested `node --test` would report to US instead of printing). */
function cleanEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const tail = (s) => String(s).split('\n').filter((l) => /^(not ok|# (pass|fail))|Error|expected|actual/.test(l.trim())).slice(-12).join('\n');

/**
 * Check the CHECKER: the hidden tests must FAIL on the starting snapshot (or the case
 * measures nothing) and PASS on the reference solution (or no one could pass it).
 */
export async function verifyCase(c, tmp) {
  const start = await materialise(c, path.join(tmp, `${c.id}-start`));
  // The repo's own tests must pass at the start (before the hidden ones are copied in): the factory starts from green.
  const gates = await run(process.execPath, ['--test'], { cwd: start, env: cleanEnv() }).then(() => true, () => false);
  const starter = await runHidden(c, start);
  const solved = await runHidden(c, await materialise(c, path.join(tmp, `${c.id}-solution`), { solution: true }));
  return { id: c.id, ok: !starter.pass && solved.pass && gates, starterFails: !starter.pass, solutionPasses: solved.pass, starterGatesPass: gates, detail: solved.pass ? '' : solved.output };
}
