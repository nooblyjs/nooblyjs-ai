/**
 * @fileoverview Target Process REST API (v1) client.
 *
 * Retrieves collections (Projects, PortfolioEpics, Epics, Features, …) with
 * `include`/`where`/`take`, following the `Next` link so every page is fetched.
 *
 * Supports three authentication modes (in priority order):
 *   1. Apptio Front Door — `settings.frontdoorPublicKey`/`frontdoorPrivateKey`.
 *      The keys are exchanged (POST to `settings.frontdoorUrl`) for a short-lived
 *      `apptio-opentoken`, which is sent as a request header and refreshed on
 *      expiry / 401. This is the current Apptio-fronted access path.
 *   2. `?access_token=` query parameter — when `settings.token` is supplied.
 *   3. HTTP Basic auth — `settings.username`/`settings.password`.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

// Network-layer failures (undici "fetch failed") and transient HTTP statuses are
// retried with linear back-off before giving up.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thin Target Process API client.
 * @class
 */
class TargetProcess {

    /**
     * @param {object} settings
     * @param {string} settings.server   - Base API URL, e.g.
     *   "https://acme.tpondemand.com/api/v1" (scheme optional — added if missing).
     * @param {string} [settings.username] - Basic-auth user.
     * @param {string} [settings.password] - Basic-auth password.
     * @param {string} [settings.token]    - Personal access token (used instead of basic auth).
     * @param {string} [settings.frontdoorPublicKey]  - Apptio Front Door API key access (public) id.
     * @param {string} [settings.frontdoorPrivateKey] - Apptio Front Door API key secret (private).
     * @param {string} [settings.frontdoorUrl]        - Front Door apikeylogin endpoint
     *   (default "https://frontdoor.apptio.com/service/apikeylogin").
     */
    constructor(settings) {
        let server = (settings && settings.server) || '';
        server = server.replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(server)) {
            server = 'https://' + server;
        }
        this.server = server;

        // Apptio Front Door: exchange API keys for a short-lived apptio-opentoken.
        // When configured it takes priority over the legacy token / basic auth.
        this.frontdoorPublicKey = (settings && settings.frontdoorPublicKey) || null;
        this.frontdoorPrivateKey = (settings && settings.frontdoorPrivateKey) || null;
        this.frontdoorUrl = (settings && settings.frontdoorUrl)
            || 'https://frontdoor.apptio.com/service/apikeylogin';
        this.frontdoor = Boolean(this.frontdoorPublicKey && this.frontdoorPrivateKey);
        this.openToken = null;      // cached apptio-opentoken
        this.openTokenExpiry = 0;   // epoch ms; 0 = unknown/expired

        // Legacy access_token query-param mode (ignored when Front Door is active).
        this.token = (!this.frontdoor && settings && settings.token) ? settings.token : null;

