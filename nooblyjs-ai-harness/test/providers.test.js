import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { chooseProvider, providerForModel, switchProvider } from '../src/providers/index.js';
import { createEchoProvider } from '../src/providers/echo.js';

test('the first provider with a key is chosen', () => {
  assert.equal(chooseProvider({ env: { XAI_API_KEY: 'x' } }).id, 'grok');
  assert.equal(chooseProvider({ env: { OPENAI_API_KEY: 'o', XAI_API_KEY: 'x' } }).id, 'openai');
  assert.equal(chooseProvider({ env: { ANTHROPIC_API_KEY: 'a', XAI_API_KEY: 'x' } }).id, 'anthropic');
});

test('GROK_API_KEY works as well as XAI_API_KEY', () => {
  assert.deepEqual(chooseProvider({ env: { GROK_API_KEY: 'g' } }), { id: 'grok', apiKey: 'g', keyName: 'GROK_API_KEY' });
});

test('a requested provider wins, and needs its key', () => {
  const env = { ANTHROPIC_API_KEY: 'a', XAI_API_KEY: 'x' };
  assert.equal(chooseProvider({ requested: 'grok', env }).id, 'grok');
  assert.equal(chooseProvider({ env: { ...env, NOOBLY_PROVIDER: 'grok' } }).id, 'grok');
  assert.throws(() => chooseProvider({ requested: 'openai', env }), /No API key found for OpenAI[\s\S]*OPENAI_API_KEY/);
  assert.throws(() => chooseProvider({ requested: 'nope', env }), /Unknown provider "nope"/);
  assert.equal(chooseProvider({ requested: 'echo', env: {} }).id, 'echo');
});

test('no keys at all explains how to set one', () => {
  assert.throws(() => chooseProvider({ env: {} }), /ANTHROPIC_API_KEY[\s\S]*OPENAI_API_KEY[\s\S]*XAI_API_KEY[\s\S]*--echo/);
});

test('model names tell us their provider', () => {
  assert.equal(providerForModel('claude-opus-5-5'), 'anthropic');
  assert.equal(providerForModel('gpt-6-astra'), 'openai');
  assert.equal(providerForModel('grok-4.7'), 'grok');
  assert.equal(providerForModel('llama-5'), null);
});

test('switching provider keeps the conversation and sets the default model', async () => {
  const session = new Session({ provider: createEchoProvider({ wordDelayMs: 0 }), providerId: 'echo' });
  await session.send('hello');
  const text = switchProvider(session, 'grok', { env: { XAI_API_KEY: 'x' } });
  assert.match(text, /Switched to xAI Grok, model grok-4.7/);
  assert.equal(session.provider.name, 'grok');
  assert.equal(session.history.length, 2);
});

test('/model with another provider\'s model switches provider (if its key is set)', async () => {
  const session = new Session({ provider: createEchoProvider({ wordDelayMs: 0 }), providerId: 'echo' });
  const saved = { ...process.env };
  try {
    process.env.XAI_API_KEY = 'x';
    delete process.env.OPENAI_API_KEY;
    assert.match((await runCommand('/model grok-4.3', session)).text, /Switched to xAI Grok, model grok-4.3/);
    assert.equal(session.model, 'grok-4.3');
    assert.match((await runCommand('/model grok-4.7', session)).text, /Model set to grok-4.7/);
    assert.match((await runCommand('/model gpt-6-astra', session)).text, /✗ No API key found for OpenAI/);
    assert.equal(session.model, 'grok-4.7');
  } finally {
    process.env = saved;
  }
});

test('/provider lists providers and which keys are set', async () => {
  const session = new Session({ provider: createEchoProvider(), providerId: 'echo' });
  const saved = { ...process.env };
  try {
    process.env = { GROK_API_KEY: 'g' };
    const { text } = await runCommand('/provider', session);
    assert.match(text, /grok\s+xAI Grok\s+GROK_API_KEY/);
    assert.match(text, /openai\s+OpenAI\s+no key \(set OPENAI_API_KEY\)/);
    assert.match(text, /● echo/);
  } finally {
    process.env = saved;
  }
});
