// Optimistic concurrency (noobly structure.md §2a): every record has an ETag naming its version ("PRD-031@4"). A change sends
// it back in If-Match; a stale one is a 409, so a save never overwrites something the person hasn't seen.
import { HttpError, conflict } from './errors.js';

export const etagOf = (record) => `"${record.id}@${record.version ?? 0}"`;

/**
 * Checks an If-Match value against the record's current ETag.
 * @param {string|undefined} header   the If-Match header (or the ETag a worker expects)
 * @param {object} record
 * @param {{ required?: boolean }} [o]   required: a missing If-Match is refused (428)
 */
export function checkIfMatch(header, record, { required = true } = {}) {
  const current = etagOf(record);
  if (!header) {
    if (!required) return;
    throw new HttpError(428, 'precondition_required', `Send If-Match: ${current} (the version you are changing).`, { current });
  }
  const sent = header.split(',').map((s) => s.trim().replace(/^W\//, ''));
  if (sent.includes('*') || sent.includes(current)) return;
  throw conflict('Someone saved a newer version since you opened it. Reload to see it, then make your change again.', { current, sent: header });
}

/** An agent actor (agents are capped at Contributor and never decide; product.md §1). */
export const isAgent = (person) => person?.kind === 'agent';

/**
 * Middleware for decisions only a person may take (approve, accept, send to the Factory). It refuses an agent
 * even if its access role was wrongly raised, and records the refusal. A hidden button is not a control.
 */
export function peopleOnly(host, action) {
  return async (req, res, next) => {
    if (!isAgent(req.person)) return next();
    await host.audit.record({
      actor: req.person.id,
      action: 'access.refused',
      target: `${req.method} ${req.originalUrl.split('?')[0]}`,
      reason: `agents propose, people decide: an agent can't ${action}`,
    });
    next(new HttpError(403, 'people_only', `Agents propose and people decide: ${req.person.name ?? 'an agent'} can't ${action}.`));
  };
}
