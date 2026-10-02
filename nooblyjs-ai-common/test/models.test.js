import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTEXT_WINDOWS, MODELS, PRICES, PROVIDERS, getModel, modelsFor, providerForModel } from '../src/models.js';

test('every model belongs to a known provider and has a label', () => {
  for (const model of MODELS) {
    assert.ok(PROVIDERS[model.provider], `${model.id}: unknown provider ${model.provider}`);
    assert.ok(model.label, `${model.id}: no label`);
  }
});

test("every provider's default and small model are in the catalogue", () => {
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (id === 'ollama') continue; // whatever you pulled locally
    for (const name of [provider.defaultModel, provider.smallModel]) assert.equal(getModel(name)?.provider, id, `${id}: ${name}`);
  }
});

test('getModel finds models by id or alias', () => {
  assert.equal(getModel('claude-haiku-4-5-20251001'), getModel('claude-haiku-4-5'));
  assert.equal(getModel('mystery-model'), null);
});

test('modelsFor lists one provider in catalogue order', () => {
  assert.deepEqual(modelsFor('deepseek').map((m) => m.id), ['deepseek-chat', 'deepseek-reasoner']);
});

test('providerForModel: catalogue first, then the name prefix', () => {
  assert.equal(providerForModel('claude-opus-5-5'), 'anthropic');
  assert.equal(providerForModel('gpt-6-astra'), 'openai');
  assert.equal(providerForModel('grok-9'), 'grok');
  assert.equal(providerForModel('gemini-3-pro'), 'gemini');
  assert.equal(providerForModel('llama-5'), null);
});

test('PRICES and CONTEXT_WINDOWS only list what we know', () => {
  assert.deepEqual(PRICES['claude-opus-5-5'], { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
  assert.equal('gpt-4o' in PRICES, false);
  assert.equal('gpt-6-sol' in CONTEXT_WINDOWS, false);
  assert.equal(CONTEXT_WINDOWS['gemini-2.5-pro'], 1_048_576);
});
