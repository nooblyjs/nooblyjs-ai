import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCommand, runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { createEchoProvider } from '../src/providers/echo.js';

const newSession = () => new Session({ provider: createEchoProvider({ wordDelayMs: 0 }) });

test('isCommand detects slash input', async () => {
  assert.equal(isCommand('/help'), true);
  assert.equal(isCommand('hello /help'), false);
});

test('/clear empties the session', async () => {
  const session = newSession();
  await session.send('hi');
  const result = await runCommand('/clear', session);
  assert.equal(result.action, 'clear');
  assert.equal(session.history.length, 0);
});

test('/model changes the model', async () => {
  const session = newSession();
  await runCommand('/model claude-haiku-4-5', session);
  assert.equal(session.model, 'claude-haiku-4-5');
});

test('/tools lists the tools', async () => {
  assert.match((await runCommand('/tools', newSession())).text, /^Read\s+\(read-only\)/);
});

test('/exit and /quit exit', async () => {
  assert.equal((await runCommand('/exit', newSession())).action, 'exit');
  assert.equal((await runCommand('/quit', newSession())).action, 'exit');
});

test('unknown commands print a hint', async () => {
  assert.match((await runCommand('/nope', newSession())).text, /Unknown command/);
});
