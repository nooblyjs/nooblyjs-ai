#!/usr/bin/env node
// A fake `noobly` for subprocess-driver tests. It replays recorded stream-json
// lines instead of talking to a model. Set FACTORY_NOOBLY_BIN to this file.
//
//   FAKE_NOOBLY_LINES   a .ndjson file to replay (default: the recorded echo run)
//   FAKE_NOOBLY_MODE    normal | split (write in awkward chunks, cutting lines and a UTF-8 character)
//                       | hang (print init, then wait; SIGINT → an "interrupted" result, exit 130)
//                       | stubborn (like hang, but ignores SIGINT: only SIGKILL stops it)
//                       | crash (print a few lines, write to stderr, exit 3 without a result)
//                       | noise (a non-JSON line in the middle)
//   FAKE_NOOBLY_ARGS    write the arguments and NOOBLY_HOME we were given to this file (as JSON)
import fs from 'node:fs';

const linesFile = process.env.FAKE_NOOBLY_LINES ?? new URL('./noobly-echo-read.ndjson', import.meta.url);
const lines = fs.readFileSync(linesFile, 'utf8').split('\n').filter(Boolean);
const mode = process.env.FAKE_NOOBLY_MODE ?? 'normal';
if (process.env.FAKE_NOOBLY_ARGS) {
  fs.writeFileSync(process.env.FAKE_NOOBLY_ARGS, JSON.stringify({ args: process.argv.slice(2), home: process.env.NOOBLY_HOME ?? null, cwd: process.cwd() }));
}

const out = (text) => new Promise((resolve) => process.stdout.write(text, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mode === 'normal') {
  await out(lines.join('\n') + '\n');
} else if (mode === 'noise') {
  await out([lines[0], 'Debugger attached.', ...lines.slice(1)].join('\n') + '\n');
} else if (mode === 'split') {
  // Insert a line with "é" (2 bytes in UTF-8), then write everything 7 BYTES at a time.
  const extra = JSON.stringify({ type: 'text_delta', text: 'café' });
  const bytes = Buffer.from([lines[0], extra, ...lines.slice(1)].join('\n') + '\n');
  for (let i = 0; i < bytes.length; i += 7) {
    await new Promise((resolve) => process.stdout.write(bytes.subarray(i, i + 7), resolve));
    await sleep(1);
  }
} else if (mode === 'crash') {
  await out(lines.slice(0, 3).join('\n') + '\n');
  process.stderr.write('TypeError: something broke inside noobly\n');
  process.exit(3);
} else if (mode === 'hang' || mode === 'stubborn') {
  await out(lines[0] + '\n' + JSON.stringify({ type: 'message_start', model: 'echo', usage: { input_tokens: 10 } }) + '\n');
  process.on('SIGINT', async () => {
    if (mode === 'stubborn') return;
    await out(JSON.stringify({ type: 'turn_end', text: '', stopReason: null, usage: {}, cost: 0, interrupted: true, rounds: 1, toolCalls: 0 }) + '\n');
    await out(JSON.stringify({ type: 'result', subtype: 'interrupted', is_error: true, result: '', num_rounds: 1, num_tool_calls: 0, usage: {}, total_cost_usd: 0, model: 'echo', session_id: 'fake' }) + '\n');
    process.exit(130);
  });
  setInterval(() => {}, 1000);
}
