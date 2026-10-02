// Phase F02: setup runs once per (command, lockfile), and its output is reused.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseRepoConfig } from '../src/exec/workspace/repo-config.js';
import { ensureSetup } from '../src/exec/workspace/setup-cache.js';
import { acquireWorkspace, releaseWorkspace } from '../src/exec/workspace/worktree.js';
import { commitFiles, makeRepo, testEnv } from './helpers.js';

const CONFIG = JSON.stringify({ setup: { command: 'fake-install', cacheKey: ['package-lock.json'], cachePaths: ['node_modules'] } });

/** A fake "npm ci": counts calls and writes node_modules, slowly enough for two to overlap. */
function fakeInstaller() {
  const calls = [];
  const run = async (command, { cwd }) => {
    calls.push(command);
    await new Promise((r) => setTimeout(r, 50));
    fs.mkdirSync(path.join(cwd, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
    return { code: 0, output: 'installed', sandboxed: false };
  };
  return { run, calls };
}

test('two workspaces with the same lockfile at the same time: setup runs ONCE, both get node_modules', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': CONFIG, 'package-lock.json': '{"v":1}' });
  const installer = fakeInstaller();
  const [a, b] = await Promise.all([acquireWorkspace({ repo, env }), acquireWorkspace({ repo, env })]);
  const [ra, rb] = await Promise.all([ensureSetup(a, a.config, { run: installer.run, env }), ensureSetup(b, b.config, { run: installer.run, env })]);
  assert.equal(installer.calls.length, 1);
  assert.deepEqual([ra.status, rb.status].sort(), ['hit', 'miss']);
  for (const ws of [a, b]) assert.ok(fs.existsSync(path.join(ws.path, 'node_modules/left-pad/index.js')));

  // A third, later: straight from the cache.
  const c = await acquireWorkspace({ repo, env });
  assert.equal((await ensureSetup(c, c.config, { run: installer.run, env })).status, 'hit');
  assert.equal(installer.calls.length, 1);
});

test('a changed lockfile is a new cache key: setup runs again', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': CONFIG, 'package-lock.json': '{"v":1}' });
  const installer = fakeInstaller();
  const a = await acquireWorkspace({ repo, env });
  const first = await ensureSetup(a, a.config, { run: installer.run, env });
  commitFiles(repo, { 'package-lock.json': '{"v":2}' });
  const b = await acquireWorkspace({ repo, env });
  const second = await ensureSetup(b, b.config, { run: installer.run, env });
  assert.notEqual(first.key, second.key);
  assert.equal(second.status, 'miss');
  assert.equal(installer.calls.length, 2);
});

test('cached folders are never committed, even when the repo has no .gitignore for them', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': CONFIG, 'package-lock.json': '{}' });
  const ws = await acquireWorkspace({ repo, env });
  await ensureSetup(ws, ws.config, { run: fakeInstaller().run, env });
  fs.writeFileSync(path.join(ws.path, 'real-change.txt'), 'x\n');
  const result = await releaseWorkspace(ws);
  assert.match(result.stat, /real-change\.txt/);
  assert.doesNotMatch(result.stat, /node_modules/);
});

test('a failing setup stops with its output', async () => {
  const env = testEnv();
  const repo = makeRepo({ '.factory/config.json': CONFIG, 'package-lock.json': '{}' });
  const ws = await acquireWorkspace({ repo, env });
  const run = async () => ({ code: 1, output: 'npm ERR! missing script', sandboxed: false });
  await assert.rejects(ensureSetup(ws, ws.config, { run, env }), /exit 1[\s\S]*npm ERR! missing script/);
});

test('config parsing: defaults, warnings, and cache paths that escape the workspace are dropped', () => {
  assert.deepEqual(parseRepoConfig(null), { network: 'none', setup: null, gates: [], review: { sensitive: [], dependencies: true }, scope: 'strict', warnings: [] });
  const c = parseRepoConfig(JSON.stringify({ network: 42, setup: { command: "npm ci", cachePaths: ["node_modules", "../../etc", "/abs"] }, extra: {} }));
  assert.equal(c.network, 'none');
  assert.deepEqual(c.setup?.cachePaths, ['node_modules']);
  assert.equal(c.warnings.length, 2);
  assert.equal(parseRepoConfig(JSON.stringify({ setup: 'npm ci' })).setup?.command, 'npm ci', 'a plain string is a command without caching');
  assert.throws(() => parseRepoConfig('{nope'), /not valid JSON/);
});
