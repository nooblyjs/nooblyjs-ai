// Phase 26: big output is saved, not cut.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createCheckpointStore } from '../src/checkpoints/store.js';
import { clearOldToolOutput } from '../src/context/compact.js';
import { Session } from '../src/core/session.js';
import { createPermissions } from '../src/permissions/gate.js';
import { createMockProvider } from '../src/providers/mock.js';
import { grepTool } from '../src/tools/grep.js';
import { readTool } from '../src/tools/read.js';
import { limitToolOutput, savedPathIn } from '../src/tools/truncate.js';
import { makeProject } from './helpers.js';

test('limitToolOutput saves the whole output and shows the start, the end and the path', async () => {
  const dir = await makeProject();
  const file = path.join(dir, 'saved', 'toolu_1.txt');
  const big = Array.from({ length: 50_000 }, (_, i) => `line ${i + 1}`).join('\n');
  const out = limitToolOutput(big, 40_000, { saveTo: file });
  assert.equal(fs.readFileSync(file, 'utf8'), big, 'nothing lost');
  assert.match(out, /^line 1\nline 2\n/);
  assert.match(out, /line 50000\n\n\[Output too long/);
  assert.match(out, /… \[[\d,]+ lines not shown: lines \d+–\d+ of 50,000\] …/);
  assert.equal(savedPathIn(out), file);
  assert.ok(out.length < 25_000);
  assert.equal(limitToolOutput('short', 40_000, { saveTo: file }), 'short');
});

test('round trip: 50,000 lines of test log → preview → the model Reads line 30,000 and Greps the failure', async () => {
  const cwd = await makeProject();
  const store = path.join(cwd, '..', `${path.basename(cwd)}-cp`);
  const provider = createMockProvider([
    { tools: [{ name: 'Bash', input: { command: 'for i in $(seq 1 50000); do if [ $i = 30000 ]; then echo "FAIL: parser test $i"; else echo "ok $i"; fi; done' } }] },
    { text: 'done' },
  ]);
  const session = new Session({
    provider, cwd, retry: { maxRetries: 0 }, permissions: createPermissions({ mode: 'bypass' }),
    newCheckpoints: (id) => createCheckpointStore(path.join(store, id), { cwd }),
  });
  await session.send('run the tests');
  const result = session.history[2].content[0].content;
  assert.doesNotMatch(result, /FAIL/, 'the failure is in the middle, not in the preview');
  const file = savedPathIn(result);
  assert.ok(file.startsWith(session.toolResultsDir));

  const ctx = { cwd, session };
  const page = await readTool.call({ file_path: file, offset: 30_000, limit: 1 }, ctx);
  assert.match(page.content, /30000\tFAIL: parser test 30000/);
  const found = await grepTool.call({ pattern: 'FAIL', path: file, output_mode: 'content' }, ctx);
  assert.match(found.content, /:30000:FAIL: parser test 30000/);
});

test('compaction keeps the path when it clears old output, and saves output that had none', async () => {
  const saved = `head\n[Output too long for one message. The full output is saved in /x/toolu_1.txt (9 lines, 99 characters). Read it…]`;
  const big = 'y'.repeat(5_000);
  const history = [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: saved + 'z'.repeat(2_000) }, { type: 'tool_result', tool_use_id: 'toolu_2', content: big }] },
    ...Array.from({ length: 6 }, () => ({ role: 'assistant', content: [{ type: 'text', text: '.' }] })),
  ];
  const savedBlocks = [];
  const { history: cleared } = clearOldToolOutput(history, { save: (block) => (savedBlocks.push(block.tool_use_id), `/x/${block.tool_use_id}.txt`) });
  assert.match(cleared[0].content[0].content, /full output is saved in \/x\/toolu_1\.txt/);
  assert.match(cleared[0].content[1].content, /full output is saved in \/x\/toolu_2\.txt/);
  assert.deepEqual(savedBlocks, ['toolu_2'], 'already-saved output is not saved again');
  assert.match(clearOldToolOutput(history).history[0].content[1].content, /Run the tool again/, 'without a place to save: as before');
});
