import { fileUnchanged, grepFiles, run } from '../../checks.js';

export default async function check({ dir }) {
  if (grepFiles(dir, /legacyFormat/).length) return { pass: false, message: 'legacyFormat is still there' };
  if (!fileUnchanged(dir, 'main.js')) return { pass: false, message: 'main.js was changed' };
  const result = run('node', ['main.js'], dir);
  return result.stdout.trim() === '2026-01-01 → 2026-03-01: 59 days' ? { pass: true } : { pass: false, message: `main.js printed "${result.stdout.trim() || result.stderr.trim()}"` };
}