        this.headers = { Accept: 'application/json' };
        // Basic auth only when neither Front Door nor access_token is in use.
        if (!this.frontdoor && !this.token && settings && settings.username) {
            const basic = Buffer.from(`${settings.username}:${settings.password || ''}`).toString('base64');
            this.headers.Authorization = `Basic ${basic}`;
        }
    }

    /**
     * Ensure a valid apptio-opentoken is present (Front Door mode only). Exchanges
     * the configured API keys for a token via the apikeylogin endpoint and caches
     * it until shortly before `valid_till`. A no-op when Front Door is not active.
     * @param {boolean} [force=false] - Re-login even if the cached token looks valid.
     * @returns {Promise<void>}
     */
    async ensureToken(force = false) {
        if (!this.frontdoor) {
            return;
        }
        // 30s safety margin so we never send a token that expires mid-flight.
        if (!force && this.openToken && Date.now() < this.openTokenExpiry - 30000) {
            this.headers['apptio-opentoken'] = this.openToken;
            return;
        }

        let response;
        try {
            response = await fetch(this.frontdoorUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    keyAccess: this.frontdoorPublicKey,
                    keySecret: this.frontdoorPrivateKey,
                }),
            });
        } catch (error) {
            const cause = error.cause ? (error.cause.code || error.cause.message) : error.message;
            throw new Error(`Front Door login failed (network) at ${this.frontdoorUrl}: ${cause}`, { cause: error });
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Front Door login ${response.status} ${response.statusText}\n${body.slice(0, 500)}`);
        }

        // The apptio-opentoken is returned as a response header.
        const openToken = response.headers.get('apptio-opentoken');
        if (!openToken) {
            throw new Error('Front Door login succeeded but no apptio-opentoken header was returned');
        }
        this.openToken = openToken;
        this.headers['apptio-opentoken'] = openToken;

        // Prefer the server-provided validity window; otherwise assume a
        // conservative 15 minutes so we refresh well before the session lapses.
        let validTillMs = 0;
        const validTillHeader = response.headers.get('apptio-opentoken-valid-till')
            || response.headers.get('valid_till');
        if (validTillHeader) {
            const parsed = Number.isNaN(Date.parse(validTillHeader))
                ? Number(validTillHeader)
                : Date.parse(validTillHeader);
            if (parsed) {
                // Accept either epoch-ms or a parseable date string.
                validTillMs = parsed > 1e12 ? parsed : Date.now() + parsed;
            }
        }
        this.openTokenExpiry = validTillMs || (Date.now() + 15 * 60 * 1000);
    }

    /**
     * Build a full request URL for a resource.
     * @param {string} resource - e.g. "Projects"
     * @param {object} [params]
     * @param {string[]} [params.include] - Field/relation names to include.
     * @param {string} [params.where]     - A Target Process filter expression.
     * @param {number} [params.take]      - Page size (default 1000).
     * @returns {string}
     */
    buildUrl(resource, params = {}) {
        const query = ['format=json'];
        query.push(`take=${params.take || 1000}`);
        if (params.include && params.include.length) {
            query.push(`include=[${params.include.join(',')}]`);
        }
        if (params.where) {
            query.push(`where=${encodeURIComponent(params.where)}`);
        }
        if (this.token) {
            query.push(`access_token=${encodeURIComponent(this.token)}`);
        }
        return `${this.server}/${resource}?${query.join('&')}`;
    }

    /**
     * Fetch a single page (any absolute Target Process URL).
     *
     * Network-layer failures (undici throws `TypeError: fetch failed`, with the
     * real reason on `error.cause`) and transient HTTP statuses (429/502/503/504)
     * are retried up to {@link MAX_ATTEMPTS} times with linear back-off. When the
     * retries are exhausted the thrown error carries the underlying cause both in
     * its message and on `error.cause`, so callers never see a bare "fetch failed".
     *
     * @param {string} url
     * @param {number} [attempt=1] - 1-based attempt counter (internal).
     * @returns {Promise<object>} The parsed `{ Items, Next }` payload.
     */
    async fetchPage(url, attempt = 1) {
        // Front Door: make sure a valid apptio-opentoken header is set.
        await this.ensureToken();

        // The `Next` link omits the token; re-append it for subsequent pages
        // (legacy access_token mode only — Front Door authenticates via header).
        let requestUrl = url;
        if (this.token && !/[?&]access_token=/.test(requestUrl)) {
            requestUrl += (requestUrl.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(this.token)}`;
        }

        let response;
        try {
            response = await fetch(requestUrl, { headers: this.headers });
        } catch (error) {
            // undici reports every network-layer failure as "fetch failed"; the
            // actionable detail (ECONNRESET, ETIMEDOUT, ENOTFOUND, …) is on .cause.
            const cause = error.cause ? (error.cause.code || error.cause.message) : error.message;
            if (attempt < MAX_ATTEMPTS) {
                console.warn(`[targetProcess] ${cause} — retry ${attempt}/${MAX_ATTEMPTS - 1} for ${url}`);
                await delay(RETRY_BASE_MS * attempt);
                return this.fetchPage(url, attempt + 1);
            }
            throw new Error(
                `Target Process request failed after ${attempt} attempt(s) for ${url}: ${cause}`,
                { cause: error },
            );
        }

        if (!response.ok) {
            // Front Door token may have expired server-side; force one re-login.
            if (this.frontdoor && (response.status === 401 || response.status === 403) && attempt < MAX_ATTEMPTS) {
                console.warn(`[targetProcess] HTTP ${response.status} — refreshing Front Door token, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
                await this.ensureToken(true);
                await delay(RETRY_BASE_MS * attempt);
                return this.fetchPage(url, attempt + 1);
            }
            // Throttling / transient server errors are worth another attempt.
            if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
                console.warn(`[targetProcess] HTTP ${response.status} — retry ${attempt}/${MAX_ATTEMPTS - 1} for ${url}`);
                await delay(RETRY_BASE_MS * attempt);
                return this.fetchPage(url, attempt + 1);
            }
            const body = await response.text().catch(() => '');
            throw new Error(`Target Process ${response.status} ${response.statusText} for ${url}\n${body.slice(0, 500)}`);
        }
        return response.json();
    }

    /**
     * Retrieve every item of a resource, following pagination.
     * @param {string} resource - e.g. "Epics"
     * @param {object} [params]  - See {@link TargetProcess#buildUrl}.
     * @returns {Promise<Array<object>>} All items across all pages.
     */
    async retrieveAll(resource, params = {}) {
        const items = [];
        let url = this.buildUrl(resource, params);

        while (url) {
            const page = await this.fetchPage(url);
            if (Array.isArray(page.Items)) {
                items.push(...page.Items);
            }
            url = page.Next || null;
        }
        return items;
    }
}

module.exports = TargetProcess;
