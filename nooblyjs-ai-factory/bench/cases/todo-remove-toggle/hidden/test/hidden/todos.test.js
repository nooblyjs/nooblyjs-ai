import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TodoStore } from '../../src/todos.js';

test('toggle flips done', () => {
  const s = new TodoStore();
  const a = s.add('a');
  s.toggle(a);
  assert.equal(s.list()[0].done, true);
  s.toggle(a);
  assert.equal(s.list()[0].done, false);
  assert.throws(() => s.toggle(99), RangeError);
});
test('remove', () => {
  const s = new TodoStore();
  const a = s.add('a');
  s.add('b');
  assert.equal(s.remove(a), true);
  assert.equal(s.remove(a), false);
  assert.deepEqual(s.list().map((i) => i.text), ['b']);
});
