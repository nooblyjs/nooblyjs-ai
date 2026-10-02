import assert from 'node:assert/strict';
import { add, average } from '../src/math.js';

assert.equal(add(2, 3), 5);
assert.equal(average([2, 4, 6]), 4);
assert.equal(average([10]), 10);
console.log('all tests pass');
