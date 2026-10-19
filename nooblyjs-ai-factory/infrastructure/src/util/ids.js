// Ids follow NooblyJS (structure.md §5): designs are INF-<NNN>, environments are named in kebab-case (test-slots,
// pr-485), and everything else is <prefix>_<random>. Route params are checked here before they reach the store.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DESIGN_ID = /^INF-\d{3,}$/;
const ENV_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+){0,5}$/;
const GENERATED_ID = /^[a-z]{2,8}_[a-z0-9]{4,32}$/;

/** The kinds of environment, in promotion order. */
export const KINDS = ['preview', 'dev', 'test', 'staging', 'production'];
export const KIND_LABEL = { preview: 'Preview', dev: 'Dev', test: 'Test', staging: 'Staging', production: 'Production' };

export const isDesignId = (id) => typeof id === 'string' && DESIGN_ID.test(id);
export const isEnvName = (name) => typeof name === 'string' && name.length <= 48 && ENV_NAME.test(name);
export const isGeneratedId = (id) => typeof id === 'string' && GENERATED_ID.test(id);
export const isKind = (kind) => KINDS.includes(kind);

/** A generated id, e.g. newId('run') → 'run_8f3k2q9a1b'. */
export function newId(prefix, length = 10) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`id prefix must be 2–8 lower-case letters, not ${JSON.stringify(prefix)}`);
  let id = '';
  for (const b of crypto.randomBytes(length)) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}
