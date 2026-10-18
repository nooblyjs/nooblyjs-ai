// @ts-check
// Phase F19: the case MINER. Real history makes the best cases.
//
// A commit that changed some code AND some tests is a finished task with a checker:
//
//   repo/      the tree at the commit's PARENT, without the tests the commit added or changed
//   hidden/    those tests, as the commit left them
//   solution/  the code files, as the commit left them
//   issue.md   a DRAFT from the commit message, marked for a person to rewrite
//
// It PROPOSES; a person curates. Commit messages describe HOW ("use a Set in dedupe"); an
// issue must say WHAT ("dedupe is slow on big lists"), or the case hands the answer over.
// And every mined case still has to pass `factory bench --verify` (the hidden tests must
// fail on repo/ and pass with solution/) before it counts.
//
// Skipped: merges, commits that delete or rename files, and big commits (> maxFiles).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = (cwd, ...args) => run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }).then((r) => r.stdout);
const gitText = async (cwd, ...args) => (await git(cwd, ...args)).toString('utf8').trim();

export const isTest = (file) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'case';

/**
 * @param {string} repo
 * @param {{ out: string, limit?: number, maxFiles?: number, since?: string }} options
 * @returns {Promise<Array<{ id: string, commit: string, subject: string, tests: string[], code: string[] }>>}
 */
export async function mineCases(repo, { out, limit = 10, maxFiles = 8, since }) {
  const log = await gitText(repo, 'log', '--no-merges', '--format=%H%x09%s', ...(since ? [`--since=${since}`] : []), 'HEAD');
  const proposed = [];
  for (const line of log.split('\n').filter(Boolean)) {
    if (proposed.length >= limit) break;
    const [commit, subject] = line.split('\t');
    const parent = (await gitText(repo, 'rev-list', '--parents', '-n', '1', commit)).split(' ')[1];
    if (!parent) continue; // the first commit: nothing to start from
    const status = (await gitText(repo, 'diff', '--name-status', '--no-renames', parent, commit)).split('\n').filter(Boolean).map((l) => l.split('\t'));
    if (!status.length || status.length > maxFiles || status.some(([s]) => s !== 'A' && s !== 'M')) continue;
    const files = status.map(([, f]) => f);
    const tests = files.filter(isTest);
    const code = files.filter((f) => !isTest(f) && /\.[cm]?[jt]sx?$/.test(f));
    if (!tests.length || !code.length) continue;

    const id = `${slug(subject)}-${commit.slice(0, 7)}`;
    const dir = path.join(out, id);
    if (fs.existsSync(dir)) continue;
    // repo/: the parent's tree, minus the tests this commit touches (they'd give the answer away).
    const tree = (await gitText(repo, 'ls-tree', '-r', '--name-only', parent)).split('\n').filter(Boolean);
    for (const f of tree) {
      if (tests.includes(f)) continue;
      write(path.join(dir, 'repo', f), await git(repo, 'show', `${parent}:${f}`));
    }
    for (const f of tests) write(path.join(dir, 'hidden', f), await git(repo, 'show', `${commit}:${f}`));
    for (const f of code) write(path.join(dir, 'solution', f), await git(repo, 'show', `${commit}:${f}`));
    const body = await gitText(repo, 'log', '-1', '--format=%b', commit);
    write(path.join(dir, 'issue.md'), `# ${subject}\n\n${body ? `${body}\n\n` : ''}<!-- DRAFT from commit ${commit.slice(0, 12)}. Rewrite it as an issue: WHAT should change and how a person would know it's done, not HOW the commit did it. Then run: factory bench --verify --case ${id} -->\n`);
    write(path.join(dir, 'case.json'), `${JSON.stringify({ id, title: subject, tags: ['mined'], budgetUsd: 1, source: { repo: path.basename(repo), commit }, needsReview: true }, null, 2)}\n`);
    proposed.push({ id, commit, subject, tests, code });
  }
  return proposed;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
