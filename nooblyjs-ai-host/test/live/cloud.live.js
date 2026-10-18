// LIVE: one short real call to each cloud host whose credentials are set (Bedrock, Vertex AI, Azure). It costs a
// fraction of a cent per host. Not part of `npm test`; run it with `npm run test:live`, which loads .env. A host
// without its variables (CLOUD_HOSTS[host].env in nooblyjs-ai-common) is skipped, so with none set nothing runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_HOSTS } from 'nooblyjs-ai-common/models';
import { complete, createProvider } from 'nooblyjs-ai-common/providers';

// The cheapest Claude model by default; LIVE_CLOUD_MODEL picks another.
const model = process.env.LIVE_CLOUD_MODEL || 'claude-haiku-4-5';
const ready = {
  bedrock: Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
  vertex: Boolean(process.env.VERTEX_PROJECT_ID && (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_ACCESS_TOKEN)),
  azure: Boolean(process.env.AZURE_AI_ENDPOINT && process.env.AZURE_AI_API_KEY),
};

for (const host of Object.keys(CLOUD_HOSTS)) {
  test(`${CLOUD_HOSTS[host].label} answers through nooblyjs-ai-common (${model})`, { skip: ready[host] ? false : `set ${CLOUD_HOSTS[host].env.join(', ')}` }, async () => {
    const provider = createProvider(host);
    const reply = await complete(provider, { model, maxTokens: 20, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
    assert.match(reply.text, /ready/i);
    assert.ok(reply.usage.output_tokens > 0);
  });
}
