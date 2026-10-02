import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmail } from '../../src/validate.js';

test('valid', () => {
  for (const ok of ['a@b.co', 'first.last@example.org', 'x+tag@sub.domain.io']) assert.equal(isEmail(ok), true, ok);
});
test('invalid', () => {
  for (const bad of ['', 'a', 'a@b', '@b.co', 'a@@b.co', 'a b@c.io', 'a@b..c', 'a@.b', 'a@b.c.', 'a@b c.io']) assert.equal(isEmail(bad), false, bad);
});
