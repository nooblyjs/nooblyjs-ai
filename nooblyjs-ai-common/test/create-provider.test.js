import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, explainError } from '../src/errors.js';
import { addCacheBreakpoints, createProvider, findApiKey } from '../src/providers/index.js';

const BREAKPOINT = { type: 'ephemeral' };

/** A fetch that records where it was sent and answers with an empty Chat Completions stream. */
function recorder() {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response('data: [DONE]\n\n', { status: 200 });
  };
  return { urls, fetchImpl };
}
const request = { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 };
const drain = async (stream) => { for await (const _ of stream); };

test('findApiKey checks each of the provider\'s variables in order', () => {
  assert.deepEqual(findApiKey('grok', { GROK_API_KEY: 'g' }), { apiKey: 'g', keyName: 'GROK_API_KEY' });
  assert.deepEqual(findApiKey('grok', { XAI_API_KEY: 'x', GROK_API_KEY: 'g' }), { apiKey: 'x', keyName: 'XAI_API_KEY' });
  assert.equal(findApiKey('grok', {}), null);
  assert.equal(findApiKey('nobody', {}), null);
});

test('createProvider explains an unknown provider, a missing key and a provider without an adapter', () => {
  assert.throws(() => createProvider('nobody', { env: {} }), /Unknown provider "nobody"/);
  assert.throws(() => createProvider('deepseek', { env: {} }), /No API key for DeepSeek\. Set DEEPSEEK_API_KEY/);
  assert.throws(() => createProvider('echo', { env: {} }), /has no shared adapter/);
});

test('createProvider takes the key from the environment, and needs none for Ollama', async () => {
  const { urls, fetchImpl } = recorder();
  await drain(createProvider('deepseek', { env: { DEEPSEEK_API_KEY: 'k' }, fetchImpl }).stream(request));
  await drain(createProvider('ollama', { env: {}, fetchImpl }).stream(request));
  assert.deepEqual(urls, ['https://api.deepseek.com/chat/completions', 'http://localhost:11434/v1/chat/completions']);
});

test('the address: baseUrl, then $<ID>_BASE_URL, then the catalogue', async () => {
  const { urls, fetchImpl } = recorder();
  const env = { GEMINI_API_KEY: 'k', GEMINI_BASE_URL: 'http://proxy/v1' };
  await drain(createProvider('gemini', { env, fetchImpl }).stream(request));
  await drain(createProvider('gemini', { env, baseUrl: 'http://mine/v1', fetchImpl }).stream(request));
  await drain(createProvider('gemini', { env: { GEMINI_API_KEY: 'k' }, fetchImpl }).stream(request));
  assert.deepEqual(urls, [
    'http://proxy/v1/chat/completions',
    'http://mine/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ]);
});

test('an empty key or address counts as not set', async () => {
  const { urls, fetchImpl } = recorder();
  const env = { DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: '' };
  await drain(createProvider('deepseek', { env, apiKey: '', baseUrl: '', fetchImpl }).stream(request));
  assert.deepEqual(urls, ['https://api.deepseek.com/chat/completions']);
  assert.throws(() => createProvider('deepseek', { env: { DEEPSEEK_API_KEY: '' } }), /No API key/);
});

test('addCacheBreakpoints caches the system prompt and puts the context after it, uncached', () => {
  const { system } = addCacheBreakpoints({ system: 'stable', context: 'changes', messages: [] });
  assert.deepEqual(system, [
    { type: 'text', text: 'stable', cache_control: BREAKPOINT },
    { type: 'text', text: 'changes' },
  ]);
  assert.equal(addCacheBreakpoints({ system: '', messages: [] }).system, '');
});

test('explainError: network failures, overload, unknown errors and cancellations', () => {
  const offline = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  assert.deepEqual(explainError(offline, 'Gemini'), { status: 0, retryable: true, message: 'Gemini: network error (ECONNREFUSED).' });
  assert.deepEqual(explainError(new ApiError(0, 'overloaded_error', 'Overloaded'), 'Anthropic'), {
    status: 0, retryable: true, message: 'Anthropic: overloaded. Try again shortly.',
  });
  assert.deepEqual(explainError(new Error('odd'), 'X'), { status: 0, retryable: false, message: 'X: odd' });
  assert.equal(explainError(new DOMException('stop', 'AbortError'), 'X'), null);
});

test('Anthropic signs in with ANTHROPIC_AUTH_TOKEN as a bearer token when there is no API key', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers);
    return new Response('', { status: 200 });
  };
  await drain(createProvider('anthropic', { env: { ANTHROPIC_AUTH_TOKEN: 'tok' }, fetchImpl }).stream(request));
  await drain(createProvider('anthropic', { env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_AUTH_TOKEN: 'tok' }, fetchImpl }).stream(request));
  assert.equal(seen[0].authorization, 'Bearer tok');
  assert.equal(seen[0]['x-api-key'], undefined);
  assert.equal(seen[1]['x-api-key'], 'key', 'an API key wins');
  assert.equal(seen[1].authorization, undefined);
  assert.throws(() => createProvider('anthropic', { env: {} }), /Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN/);
});
