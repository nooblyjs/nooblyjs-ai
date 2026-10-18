// CSRF protection with a double-submit cookie (tech.md §4.3). The `noobly.csrf` cookie holds a random token that
// the page can read; every non-GET request must send the same value in the X-CSRF-Token header or a `_csrf`
// form field. A cross-site page can make the browser send the cookie but can't read it, so it can't send the match.
// nooblyjs-core's /services routes are registered before this middleware and keep their own protection.
import crypto from 'node:crypto';
import { sendError, wantsJson } from '../util/errors.js';

export const CSRF_COOKIE = 'noobly.csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN = /^[A-Za-z0-9_-]{32,}$/;

export function readCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in cookies)) cookies[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** `skip(req)` names the requests that prove themselves another way (the Teams bot endpoint: a signed token). */
export function csrf({ secure = false, skip = null } = {}) {
  return (req, res, next) => {
    let token = readCookies(req.headers.cookie)[CSRF_COOKIE];
    if (!TOKEN.test(token ?? '')) {
      token = crypto.randomBytes(32).toString('base64url');
      res.cookie(CSRF_COOKIE, token, { path: '/', sameSite: 'strict', secure, httpOnly: false });
    }
    req.csrfToken = token;
    if (SAFE.has(req.method) || skip?.(req)) return next();
    const sent = req.get('x-csrf-token') ?? req.body?._csrf;
    if (same(sent, token)) return next();
    res.locals.audit = { action: 'csrf.refused', reason: 'missing or wrong CSRF token' };
    if (wantsJson(req)) return sendError(res, 403, 'csrf_failed', 'This request is missing its CSRF token. Reload the page and try again.');
    res.status(403).type('text').send('This form expired. Go back, reload the page and try again.');
  };
}
