// Who may post to the bot's endpoint (Phase 12, tech.md §7.3): Microsoft Teams, through the Bot Framework, proves
// each request with a signed token (a JWT in the Authorization header). This checks it with node:crypto alone:
//
//   - the signing keys come from the Bot Framework's OpenID metadata, cached for a day and fetched again when a
//     token names a key NooblyJS doesn't have (at most once every five minutes);
//   - RS256 only; the issuer is the Bot Framework; the audience is NooblyJS's bot (its Entra app id);
//   - not before / not after, with five minutes' clock skew;
//   - the token's serviceUrl is the activity's, so a token for one conversation can't be replayed into another.
//
// The answer is { ok: true, via } or { ok: false, reason }; the endpoint turns a refusal into a 401 and audits it.

import crypto from 'node:crypto';

export const BOT_FRAMEWORK = {
  metadata: 'https://login.botframework.com/v1/.well-known/openidconfiguration',
  issuer: 'https://api.botframework.com',
};
const DAY = 86_400_000;
const REFETCH_MS = 5 * 60_000;
const SKEW_S = 300;

const fromB64 = (part) => Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function decodePart(part) {
  try {
    return JSON.parse(fromB64(part).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {string|null} o.appId   the bot's Entra app id (TEAMS_BOT_APP_ID); without it no token is accepted
 * @param {typeof fetch} [o.fetch]
 * @param {() => number} [o.now]  ms
 */
export function createTokenCheck({ appId, fetch: fetchImpl = globalThis.fetch, now = Date.now, log } = {}) {
  let keys = new Map(); // kid → KeyObject
  let fetchedAt = 0;
  let lastTry = 0;
  let loading = null;

  async function loadKeys() {
    loading ??= (async () => {
      lastTry = now();
      const metadata = await (await fetchImpl(BOT_FRAMEWORK.metadata, { signal: AbortSignal.timeout(10_000) })).json();
      if (!metadata?.jwks_uri || !/^https:\/\//.test(metadata.jwks_uri)) throw new Error('The Bot Framework metadata has no https jwks_uri.');
      const jwks = await (await fetchImpl(metadata.jwks_uri, { signal: AbortSignal.timeout(10_000) })).json();
      const next = new Map();
      for (const jwk of jwks?.keys ?? []) {
        if (jwk?.kty !== 'RSA' || !jwk.kid) continue;
        try {
          next.set(jwk.kid, crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' }));
        } catch { /* a key we can't read is left out */ }
      }
      keys = next;
      fetchedAt = now();
    })().finally(() => { loading = null; });
    return loading;
  }

  async function keyFor(kid) {
    if (!keys.size || now() - fetchedAt > DAY || (!keys.has(kid) && now() - lastTry > REFETCH_MS)) {
      try {
        await loadKeys();
      } catch (err) {
        log?.warn?.(`teams: the Bot Framework signing keys could not be read: ${err.message}`);
      }
    }
    return keys.get(kid) ?? null;
  }

  /**
   * Checks a Bearer token for an activity.
   * @param {string} authorization  the Authorization header
   * @param {{ serviceUrl: string|null }} activity
   */
  async function verify(authorization, activity) {
    if (!appId) return { ok: false, reason: 'NooblyJS has no Teams bot registered (TEAMS_BOT_APP_ID is not set)' };
    const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(authorization ?? ''));
    if (!match) return { ok: false, reason: authorization ? 'the Authorization header is not a Bearer token' : 'no Authorization header' };
    const [, h, p, s] = match;
    const header = decodePart(h);
    const claims = decodePart(p);
    if (!header || !claims) return { ok: false, reason: 'the token could not be read' };
    if (header.alg !== 'RS256') return { ok: false, reason: `the token is signed with ${header.alg ?? 'nothing'}, not RS256` };
    const key = await keyFor(String(header.kid ?? ''));
    if (!key) return { ok: false, reason: 'the token was not signed with a Bot Framework key' };
    const good = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, fromB64(s));
    if (!good) return { ok: false, reason: 'the token\'s signature is wrong' };
    const t = Math.floor(now() / 1000);
    if (claims.iss !== BOT_FRAMEWORK.issuer) return { ok: false, reason: `the token was issued by ${claims.iss ?? 'nobody'}, not the Bot Framework` };
    if (claims.aud !== appId) return { ok: false, reason: 'the token is for another bot' };
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < t) return { ok: false, reason: 'the token has expired' };
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > t) return { ok: false, reason: 'the token is not valid yet' };
    const said = claims.serviceurl ?? claims.serviceUrl;
    if (said && activity?.serviceUrl && said.replace(/\/+$/, '') !== String(activity.serviceUrl).replace(/\/+$/, '')) {
      return { ok: false, reason: 'the token was issued for another service address' };
    }
    return { ok: true, via: 'teams' };
  }

  return { verify, forget: () => { keys = new Map(); fetchedAt = 0; lastTry = 0; } };
}

/** True for the Agents Playground's address (it runs on this machine). */
export function isLocalServiceUrl(serviceUrl) {
  try {
    const url = new URL(serviceUrl);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/** True for the hosts Microsoft's Bot Connector service answers on, the only places the bot's token may go. */
export function isBotFrameworkServiceUrl(serviceUrl) {
  try {
    const url = new URL(serviceUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'smba.trafficmanager.net' || host.endsWith('.botframework.com') || host === 'smba.infra.gcc.teams.microsoft.com' || host.endsWith('.botframework.us');
  } catch {
    return false;
  }
}
