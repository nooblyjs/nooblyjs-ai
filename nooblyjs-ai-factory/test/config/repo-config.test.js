// Phase F02: a target repo's .factory/config.json: defaults, gates, and a warning (not a crash) for each mistake.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GATE_TIMEOUT_MS, parseRepoConfig } from '../../src/config/repo-config.js';

test('no config file → no network, no setup, no gates, strict scope', () => {
  assert.deepEqual(parseRepoConfig(null), { network: 'none', setup: null, gates: [], review: { sensitive: [], dependencies: true }, scope: 'strict', warnings: [] });
});

test('gates: a string or { command, fast, timeoutMs }, in the order written', () => {
  const config = parseRepoConfig(JSON.stringify({ timeoutMs: 5000, gates: { lint: 'npm run lint', test: { command: 'npm test', fast: false, timeoutMs: 90_000 } } }));
  assert.deepEqual(config.gates, [
    { name: 'lint', command: 'npm run lint', fast: true, timeoutMs: 5000 },
    { name: 'test', command: 'npm test', fast: false, timeoutMs: 90_000 },
  ]);
  assert.deepEqual(config.warnings, []);
  assert.equal(parseRepoConfig(JSON.stringify({ gates: { t: 'x' } })).gates[0].timeoutMs, DEFAULT_GATE_TIMEOUT_MS);
});

test('setup: a string is a command; cache paths outside the repo are dropped', () => {
  assert.deepEqual(parseRepoConfig(JSON.stringify({ setup: 'npm ci' })).setup, { command: 'npm ci', cacheKey: [], cachePaths: [] });
  const setup = parseRepoConfig(JSON.stringify({ setup: { command: 'npm ci', cacheKey: ['package-lock.json'], cachePaths: ['node_modules', '../outside', '/abs'] } })).setup;
  assert.deepEqual(setup, { command: 'npm ci', cacheKey: ['package-lock.json'], cachePaths: ['node_modules'] });
});

test('each mistake is a warning, and the safe choice is used', () => {
  const config = parseRepoConfig(JSON.stringify({ network: 'everything', setup: { command: '' }, gates: { empty: {} }, scope: 'loose', colour: 'blue' }));
  assert.equal(config.network, 'none');
  assert.equal(config.setup, null);
  assert.deepEqual(config.gates, []);
  assert.equal(config.scope, 'strict');
  assert.equal(config.warnings.length, 5);
  for (const word of ['network', 'setup.command', 'gate "empty"', 'scope', '"colour"']) assert.ok(config.warnings.some((w) => w.includes(word)), `a warning about ${word}`);
  assert.match(parseRepoConfig(JSON.stringify({ gates: ['npm test'] })).warnings[0], /must be an object/);
});

test('network: "allow" or a list of domains; review settings', () => {
  assert.deepEqual(parseRepoConfig(JSON.stringify({ network: ['registry.npmjs.org'] })).network, ['registry.npmjs.org']);
  assert.equal(parseRepoConfig(JSON.stringify({ network: 'allow' })).network, 'allow');
  assert.deepEqual(parseRepoConfig(JSON.stringify({ review: { sensitive: ['src/auth/**'], dependencies: false } })).review, { sensitive: ['src/auth/**'], dependencies: false });
  assert.equal(parseRepoConfig(JSON.stringify({ scope: 'warn' })).scope, 'warn');
});

test('not JSON → an error naming the file', () => {
  assert.throws(() => parseRepoConfig('{ gates: '), /\.factory\/config\.json is not valid JSON/);
});
