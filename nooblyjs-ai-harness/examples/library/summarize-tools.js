// Phase 17 checkpoint: use noobly as a library. Summarise every file in src/tools/.
//   node examples/library/summarize-tools.js            (needs an API key; add --echo to try it offline)
import fs from 'node:fs';
import { query } from '../../src/index.js';

const provider = process.argv.includes('--echo') ? 'echo' : undefined;
for (const file of fs.readdirSync('src/tools').filter((name) => name.endsWith('.js'))) {
  const prompt = `Read src/tools/${file} and summarise what it does in one sentence.`;
  let summary = '';
  for await (const event of query({ prompt, options: { provider, permissionMode: 'plan', maxTurns: 5 } })) {
    if (event.type === 'turn_end') summary = event.text.trim().split('\n').at(-1);
  }
  console.log(`${file.padEnd(20)} ${summary}`);
}
