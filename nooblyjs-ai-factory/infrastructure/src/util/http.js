// Optimistic concurrency and "people only" (noobly structure.md §2a; stack.md §3). A design has an ETag naming its version
// ("INF-031@2"); a decision sends it back in If-Match, so nobody approves a version they haven't seen.
import { HttpError, conflict } from './errors.js';

export const etagOf = (record) => `"${record.id}@${record.version ?? 0}"`;

/** Checks an If-Match value against the record's current ETag. A missing one is allowed unless `required`. */
export function checkIfMatch(header, record, { required = false } = {}) {
  const current = etagOf(record);
  if (!header) {
    if (!required) return;
    throw new HttpError(428, 'precondition_required', `Send If-Match: ${current} (the version you are changing).`, { current });
  }
  const sent = header.split(',').map((s) => s.trim().replace(/^W\//, ''));
  if (sent.includes('*') || sent.includes(current)) return;
  throw conflict('There is a newer version than the one you opened. Reload to see it, then decide again.', { current, sent: header });
}

/** An agent actor (agents are capped at Contributor and never decide; product.md §1). */
export const isAgent = (person) => person?.kind === 'agent';

/**
 * Refuses, with an audit record: a hidden button is not a control. `code` is 'forbidden' (the access role lacks a
 * permission) or 'people_only' (an agent tried to decide).
 */
export async function refuse(host, person, { action, reason, code = 'forbidden', message, permission }) {
  await host.audit.record({ actor: person?.id ?? null, action: 'access.refused', target: action, reason, ...(permission ? { permission } : {}) });
  throw new HttpError(403, code, message);
}

/** Throws unless a person (never an agent) is acting. */
export async function peopleOnly(host, person, action) {
  if (!isAgent(person)) return;
  await refuse(host, person, {
    action,
    code: 'people_only',
    reason: 'agents propose, people decide',
    message: `Agents propose and people decide: ${person.name ?? 'an agent'} can't ${action}.`,
  });
}

/** Throws unless the person's access role has the permission. */
export async function needs(host, person, permission, action) {
  if (await host.can(person?.accessRole, permission)) return;
  await refuse(host, person, {
    action,
    permission,
    reason: `needs ${permission}`,
    message: `To ${action} you need the "${permission}" permission. Your access role is ${person?.accessRole ?? 'none'}.`,
  });
}
