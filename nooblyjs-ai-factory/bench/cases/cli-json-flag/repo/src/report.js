import { summary } from './summary.js';

const s = summary([10, 20, 30]);
console.log(`${s.items} items, total ${s.total}`);
