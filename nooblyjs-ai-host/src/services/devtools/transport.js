// The only code in NooblyJS that talks to Jira or Bitbucket (Phase 11). They are production systems and this phase is
// read-only, so reading is all this file can do: a reader is bound to one origin and sends GET with no body. There
// is no parameter for a method, a body or another host, so a connector built on it cannot write even when its token
// could. test/services/devtools.test.js also reads this folder's source to check nothing else calls the network.
//
// A read never throws for what the other side says. It resolves with { ok: true, body } or
// { ok: false, reason, message, … } where reason is one of:
//   not-configured  no credential in the environment
//   unauthorised    the credential was refused (401)
//   scope           the token is valid but may not read this (403, or Jira's "scope does not match"); `scope` names it
//   not-found       404
//   rate-limited    429
//   unreachable     no answer: network, TLS, timeout
//   refused         NooblyJS itself would not send it (another host, not a path)
//   failed          anything else (5xx, a body that is not JSON)

const DEFAULT_TIMEOUT_MS = 15_000;

/** "Basic …" for an Atlassian account email and API token. */
export const basicAuth = (email, token) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

export const failure = (reason, message, extra = {}) => ({ ok: false, reason, message, ...extra });

function refusal(status, body) {
  const detail = body?.error?.detail;
  const message = body?.error?.message ?? body?.message ?? body?.errorMessages?.[0] ?? `HTTP ${status}`;
  if (status === 403 && Array.isArray(detail?.required)) return failure('scope', message, { scope: detail.required.join(', '), granted: Array.isArray(detail.granted) ? detail.granted : null, status });
  if (status === 401 && /scope does not match/i.test(message)) return failure('scope', message, { status });
  if (status === 401) return failure('unauthorised', message, { status });
  if (status === 403) return failure('scope', message, { status });
  if (status === 404) return failure('not-found', message, { status });
  if (status === 429) return failure('rate-limited', message, { status });
  return failure('failed', message, { status });
}

/**
 * A reader for one origin.
 * @param {object} options
 * @param {string} options.origin          e.g. 'https://api.bitbucket.org'. Fixed for the reader's life.
 * @param {string} [options.authorization] the Authorization header, or none for a public read
 * @param {typeof fetch} [options.fetch]   replaced in tests
 * @returns {{ origin: string, read: (path: string, query?: object) => Promise<object>, readUrl: (url: string) => Promise<object> }}
 */
export function createReader({ origin, authorization = null, fetch: fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const fixed = new URL(origin);
  if (fixed.protocol !== 'https:' || fixed.pathname !== '/' || fixed.search || fixed.username) throw new Error(`A reader's origin is https://host, not "${origin}".`);

  async function get(url) {
    // Checked here, last, whatever built the URL: the same origin, and no credentials smuggled in.
    if (url.origin !== fixed.origin || url.username || url.password) return failure('refused', `NooblyJS only reads ${fixed.origin}; it will not call ${url.origin}.`);
    let res;
    try {
      res = await fetchFn(url.href, {
        method: 'GET',
        headers: { accept: 'application/json', ...(authorization ? { authorization } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return failure('unreachable', `${fixed.host} did not answer: ${err.cause?.code ?? err.name ?? err.message}`);
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch { /* not JSON: a proxy's page, or a file's raw text */ }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, body, text };
    return refusal(res.status, body);
  }

  return {
    origin: fixed.origin,
    /** GET a path on the reader's origin. `query` values that are undefined or null are left out. */
    read(path, query = {}) {
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s]/.test(path) || path.split('/').includes('..')) {
        return Promise.resolve(failure('refused', `A read is a path on ${fixed.origin}, not "${String(path).slice(0, 80)}".`));
      }
      const url = new URL(path, fixed);
      for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      return get(url);
    },
    /** GET a full URL the other side gave us (a "next" page), only when it stays on the reader's origin. */
    readUrl(href) {
      let url;
      try {
        url = new URL(href);
      } catch {
        return Promise.resolve(failure('refused', 'Not a URL.'));
      }
      return get(url);
    },
  };
}
