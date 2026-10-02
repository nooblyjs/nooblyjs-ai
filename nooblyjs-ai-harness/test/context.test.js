import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runCommand, INIT_PROMPT } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { getEnvironment } from '../src/context/environment.js';
import { loadInstructions } from '../src/context/instructions.js';
import { collectReminders, withReminders } from '../src/context/reminders.js';
import { buildSystemPrompt, loadContext, renderSections } from '../src/context/system-prompt.js';
import { createMockProvider } from '../src/providers/mock.js';
import { makeProject } from './helpers.js';

test('environment: date, platform and git details', async () => {
  const dir = await makeProject({ 'a.txt': 'x' });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'first commit'], { cwd: dir });

  const env = await getEnvironment(dir, { now: new Date('2026-09-29T12:00:00Z') });
  assert.equal(env.date, '2026-09-29');
  assert.equal(env.isGit, true);
  assert.equal(env.branch, 'main');
  assert.match(env.status, /\?\? a.txt/);
  assert.match(env.recentCommits, /first commit/);
});

test('environment outside git just says so', async () => {
  const env = await getEnvironment(await makeProject());
  assert.equal(env.isGit, false);
  assert.equal(env.branch, undefined);
});

test('instructions load from home, parents and project, general to specific', async () => {
  const root = await makeProject({
    'home/.noobly/NOOBLY.md': 'personal',
    'work/NOOBLY.md': 'parent',
    'work/app/AGENTS.md': 'agents file',
  });
  const files = await loadInstructions(path.join(root, 'work/app'), { home: path.join(root, 'home') });
  assert.deepEqual(
    files.map((f) => [f.scope, f.content]),
    [
      ['user', 'personal'],
      ['parent', 'parent'],
      ['project', 'agents file'],
    ],
  );
});

test('NOOBLY.md wins over AGENTS.md in the same folder', async () => {
  const root = await makeProject({ 'NOOBLY.md': 'noobly', 'AGENTS.md': 'agents' });
  const files = await loadInstructions(root, { home: '/nonexistent' });
  assert.deepEqual(files.map((f) => f.content), ['noobly']);
});

test('@imports are expanded, and loops or missing files are explained', async () => {
  const root = await makeProject({
    'NOOBLY.md': 'top\n@docs/style.md\n@missing.md\nnot @an import',
    'docs/style.md': 'use tabs\n@../NOOBLY.md',
  });
  const [file] = await loadInstructions(root, { home: '/nonexistent' });
  assert.equal(file.content, 'top\nuse tabs\n(import of ../NOOBLY.md skipped: it imports itself)\n(import of missing.md skipped: file not found)\nnot @an import');
});

test('system prompt: stable sections first, then environment, then project instructions', async () => {
  const root = await makeProject({ 'NOOBLY.md': 'Always answer in pirate speak.' });
  const context = await loadContext(root, { home: '/nonexistent' });
  const names = renderSections(context).map((s) => s.name);
  // Built-in subagents are always listed (Phase 13); skills only when some are installed (Phase 15).
  assert.deepEqual(names, ['Identity', 'Using tools', 'Planning', 'Permissions and safety', 'Environment', 'Subagents', 'Memory', 'Project instructions']);
  const prompt = buildSystemPrompt(context);
  assert.match(prompt, /Working directory: /);
  assert.match(prompt, /Always answer in pirate speak\./);
  assert.ok(prompt.indexOf('# Using tools') < prompt.indexOf('# Environment'));
});

test('without context, the prompt skips environment and instructions', () => {
  assert.deepEqual(renderSections({}).map((s) => s.name), ['Identity', 'Using tools', 'Planning', 'Permissions and safety']);
});

test('reminders: a mode change is mentioned once', () => {
  const session = new Session({ provider: createMockProvider([]) });
  assert.deepEqual(collectReminders(session), []);
  session.permissions.mode = 'plan';
  assert.match(collectReminders(session)[0], /permission mode is now "plan"/);
  assert.deepEqual(collectReminders(session), []);
});

test('reminders: a file changed since it was read is mentioned once', async () => {
  const dir = await makeProject({ 'a.js': 'x' });
  const session = new Session({ provider: createMockProvider([]), cwd: dir });
  const file = path.join(dir, 'a.js');
  session.readFiles.set(file, fs.statSync(file).mtimeMs);
  assert.deepEqual(collectReminders(session), []);

  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.match(collectReminders(session)[0], /a.js was modified since you last read it/);
  assert.deepEqual(collectReminders(session), []);
});

test('withReminders appends tagged text blocks, and the loop sends them', async () => {
  assert.equal(withReminders('hi', []), 'hi');
  assert.deepEqual(withReminders('hi', ['note']), [
    { type: 'text', text: 'hi' },
    { type: 'text', text: '<system-reminder>\nnote\n</system-reminder>' },
  ]);

  const provider = createMockProvider([{ text: 'ok' }]);
  const session = new Session({ provider });
  session.permissions.mode = 'acceptEdits';
  await session.send('hello');
  const sent = provider.requests[0].messages[0].content;
  assert.equal(sent[0].text, 'hello');
  assert.match(sent[1].text, /<system-reminder>\nThe permission mode is now "accept edits"/);
});

test('/context lists sections and instruction files; /init sends a prompt to the model', async () => {
  const root = await makeProject({ 'NOOBLY.md': 'hello' });
  const context = await loadContext(root, { home: '/nonexistent' });
  const session = new Session({ provider: createMockProvider([]), cwd: root, context });

  const { text } = await runCommand('/context', session);
  assert.match(text, /Project instructions\s+\d+/);
  assert.match(text, /Tool definitions\s+\d+/);
  assert.match(text, new RegExp(`${path.join(root, 'NOOBLY.md')} \\(project\\)`));

  const init = await runCommand('/init', session);
  assert.equal(init.action, 'prompt');
  assert.equal(init.prompt, INIT_PROMPT);
});

test('the prompt says what each tool is for, without warnings that make the model defensive', () => {
  const prompt = buildSystemPrompt({});
  // Positive: Bash's job includes running programs.
  assert.match(prompt, /Bash runs programs and commands: scripts \(e\.g\. `node app\.js`\)/);
  // Scoped: explain new concepts, not routine tool choices.
  assert.match(prompt, /Don't explain routine choices, such as which tool you used or why\./);
  // Gone: the "do not use Bash for…" warning and the blanket "explain your reasoning".
  assert.doesNotMatch(prompt, /Do not use Bash/);
  assert.doesNotMatch(prompt, /explain your reasoning/);
});
