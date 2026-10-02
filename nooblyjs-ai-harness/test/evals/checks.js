// Helpers for eval checkers (test/evals/cases/*/check.js).
//
// A checker gets { dir, answer }: the folder the agent worked in, and its final
// reply. It returns { pass: boolean, message?: string }. Checkers look at
// RESULTS (does the program print the right thing? do the tests pass?), never at
// HOW the agent got there, so any correct approach passes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '.noobly-eval.json'; // written by prepareCase: where the original repo is

/** Run a program in the work folder (10s limit). */
export function run(command, args, dir) {
  const result = spawnSync(command, args, { cwd: dir, encoding: 'utf8', timeout: 10_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

/** Every file in the work folder, relative, sorted (skipping node_modules, .git and the marker). */
export function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (['node_modules', '.git', MARKER].includes(entry.name)) continue;
    if (entry.isDirectory()) files.push(...listFiles(dir, relative));
    else files.push(relative);
  }
  return files.sort();
}

/** Files whose contents match a regex. */
export function grepFiles(dir, regex) {
  return listFiles(dir).filter((file) => regex.test(fs.readFileSync(path.join(dir, file), 'utf8')));
}

function originalRepo(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')).repo;
}

/** Is this file exactly as it was in the starter repo? */
export function fileUnchanged(dir, file) {
  const before = path.join(originalRepo(dir), file);
  const after = path.join(dir, file);
  return fs.existsSync(after) && fs.readFileSync(before, 'utf8') === fs.readFileSync(after, 'utf8');
}

/** Files added, removed or changed compared with the starter repo. */
export function changedFiles(dir) {
  const repo = originalRepo(dir);
  const all = new Set([...listFiles(repo), ...listFiles(dir)]);
  return [...all].filter((file) => {
    const a = path.join(repo, file);
    const b = path.join(dir, file);
    return !fs.existsSync(a) || !fs.existsSync(b) || fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8');
  });
}

export function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

/** Import a module from the work folder, bypassing Node's module cache. */
export function importFresh(dir, file) {
  return import(`${pathToFileURL(path.join(dir, file)).href}?t=${Date.now()}-${Math.random()}`);
}
