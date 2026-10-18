/**
 * @fileoverview Pull a user's profile photo from Microsoft Entra ID (Azure AD)
 * on sign-in and store it in the SAME place as an uploaded profile picture
 * (<appBaseDir>/data/auth/images, via {@link module:avatarStore}), so it shows up
 * everywhere the app already renders avatars — header badge, comment avatars —
 * with no frontend changes.
 *
 * Permission model: APP-ONLY (client credentials). We mint an app token from the
 * existing AZURE_AD_CLIENT_ID / AZURE_AD_SECRET / AZURE_AD_TENANT_ID and call
 * Microsoft Graph `GET /users/{id}/photo/$value`. This requires the Graph
 * **User.Read.All** APPLICATION permission with admin consent on the app
 * registration. Everything here is best-effort and non-fatal: any failure
 * (not configured, no photo, permission denied, network) is logged and swallowed
 * so it can never delay or break sign-in.
 *
 * Provenance is respected: a picture the user uploaded themselves ('upload' in the
 * avatarStore marker) is never overwritten, nor is a pre-existing image that
 * predates the marker. Entra pictures carry an ETag so unchanged photos are not
 * re-downloaded on every login.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const avatarStore = require('./avatarStore');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** How long a Graph/token network call may run before we give up (ms). */
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Process-wide app-token cache. The client-credentials token is valid for ~1h and
 * shared across all users, so we mint it once and reuse it until shortly before
 * expiry rather than on every login.
 * @type {{value: ?string, expiresAt: number}}
 */
let tokenCache = { value: null, expiresAt: 0 };

/** @return {boolean} Whether the app-only Azure credentials are all present. */
function azureConfigured() {
  return !!(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_SECRET && process.env.AZURE_AD_TENANT_ID);
}

/** Runs fetch with an AbortController timeout so a hung socket can't wedge login. */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Acquires (and caches) an app-only Microsoft Graph token via the client
 * credentials grant.
 * @return {Promise<string>} A bearer token for graph.microsoft.com.
 */
async function getAppToken() {
  const now = Date.now();
  if (tokenCache.value && now < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  const tenant = process.env.AZURE_AD_TENANT_ID;
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID,
    client_secret: process.env.AZURE_AD_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`token endpoint ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = await res.json();
  const ttlMs = ((json.expires_in || 3600) - 60) * 1000; // refresh a minute early
  tokenCache = { value: json.access_token, expiresAt: now + Math.max(ttlMs, 0) };
  return tokenCache.value;
}

/** Maps a Graph photo content-type to an avatar file extension. */
function extForContentType(contentType) {
  const t = String(contentType || '').toLowerCase();
  if (t.includes('png')) return '.png';
  if (t.includes('gif')) return '.gif';
  return '.jpg'; // Graph returns image/jpeg by default
}

/**
 * Fetches the user's Entra profile photo and stores it as their avatar, unless
 * they have their own uploaded picture (which is left untouched) or the photo is
 * unchanged since we last stored it.
 *
 * @param {Object} params
 * @param {string} params.appBaseDir Base directory for application data.
 * @param {string} params.email User's email (identity key + Graph fallback id).
 * @param {string=} params.azureId The user's Entra object id (oid) — the most
 *     reliable Graph lookup key; falls back to email when absent.
 * @param {Object=} params.log Logger with info/warn (defaults to console).
 * @return {Promise<Object>} A small result describing what happened. Never throws.
 */
async function syncEntraAvatar({ appBaseDir, email, azureId, log } = {}) {
  const logger = log || console;
  const warn = (msg) => (logger.warn ? logger.warn(msg) : console.warn(msg));

  try {
    if (!email) return { skipped: 'no-email' };
    if (!azureConfigured()) return { skipped: 'not-configured' };

    // Respect the user's own choices: never clobber an uploaded picture, and treat
    // a pre-existing image with no marker (predates this feature) as user-owned.
    const marker = await avatarStore.readMarker(appBaseDir, email);
    if (marker && marker.source === 'upload') {
      return { skipped: 'user-upload' };
    }
    if (!marker && (await avatarStore.resolveAvatarPath(appBaseDir, email))) {
      return { skipped: 'pre-existing' };
    }

    const token = await getAppToken();
    const id = azureId || email;
    const headers = { Authorization: `Bearer ${token}` };
    if (marker && marker.source === 'entra' && marker.etag) {
      headers['If-None-Match'] = marker.etag; // cheap "unchanged?" check
    }

    const res = await fetchWithTimeout(
      `${GRAPH_BASE}/users/${encodeURIComponent(id)}/photo/$value`,
      { headers }
    );

    if (res.status === 304) return { updated: false, reason: 'unchanged' };
    if (res.status === 404) return { skipped: 'no-photo' }; // user has no Graph photo
    if (res.status === 401 || res.status === 403) {
      warn(`[entraAvatar] Graph denied the photo for ${email} (${res.status}) — ` +
        'grant the "User.Read.All" application permission and admin consent on the app registration.');
      return { skipped: 'forbidden', status: res.status };
    }
    if (!res.ok) {
      warn(`[entraAvatar] Graph photo fetch for ${email} returned ${res.status}`);
      return { skipped: 'error', status: res.status };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return { skipped: 'empty' };

    const ext = extForContentType(res.headers.get('content-type'));
    const etag = res.headers.get('etag') || undefined;
    await avatarStore.saveAvatar(appBaseDir, email, ext, buffer, 'entra', { etag });

    if (logger.info) logger.info(`[entraAvatar] Stored Entra photo for ${email} (${buffer.length} bytes, ${ext})`);
    return { updated: true, ext, bytes: buffer.length };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      warn(`[entraAvatar] Graph photo fetch for ${email} timed out`);
      return { skipped: 'timeout' };
    }
    warn(`[entraAvatar] Could not sync Entra photo for ${email}: ${err && err.message}`);
    return { skipped: 'error', error: err && err.message };
  }
}

module.exports = { syncEntraAvatar, azureConfigured, getAppToken, _resetTokenCache: () => { tokenCache = { value: null, expiresAt: 0 }; } };
