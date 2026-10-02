import { grepFiles, run } from '../../checks.js';

export default async function check({ dir }) {
  const left = grepFiles(dir, /getUsr\b/);
  if (left.length) return { pass: false, message: `getUsr is still used in ${left.join(', ')}` };
  if (!grepFiles(dir, /export function getUser\b/).length) return { pass: false, message: 'getUser is not defined' };
  const result = run('node', ['app.js'], dir);
  const expected = 'First user: Ada\nAda, Grace';
  return result.stdout.trim() === expected ? { pass: true } : { pass: false, message: `app.js printed: ${result.stdout.trim() || result.stderr.trim()}` };
}
