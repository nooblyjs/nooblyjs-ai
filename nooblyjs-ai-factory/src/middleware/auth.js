// @ts-check
// Phase F17: who is calling? The dashboard's BEARER TOKEN.
//
//   `Authorization: Bearer <t>`, or `X-Factory-Token: <t>` (what the dashboard sends: proxies
//   like Cloud Shell's web preview claim `Authorization` for their own login), or `?token=`
//   for EventSource, which can't send headers. A POST must carry the token in the HEADER:
//   a query token alone could be replayed by any page that learned the URL (CSRF-ish).
// Tokens are compared in constant time.
import crypto from 'node:crypto';

/** Does `got` equal `expected`, without leaking how much of it matched through timing? */
export function tokenOk(expected, got) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(got ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The token a request carries, or null. Only a GET may use `?token=`.
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 */
export function tokenFrom(req, url) {
  const header = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : (/** @type {string | undefined} */ (req.headers['x-factory-token']) ?? null);
  return header ?? (req.method === 'GET' ? url.searchParams.get('token') : null);
}

/** An authorize function for one shared token: the operator, or nobody. */
export function singleToken(token) {
  return (given) => (tokenOk(token, given) ? { role: 'operator' } : null);
}
