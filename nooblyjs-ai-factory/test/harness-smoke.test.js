// Phase F00: the harness is a dependency we can import and drive, offline.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createMockProvider, createSession, EVENT, harnessVersion, nooblyBin } from '../src/harness.js';

test('the harness library imports and runs a session with the mock provider', async () => {
  const provider = createMockProvider([{ text: 'hello from a scripted model' }]);
  const session = await createSession({ cwd: process.cwd(), provider });
  const events = [];
  for await (const event of session.stream('hi')) events.push(event);
  const end = events.at(-1);
  assert.equal(end.type, EVENT.TURN_END);
  assert.equal(end.text, 'hello from a scripted model');
  assert.equal(provider.requests.length, 1);
});

test('the noobly command can be found for running as a separate process', () => {
  assert.ok(fs.existsSync(nooblyBin({})), nooblyBin({}));
  assert.match(harnessVersion(), /^\d+\.\d+\.\d+/);
});
