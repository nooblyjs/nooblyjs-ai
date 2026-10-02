import { summary } from './summary.js';

const s = summary([10, 20, 30]);
if (process.argv.includes('--json')) console.log(JSON.stringify(s));
else console.log(`${s.items} items, total ${s.total}`);
