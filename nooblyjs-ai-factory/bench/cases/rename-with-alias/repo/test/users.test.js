import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as users from '../src/users.js';

test('ada', () => assert.equal((users.getUser ?? users.getUsr)(1), 'Ada'));
