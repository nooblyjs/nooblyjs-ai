// Phase F00: where the factory keeps its files, and folder-safe repo names.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { factoryHome, repoSlug } from '../../src/utils/paths.js';

test('factoryHome: $FACTORY_HOME, else ~/.factory', () => {
  assert.equal(factoryHome({ FACTORY_HOME: '/tmp/f' }), '/tmp/f');
  assert.equal(factoryHome({}), path.join(os.homedir(), '.factory'));
});

test('repoSlug: paths and URLs become one folder-safe name', () => {
  assert.equal(repoSlug('/home/me/my-app'), 'home-me-my-app');
  assert.equal(repoSlug('https://github.com/acme/calc.git'), 'https-github-com-acme-calc');
  assert.equal(repoSlug('C:\\work\\calc'), 'C-work-calc');
  assert.equal(repoSlug('calc'), 'calc');
});
