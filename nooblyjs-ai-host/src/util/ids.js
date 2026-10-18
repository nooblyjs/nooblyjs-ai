// Generated ids are <prefix>_<random> (structure.md §5), e.g. evt_8f3k2q9a.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix, length = 10) {
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}

/** Person and team ids are kebab-case slugs. */
export const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
