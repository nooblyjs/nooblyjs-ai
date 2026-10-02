import { run } from '../../checks.js';

const CASES = [
  [['Sam'], 'Hello, Sam!'],
  [[], 'Hello, world!'],
  [['Sam', '--shout'], 'HELLO, SAM!'],
  [['--shout', 'Sam'], 'HELLO, SAM!'],
];

export default async function check({ dir }) {
  for (const [args, expected] of CASES) {
    const out = run('node', ['greet.js', ...args], dir).stdout.trim();
    if (out !== expected) return { pass: false, message: `node greet.js ${args.join(' ')} printed "${out}", expected "${expected}"` };
  }
  return { pass: true };
}
