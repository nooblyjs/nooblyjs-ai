// @ts-check
// Phase F24: the AUDIT LOG export. Who allowed what, when, as a file you can hand to someone.
//
// Everything is already in the event log (F05). The export picks the events that matter for
// security and accountability, and CHAINS them: each line carries the hash of the line before,
//
//   { "seq": 812, "at": "…", "type": "inbox.answered", "data": {…}, "prev": "9f2c…", "hash": "a71b…" }
//
// so a line changed, removed or reordered after export breaks every hash after it, and
// `factory audit verify` says where. (A chain proves the FILE is intact since export. It
// doesn't prove the database wasn't edited before: for that, ship the export somewhere
// append-only, regularly, and compare.)
import crypto from 'node:crypto';
import { parseSince } from '../metrics/factory-metrics.js';

export const AUDIT_TYPES = [
  'inbox.opened', 'inbox.answered', // approvals, questions, policy gaps, scope and security holds, and their answers
  'policy.gap', 'scope.granted', 'security.blocked',
  'run.cancel_requested', 'run.merged', 'pr.changes_requested',
  'system.stop_all', 'system.resume_all',
  'worker.registered', 'worker.revoked',
  'learning.proposed',
  'effect.done', // pushes, PRs, merges, statuses: every time the factory touched the outside world
];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);

/** The chained lines, oldest first. */
export function exportAudit(store, { since = '30d', now = Date.now() } = {}) {
  const from = parseSince(since, now);
  const lines = [];
  let prev = GENESIS;
  for (const e of store.read({ types: AUDIT_TYPES })) {
    if (Date.parse(e.at) < from) continue;
    const record = { seq: e.seq, at: e.at, stream: e.stream, type: e.type, data: e.data, prev };
    const hash = sha(JSON.stringify(record));
    lines.push({ ...record, hash });
    prev = hash;
  }
  return lines;
}

/** Recompute the chain. Returns the first line that doesn't fit, if any. */
export function verifyAudit(lines) {
  let prev = lines[0]?.prev ?? GENESIS;
  for (let i = 0; i < lines.length; i++) {
    const { hash, ...record } = lines[i];
    if (record.prev !== prev) return { ok: false, line: i + 1, why: 'it does not follow the line before (a line was removed or reordered)' };
    if (sha(JSON.stringify(record)) !== hash) return { ok: false, line: i + 1, why: 'its content was changed' };
    prev = hash;
  }
  return { ok: true, lines: lines.length, last: prev };
}
