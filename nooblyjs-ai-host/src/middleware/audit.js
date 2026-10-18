// Every write is audited (product.md §3), and so is every refusal. The record is written when the response
// finishes, so it has the outcome. A handler (or a refusal) can name the action and add fields through
// res.locals.audit, e.g. { action: 'session.signed_in', target: 'lerato-m' }; otherwise the action is
// "<METHOD> <path>".
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function auditRequests({ auditLog, log }) {
  return (req, res, next) => {
    res.on('finish', () => {
      const isWrite = WRITES.has(req.method);
      if (!isWrite && res.statusCode !== 403) return;
      const path = req.originalUrl.split('?')[0];
      const extra = res.locals.audit ?? {};
      auditLog.record({
        actor: extra.actor ?? req.person?.id ?? null,
        action: `${req.method} ${path}`,
        target: path,
        status: res.statusCode,
        ...extra,
      }).catch((err) => log.error(`audit write failed: ${err.message}`));
    });
    next();
  };
}
