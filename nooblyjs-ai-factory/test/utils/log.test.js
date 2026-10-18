// Phase F00: the debug log: only with FACTORY_DEBUG, and never an error.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { debug } from '../../src/utils/log.js';
import { tmpDir } from '../helpers.js';

/** Run fn with these environment variables, then put them back. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test('without FACTORY_DEBUG nothing is written', () => {
  const home = tmpDir();
  withEnv({ FACTORY_HOME: home, FACTORY_DEBUG: undefined }, () => debug('quiet'));
  assert.equal(fs.existsSync(path.join(home, 'debug.log')), false);
});

test('with FACTORY_DEBUG each call is a timestamped line, with its data as JSON', () => {
  const home = path.join(tmpDir(), 'not-yet');
  withEnv({ FACTORY_HOME: home, FACTORY_DEBUG: '1' }, () => {
    debug('first');
    debug('second', { runId: 'run-1' });
  });
  const lines = fs.readFileSync(path.join(home, 'debug.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z first$/);
  assert.match(lines[1], / second \{"runId":"run-1"\}$/);
});

test('a log that cannot be written never breaks the program', () => {
  const file = path.join(tmpDir(), 'a-file');
  fs.writeFileSync(file, 'not a folder');
  withEnv({ FACTORY_HOME: file, FACTORY_DEBUG: '1' }, () => assert.doesNotThrow(() => debug('nowhere to go', { x: 1 })));
});
