'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const contextBuilder = require('../src/services/contextBuilder');
const { ValidationError } = require('../src/lib/errors');

test.after(() => cleanup(dir));

const MODEL = { id: 'test-model', label: 'Test Model', contextWindow: 200000 };
const TINY = { id: 'tiny', label: 'Tiny', contextWindow: 2000 };

const project = (description) => ({ name: 'NMEA Parser', description });
const turns = (n) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i} ${'x'.repeat(200)}`
  }));

test('system prompt carries the project name and description', () => {
  const system = contextBuilder.buildSystemPrompt(project('Rust CLI for NMEA 0183.'));
  assert.match(system, /# Project: NMEA Parser/);
  assert.match(system, /Rust CLI for NMEA 0183\./);
});

test('an empty description still yields a usable system prompt', () => {
  const system = contextBuilder.buildSystemPrompt(project(''));
  assert.match(system, /# Project: NMEA Parser/);
  assert.ok(!system.endsWith('\n\n'), 'should not leave a dangling blank section');
});

test('history well under budget passes through untouched', () => {
  const messages = turns(6);
  const result = contextBuilder.build({
    project: project('short'),
    messages,
    model: MODEL,
    temperature: 0.7,
    maxOutputTokens: 4096
  });
  assert.equal(result.messages.length, 6);
  assert.equal(result.truncatedHistory, false);
  assert.equal(result.droppedCount, 0);
});

test('history over budget drops oldest turns and flags truncation', () => {
  const messages = turns(60);
  const result = contextBuilder.build({
    project: project('short'),
    messages,
    model: TINY,
    temperature: 0.7,
    maxOutputTokens: 256
  });
  assert.equal(result.truncatedHistory, true);
  assert.ok(result.messages.length < 60);
  assert.ok(result.droppedCount > 0);
  // The most recent turn always survives.
  assert.match(result.messages.at(-1).content, /message 59/);
});

test('the window never opens on an assistant turn', () => {
  const messages = turns(60);
  const result = contextBuilder.build({
    project: project('short'),
    messages,
    model: TINY,
    temperature: 0.7,
    maxOutputTokens: 256
  });
  assert.equal(result.messages[0].role, 'user');
});

test('the description is never trimmed away by truncation', () => {
  const description = 'D'.repeat(1500);
  const result = contextBuilder.build({
    project: project(description),
    messages: turns(60),
    model: { id: 'mid', label: 'Mid', contextWindow: 4000 },
    temperature: 0.7,
    maxOutputTokens: 256
  });
  assert.equal(result.truncatedHistory, true, 'this case must actually truncate');
  assert.ok(result.system.includes(description), 'full description must survive');
});

test('a description that cannot fit the window fails loudly', () => {
  assert.throws(
    () =>
      contextBuilder.build({
        project: project('D'.repeat(50000)),
        messages: turns(2),
        model: TINY,
        temperature: 0.7,
        maxOutputTokens: 256
      }),
    ValidationError
  );
});

test('a single message larger than the whole budget fails rather than sending nothing', () => {
  assert.throws(
    () =>
      contextBuilder.build({
        project: project('short'),
        messages: [{ role: 'user', content: 'x'.repeat(100000) }],
        model: TINY,
        temperature: 0.7,
        maxOutputTokens: 256
      }),
    ValidationError
  );
});

test('consecutive same-role turns are merged', () => {
  const merged = contextBuilder.mergeConsecutive([
    { role: 'user', content: 'first' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'reply' }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].content, 'first\n\nsecond');
});

test('merging does not mutate the input messages', () => {
  const input = [
    { role: 'user', content: 'first' },
    { role: 'user', content: 'second' }
  ];
  contextBuilder.mergeConsecutive(input);
  assert.equal(input[0].content, 'first');
});
