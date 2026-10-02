// Lab: the model ASKS to do something; the harness decides. No API key, no cost.
// Run from the project root:  node .claude/learning/labs/watch-a-denial.js
import { Session } from '../../../src/core/session.js';
import { createMockProvider } from '../../../src/providers/mock.js';
import { createPermissions } from '../../../src/permissions/gate.js';

const provider = createMockProvider([
  // The "model" tries to read a secrets file. A default deny rule blocks Read(**/.env*).
  { text: 'I will read the env file.', tools: [{ name: 'Read', input: { file_path: '.env' } }] },
  // The "model" tries to write a file. Nobody is there to say yes, so "ask" becomes "no".
  { text: 'Then I will write a file.', tools: [{ name: 'Write', input: { file_path: 'hello.txt', content: 'hi' } }] },
  { text: 'OK, I was not allowed to do either.' },
]);

const session = new Session({ provider, model: 'fake-model', cwd: process.cwd(), permissions: createPermissions({ mode: 'default' }) });

for await (const event of session.stream('Try some things')) {
  if (event.type === 'tool_end') console.log(`${event.name}: ${event.isError ? 'ERROR' : 'ok'}\n  the model is told: "${event.content}"\n`);
}
