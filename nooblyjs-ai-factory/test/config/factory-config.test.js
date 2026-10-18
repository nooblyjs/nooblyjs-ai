// Phase F06: the operator's settings (~/.factory/config.json): defaults, merging, per-repo limits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULTS, loadFactoryConfig, repoLimits } from '../../src/config/factory-config.js';
import { testEnv } from '../helpers.js';

test('no config file → the defaults (a copy, not the frozen object)', () => {
  const config = loadFactoryConfig(testEnv());
  assert.deepEqual(config, { ...DEFAULTS });
  assert.notEqual(config, DEFAULTS);
  assert.equal(Object.isFrozen(DEFAULTS), true);
});

test('a config file overrides some settings and keeps the rest; models merge per tier', () => {
  const config = loadFactoryConfig(testEnv({ maxConcurrent: 1, models: { strong: 'my-strong-model' }, repos: { calc: { dailyBudgetUsd: 5 } } }));
  assert.equal(config.maxConcurrent, 1);
  assert.equal(config.dailyBudgetUsd, DEFAULTS.dailyBudgetUsd);
  assert.equal(config.models.strong, 'my-strong-model');
  assert.equal(config.models.fast, DEFAULTS.models.fast, 'the other tiers keep their default model');
  assert.deepEqual(config.repos, { calc: { dailyBudgetUsd: 5 } });
});

test('a broken config file is an error that names the file', () => {
  const env = testEnv();
  fs.writeFileSync(path.join(env.FACTORY_HOME, 'config.json'), '{ maxConcurrent: 2 ');
  assert.throws(() => loadFactoryConfig(env), (e) => e.message.includes('config.json') && /not valid JSON/.test(e.message));
});

test('repoLimits: by slug first, then by the folder name, else none', () => {
  const config = { ...DEFAULTS, repos: { 'tmp-work-calc': { maxConcurrent: 2 }, calc: { maxConcurrent: 1 }, web: { dailyBudgetUsd: 3 } } };
  assert.deepEqual(repoLimits(config, 'tmp-work-calc', '/tmp/work/calc'), { maxConcurrent: 2 });
  assert.deepEqual(repoLimits(config, 'other-slug', '/tmp/work/web'), { dailyBudgetUsd: 3 });
  assert.deepEqual(repoLimits(config, 'nothing', '/tmp/nothing'), {});
  assert.deepEqual(repoLimits({}, 'x'), {});
});
