// Small helpers for reading requests in the controllers.

/** `?offset=` as a whole number of periods back (negative) or forward, at most 120 either way. */
export const offsetOf = (query) => Math.max(-120, Math.min(120, Number.parseInt(query.offset ?? '0', 10) || 0));

/** Records `action` on `target` in the audit log as the request's actor. */
export const recorder = (audit) => (req, action, target, detail) => audit.record(req.actor, action, target, detail);
