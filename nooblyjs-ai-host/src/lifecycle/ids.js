// Generated ids are <prefix>_<random> (NooblyJS structure.md §5), e.g. apr_8f3k2q9a.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix, length = 10) {
  let id = '';
  for (const b of crypto.randomBytes(length)) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}
