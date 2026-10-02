// @ts-check
// Phase F03: the LOCAL forge. Issues and pull requests as files in a folder.
//
//   ~/.factory/forge/<repo-slug>/
//   ├── issues/1-add-a-greeting.md     frontmatter (number, title, labels, source) + the body
//   └── prs/issue-1.md                 frontmatter (title, head, base, status…) + the description
//
// And the PR's BRANCH is pushed to the repository itself:
//
//   git push --force origin factory/ws/…:refs/heads/factory/issue-1/main      (from the mirror)
//
// so reviewing a factory PR is ordinary git in your own repo:
//
//   git log  main..factory/issue-1/main
//   git diff main...factory/issue-1/main
//   git merge factory/issue-1/main            ← merging is YOUR action, never the factory's
//
// --force is safe here because refs/heads/factory/* belongs to the factory: re-running
// an issue replaces its PR branch, just like pushing a new version of a GitHub PR.
import fs from 'node:fs';
import path from 'node:path';
import { formatFrontmatter, parseFrontmatter } from '../util/frontmatter.js';
import { slugify } from '../util/ids.js';
import { factoryHome } from '../util/paths.js';
import { git } from '../exec/workspace/git.js';

/** @param {{ root?: string, env?: NodeJS.ProcessEnv }} [options] */
export function createLocalForge({ root, env = process.env } = {}) {
  const base = root ?? path.join(factoryHome(env), 'forge');
  const issuesDir = (slug) => path.join(base, slug, 'issues');
  const prsDir = (slug) => path.join(base, slug, 'prs');

  /** @returns {import('./forge.js').Issue[]} */
  function listIssues(slug) {
    const dir = issuesDir(slug);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.endsWith('.comments.md'))
      .map((f) => readIssue(path.join(dir, f)))
      .sort((a, b) => a.number - b.number);
  }

  const forge = {
    name: 'local',
    root: base,

    /**
     * File an issue. Filing the same source file again UPDATES that issue instead
     * of making a new one (so re-running a job doesn't pile up duplicates).
     * @param {string} slug
     * @param {{ title: string, body: string, labels?: string[], source?: string }} issue
     * @returns {import('./forge.js').Issue}
     */
    fileIssue(slug, { title, body, labels = [], source }) {
      const existing = source ? listIssues(slug).find((i) => i.source === source) : undefined;
      const number = existing?.number ?? (listIssues(slug).at(-1)?.number ?? 0) + 1;
      const file = existing?.path ?? path.join(issuesDir(slug), `${number}-${slugify(title)}.md`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, formatFrontmatter({ number, title, labels, source }, body.endsWith('\n') ? body : `${body}\n`));
      return readIssue(file);
    },

    getIssue(slug, number) {
      return listIssues(slug).find((i) => i.number === number) ?? null;
    },

    /**
     * Phase F07: comment on an issue (e.g. triage's questions). Comments live in their own
     * file next to the issue, so re-filing the issue from its source never erases them.
     */
    comment(slug, number, markdown, { author = 'factory', at = new Date().toISOString() } = {}) {
      const issue = listIssues(slug).find((i) => i.number === number);
      if (!issue?.path) throw new Error(`No issue #${number}.`);
      const file = issue.path.replace(/\.md$/, '.comments.md');
      fs.appendFileSync(file, `\n---\n**${author}** · ${at}\n\n${markdown.trim()}\n`);
      return file;
    },

    /** Phase F07: the comments on an issue, as Markdown (or ''). */
    comments(slug, number) {
      const issue = listIssues(slug).find((i) => i.number === number);
      const file = issue?.path?.replace(/\.md$/, '.comments.md');
      return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },

    listIssues,

    /** Push a branch from the mirror to the real repository (its "origin"). Returns the pushed sha. */
    async pushBranch(mirrorDir, fromBranch, toBranch) {
      await git(['push', '-q', '--force', 'origin', `refs/heads/${fromBranch}:refs/heads/${toBranch}`], { cwd: mirrorDir });
      return git(['rev-parse', `refs/heads/${fromBranch}`], { cwd: mirrorDir });
    },

    /**
     * One PR per head branch: create it, or update it in place.
     * @param {string} slug
     * @param {import('./forge.js').PullRequest} pr
     */
    openOrUpdatePR(slug, pr) {
      const file = prFile(slug, pr.head);
      const text = formatFrontmatter({ title: pr.title, head: pr.head, base: pr.base, status: pr.status, ...pr.meta }, pr.body);
      const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (before === text) return { path: file, action: /** @type {const} */ ('unchanged') };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return { path: file, action: before === null ? /** @type {const} */ ('created') : /** @type {const} */ ('updated') };
    },

    /**
     * Phase F12: MERGE a PR into its base, in the local repository (autonomy L3 only).
     * Only when it's safe to do in someone's checkout: the base branch is checked out and
     * clean. Otherwise it says why, and a person merges. Merging twice is a no-op.
     * @returns {Promise<{ merged: boolean, sha?: string, reason?: string }>}
     */
    async merge(repoPath, { head, base, message }) {
      const already = await git(['merge-base', '--is-ancestor', `refs/heads/${head}`, `refs/heads/${base}`], { cwd: repoPath }).then(() => true, () => false);
      if (already) return { merged: true, sha: await git(['rev-parse', base], { cwd: repoPath }), reason: 'already merged' };
      const current = await git(['branch', '--show-current'], { cwd: repoPath }).catch(() => '');
      if (current !== base) return { merged: false, reason: `the checkout is on "${current || 'a detached HEAD'}", not "${base}": a person merges` };
      if (await git(['status', '--porcelain', '--untracked-files=no'], { cwd: repoPath })) return { merged: false, reason: 'the checkout has uncommitted changes: a person merges' };
      const email = await git(['config', 'user.email'], { cwd: repoPath }).catch(() => '');
      const who = email ? [] : ['-c', 'user.name=factory', '-c', 'user.email=factory@localhost'];
      await git([...who, 'merge', '--no-ff', '--no-edit', '-m', message, `refs/heads/${head}`], { cwd: repoPath });
      return { merged: true, sha: await git(['rev-parse', 'HEAD'], { cwd: repoPath }) };
    },

    findPR(slug, head) {
      const file = prFile(slug, head);
      return fs.existsSync(file) ? readPR(file) : null;
    },

    listPRs(slug) {
      const dir = prsDir(slug);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readPR(path.join(dir, f)));
    },
  };

  /** factory/issue-1/main → prs/issue-1.md (the item's folder name); anything else → slashes become "--". */
  function prFile(slug, head) {
    const item = head.match(/^factory\/([^/]+)\/main$/)?.[1];
    return path.join(prsDir(slug), `${item ?? head.replace(/\//g, '--')}.md`);
  }

  return forge;
}

/** @returns {import('./forge.js').Issue & { source?: string }} */
function readIssue(file) {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const labels = Array.isArray(data.labels) ? data.labels : data.labels ? [String(data.labels)] : [];
  return { number: Number(data.number), ref: `local#${data.number}`, title: String(data.title ?? ''), body, labels, source: data.source, path: file };
}

function readPR(file) {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return { ...data, body, path: file };
}
