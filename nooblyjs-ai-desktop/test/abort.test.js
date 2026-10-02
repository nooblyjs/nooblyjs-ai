'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const { bootstrap } = require('../src/storage/bootstrap');
const registry = require('../src/providers/registry');
const { makeMockProvider } = require('../scripts/mockProvider');
const { createApp } = require('../src/app');

registry.register(makeMockProvider({ id: 'slowmock', label: 'Slow Mock', delayMs: 40 }));

let server;
let base;

test.before(async () => {
  await bootstrap();
  server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  cleanup(dir);
});

async function json(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

test('aborting mid-stream persists the partial reply and marks it stopped', async () => {
  const { project } = await json('POST', '/api/projects', { name: 'Abort', description: 'ctx' });
  const { chat } = await json('POST', `/api/projects/${project.id}/chats`, {});

  const controller = new AbortController();
  const res = await fetch(`${base}/api/projects/${project.id}/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'start a long answer', provider: 'slowmock' }),
    signal: controller.signal
  });

  // Read a couple of chunks, then hang up like a user hitting Stop.
  const reader = res.body.getReader();
  await reader.read();
  await reader.read();
  controller.abort();

  // Give the server a moment to notice the disconnect and flush its write.
  await new Promise((resolve) => setTimeout(resolve, 600));

  const { chat: saved } = await json('GET', `/api/projects/${project.id}/chats/${chat.id}`);
  assert.equal(saved.messages[0].content, 'start a long answer', 'user message must survive');

  const assistant = saved.messages[1];
  assert.ok(assistant, 'the partial assistant reply must still be saved');
  assert.equal(assistant.meta.finishReason, 'aborted');
  assert.ok(assistant.content.length > 0, 'partial text should be kept');
});

test('a completed turn is never marked aborted', async () => {
  const { project } = await json('POST', '/api/projects', { name: 'Complete', description: 'ctx' });
  const { chat } = await json('POST', `/api/projects/${project.id}/chats`, {});

  const res = await fetch(`${base}/api/projects/${project.id}/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'finish normally', provider: 'slowmock' })
  });
  await res.text();

  const { chat: saved } = await json('GET', `/api/projects/${project.id}/chats/${chat.id}`);
  assert.equal(saved.messages[1].meta.finishReason, 'end_turn');
});
