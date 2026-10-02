// Phase 08: token estimates, the output limit, and compaction.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chooseCut,
  clearOldToolOutput,
  isTurnStart,
  stripThinking,
  SUMMARY_SYSTEM_PROMPT,
  transcriptText,
  withSummary,
} from '../src/context/compact.js';
import { contextUsage, contextWindowFor, estimateTokens } from '../src/context/tokens.js';
import { Session } from '../src/core/session.js';
import { createMockProvider } from '../src/providers/mock.js';
import { limitToolOutput } from '../src/tools/truncate.js';
import { collect } from './helpers.js';

const user = (text) => ({ role: 'user', content: text });
const assistant = (...content) => ({ role: 'assistant', content });
const toolUse = (id) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: 'a.js' } });
const results = (id, text) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] });
const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
const big = 'x'.repeat(5_000);

test('estimateTokens is about 4 characters per token', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens({ a: 1 }), 2); // '{"a":1}' = 7 characters
});

test('context windows: known models, unknown models, and the override setting', () => {
  assert.equal(contextWindowFor('claude-haiku-4-5'), 200_000);
  assert.equal(contextWindowFor('some-new-model'), 128_000);
  assert.equal(contextWindowFor('claude-haiku-4-5', 8_000), 8_000);
});

test('limitToolOutput cuts huge results and says how to ask for less', () => {
  assert.equal(limitToolOutput('small'), 'small');
  const out = limitToolOutput('a'.repeat(100), 20);
  assert.match(out, /characters omitted/);
  assert.match(out, /Read with offset\/limit/);
});

test('stripThinking removes thinking blocks and never leaves an empty message', () => {
  assert.deepEqual(stripThinking([assistant(thinking, { type: 'text', text: 'hi' })]), [assistant({ type: 'text', text: 'hi' })]);
  assert.deepEqual(stripThinking([assistant(thinking)])[0].content, [{ type: 'text', text: '(no visible reply)' }]);
});

test('a turn starts at a user message that is not tool results', () => {
  assert.equal(isTurnStart(user('hi')), true);
  assert.equal(isTurnStart(results('t1', 'x')), false);
  assert.equal(isTurnStart(assistant({ type: 'text', text: 'x' })), false);
});

test('clearOldToolOutput clears big OLD results only, and strips thinking when it does', () => {
  const history = [
    user('read it'),
    assistant(thinking, toolUse('t1')),
    results('t1', big), // old and big: cleared
    assistant({ type: 'text', text: 'ok' }),
    user('again'),
    assistant(toolUse('t2')),
    results('t2', 'small'), // small: kept
    assistant({ type: 'text', text: 'ok' }),
    user('and again'),
    assistant(toolUse('t3')),
    results('t3', big), // recent: kept
    assistant({ type: 'text', text: 'done' }),
  ];
  const { history: cleared, cleared: count } = clearOldToolOutput(history);
  assert.equal(count, 1);
  assert.match(cleared[2].content[0].content, /Old tool output cleared/);
  assert.equal(cleared[6].content[0].content, 'small');
  assert.equal(cleared[10].content[0].content, big);
  assert.deepEqual(cleared[1].content, [toolUse('t1')]); // thinking gone
});

test('chooseCut keeps whole recent turns and never separates a tool call from its result', () => {
  const history = [user('one'), assistant(toolUse('t1')), results('t1', big), assistant({ type: 'text', text: 'a' }), user('two'), assistant({ type: 'text', text: 'b' })];
  const cut = chooseCut(history, 4_000); // budget: 20% = 800 tokens, enough for the last turn only
  assert.equal(cut, 4);
  assert.ok(isTurnStart(history[cut]));
});

test('withSummary puts the summary at the start of the first kept user message', () => {
  const [first, second] = withSummary('SUMMARY', [user('latest question'), assistant({ type: 'text', text: 'answer' })]);
  assert.match(first.content[0].text, /<conversation-summary>[\s\S]*SUMMARY/);
  assert.deepEqual(first.content[1], { type: 'text', text: 'latest question' });
  assert.equal(second.role, 'assistant');
  assert.equal(withSummary('S', []).length, 1);
});

test('transcriptText turns history into plain text and shortens tool output', () => {
  const text = transcriptText([user('hi'), assistant(toolUse('t1')), results('t1', big)], { maxToolChars: 10 });
  assert.match(text, /^User: hi\n\nAgent used Read: \{"file_path":"a.js"\}\n\nTool result: x{10}… \[4990 more characters\]$/);
});

function compactable({ contextWindow = 4_000, script = [] } = {}) {
  const provider = createMockProvider(script);
  const session = new Session({ provider, settings: { contextWindow }, retry: { maxRetries: 0 } });
  return { provider, session };
}

test('/compact summarises with the small model, as plain text, and keeps the last turn', async () => {
  const { provider, session } = compactable({ contextWindow: 100_000, script: [{ text: 'THE SUMMARY', usage: { input_tokens: 50, output_tokens: 10 } }] });
  session.history = [user('first'), assistant(thinking, { type: 'text', text: 'one' }), user('second'), assistant(thinking, { type: 'text', text: 'two' })];

  const result = await session.compact({ force: true, focus: 'the tests' });

  const request = provider.requests[0];
  assert.equal(request.system, SUMMARY_SYSTEM_PROMPT);
  assert.equal(request.model, 'claude-haiku-4-5'); // the provider's small model
  assert.deepEqual(request.tools, []);
  assert.equal(typeof request.messages[0].content, 'string');
  assert.match(request.messages[0].content, /User: first[\s\S]*focus on: the tests/);

  assert.equal(result.method, 'summarized');
  assert.equal(session.history.length, 2);
  assert.match(session.history[0].content[0].text, /THE SUMMARY/);
  assert.deepEqual(session.history[1].content, [{ type: 'text', text: 'two' }]); // kept, thinking stripped
  assert.equal(session.usage.input_tokens, 50); // the summary's cost is counted
});

test('auto-compaction happens at the start of a turn once the window is nearly full', async () => {
  const { provider, session } = compactable({ contextWindow: 3_000, script: [{ text: 'SUMMARY' }, { text: 'reply' }] });
  session.history = [user('a'.repeat(6_000)), assistant({ type: 'text', text: 'ok' }), user('b'.repeat(6_000)), assistant({ type: 'text', text: 'ok' })];
  assert.ok(contextUsage(session).fraction > 0.8);

  const events = await collect(session.stream('next'));
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 2), ['compact_start', 'compact']);
  assert.equal(events[1].method, 'summarized');
  assert.ok(events[1].after < events[1].before);
  assert.equal(provider.requests[0].system, SUMMARY_SYSTEM_PROMPT);
  assert.equal(provider.requests[1].messages.at(-1).content, 'next');
});

test('no compaction while there is room', async () => {
  const { session } = compactable({ contextWindow: 1_000_000, script: [{ text: 'reply' }] });
  session.history = [user('hi'), assistant({ type: 'text', text: 'hello' })];
  const events = await collect(session.stream('next'));
  assert.ok(!events.some((e) => e.type.startsWith('compact')));
});
