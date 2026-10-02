import fs from 'node:fs';
import path from 'node:path';

const EXPECTED = ['src/server.js:3', 'src/db/query.js:2', 'src/db/pool.js:3'];

export default async function check({ dir }) {
  const file = path.join(dir, 'TODOS.md');
  if (!fs.existsSync(file)) return { pass: false, message: 'TODOS.md was not created' };
  const text = fs.readFileSync(file, 'utf8');
  const missing = EXPECTED.filter((location) => !text.includes(location));
  if (missing.length) return { pass: false, message: `TODOS.md is missing ${missing.join(', ')}` };
  const items = text.split('\n').filter((line) => /^\s*[-*]\s/.test(line));
  return items.length === EXPECTED.length ? { pass: true } : { pass: false, message: `TODOS.md has ${items.length} items, expected ${EXPECTED.length}` };
}
