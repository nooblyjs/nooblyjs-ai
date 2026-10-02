// Phase 29: parallel agents in git worktrees.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { createWorktree, finishWorktree } from '../src/agents/worktree.js';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { taskTool } from '../src/tools/task.js';
import { makeProject } from './helpers.js';

before(async () => {
  process.env.NOOBLY_HOME = await makeProject(); // worktrees go under ~/.noobly/projects/…
});

async function repo(files = { 'app.js': 'console.log(1);\n' }) {
  const cwd = await makeProject(files);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-qm', 'start');
  return { cwd, git };
}

test('a worktree: changes are committed to its branch, the main folder is untouched, the folder is removed', async () => {
  const { cwd, git } = await repo();
  const wt = await createWorktree(cwd, 'Add logging!');
  assert.match(wt.branch, /^noobly\/add-logging-[0-9a-f]{6}$/);
  fs.writeFileSync(path.join(wt.cwd, 'app.js'), 'console.log(2);\n');
  const done = await finishWorktree(wt, 'noobly subagent: add logging');
  assert.equal(done.changed, true);
  assert.match(done.stat, /app\.js \| 2 \+-/);
  assert.equal(fs.readFileSync(path.join(cwd, 'app.js'), 'utf8'), 'console.log(1);\n');
  assert.equal(fs.existsSync(wt.dir), false);
  assert.equal(git('show', `${wt.branch}:app.js`), 'console.log(2);');

  const idle = await createWorktree(cwd, 'nothing');
  assert.deepEqual(await finishWorktree(idle, 'x'), { changed: false, branch: idle.branch, commits: 0, stat: '' });
  assert.equal(git('branch', '--list', idle.branch), '', 'no changes: no branch left');
});

test('two worktrees at once do not see each other; not a git repo → a clear error', async () => {
  const { cwd } = await repo();
  const [a, b] = await Promise.all([createWorktree(cwd, 'a'), createWorktree(cwd, 'b')]);
  fs.writeFileSync(path.join(a.cwd, 'only-a.txt'), 'a');
  assert.equal(fs.existsSync(path.join(b.cwd, 'only-a.txt')), false);
  await Promise.all([finishWorktree(a, 'a'), finishWorktree(b, 'b')]);
  await assert.rejects(createWorktree(await makeProject(), 'x'), /needs a git repository/);
  assert.equal(taskTool.isConcurrencySafe({ isolation: 'worktree', subagent_type: 'general' }, { agents: [] }), true);
});

test('Task with isolation "worktree": the subagent edits its own copy; the branch comes back; /merge brings it in', async () => {
  const { cwd, git } = await repo();
  const provider = createMockProvider([
    { tools: [{ name: 'Task', input: { description: 'add a readme', prompt: 'Create README.md', subagent_type: 'general', isolation: 'worktree' } }] },
    { tools: [{ name: 'Write', input: { file_path: 'README.md', content: '# Hello\n' } }] }, // the subagent
    { text: 'Created README.md.' }, // the subagent's report
    { text: 'The subagent made a branch.' }, // the parent
  ]);
  const session = new Session({ provider, cwd, retry: { maxRetries: 0 }, permissions: createPermissions({ mode: 'bypass' }) });
  await session.send('add a readme, in a worktree');
  const result = session.history[2].content[0].content;
  assert.match(result, /^Created README\.md\.\n\n\[Worktree: the changes were committed to branch (noobly\/add-a-readme-[0-9a-f]{6})/);
  const branch = result.match(/branch (noobly\/\S+) \(/)[1];
  assert.equal(fs.existsSync(path.join(cwd, 'README.md')), false, 'the main folder is untouched');
  assert.match(JSON.stringify(provider.requests[1].system), /You work in your own git worktree/);

  assert.match((await runCommand('/merge', session)).text, new RegExp(`Subagent branches:\\n${branch}`));
  assert.match((await runCommand(`/merge ${branch}`, session)).text, /^Merged noobly\/add-a-readme-\w+ and deleted it\./);
  assert.equal(fs.readFileSync(path.join(cwd, 'README.md'), 'utf8'), '# Hello\n');
  assert.equal(git('branch', '--list', 'noobly/*'), '');
});
