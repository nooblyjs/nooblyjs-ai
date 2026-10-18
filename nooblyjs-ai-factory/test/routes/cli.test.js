// The command line's router (src/routes/cli.js), run as the real `factory` command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { testEnv } from '../helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const factory = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/factory.js'), ...args], { encoding: 'utf8', env: testEnv() });

test('--help lists a controller for every command, one per line', () => {
  const { status, stdout } = factory('--help');
  assert.equal(status, 0);
  for (const name of ['run', 'submit', 'serve', 'dashboard', 'worker', 'inbox', 'metrics', 'audit', 'workspace']) assert.match(stdout, new RegExp(`^  ${name}\\s`, 'm'), `--help lists ${name}`);
  // Every CLI controller file is reachable from the router.
  const router = fs.readFileSync(path.join(ROOT, 'src/routes/cli.js'), 'utf8');
  for (const file of fs.readdirSync(path.join(ROOT, 'src/controllers/cli'))) assert.ok(router.includes(`../controllers/cli/${file}`), `the router imports controllers/cli/${file}`);
});

test('--version prints the package version; no command prints the help', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(factory('--version').stdout.trim(), pkg.version);
  assert.match(factory().stdout, /^Usage: factory <command>/m);
});

test('an unknown command fails, and says where the list is', () => {
  const { status, stderr } = factory('paint');
  assert.equal(status, 1);
  assert.match(stderr, /Unknown command "paint"\. Run factory --help/);
});
