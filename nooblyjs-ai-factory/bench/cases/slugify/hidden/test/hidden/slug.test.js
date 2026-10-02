import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../../src/slug.js';

test('slugify', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('  Many   spaces '), 'many-spaces');
  assert.equal(slugify('Version 2.0'), 'version-2-0');
  assert.equal(slugify('---'), '');
  assert.equal(slugify('ABC'), 'abc');
});
