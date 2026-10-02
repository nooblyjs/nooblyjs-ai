#!/usr/bin/env node
// PreToolUse hook: refuse `rm -rf` in any Bash command, even when permissions would allow it.
//
//   "PreToolUse": [{ "matcher": "Bash", "command": "node examples/hooks/block-rm-rf.js" }]
//
// Exit code 2 = block; what we print to stderr is sent to the model as the reason.
let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const event = JSON.parse(input);
  const command = event.tool_input?.command ?? '';
  if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/.test(command)) {
    console.error('rm -rf is not allowed in this project. Delete specific files with `git rm <file>` or `rm <file>` instead.');
    process.exit(2);
  }
});
