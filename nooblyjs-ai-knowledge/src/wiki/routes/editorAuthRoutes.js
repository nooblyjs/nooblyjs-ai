/**
 * @fileoverview Browser-assisted sign-in for editor extensions (VS Code, Kiro).
 *
 * WHY THIS EXISTS
 *
 * An editor extension cannot complete Microsoft Entra SSO by itself: the flow is
 * a series of browser redirects ending in a session cookie, and an extension has
 * no browser and cannot read one. The standard answer — used by VS Code's own
 * GitHub authentication — is to hand the whole thing to the user's real browser
 * and get a token back through a custom-scheme redirect.
 *
 * The obvious shortcut, pointing the core's `?returnUrl=` straight at a
 * `vscode://` URI, does NOT work and should not be made to work:
 * `authAzure.sanitizeReturnUrl_` deliberately rejects anything that is not a
 * same-origin path, which is what stops the login flow becoming an open
 * redirect. So the browser lands back HERE, on a same-origin route, and this
 * route performs the hand-off.
 *
 * THE FLOW
 *
 *   1. Extension makes a random `verifier`, sends only `challenge` =
 *      base64url(sha256(verifier)) and opens the browser at /start.
 *   2. /start has no session yet, so it redirects into Entra
 *      (`/services/authservice/api/azure?returnUrl=<back to /start>`).
 *   3. Entra returns, the core establishes the passport session, and the
 *      browser arrives back at /start — this time authenticated.
 *   4. /start mints a bearer token, files it under a one-time `code`, and
 *      redirects to `<editor>://<extension id>/auth?code=…&state=…`.
 *   5. The extension exchanges `code` + `verifier` for the token at /exchange.
 *
 * WHY PKCE RATHER THAN PUTTING THE TOKEN IN THE REDIRECT
 *
 * A custom-scheme URI is not a private channel — another application on the
 * machine can register the same scheme. The redirect therefore carries only a
 * `code`, which is worthless without the `verifier` that never left the
 * extension. Whoever intercepts the redirect cannot exchange it.
 *
 * Codes are single-use and short-lived, and an exchange consumes the record
 * whether or not the verifier matched, so a wrong guess cannot be retried.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-27
 */

'use strict';

const crypto = require('node:crypto');

/** How long a code stays exchangeable. The real flow takes seconds. */
const CODE_TTL_MS = 5 * 60 * 1000;

/** Bearer token lifetime, matching /api/auth/extension-token. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Editors whose custom URI scheme we will redirect to.
 *
 * An allow-list rather than free choice: the code is useless without the
 * verifier, so this is defence in depth, but there is no reason to let a
 * crafted link bounce a signed-in user's browser into an arbitrary scheme.
 */
const ALLOWED_SCHEMES = new Set([
  'vscode',
  'vscode-insiders',
  'vscodium',
  'code-oss',
  'cursor',
  'kiro',
  'windsurf',
  'positron'
]);

/** The extension the redirect is allowed to name. */
const EXTENSION_ID = process.env.EDITOR_AUTH_EXTENSION_ID
  || 'noobly.noobly-knowledge-repository';

const START_PATH = '/api/auth/editor/start';

function base64UrlSha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('base64url');
}

/**
 * Reject anything that is not a plausible base64url token of sane length,
 * before it is used as a map key or compared against a hash.
 *
 * @param {*} value - candidate string
 * @param {number} min - shortest acceptable length
 * @return {boolean} whether the value is safe to use
 */
