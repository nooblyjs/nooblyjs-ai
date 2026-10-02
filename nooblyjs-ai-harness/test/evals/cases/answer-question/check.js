import { changedFiles } from '../../checks.js';

// The answer is the agent's final reply. (The solution/ folder holds a sample answer for --verify.)
export default async function check({ dir, answer }) {
  const changed = changedFiles(dir).filter((file) => file !== 'ANSWER.txt');
  if (changed.length) return { pass: false, message: `files were changed: ${changed.join(', ')}` };
  const text = answer ?? '';
  if (!/computeFreightCharge/.test(text)) return { pass: false, message: 'the answer does not name computeFreightCharge' };
  if (!/pricing\/delivery\.js/.test(text)) return { pass: false, message: 'the answer does not name src/pricing/delivery.js' };
  return { pass: true };
}
