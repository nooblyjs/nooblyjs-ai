// Models & pricing, live (NooblyJS): the models each provider offers right now, offered to teammates under a tier.
// The list is a fake here (nooblyjs-ai-common's discovery is tested in nooblyjs-core); nothing reaches a provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { createProviders } from '../../src/services/providers/index.js';

const LIST = {
  checkedAt: '2026-10-01T08:00:00.000Z',
  prices: { source: 'openrouter', count: 3 },
  providers: [
    { id: 'anthropic', label: 'Anthropic', ok: true, models: [
      { id: 'claude-sonnet-5-5', provider: 'anthropic', providerLabel: 'Anthropic', label: 'Sonnet 5.5', contextWindow: 1_000_000, maxOutput: 128_000, pricing: { input: 2, output: 10, cacheRead: 0.2 }, priceSource: 'catalogue', priceNote: 'NooblyJS catalogue price', tier: 'BALANCED' },
    ] },
    { id: 'openai', label: 'OpenAI', ok: true, models: [
      { id: 'gpt-6.1-sol', provider: 'openai', providerLabel: 'OpenAI', label: 'GPT 6.1 Sol', contextWindow: 1_050_000, maxOutput: null, pricing: { input: 2, output: 10, cacheRead: 0.2 }, priceSource: 'openrouter', priceNote: 'OpenRouter list price (a reference: check the provider)', tier: 'BALANCED' },
      { id: 'gpt-6-luna', provider: 'openai', providerLabel: 'OpenAI', label: 'GPT-6 Luna', contextWindow: 1_050_000, maxOutput: 8000, pricing: { input: 0.1, output: 0.5, cacheRead: 0.01 }, priceSource: 'catalogue', priceNote: 'NooblyJS catalogue price', tier: 'LIGHT' },
    ] },
    { id: 'grok', label: 'xAI Grok', ok: false, reason: 'unauthorised', message: 'Incorrect API key provided', models: [] },
  ],
};
let asked = 0;
let app;
before(async () => {
  app = await startApp({ discoverModels: async () => { asked += 1; return LIST; } });
});
after(() => app.close());

test('the live list: every provider\'s models, marked when already offered here, and why a provider is missing', async () => {
  const { status, body } = await app.get('/api/v1/models/available');
  assert.equal(status, 200);
  assert.deepEqual(body.tiers, ['LIGHT', 'BALANCED', 'PREMIUM']);
  const anthropic = body.providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.models[0].offeredAs, 'sonnet', 'the seed already offers Sonnet 5.5');
  assert.equal(body.providers.find((p) => p.id === 'openai').models[0].offeredAs, null);
  assert.deepEqual(body.providers.find((p) => p.id === 'grok'), LIST.providers[2]);
});

test('an Owner offers a model under a tier: it takes the tier\'s rate card and its own list price, marked for review when it is a reference', async () => {
  assert.equal((await app.send('POST', '/api/v1/models', { provider: 'openai', modelId: 'gpt-6.1-sol', tier: 'GOLD' })).status, 422);
  assert.equal((await app.send('POST', '/api/v1/models', { provider: 'openai', modelId: 'gpt-9', tier: 'LIGHT' })).body.error.details.modelId.includes('does not list'), true);

  const sol = await app.send('POST', '/api/v1/models', { provider: 'openai', modelId: 'gpt-6.1-sol', tier: 'BALANCED' });
  assert.equal(sol.status, 201);
  assert.deepEqual(
    [sol.body.id, sol.body.name, sol.body.tier, sol.body.provider, sol.body.baseRate, sol.body.computePerHour, sol.body.toolsPerHour, sol.body.priceSource, sol.body.pricingReviewedAt, sol.body.reviewStale],
    ['gpt-6-1-sol', 'GPT 6.1 Sol', 'BALANCED', 'openai', 16, 10, 2, 'openrouter', null, true],
  );
  assert.deepEqual(sol.body.pricing, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 });
  assert.match(sol.body.description, /OpenRouter list price/);

  const luna = await app.send('POST', '/api/v1/models', { provider: 'openai', modelId: 'gpt-6-luna', tier: 'LIGHT' });
  assert.deepEqual([luna.body.baseRate, luna.body.pricingReviewedAt, luna.body.reviewStale], [4, '2026-10-01', false], 'a catalogue price counts as reviewed');
  assert.equal((await app.send('POST', '/api/v1/models', { provider: 'openai', modelId: 'gpt-6-luna', tier: 'LIGHT' })).status, 409);

  // It is in the list every picker reads, and a teammate can be hired on it.
  assert.ok((await app.get('/api/v1/models')).body.models.some((m) => m.id === 'gpt-6-1-sol'));
  const hired = await app.send('POST', '/api/v1/teammates', { name: 'Sol', role: 'Analyst', model: 'gpt-6-1-sol', rate: 16, monthlyCap: 500, costCentre: 'Support', memoryMode: 'session', skills: [] });
  assert.equal(hired.status, 201, JSON.stringify(hired.body));
  const run = await app.send('POST', '/api/v1/teammates/sol/tasks', { task: 'Summarise the week', costCentre: 'Support' });
  assert.equal(run.status, 200);

  // Removing: refused while Sol runs on it; fine for one nobody uses.
  assert.equal((await app.send('DELETE', '/api/v1/models/gpt-6-1-sol')).status, 409);
  assert.deepEqual((await app.send('DELETE', '/api/v1/models/gpt-6-luna')).body, { removed: 'gpt-6-luna' });
  assert.ok(!(await app.get('/api/v1/models')).body.models.some((m) => m.id === 'gpt-6-luna'));
  assert.equal((await app.send('DELETE', '/api/v1/models/haiku')).status, 409, 'Haiku writes memories');
});

test('a model of another provider is served by that provider when its key is set, else the mock; never in production', () => {
  const model = { provider: 'openai', modelId: 'gpt-6.1-sol' };
  assert.equal(createProviders({ env: { OPENAI_API_KEY: 'k' } }).get(model).name, 'openai');
  assert.equal(createProviders({ env: { GROK_API_KEY: 'k' } }).get({ provider: 'grok', modelId: 'grok-4.7' }).name, 'grok');
  assert.equal(createProviders({ env: {} }).get(model).name, 'mock');
  assert.equal(createProviders({ mode: 'mock', env: { OPENAI_API_KEY: 'k' } }).get(model).name, 'mock');
  assert.throws(() => createProviders({ env: { OPENAI_API_KEY: 'k', NODE_ENV: 'production' } }).get(model), /development only/);
});
