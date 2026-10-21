// The only code in NooblyJS that can WRITE to Jira or Bitbucket over HTTP (Phase 13). They are production systems, so
// this file is built to be unable to do more than the kinds listed here: each kind is one method on one shape of
// path, on the one origin the writer was made for. There is no kind for merging, deleting, declining, changing a
// permission or a setting, and no way to pass a method. Nothing calls a writer except the write gate (writes.js),
// which decides whether a write may be sent at all; with the gate closed, nothing reaches this file.
//
// A write never throws for what the other side says: { ok: true, status, body } or { ok: false, reason, message }
// with the same reasons as a read (transport.js).
import { failure } from './transport.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const ISSUE = '[A-Z][A-Z0-9_]{1,19}-\\d{1,9}';
const SLUG = '[A-Za-z0-9][A-Za-z0-9._-]{0,99}';

/**
 * Every write NooblyJS can make. `path` is matched against the whole path after the writer's prefix.
 * `bitbucket.push-branch` is a git push, not an HTTP call: it is listed so the gate treats it like the others
 * (git-push.js sends it).
 */
export const KINDS = Object.freeze({
  'jira.create-issue': Object.freeze({ system: 'jira', label: 'Create a Jira issue', method: 'POST', path: new RegExp('^/rest/api/3/issue$') }),
  'jira.transition': Object.freeze({ system: 'jira', label: 'Move a Jira issue', method: 'POST', path: new RegExp(`^/rest/api/3/issue/${ISSUE}/transitions$`) }),
  'jira.comment': Object.freeze({ system: 'jira', label: 'Comment on a Jira issue', method: 'POST', path: new RegExp(`^/rest/api/3/issue/${ISSUE}/comment$`) }),
  'bitbucket.push-branch': Object.freeze({ system: 'bitbucket', label: 'Push a factory branch', method: null, path: null }),
  'bitbucket.open-pr': Object.freeze({ system: 'bitbucket', label: 'Open a pull request', method: 'POST', path: new RegExp(`^/2\\.0/repositories/${SLUG}/${SLUG}/pullrequests$`) }),
  'bitbucket.update-pr': Object.freeze({ system: 'bitbucket', label: 'Update a pull request', method: 'PUT', path: new RegExp(`^/2\\.0/repositories/${SLUG}/${SLUG}/pullrequests/\\d{1,9}$`) }),
  // Phase 22: a release's Jira fix version and its Bitbucket tag (a new version, a new tag: neither changes anything there).
  'jira.fix-version': Object.freeze({ system: 'jira', label: 'Create a Jira fix version', method: 'POST', path: new RegExp('^/rest/api/3/version$') }),
  'bitbucket.tag': Object.freeze({ system: 'bitbucket', label: 'Tag a release', method: 'POST', path: new RegExp(`^/2\\.0/repositories/${SLUG}/${SLUG}/refs/tags$`) }),
});

export const SYSTEMS = Object.freeze(['jira', 'bitbucket']);

function refusal(status, body) {
  const message = body?.error?.message ?? body?.message ?? body?.errorMessages?.[0] ?? (body?.errors ? JSON.stringify(body.errors).slice(0, 300) : null) ?? `HTTP ${status}`;
  if (status === 401) return failure('unauthorised', message, { status });
  if (status === 403) return failure('scope', message, { status });
  if (status === 404) return failure('not-found', message, { status });
  if (status === 409) return failure('conflict', message, { status });
  if (status === 429) return failure('rate-limited', message, { status });
  return failure('failed', message, { status });
}

/**
 * A writer for one origin.
 * @param {object} options
 * @param {string} options.origin          'https://api.bitbucket.org' or 'https://api.atlassian.com'. Fixed for its life.
 * @param {string} options.authorization   the Authorization header. A writer without one sends nothing.
 * @param {'jira' | 'bitbucket'} options.system  the only system whose kinds this writer sends
 * @param {typeof fetch} [options.fetch]   replaced in tests
 * @returns {{ origin: string, write: (kind: string, path: string, body: object, opts?: { prefix?: string }) => Promise<object> }}
 */
export function createWriter({ origin, authorization, system, fetch: fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const fixed = new URL(origin);
  if (fixed.protocol !== 'https:' || fixed.pathname !== '/' || fixed.search || fixed.username) throw new Error(`A writer's origin is https://host, not "${origin}".`);
  if (!SYSTEMS.includes(system)) throw new Error(`A writer is for jira or bitbucket, not "${system}".`);

  return {
    origin: fixed.origin,
    /**
     * Send one write of a listed kind. `prefix` is a fixed lead-in the kind's path follows (Jira's
     * "/ex/jira/<cloudId>"); it is not matched against the kind, so it may only be letters, digits, "/" and "-".
     */
    async write(kind, path, body, { prefix = '' } = {}) {
      const spec = KINDS[kind];
      if (!spec || spec.system !== system || !spec.method) return failure('refused', `NooblyJS has no way to send "${String(kind).slice(0, 60)}" to ${fixed.host}.`);
      if (!authorization) return failure('not-configured', `No credential is set for writing to ${fixed.host}.`);
      if (typeof path !== 'string' || !spec.path.test(path)) return failure('refused', `"${String(path).slice(0, 80)}" is not where ${kind} goes.`);
      if (typeof prefix !== 'string' || (prefix && !/^(\/[A-Za-z0-9-]+)+$/.test(prefix))) return failure('refused', 'That prefix is not a path.');
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return failure('refused', `${kind} sends a JSON object.`);
      const url = new URL(prefix + path, fixed);
      if (url.origin !== fixed.origin || url.username || url.password || url.search) return failure('refused', `NooblyJS only writes to ${fixed.origin}.`);
      let res;
      try {
        res = await fetchFn(url.href, {
          method: spec.method,
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        return failure('unreachable', `${fixed.host} did not answer: ${err.cause?.code ?? err.name ?? err.message}`);
      }
      const text = await res.text().catch(() => '');
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch { /* not JSON */ }
      if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, body: parsed };
      return refusal(res.status, parsed);
    },
  };
}
