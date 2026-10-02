// Phase F03: the local forge: issues and PRs as files, PR branches pushed to the repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createLocalForge } from '../src/forge/local.js';
import { acquireWorkspace, releaseWorkspace } from '../src/exec/workspace/worktree.js';
import { gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

test('issues are numbered; filing the same source again updates it instead of duplicating', () => {
  const forge = createLocalForge({ root: tmpDir() });
  const one = forge.fileIssue('app', { title: 'First', body: 'a', source: '/x/first.md' });
  const two = forge.fileIssue('app', { title: 'Second', body: 'b', labels: ['bug'], source: '/x/second.md' });
  const again = forge.fileIssue('app', { title: 'First, edited', body: 'a2', source: '/x/first.md' });
  assert.deepEqual([one.number, two.number, again.number], [1, 2, 1]);
  assert.equal(again.title, 'First, edited');
  assert.equal(again.ref, 'local#1');
  assert.deepEqual(forge.getIssue('app', 2)?.labels, ['bug']);
  assert.equal(forge.listIssues('app').length, 2);
});

test('one PR per head branch: created, then updated, then unchanged', () => {
  const forge = createLocalForge({ root: tmpDir() });
  const pr = { title: 'T', head: 'factory/issue-1/main', base: 'main', status: /** @type {const} */ ('ready'), body: 'v1\n' };
  assert.equal(forge.openOrUpdatePR('app', pr).action, 'created');
  assert.equal(forge.openOrUpdatePR('app', { ...pr, body: 'v2\n' }).action, 'updated');
  const last = forge.openOrUpdatePR('app', { ...pr, body: 'v2\n' });
  assert.equal(last.action, 'unchanged');
  assert.match(last.path, /prs\/issue-1\.md$/);
  assert.equal(forge.listPRs('app').length, 1);
  assert.equal(forge.findPR('app', 'factory/issue-1/main')?.body, 'v2\n');
});

test('titles that would break frontmatter survive a round trip', () => {
  const forge = createLocalForge({ root: tmpDir() });
  const issue = forge.fileIssue('app', { title: '[bug] crash on start\nsecond line', body: 'x' });
  assert.equal(issue.title, '[bug] crash on start second line');
});

test('pushBranch puts the PR branch into the real repository, without touching its checkout', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const ws = await acquireWorkspace({ repo, env });
  fs.writeFileSync(`${ws.path}/NEW.md`, 'new\n');
  await releaseWorkspace(ws);
  const forge = createLocalForge({ env });
  const sha = await forge.pushBranch(ws.mirror, ws.branch, 'factory/issue-7/main');
  assert.equal(gitIn(repo, 'rev-parse', 'factory/issue-7/main'), sha);
  assert.equal(gitIn(repo, 'branch', '--show-current'), 'main');
  assert.equal(gitIn(repo, 'status', '--porcelain'), '');
  assert.ok(!fs.existsSync(`${repo}/NEW.md`), 'the checkout is unchanged: the change is only on the branch');
});