function isOpaqueToken(value, min = 20) {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= 512
    && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Pending hand-offs, keyed by code.
 *
 * In-process on purpose: the record lives for the few seconds between the
 * browser redirect and the extension's exchange call. Behind a load balancer
 * WITHOUT sticky sessions the two requests can land on different nodes and the
 * exchange will 400 — if that deployment shape is used, back this with the
 * shared cache service instead. It is deliberately not the core cache today
 * because that provider ignores the TTL argument, and a credential store that
 * silently never expires is worse than one that is node-local.
 */
const pending = new Map();

function sweepExpired() {
  const now = Date.now();
  for (const [code, record] of pending.entries()) {
    if (record.expiresAt <= now) pending.delete(code);
  }
}

module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { log } = services;
  const logger = log || console;

  const sweeper = setInterval(sweepExpired, 60 * 1000);
  if (typeof sweeper.unref === 'function') sweeper.unref();

  /**
   * Is Entra/Azure SSO configured on this deployment?
   *
   * Same test the core's own /sso-config uses, so the two can never disagree
   * about whether the button should be offered.
   *
   * @return {boolean} true when Entra is available
   */
  const ssoConfigured = () =>
    Boolean(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_TENANT_ID);

  /**
   * GET /api/auth/editor/config
   *
   * Public discovery, so an extension can show "Sign in with Microsoft" only
   * where it will actually work, and fall back to the password form otherwise.
   */
  app.get('/api/auth/editor/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      sso: {
        enabled: ssoConfigured(),
        provider: ssoConfigured() ? 'azure' : null,
        startPath: START_PATH
      },
      passwordLogin: true,
      extensionId: EXTENSION_ID
    });
  });

  /**
   * GET /api/auth/editor/start
   *
   * Entered twice: once unauthenticated (to bounce into Entra) and once with a
   * session (to mint the code). Both hits carry the same query string, which is
   * how the challenge survives the round trip without any server-side state.
   */
  app.get(START_PATH, async (req, res) => {
    const { challenge, state, scheme } = req.query || {};

    if (!isOpaqueToken(challenge, 32)) {
      return res.status(400).type('html').send(errorPage(
        'Missing sign-in challenge',
        'Start the sign-in from your editor rather than opening this link directly.'
      ));
    }

    const editorScheme = String(scheme || 'vscode').toLowerCase();
    if (!ALLOWED_SCHEMES.has(editorScheme)) {
      logger.warn(`[EditorAuth] Refused unknown editor scheme: ${editorScheme}`);
      return res.status(400).type('html').send(errorPage(
        'Unsupported editor',
        `This server does not recognise "${escapeHtml(editorScheme)}" as an editor it can hand a session back to.`
      ));
    }

    // Not signed in yet — send the browser through SSO and come back here.
    // returnUrl must be a same-origin PATH; the core rejects anything else.
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      const self = `${START_PATH}?${new URLSearchParams({
        challenge, scheme: editorScheme, ...(state ? { state } : {})
      }).toString()}`;

      if (ssoConfigured()) {
        const target = `/services/authservice/api/azure?returnUrl=${encodeURIComponent(self)}`;
        logger.info('[EditorAuth] No session — redirecting into Entra SSO.');
        return res.redirect(target);
      }

      // No SSO configured: send them to the normal login page, which will
      // return here once a session exists.
      return res.redirect(
        `/services/authservice/views/login.html?returnUrl=${encodeURIComponent(self)}`
      );
    }

    // Signed in. Mint a bearer token and file it under a one-time code.
    try {
      const user = req.user;
      const token = crypto.randomBytes(32).toString('base64url');
      const code = crypto.randomBytes(32).toString('base64url');

      if (global.bearerTokenMiddleware?.registerToken) {
        global.bearerTokenMiddleware.registerToken(token, user, TOKEN_TTL_MS);
      } else {
        logger.error('[EditorAuth] bearerTokenMiddleware unavailable — token would not validate.');
        return res.status(503).type('html').send(errorPage(
          'Sign-in unavailable',
          'The server could not issue a session token. Please try again shortly.'
        ));
      }

      sweepExpired();
      pending.set(code, {
        challenge,
        token,
        expiresAt: Date.now() + CODE_TTL_MS,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name || user.fullName,
          roles: Array.isArray(user.roles) ? user.roles : [user.role || 'user']
        }
      });

      const redirect = `${editorScheme}://${EXTENSION_ID}/auth?${new URLSearchParams({
        code, ...(state ? { state } : {})
      }).toString()}`;

      eventEmitter?.emit?.('auth:editor-handoff', {
        email: user.email, scheme: editorScheme
      });
      logger.info(`[EditorAuth] Handing a session to ${editorScheme} for ${user.email}.`);

      res.set('Cache-Control', 'no-store');
      return res.type('html').send(handoffPage(redirect, editorScheme));
    } catch (error) {
      logger.error(`[EditorAuth] Hand-off failed: ${error.message}`);
      return res.status(500).type('html').send(errorPage(
        'Sign-in failed',
        'Something went wrong completing the sign-in. Please try again.'
      ));
    }
  });

  /**
   * POST /api/auth/editor/exchange
   *
   * Body: { code, verifier }. Returns the bearer token exactly once.
   */
  app.post('/api/auth/editor/exchange', (req, res) => {
    res.set('Cache-Control', 'no-store');

    const { code, verifier } = req.body || {};

    if (!isOpaqueToken(code, 20) || !isOpaqueToken(verifier, 32)) {
      return res.status(400).json({ success: false, error: 'Invalid exchange request' });
    }

    const record = pending.get(code);
    // Consume on sight: a code gets exactly one attempt, right or wrong, so a
    // mismatched verifier cannot be retried against the same code.
    pending.delete(code);

    if (!record) {
      return res.status(400).json({ success: false, error: 'Unknown or already used code' });
    }

    if (record.expiresAt <= Date.now()) {
      return res.status(400).json({ success: false, error: 'Sign-in took too long — please try again' });
    }

    const expected = Buffer.from(record.challenge);
    const actual = Buffer.from(base64UrlSha256(verifier));
    const matches = expected.length === actual.length
      && crypto.timingSafeEqual(expected, actual);

    if (!matches) {
      logger.warn('[EditorAuth] Exchange rejected — verifier did not match the challenge.');
      return res.status(400).json({ success: false, error: 'Verifier did not match' });
    }

    logger.info(`[EditorAuth] Exchange completed for ${record.user.email}.`);
    return res.json({
      success: true,
      token: record.token,
      user: record.user,
      expiresIn: Math.floor(TOKEN_TTL_MS / 1000)
    });
  });

  logger.info?.('✓ Editor SSO hand-off registered at /api/auth/editor/*');
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * The page the browser lands on after SSO.
 *
 * It navigates to the custom scheme rather than the server issuing a 302: some
 * browsers refuse to follow a redirect into an unknown protocol, and a visible
 * page also gives the user a manual link when the automatic hop is blocked.
 */
