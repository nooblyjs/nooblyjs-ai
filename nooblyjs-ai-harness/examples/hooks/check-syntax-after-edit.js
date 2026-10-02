#!/usr/bin/env node
// PostToolUse hook: after an Edit or Write to a .js file, check its syntax and tell the model if it broke it.
//
//   "PostToolUse": [{ "matcher": "Edit|Write", "command": "node examples/hooks/check-syntax-after-edit.js" }]
//
// (A real project would run its formatter or linter here, e.g. `npx prettier --write "$NOOBLY_FILE"`.)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  const file = event.tool_input?.file_path;
  if (!file || !/\.(m?js)$/.test(file)) return;
  const check = spawnSync(process.execPath, ['--check', path.resolve(event.cwd, file)], { encoding: 'utf8' });
  if (check.status !== 0) {
    // JSON on stdout: "block" sends the reason to the model as feedback on its edit.
    console.log(JSON.stringify({ decision: 'block', reason: `${file} no longer parses:\n${check.stderr.trim().split('\n').slice(0, 6).join('\n')}\nFix it.` }));
  }
});
