// Phase F02: isolated workspaces, from a mirror, with a branch each.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ALWAYS_DENY } from '../src/exec/workspace/harness-settings.js';
import { acquireWorkspace, cleanWorkspaces, listWorkspaces, releaseWorkspace } from '../src/exec/workspace/worktree.js';
import { commitFiles, gitIn, makeRepo, testEnv, writeFiles } from './helpers.js';

const mirrorGit = (ws, ...args) => gitIn(ws.mirror, ...args);

test('two workspaces from one repo: separate folders and branches, same pinned base', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const [a, b] = await Promise.all([acquireWorkspace({ repo, name: 'task a', env }), acquireWorkspace({ repo, name: 'task b', env })]);
  assert.notEqual(a.path, b.path);
  assert.notEqual(a.branch, b.branch);
  assert.match(a.branch, /^factory\/ws\/task-a-[0-9a-f]{6}$/);
  assert.equal(a.baseSha, gitIn(repo, 'rev-parse', 'HEAD'));
  assert.equal(a.baseSha, b.baseSha);
  assert.equal(a.baseRef, 'main');

  fs.writeFileSync(path.join(a.path, 'only-in-a.txt'), 'a\n');
  assert.ok(!fs.existsSync(path.join(b.path, 'only-in-a.txt')), 'b does not see a\'s files');
  assert.ok(fs.existsSync(path.join(b.path, 'README.md')));
});

test('release commits the changes to the branch, removes the checkout, keeps the branch; the source repo is untouched', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const ws = await acquireWorkspace({ repo, name: 'add greeting', env });
  fs.writeFileSync(path.join(ws.path, 'GREETING.md'), 'Hello!\n');

  const result = await releaseWorkspace(ws, { message: 'Add a greeting' });
  assert.equal(result.commits, 1);
  assert.equal(result.branch, ws.branch);
  assert.match(result.stat, /GREETING\.md/);
  assert.ok(!fs.existsSync(ws.path), 'checkout removed');
  assert.equal(mirrorGit(ws, 'show', `${ws.branch}:GREETING.md`), 'Hello!');
  assert.equal(mirrorGit(ws, 'log', '-1', '--format=%s', ws.branch), 'Add a greeting');

  assert.equal(gitIn(repo, 'branch', '--list', 'factory/*'), '', 'no branches added to the source repo');
  assert.equal(gitIn(repo, 'status', '--porcelain'), '', 'source working copy untouched');
  assert.equal(listWorkspaces(env)[0].status, 'released');
});

test('release with no changes deletes the branch: nothing to review, nothing left behind', async () => {
  const env = testEnv();
  const ws = await acquireWorkspace({ repo: makeRepo(), env });
  const result = await releaseWorkspace(ws);
  assert.equal(result.commits, 0);
  assert.equal(result.branch, null);
  assert.equal(mirrorGit(ws, 'branch', '--list', ws.branch), '');
});

test('keep: the checkout stays for inspection (e.g. after a failure), but the work is committed', async () => {
  const env = testEnv();
  const ws = await acquireWorkspace({ repo: makeRepo(), env });
  fs.writeFileSync(path.join(ws.path, 'half-done.txt'), '…\n');
  const result = await releaseWorkspace(ws, { keep: true });
  assert.equal(result.kept, true);
  assert.ok(fs.existsSync(path.join(ws.path, 'half-done.txt')));
  assert.equal(result.commits, 1);
  assert.equal(listWorkspaces(env)[0].status, 'kept');
});

test('the base is pinned: new commits upstream do not move a running workspace; the next one picks them up', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const first = await acquireWorkspace({ repo, env });
  const newSha = commitFiles(repo, { 'later.txt': 'later\n' });
  assert.notEqual(first.baseSha, newSha);
  assert.ok(!fs.existsSync(path.join(first.path, 'later.txt')));
  const second = await acquireWorkspace({ repo, env });
  assert.equal(second.baseSha, newSha);
});

test('a base can be a branch or a commit; a bad one says which branches exist', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const firstSha = gitIn(repo, 'rev-parse', 'HEAD');
  gitIn(repo, 'switch', '-q', '-c', 'feature');
  commitFiles(repo, { 'f.txt': 'f\n' });
  gitIn(repo, 'switch', '-q', 'main');
  assert.ok(fs.existsSync(path.join((await acquireWorkspace({ repo, base: 'feature', env })).path, 'f.txt')));
  assert.equal((await acquireWorkspace({ repo, base: firstSha, env })).baseSha, firstSha);
  await assert.rejects(acquireWorkspace({ repo, base: 'nope', env }), /"nope" is not a branch.*feature.*main|"nope" is not a branch.*main.*feature/s);
});

test('.factory/config.json is read from the pinned commit, not the working copy; it shapes the harness settings', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': JSON.stringify({ network: ['registry.npmjs.org'] }) });
  writeFiles(repo, { '.factory/config.json': JSON.stringify({ network: 'allow' }) }); // uncommitted: must be ignored
  const ws = await acquireWorkspace({ repo, env });
  assert.deepEqual(ws.config.network, ['registry.npmjs.org']);
  const written = JSON.parse(fs.readFileSync(path.join(ws.harnessHome, 'settings.json'), 'utf8'));
  assert.deepEqual(written.sandbox, { enabled: true, network: ['registry.npmjs.org'] });
  assert.deepEqual(written.permissions.deny, ALWAYS_DENY);
  assert.ok(!fs.existsSync(path.join(ws.path, '.noobly')), 'nothing written into the checkout');
});

test('list is newest first; clean removes released workspaces only', async () => {
  const env = testEnv();
  const repo = makeRepo();
  const one = await acquireWorkspace({ repo, name: 'one', env });
  await new Promise((r) => setTimeout(r, 5));
  const two = await acquireWorkspace({ repo, name: 'two', env });
  assert.deepEqual(listWorkspaces(env).map((w) => w.id), [two.id, one.id]);
  await releaseWorkspace(one);
  assert.deepEqual(cleanWorkspaces(env), [one.id]);
  assert.deepEqual(listWorkspaces(env).map((w) => w.id), [two.id]);
});

test('several PROCESSES acquiring from a new repo at once: one mirror, no collisions (found by the F02 checkpoint)', async () => {
  const { spawn } = await import('node:child_process');
  const env = testEnv();
  const repo = makeRepo();
  const script = `import { acquireWorkspace } from ${JSON.stringify(new URL('../src/exec/workspace/worktree.js', import.meta.url).href)};
    const ws = await acquireWorkspace({ repo: ${JSON.stringify(repo)} }); console.log(ws.branch);`;
  const runOne = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
    });
  const results = await Promise.all([runOne(), runOne(), runOne(), runOne()]);
  for (const r of results) assert.equal(r.code, 0, r.out);
  assert.equal(new Set(results.map((r) => r.out.trim())).size, 4, 'four different branches');
  assert.equal(listWorkspaces(env).length, 4);
});

test('a lock left behind by a crashed process is recognised as stale and taken over', async () => {
  const { withRepoLock } = await import('../src/exec/workspace/git.js');
  const dir = path.join(testEnv().FACTORY_HOME, 'repos', 'x.git');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.writeFileSync(`${dir}.lock`, '999999999'); // no such process
  assert.equal(await withRepoLock(dir, async () => 'got it', { timeoutMs: 2000 }), 'got it');
  assert.ok(!fs.existsSync(`${dir}.lock`));
});
