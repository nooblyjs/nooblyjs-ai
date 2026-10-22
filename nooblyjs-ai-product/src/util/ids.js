// Ids follow NooblyJS (structure.md §4): numbered artefacts (IDEA-018, PRD-031, ADR-014) and generated ids
// <prefix>_<random> (drafts, signals).
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** The numbered artefacts and their prefixes. */
// NooblyJS Phase 17: the work hierarchy's portfolio epics, epics and features (catalogue.yaml, hierarchy.js).
// NooblyJS Phase 25a: feedback notes (NOTE-0412), four digits.
// NooblyJS Phase 25b: objectives (OBJ-04), two digits.
export const NUMBERED = { idea: 'IDEA', spec: 'PRD', adr: 'ADR', portfolioEpic: 'PEPIC', epic: 'EPIC', feature: 'FEAT', note: 'NOTE', objective: 'OBJ' };

const NUMBERED_ID = /^(IDEA|PRD|ADR|PEPIC|EPIC|FEAT|NOTE)-(\d{3,})$|^(OBJ)-(\d{2,})$/;
const GENERATED_ID = /^[a-z]{2,8}_[a-z0-9]{6,32}$/;

/** A generated id, e.g. newId('drf') → 'drf_8f3k2q9a1b'. */
export function newId(prefix, length = 10) {
  if (!/^[a-z]{2,8}$/.test(prefix)) throw new Error(`id prefix must be 2–8 lower-case letters, not ${JSON.stringify(prefix)}`);
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${id}`;
}

/** The next numbered id after the ones in use: nextNumbered('PRD', ['PRD-031', 'PRD-029']) → 'PRD-032'. */
export function nextNumbered(prefix, existing = [], width = 3) {
  if (!Object.values(NUMBERED).includes(prefix)) throw new Error(`unknown id prefix ${JSON.stringify(prefix)}`);
  let max = 0;
  for (const id of existing) {
    const match = NUMBERED_ID.exec(id);
    const [p, n] = match ? [match[1] ?? match[3], match[2] ?? match[4]] : [];
    if (p === prefix) max = Math.max(max, Number(n));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

/** True for an id this engine issues: numbered or generated. Used to validate route params before they reach the store. */
export const isId = (id) => typeof id === 'string' && (NUMBERED_ID.test(id) || GENERATED_ID.test(id));
