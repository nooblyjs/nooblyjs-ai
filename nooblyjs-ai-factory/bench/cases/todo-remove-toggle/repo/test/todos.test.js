import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TodoStore } from '../src/todos.js';

test('add', () => {
  const s = new TodoStore();
  s.add('x');
  assert.equal(s.list().length, 1);
});
