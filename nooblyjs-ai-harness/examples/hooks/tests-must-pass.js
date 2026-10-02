#!/usr/bin/env node
// Stop hook: the agent may only finish when the tests pass.
//
//   "Stop": [{ "command": "node examples/hooks/tests-must-pass.js", "timeout": 180 }]
//
// If `npm test` fails, exit code 2 sends the model back to work with the end of
// the test output. noobly allows at most 3 such "not done yet"s per message.
import { spawnSync } from 'node:child_process';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  const run = spawnSync('npm', ['test'], { cwd: event.cwd, encoding: 'utf8' });
  if (run.status === 0) return;
  const output = `${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-25).join('\n');
  console.error(`The tests fail, so the task is not finished. Fix them before stopping.\n\n${output}`);
  process.exit(2);
});
