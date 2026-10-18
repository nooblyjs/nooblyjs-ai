// The cloud hosts NooblyJS's governance allows (Bedrock, Vertex AI, Azure): signing, request shape, stream decoding,
// errors and the production refusal of direct APIs. Offline: every call goes to a fake fetch.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { ApiError } from '../src/errors.js';
import { cloudModelId } from '../src/models.js';
import { complete, createProvider } from '../src/providers/index.js';
import { signRequest } from '../src/providers/aws-sigv4.js';
import { decodeFrame, encodeFrame, parseEventStream, EventStreamError } from '../src/providers/aws-eventstream.js';
import { buildBedrockRequest } from '../src/providers/bedrock.js';
import { createGoogleAuth } from '../src/providers/google-auth.js';
import { isRetryable } from '../src/retry.js';
import { chunked, collect } from './helpers.js';

// ── A reply in Anthropic's stream events, and fakes that carry it ─────────

const anthropicEvents = (text = 'Hello world') => [
  { type: 'message_start', message: { id: 'msg_1', model: 'served-model', content: [], usage: { input_tokens: 11 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 5) } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(5) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
  { type: 'message_stop' },
];

const chunk = (event) => encodeFrame({ ':message-type': 'event', ':event-type': 'chunk', ':content-type': 'application/json' },
  JSON.stringify({ bytes: Buffer.from(JSON.stringify(event)).toString('base64') }));

const streamOf = (bytes) => new ReadableStream({
  async start(controller) {
    for await (const piece of chunked(bytes, { maxChunk: 13 })) controller.enqueue(piece);
    controller.close();
  },
});

/** A fetch that records each call and answers with the next reply. */
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? (String(init.headers?.['content-type'] ?? '').includes('json') ? JSON.parse(init.body) : init.body) : null });
    const reply = replies.shift();
    return typeof reply === 'function' ? reply(url, init) : reply;
  };
  fn.calls = calls;
  return fn;
}

