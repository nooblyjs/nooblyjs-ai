/**
 * @fileoverview Contain a client-supplied path inside a trusted base directory.
 *
 * The one correct answer to "did this join escape the folder I meant?".
 *
 * WHY NOT `startsWith`. Several handlers guarded a join with
 * `resolved.startsWith(baseDir)`. That is the exact weak form static analysis
 * flags (`datadog/javascript-pathtraversal`), and it is weak for two concrete
 * reasons:
 *
 *   1. NO SEPARATOR BOUNDARY. With `baseDir = /app/json`, the sibling
 *      `/app/json-secret/x` starts with the base string yet is a different
 *      directory. The check passes and the traversal succeeds.
 *   2. IT COMPARES UNNORMALISED STRINGS. A base captured with one separator
 *      style, or a resolved path with a trailing slash, drifts from the string
 *      it is tested against, so the check reads as false where it should be true
 *      (a denial-of-service on legitimate paths) or vice versa.
 *
 * The reliable test is the one `shared/spaces/spacePaths.js` already uses for
 * space-relative document paths: resolve both sides, take `path.relative(base,
 * target)`, and reject when it climbs out (`..` prefix) or is absolute. This
 * module is that test, extracted so every non-space filesystem route can share
 * one implementation instead of hand-rolling the weak form again.
 *
 * SCOPE. This guards the DIRECTORY containment of a path. It does NOT validate a
 * single file NAME's characters — use `fileNaming.sanitizeFileName` for that —
 * nor does it apply space VISIBILITY rules — use `spacePaths.resolveSpacePath`
 * when the base is a space content root.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-09-28
 */

'use strict';

const path = require('node:path');

/** Error code thrown when a path resolves outside its base directory. */
const PATH_ESCAPE = 'PATH_ESCAPE';

/**
 * Build the error thrown on containment failure.
 *
 * The message is deliberately generic — echoing the offending path back is the
 * information leak the traversal was trying to cause.
 *
 * @returns {Error} with `code: 'PATH_ESCAPE'`
 */
function escapeError() {
  const error = new Error('Access denied: path outside the permitted directory');
  error.code = PATH_ESCAPE;
  return error;
}

/**
 * Whether `target` resolves to a location inside (or equal to) `baseDir`.
 *
 * Pure predicate — no throw — for callers that want to branch rather than
 * catch. Both paths are resolved to absolute form first, so a relative
 * `baseDir` is interpreted against the process cwd exactly as `fs` would.
 *
 * @param {string} baseDir - the trusted root
 * @param {string} target - an already-resolved or relative candidate path
 * @returns {boolean}
 */
function isInside(baseDir, target) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  if (resolved === base) return true;
  const relative = path.relative(base, resolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolve `userPath` against `baseDir` and return the absolute path ONLY when it
 * stays inside `baseDir`; otherwise throw PATH_ESCAPE.
 *
 * This is the function to reach for at a route boundary: it replaces
 * `const p = path.join(baseDir, req.params.x)` plus a hand-rolled prefix check
 * with a single call that cannot be got wrong.
 *
 * An absolute `userPath` is treated as untrusted input, not honoured as-is:
 * `path.resolve(baseDir, '/etc/passwd')` would return `/etc/passwd`, so absolute
 * input is rejected up front rather than resolved.
 *
 * @param {string} baseDir - the trusted root the result must stay within
 * @param {string} userPath - the client-supplied, possibly hostile, sub-path
 * @returns {string} the contained absolute path
 * @throws {Error} with `code: 'PATH_ESCAPE'`
 */
function containedPath(baseDir, userPath) {
  const relativeInput = String(userPath == null ? '' : userPath);

  // Reject an absolute or drive-letter input outright: resolving it against the
  // base would discard the base entirely.
  if (path.isAbsolute(relativeInput) || /^[a-zA-Z]:/.test(relativeInput)) {
    throw escapeError();
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, relativeInput);

  if (!isInside(base, resolved) && resolved !== base) {
    throw escapeError();
  }
  return resolved;
}

/**
 * Map a containment failure onto an Express response. Returns true when handled,
 * so a caller can `if (handlePathError(res, err)) return;`.
 *
 * Answers 403 with no path detail. (Where hiding existence matters more than
 * signalling refusal, prefer `spacePaths.resolveSpacePath`, which 404s.)
 *
 * @param {Object} res - Express response
 * @param {Error} error
 * @returns {boolean}
 */
function handlePathError(res, error) {
  if (error && error.code === PATH_ESCAPE) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return true;
  }
  return false;
}

module.exports = {
  PATH_ESCAPE,
  isInside,
  containedPath,
  handlePathError
};
