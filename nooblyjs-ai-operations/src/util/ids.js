// Ids follow NooblyJS (root stack.md §7: typed and global): a release is REL-<NNN> (REL-001), and everything else
// <prefix>_<random>. Route params are checked here before they reach the store.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RELEASE_ID = /^REL-\d{3,}$/;
const ITEM_ID = /^[A-Z]{2,8}-\d{1,6}(-\d{1,4})?$/;
const FEATURE_ID = /^[A-Z]{2,8}-\d{1,6}(-\d{1,4})?$/;

export const isReleaseId = (id) => typeof id === 'string' && RELEASE_ID.test(id);
export const isItemId = (id) => typeof id === 'string' && ITEM_ID.test(id);
export const isFeatureId = (id) => typeof id === 'string' && FEATURE_ID.test(id);
/** Severities, worst first (Security's). */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
/** Is `a` at least as bad as `b`? */
export const atLeast = (a, b) => SEVERITIES.indexOf(a) >= 0 && SEVERITIES.indexOf(a) <= SEVERITIES.indexOf(b);

/** A generated id, e.g. newId('dep') → 'dep_8f3k2q9a1b'. */
export function newId(prefix, length = 10) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`id prefix must be 2–8 lower-case letters, not ${JSON.stringify(prefix)}`);
  let id = '';
  for (const b of crypto.randomBytes(length)) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}
