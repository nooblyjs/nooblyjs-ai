import { run } from '../../checks.js';

export default async function check({ dir }) {
  const result = run('node', ['index.js'], dir);
  if (result.status !== 0) return { pass: false, message: `still crashes: ${result.stderr.trim().split('\n').find((l) => /Error/.test(l)) ?? result.stderr.trim()}` };
  return result.stdout.trim() === 'port=3000 host=localhost' ? { pass: true } : { pass: false, message: `printed "${result.stdout.trim()}"` };
}