function handoffPage(redirect, scheme) {
  const safe = escapeHtml(redirect);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signing you in…</title>
<meta name="referrer" content="no-referrer">
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#f2f4f5;
         color:#141b1c; display:flex; min-height:100vh; margin:0; align-items:center;
         justify-content:center; }
  .card { background:#fff; border:1px solid #d3dadb; border-radius:6px; padding:32px 36px;
          max-width:32rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { color:#4a5658; line-height:1.6; margin:.5rem 0; }
  a.btn { display:inline-block; margin-top:1rem; background:#0f6b64; color:#fff;
          text-decoration:none; padding:.6rem 1.1rem; border-radius:4px; font-weight:600; }
  code { background:#e9edee; padding:.1em .35em; border-radius:3px; font-size:.9em; }
</style>
</head>
<body>
  <div class="card">
    <h1>Signed in</h1>
    <p>Returning you to ${escapeHtml(scheme)}…</p>
    <p>If nothing happens, your browser may be blocking the hand-off.</p>
    <a class="btn" href="${safe}">Open ${escapeHtml(scheme)}</a>
    <p>You can close this tab once your editor reports that you are signed in.</p>
  </div>
  <script>
    // Assign rather than redirect server-side: an unknown protocol handler is
    // something the browser must decide to open, and it will only prompt for a
    // navigation it can attribute to the page.
    setTimeout(function () { window.location.href = ${JSON.stringify(redirect)}; }, 250);
  </script>
</body>
</html>`;
}

function errorPage(title, detail) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#f2f4f5;
         color:#141b1c; display:flex; min-height:100vh; margin:0; align-items:center;
         justify-content:center; }
  .card { background:#fff; border:1px solid #d3dadb; border-left:3px solid #a32220;
          border-radius:6px; padding:32px 36px; max-width:32rem; }
  h1 { font-size:1.15rem; margin:0 0 .5rem; }
  p { color:#4a5658; line-height:1.6; margin:0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
  </div>
</body>
</html>`;
}
