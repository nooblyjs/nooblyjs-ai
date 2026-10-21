// Ids follow NooblyJS (root stack.md §7: typed and global): a threat model is TM-<item number> (TM-031 for PRD-031), its
// threats THR-031-1 and mitigations MIT-031-1, a finding FND-<NNN>, and everything else <prefix>_<random>. Route params
// are checked here before they reach the store.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TM_ID = /^TM-\d{3,}$/;
const FINDING_ID = /^FND-\d{3,}$/;
const ITEM_ID = /^[A-Z]{2,8}-\d{1,6}(-\d{1,4})?$/;
const GENERATED_ID = /^[a-z]{2,8}_[a-z0-9]{4,32}$/;

/** Severities, worst first. */
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
/** The scan kinds of root design.md §9. */
export const SCAN_KINDS = ['secrets', 'sast', 'sca', 'licence', 'iac', 'image', 'dast'];
export const KIND_LABEL = { secrets: 'Secrets', sast: 'Static analysis', sca: 'Dependencies', licence: 'Licences', iac: 'Infrastructure as code', image: 'Container image', dast: 'Dynamic scan' };

export const isThreatModelId = (id) => typeof id === 'string' && TM_ID.test(id);
export const isFindingId = (id) => typeof id === 'string' && FINDING_ID.test(id);
export const isItemId = (id) => typeof id === 'string' && ITEM_ID.test(id);
export const isGeneratedId = (id) => typeof id === 'string' && GENERATED_ID.test(id);
export const isSeverity = (s) => SEVERITIES.includes(s);
/** Is `a` at least as bad as `b`? */
export const atLeast = (a, b) => SEVERITIES.indexOf(a) >= 0 && SEVERITIES.indexOf(a) <= SEVERITIES.indexOf(b);

/** The number part of an item id: PRD-031 → 031. */
export const numberOf = (itemId) => String(itemId).replace(/^[A-Z]+-/, '').split('-')[0];
export const threatModelIdFor = (itemId) => `TM-${numberOf(itemId)}`;

/** A generated id, e.g. newId('scn') → 'scn_8f3k2q9a1b'. */
export function newId(prefix, length = 10) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`id prefix must be 2–8 lower-case letters, not ${JSON.stringify(prefix)}`);
  let id = '';
  for (const b of crypto.randomBytes(length)) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}
