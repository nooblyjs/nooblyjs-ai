import { getUsr } from './lib/users.js';
import { report } from './report.js';

console.log(`First user: ${getUsr(1)}`);
console.log(report([1, 2]));
