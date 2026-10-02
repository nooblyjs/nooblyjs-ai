import { fileUnchanged, run } from '../../checks.js';

export default async function check({ dir }) {
  if (!fileUnchanged(dir, 'spec/math.spec.js')) return { pass: false, message: 'the test file was changed' };
  const result = run('node', ['spec/math.spec.js'], dir);
  const reason = result.stderr.split('\n').find((line) => /Error/.test(line))?.trim() ?? result.stderr.trim();
  return result.status === 0 ? { pass: true } : { pass: false, message: `tests still fail: ${reason}` };
}
