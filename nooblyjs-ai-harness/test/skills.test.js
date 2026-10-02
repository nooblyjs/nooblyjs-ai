// Phase 15: skills and progressive disclosure.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { renderSections } from '../src/context/system-prompt.js';
import { estimateTokens } from '../src/context/tokens.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { loadSkills, readSkill } from '../src/skills/loader.js';
import { createDefaultTools } from '../src/tools/index.js';
import { makeProject } from './helpers.js';

const LONG_BODY = 'Step by step instructions. '.repeat(200);

async function project() {
  const cwd = await makeProject({
    '.noobly/skills/release-notes/SKILL.md': `---\nname: release-notes\ndescription: Use when asked for release notes or a changelog\n---\n1. Run git log.\n2. Fill in template.md for $ARGUMENTS.\n${LONG_BODY}`,
    '.noobly/skills/release-notes/template.md': '## What changed\n',
    '.noobly/skills/release-notes/examples/v1.md': 'example',
    '.noobly/skills/not-a-skill/README.md': 'no SKILL.md here',
    'home/skills/release-notes/SKILL.md': '---\ndescription: my personal version\n---\nmine',
    'home/skills/commit-message/SKILL.md': '---\ndescription: Use when writing a commit message\n---\nKeep the subject under 50 characters. See style.md.',
    'home/skills/commit-message/style.md': 'Imperative mood.',
  });
  const nooblyDir = path.join(cwd, 'home');
  return { cwd, skills: loadSkills(cwd, { nooblyDir }) };
}

test('discovery: every folder with a SKILL.md, the project winning on a name clash', async () => {
  const { skills } = await project();
  assert.deepEqual(
    skills.map((s) => [s.name, s.scope, s.description]).sort(),
    [
      ['commit-message', 'user', 'Use when writing a commit message'],
      ['release-notes', 'project', 'Use when asked for release notes or a changelog'],
    ],
  );
});

test('only names and descriptions go in the system prompt; the body is loaded on demand', async () => {
  const { cwd, skills } = await project();
  const session = new Session({ provider: createMockProvider([]), cwd, context: { skills } });
  const section = renderSections(session.context).find((s) => s.name === 'Skills');
  assert.match(section.text, /- release-notes: Use when asked for release notes/);
  assert.doesNotMatch(session.systemPrompt, /Step by step/);
  assert.ok(estimateTokens(section.text) < 150, 'a skill costs a line, not its manual');

  const loaded = readSkill(skills.find((s) => s.name === 'release-notes'));
  assert.match(loaded.body, /^1\. Run git log/);
  assert.deepEqual(loaded.files.sort(), ['examples/v1.md', 'template.md']);
});

test('the Skill tool returns the instructions, the folder and its files', async () => {
  const { cwd, skills } = await project();
  const provider = createMockProvider([{ tools: [{ name: 'Skill', input: { skill: 'release-notes', args: 'v2.0' } }] }, { text: 'ok' }]);
  const session = new Session({ provider, cwd, context: { skills }, tools: createDefaultTools(), retry: { maxRetries: 0 } });

  const before = provider.requests.length;
  await session.send('write release notes for v2.0');
  assert.equal(before, 0);
  const result = provider.requests[1].messages.at(-1).content[0];
  assert.match(result.content, new RegExp(`<skill name="release-notes" folder="${path.join(cwd, '.noobly/skills/release-notes')}">`));
  assert.match(result.content, /Fill in template\.md for v2\.0/);
  assert.match(result.content, /- template\.md/);
});

test('unknown skills are explained', async () => {
  const { cwd, skills } = await project();
  const provider = createMockProvider([{ tools: [{ name: 'Skill', input: { skill: 'poetry' } }] }, { text: 'ok' }]);
  const session = new Session({ provider, cwd, context: { skills }, tools: createDefaultTools(), retry: { maxRetries: 0 } });
  await session.send('go');
  assert.match(provider.requests[1].messages.at(-1).content[0].content, /no skill called "poetry". Available skills: commit-message, release-notes/);
});

test('Read may open files in YOUR skill folders (outside the project), but nothing else outside', async () => {
  const outside = await makeProject({ 'skills/commit-message/SKILL.md': '---\ndescription: d\n---\nbody', 'skills/commit-message/style.md': 'Imperative mood.', 'secret.txt': 'no' });
  const cwd = await makeProject({});
  const skills = loadSkills(cwd, { nooblyDir: outside });
  const provider = createMockProvider([
    { tools: [{ name: 'Read', input: { file_path: path.join(outside, 'skills/commit-message/style.md') } }, { name: 'Read', input: { file_path: path.join(outside, 'secret.txt') } }] },
    { text: 'ok' },
  ]);
  const session = new Session({ provider, cwd, context: { skills }, tools: createDefaultTools(), retry: { maxRetries: 0 }, permissions: createPermissions() });
  await session.send('go');
  const [style, secret] = provider.requests[1].messages.at(-1).content;
  assert.match(style.content, /Imperative mood/);
  assert.match(secret.content, /outside the project/);
});

test('/skills lists them, and /<skill-name> sends the skill straight to the model', async () => {
  const { cwd, skills } = await project();
  const session = new Session({ provider: createMockProvider([]), cwd, context: { skills } });
  assert.match((await runCommand('/skills', session)).text, /\/release-notes\s+Use when asked/);

  const result = await runCommand('/release-notes v3.1', session);
  assert.equal(result.action, 'prompt');
  assert.match(result.prompt, /Fill in template\.md for v3\.1/);
});
