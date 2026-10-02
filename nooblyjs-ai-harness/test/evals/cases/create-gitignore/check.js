import fs from 'node:fs';
import path from 'node:path';

// Does some line of the .gitignore ignore this path? (A small subset of gitignore rules.)
function ignored(lines, file) {
  return lines.some((line) => {
    const rule = line.replace(/^\//, '').replace(/\/$/, '');
    if (!rule || rule.startsWith('#')) return false;
    const pattern = new RegExp(`(^|/)${rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}(/|$)`);
    return pattern.test(file);
  });
}

export default async function check({ dir }) {
  const file = path.join(dir, '.gitignore');
  if (!fs.existsSync(file)) return { pass: false, message: '.gitignore was not created' };
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim());
  for (const target of ['node_modules/express/index.js', 'debug.log', 'logs/server.log', 'dist/app.js']) {
    if (!ignored(lines, target)) return { pass: false, message: `${target} would not be ignored` };
  }
  for (const target of ['src/index.js', 'package.json']) {
    if (ignored(lines, target)) return { pass: false, message: `${target} would be ignored, but should not be` };
  }
  return { pass: true };
}
