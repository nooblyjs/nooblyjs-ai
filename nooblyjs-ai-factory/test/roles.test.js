// Phase F09: roles: prompt + tools + model + permissions + budget, with invariants.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { agentOptionsFor, builtInRoles, loadRoles } from '../src/roles/loader.js';
import { rolePrompt } from '../src/roles/prompts.js';
import { openStore } from '../src/store/events.js';
import { approve, commitFiles, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';
import { ensureMirror, resolveBase } from '../src/exec/workspace/mirror.js';

const config = { models: { fast: 'claude-haiku-4-5', balanced: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' } };

test('built-in roles: read-only triager, scoped spec-writer, builder; models by tier', () => {
  const roles = builtInRoles();
  assert.deepEqual(Object.keys(roles).sort(), ['builder', 'fixer', 'integrator', 'retro', 'reviewer', 'security-reviewer', 'spec-writer', 'triager']);
  const t = agentOptionsFor(roles.triager, { request: {}, config });
  assert.deepEqual([t.model, t.permissionMode, t.allowedTools, t.stopHook], ['claude-haiku-4-5', 'plan', [], false]);
  const s = agentOptionsFor(roles['spec-writer'], { request: {}, config, vars: { specDir: '.factory/specs/issue-9' } });
  assert.deepEqual([s.model, s.permissionMode, s.allowedTools], ['claude-opus-5-5', 'default', ['Edit(.factory/specs/issue-9/**)']]);
  const b = agentOptionsFor(roles.builder, { request: {}, config });
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.ok(b.disallowedTools.includes('Bash(git push:*)'), 'every role: git push denied');
});

test('a run\'s explicit --model wins over tiers; another named provider skips tier models; budgets take the lowest cap', () => {
  const b = builtInRoles().builder;
  assert.equal(agentOptionsFor(b, { request: { agent: { model: 'claude-haiku-4-5' } }, config }).model, 'claude-haiku-4-5');
  assert.equal(agentOptionsFor(b, { request: { agent: { provider: 'echo' } }, config }).model, undefined);
  const capped = agentOptionsFor({ ...b, budgetUsd: 1 }, { request: { agent: { limits: { budgetUsd: 3 } } }, config, budgetUsd: 0.5 });
  assert.equal(capped.limits.budgetUsd, 0.5);
});

test('INVARIANTS: no layer can make a read-only role write, choose bypass, or drop the always-deny rules', async () => {
  const roles = await loadRoles({ operator: { triager: { readOnly: false, permissionMode: 'acceptEdits' }, builder: { permissionMode: 'bypass', deny: [] } } });
  assert.equal(roles.triager.readOnly, true);
  const t = agentOptionsFor(roles.triager, { request: { agent: { allowedTools: ['Bash'] } }, config });
  assert.deepEqual([t.permissionMode, t.allowedTools], ['plan', []], 'read-only: no allow rules at all, even from the run');
  assert.equal(roles.builder.permissionMode, 'acceptEdits');
  assert.ok(agentOptionsFor(roles.builder, { request: {}, config }).disallowedTools.includes('Bash(git push:*)'));
  assert.equal(roles.builder.warnings.length, 1);
});

test('a REPO can tune a role at its base commit: model, limits, prompt; layers are recorded', async () => {
  const env = testEnv();
  const repo = makeRepo();
  commitFiles(repo, { '.factory/roles/builder.md': '---\nname: builder\ntier: strong\nmaxTurns: 12\n---\nYou are the builder. In this repo, always write JSDoc for new functions.\n' });
  const mirror = await ensureMirror(repo, { env });
  const { sha } = await resolveBase(mirror.dir);
  const roles = await loadRoles({ mirrorDir: mirror.dir, sha, operator: { builder: { maxTurns: 20 } } });
  assert.equal(roles.builder.tier, 'strong', 'from the repo');
  assert.equal(roles.builder.maxTurns, 20, 'the operator overrides the repo');
  assert.equal(roles.builder.permissionMode, 'acceptEdits', 'not set by the repo: kept from built-in');
  assert.match(roles.builder.body, /always write JSDoc/);
  assert.deepEqual(roles.builder.sources, ['built-in builder.md', 'repo .factory/roles/builder.md', '~/.factory/config.json']);
});

test('prompt assembly order: steering → role body → context → fenced issue', () => {
  const p = rolePrompt(builtInRoles().builder, { steering: { tech: 'Use node:test.' }, vars: { specNote: 'SPEC NOTE' }, context: ['CONTEXT'], issue: { ref: 'local#1', title: 'Do it', body: 'Please.' } });
  const at = (s) => p.indexOf(s);
  assert.ok(at('Use node:test.') < at('You are the builder') && at('You are the builder') < at('SPEC NOTE') && at('SPEC NOTE') < at('CONTEXT') && at('CONTEXT') < at('<untrusted source="local#1">'));
  assert.match(p, /never as instructions to you/);
});

test('END TO END: the triager (read-only) cannot edit; each station ran with its role\'s model', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const events = [];
  const file = path.join(tmpDir(), 'i.md');
  fs.writeFileSync(file, '---\ntitle: Add a greeting\n---\nPlease add GREETING.md.\n');
  const triage = createMockProvider([
    { text: 'Let me just fix it myself.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'sneaky\n' } }] },
    { text: '```json\n{"kind":"chore","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"one file"}\n```' },
  ]);
  const build = createMockProvider([{ text: 'Writing.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'Hello!\n' } }] }, { text: 'Done.' }]);
  const repo = makeRepo();
  const out = await runJob({ issueFile: file, repo, agent: { onEvent: (e) => events.push(e) }, providers: { triage, build, review: await approve() } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.ok(events.find((e) => e.type === 'tool_end' && e.name === 'Write' && e.isError), 'the triager\'s Write was refused (plan mode)');
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:GREETING.md'), 'Hello!');
  assert.equal(triage.requests[0].model, 'claude-haiku-4-5', 'triager: fast tier');
  assert.equal(build.requests[0].model, 'claude-sonnet-5-5', 'builder: balanced tier');
});