const ask = { model: 'claude-sonnet-5-5', system: 'SYSTEM-MARKER', messages: [{ role: 'user', content: 'Say hello' }], maxTokens: 256 };
const AWS = { AWS_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret', AWS_SESSION_TOKEN: 'session' };

// ── AWS Signature V4 ─────────────────────────────────────────────────────

test('SigV4 matches AWS\'s published get-vanilla test vector', () => {
  const headers = signRequest({
    method: 'GET', url: 'https://example.amazonaws.com/', region: 'us-east-1', service: 'service',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
    date: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(headers['x-amz-date'], '20150830T123600Z');
  assert.equal(headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

test('SigV4 adds the session token and encodes a Bedrock model id\'s colon twice in the canonical path', () => {
  const sign = (url) => signRequest({ method: 'POST', url, body: '{}', region: 'eu-west-1', service: 'bedrock', credentials: { accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' }, date: new Date('2026-10-10T00:00:00Z') });
  const h = sign('https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-haiku-4-5-20251001-v1%3A0/invoke-model-with-response-stream');
  assert.equal(h['x-amz-security-token'], 'T');
  assert.match(h.authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token/);
  // Differently encoded paths are different requests, so they must sign differently.
  const other = sign('https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-haiku-4-5-20251001-v1:0/invoke-model-with-response-stream');
  assert.notEqual(h.authorization, other.authorization);
});

// ── The event-stream framing ─────────────────────────────────────────────

test('event-stream frames survive any chunking, and a damaged frame is an error, not half a reply', async () => {
  const bytes = Buffer.concat([encodeFrame({ ':event-type': 'chunk', a: 'é' }, '{"x":1}'), encodeFrame({ ':event-type': 'chunk' }, 'second')]);
  const frames = await collect(parseEventStream(chunked(bytes, { maxChunk: 3 })));
  assert.deepEqual(frames.map((f) => [f.headers[':event-type'], f.headers.a, Buffer.from(f.payload).toString()]), [['chunk', 'é', '{"x":1}'], ['chunk', undefined, 'second']]);
  const damaged = Buffer.from(encodeFrame({ a: 'b' }, 'payload'));
  damaged[damaged.length - 6] ^= 0xff;
  assert.throws(() => decodeFrame(damaged), EventStreamError);
  await assert.rejects(collect(parseEventStream(chunked(bytes.subarray(0, bytes.length - 3)))), /in the middle of a frame/);
});

// ── Bedrock ──────────────────────────────────────────────────────────────

test('Bedrock: the signed request has the Messages body without model or stream, and the model\'s Bedrock id', () => {
  const { url, init } = buildBedrockRequest({ region: 'eu-west-1', credentials: { accessKeyId: 'A', secretAccessKey: 'S' }, modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', request: ask, date: new Date('2026-10-10T00:00:00Z') });
  assert.equal(url, 'https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-haiku-4-5-20251001-v1%3A0/invoke-model-with-response-stream');
  const body = JSON.parse(init.body);
  assert.equal(body.anthropic_version, 'bedrock-2023-05-31');
  assert.equal(body.max_tokens, 256);
  assert.ok(!('model' in body) && !('stream' in body) && !('fallbacks' in body));
  assert.equal(JSON.stringify(body.system).includes('SYSTEM-MARKER'), true);
  assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=A\/20261010\/eu-west-1\/bedrock\/aws4_request/);
  assert.equal(init.headers.accept, 'application/vnd.amazon.eventstream');
  assert.equal(init.headers['anthropic-beta'], undefined);
});

test('Bedrock: streams text, then one complete message, from event-stream frames', async () => {
  const fetchImpl = fakeFetch(new Response(streamOf(Buffer.concat(anthropicEvents().map(chunk))), { status: 200 }));
  const provider = createProvider('bedrock', { env: { ...AWS, BEDROCK_INFERENCE_PREFIX: 'eu.' }, fetchImpl });
  assert.equal(provider.name, 'bedrock');
  const texts = [];
  const reply = await complete(provider, ask, { onText: (t) => texts.push(t) });
  assert.deepEqual(texts, ['Hello', ' world']);
  assert.equal(reply.text, 'Hello world');
  assert.equal(reply.stopReason, 'end_turn');
  assert.deepEqual([reply.usage.input_tokens, reply.usage.output_tokens], [11, 7]);
  assert.match(fetchImpl.calls[0].url, /\/model\/eu\.anthropic\.claude-sonnet-5-5-v1%3A0\//);
  assert.equal(fetchImpl.calls[0].init.headers['x-amz-security-token'], 'session');
});

test('Bedrock: an exception frame and an HTTP error are ApiErrors that say whether to retry', async () => {
  const exception = encodeFrame({ ':message-type': 'exception', ':exception-type': 'throttlingException' }, JSON.stringify({ message: 'Too many requests' }));
  const throttled = createProvider('bedrock', { env: AWS, fetchImpl: fakeFetch(new Response(streamOf(Buffer.concat([chunk(anthropicEvents()[0]), exception])))) });
  await assert.rejects(collect(throttled.stream(ask)), (err) => err instanceof ApiError && err.status === 429 && err.type === 'throttlingException' && isRetryable(err));

  const denied = createProvider('bedrock', { env: AWS, fetchImpl: fakeFetch(new Response(JSON.stringify({ message: 'You don\'t have access' }), { status: 403, headers: { 'x-amzn-errortype': 'AccessDeniedException:http://internal' } })) });
  await assert.rejects(collect(denied.stream(ask)), (err) => err.status === 403 && err.type === 'AccessDeniedException' && !isRetryable(err));
  assert.throws(() => createProvider('bedrock', { env: { AWS_REGION: 'eu-west-1' } }), /No AWS credentials/);
  assert.throws(() => createProvider('bedrock', { env: { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' } }), /No AWS region/);
});

// ── Vertex AI ────────────────────────────────────────────────────────────

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

test('Vertex AI: streamRawPredict with a bearer token, anthropic_version and no model in the body', async () => {
  const fetchImpl = fakeFetch(new Response(streamOf(Buffer.from(sse(anthropicEvents())))));
  const provider = createProvider('vertex', { env: { VERTEX_PROJECT_ID: 'sample-project', VERTEX_REGION: 'europe-west1', GOOGLE_ACCESS_TOKEN: 'ya29.token' }, fetchImpl });
  const reply = await complete(provider, { ...ask, model: 'claude-haiku-4-5' });
  assert.equal(reply.text, 'Hello world');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://europe-west1-aiplatform.googleapis.com/v1/projects/sample-project/locations/europe-west1/publishers/anthropic/models/claude-haiku-4-5%4020251001:streamRawPredict');
  assert.equal(call.init.headers.authorization, 'Bearer ya29.token');
  assert.equal(call.body.anthropic_version, 'vertex-2023-10-16');
  assert.equal(call.body.stream, true);
  assert.ok(!('model' in call.body));
});

test('Vertex AI: the global region, and Google\'s error shape', async () => {
  const fetchImpl = fakeFetch(new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 }));
  const provider = createProvider('vertex', { env: { VERTEX_PROJECT_ID: 'p', GOOGLE_ACCESS_TOKEN: 't' }, fetchImpl });
  await assert.rejects(collect(provider.stream(ask)), (err) => err.status === 429 && err.type === 'RESOURCE_EXHAUSTED' && isRetryable(err));
  assert.match(fetchImpl.calls[0].url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/p\/locations\/global\//);
  assert.throws(() => createProvider('vertex', { env: { GOOGLE_ACCESS_TOKEN: 't' } }), /VERTEX_PROJECT_ID/);
  assert.throws(() => createProvider('vertex', { env: { VERTEX_PROJECT_ID: 'p' } }), /No Google credentials/);
});

test('Google auth: a service-account key becomes a signed JWT, exchanged once and reused until near expiry', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'noobly@sample-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.example/token' };
  let clock = 1_800_000_000_000;
  const fetchImpl = fakeFetch(
    (url, init) => {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, c, s] = assertion.split('.');
      assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      assert.deepEqual([claims.iss, claims.aud, claims.scope], [key.client_email, key.token_uri, 'https://www.googleapis.com/auth/cloud-platform']);
      return new Response(JSON.stringify({ access_token: 'first', expires_in: 3600 }));
    },
    new Response(JSON.stringify({ access_token: 'second', expires_in: 3600 })),
  );
  const auth = createGoogleAuth({ env: { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' }, fetchImpl, now: () => clock, readFile: () => JSON.stringify(key) });
  assert.deepEqual(await Promise.all([auth.token(), auth.token()]), ['first', 'first']);
  clock += 3_500_000;
  assert.equal(await auth.token(), 'first');
  clock += 100_000; // within a minute of expiry
  assert.equal(await auth.token(), 'second');
  assert.equal(fetchImpl.calls.length, 2);
});

// ── Azure ────────────────────────────────────────────────────────────────

test('Azure: the Messages API at the Foundry resource, with its key and without the fallbacks beta', async () => {
  const fetchImpl = fakeFetch(new Response(streamOf(Buffer.from(sse(anthropicEvents())))));
  const provider = createProvider('azure', { env: { AZURE_AI_ENDPOINT: 'https://noobly.services.ai.azure.com/anthropic/', AZURE_AI_API_KEY: 'az-key', AZURE_MODEL_IDS: 'claude-sonnet-5-5=sonnet-prod' }, fetchImpl });
  assert.equal(provider.name, 'azure');
  assert.equal((await complete(provider, ask)).text, 'Hello world');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://noobly.services.ai.azure.com/anthropic/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'az-key');
  assert.equal(call.init.headers['anthropic-beta'], undefined);
  assert.equal(call.body.model, 'sonnet-prod');
  assert.throws(() => createProvider('azure', { env: { AZURE_AI_API_KEY: 'k' } }), /AZURE_AI_ENDPOINT/);
});

// ── Governance ───────────────────────────────────────────────────────────

test('in production a direct public API is refused, and the cloud hosts are not', () => {
  const production = { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' };
  assert.throws(() => createProvider('anthropic', { env: production }), /refused when NODE_ENV=production/);
  assert.throws(() => createProvider('openai', { env: production }), /refused when NODE_ENV=production/);
  assert.equal(createProvider('bedrock', { env: { ...production, ...AWS } }).name, 'bedrock');
  assert.equal(createProvider('anthropic', { env: { ANTHROPIC_API_KEY: 'k' } }).name, 'anthropic');
  assert.throws(() => createProvider('nope', { env: {} }), /bedrock, vertex, azure/);
});

test('cloud model ids: known ones, derived ones, overrides and Bedrock\'s inference prefix', () => {
  assert.equal(cloudModelId('bedrock', 'claude-haiku-4-5', {}), 'anthropic.claude-haiku-4-5-20251001-v1:0');
  assert.equal(cloudModelId('bedrock', 'claude-haiku-4-5-20251001', { BEDROCK_INFERENCE_PREFIX: 'us.' }), 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  assert.equal(cloudModelId('bedrock', 'claude-opus-5-5', {}), 'anthropic.claude-opus-5-5-v1:0');
  assert.equal(cloudModelId('bedrock', 'claude-opus-5-5', { BEDROCK_MODEL_IDS: 'claude-opus-5-5=arn:aws:bedrock:eu-west-1:1:inference-profile/x', BEDROCK_INFERENCE_PREFIX: 'eu.' }), 'arn:aws:bedrock:eu-west-1:1:inference-profile/x');
  assert.equal(cloudModelId('vertex', 'claude-opus-5-5', {}), 'claude-opus-5-5');
  assert.equal(cloudModelId('azure', 'claude-opus-5-5', {}), 'claude-opus-5-5');
});
