// @ts-check
// A Google Cloud access token for Vertex AI, with node:crypto only (no Google SDK).
//
//   GOOGLE_ACCESS_TOKEN              used as it is (e.g. from `gcloud auth print-access-token`); it expires in an hour
//   GOOGLE_APPLICATION_CREDENTIALS   a service-account key file: a short JWT signed with its private key (RS256) is
//                                    exchanged at its token_uri for an access token, kept until a minute before expiry
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ApiError } from '../errors.js';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

/** @param {string} data */
const base64url = (data) => Buffer.from(data).toString('base64url');

/**
 * A signed JWT asking for an access token. Exported for tests.
 * @param {{ clientEmail: string, privateKey: crypto.KeyLike, tokenUri?: string, nowSeconds: number }} o
 */
export function signedAssertion({ clientEmail, privateKey, tokenUri = TOKEN_URI, nowSeconds }) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: tokenUri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, now?: () => number,
 *           readFile?: (path: string) => string }} [options]
 * @returns {{ token: () => Promise<string>, source: 'token' | 'service-account' | null }}
 */
export function createGoogleAuth({ env = process.env, fetchImpl = fetch, now = Date.now, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  if (env.GOOGLE_ACCESS_TOKEN) {
    const fixed = env.GOOGLE_ACCESS_TOKEN;
    return { source: 'token', token: async () => fixed };
  }
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) return { source: null, token: async () => { throw new Error('No Google credentials. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_ACCESS_TOKEN.'); } };

  /** @type {{ value: string, until: number } | null} */
  let cached = null;
  let pending = null;
  async function fetchToken() {
    const key = JSON.parse(readFile(/** @type {string} */ (env.GOOGLE_APPLICATION_CREDENTIALS)));
    if (!key.client_email || !key.private_key) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not a service-account key (no client_email or private_key).');
    const tokenUri = key.token_uri || TOKEN_URI;
    const assertion = signedAssertion({ clientEmail: key.client_email, privateKey: key.private_key, tokenUri, nowSeconds: Math.floor(now() / 1000) });
    const response = await fetchImpl(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.access_token) throw new ApiError(response.status || 401, json.error ?? 'auth_error', json.error_description ?? 'Google did not issue an access token');
    cached = { value: json.access_token, until: now() + (Number(json.expires_in) || 3600) * 1000 - 60_000 };
    return cached.value;
  }

  return {
    source: 'service-account',
    async token() {
      if (cached && now() < cached.until) return cached.value;
      // Requests that arrive together share one token request.
      pending ??= fetchToken().finally(() => { pending = null; });
      return pending;
    },
  };
}
