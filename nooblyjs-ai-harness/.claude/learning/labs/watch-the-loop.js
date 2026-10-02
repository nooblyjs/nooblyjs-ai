// Lab: watch the agent loop with a scripted (fake) model. No API key, no cost.
// Run from the project root:  node .claude/learning/labs/watch-the-loop.js
import { Session } from '../../../src/core/session.js';
import { createMockProvider } from '../../../src/providers/mock.js';

// We play the model. Reply 1 asks for a tool; reply 2 answers using the result.
const provider = createMockProvider([
  { text: 'Let me look.', tools: [{ name: 'Read', input: { file_path: 'package.json' } }] },
  { text: 'The package is called nooblyjs-learn-harness.' },
]);

const session = new Session({ provider, providerId: 'anthropic', model: 'fake-model', cwd: process.cwd() });

console.log('--- EVENTS (what the UI sees) ---');
for await (const event of session.stream('What is this package called?')) {
  if (event.type === 'text_delta') continue; // too chatty; the text shows up in the history below
  const { type, name, summary, stopReason, rounds, toolCalls } = event;
  console.log(type, JSON.stringify({ name, summary, stopReason, rounds, toolCalls }));
}

console.log('\n--- HISTORY (what gets re-sent to the model next time) ---');
for (const m of session.history) {
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
  for (const b of blocks) {
    const body = b.type === 'text' ? b.text : b.type === 'tool_use' ? `${b.name} ${JSON.stringify(b.input)}` : String(b.content).slice(0, 60) + '…';
    console.log(`${m.role.padEnd(9)} ${b.type.padEnd(11)} ${body.replace(/\n/g, ' ').slice(0, 90)}`);
  }
}

console.log(`\n--- REQUESTS: the model was called ${provider.requests.length} times for ONE user message ---`);
provider.requests.forEach((r, i) => console.log(`request ${i + 1}: ${r.messages.length} messages, ${r.tools.length} tools offered, system prompt ${r.system.length} chars`));
