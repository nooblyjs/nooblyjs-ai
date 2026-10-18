/**
 * @fileoverview Server-side visit capture for document READS.
 *
 * WHY THIS EXISTS. A visit used to be recorded in exactly one place: the browser
 * (and the Chrome extension) calling `POST /applications/wiki/api/user/visit`
 * after a human opened a document. That misses every read that does NOT go
 * through those UIs:
 *
 *   • MCP — `read_document` reads `GET .../file-content/:path` AS THE REAL USER
 *     (their bearer token is forwarded, see mcp/internalApi.js) but never posts a
 *     visit. A person consuming a document through an agent is real usage, and it
 *     was invisible to the tally.
 *   • Any direct API consumer holding a `dtk_` token, likewise.
 *
 * ...while NOT counting the one reader we deliberately want silent:
 *
 *   • The sync daemon mirrors whole spaces through a different route family
 *     entirely — `/services/filing/api/:instance/download/*` — so it never
 *     touches `file-content` and is excluded here BY CONSTRUCTION, not by luck.
 *
 * WHAT THIS RECORDS, AND WHERE. Only the per-day usage TALLY (visitTally.js),
 * never the `recent` list. `recent` is a UI "jump back to what you were reading"
 * feature owned by the browser; letting an MCP/API read push entries into a
 * person's browser jump-list would be wrong. The tally is just counts, so
 * incrementing it from the read path is cheap and is exactly the "how much did
 * they use it" signal the tally was built for.
 *
 * READS ARE ALWAYS 'viewed'. An edit is a distinct explicit action on a
 * different endpoint; reading a document's content is a view by definition.
 *
 * BEST EFFORT, LIKE POST /user/visit. A counter that cannot be written must
 * never fail the read it was counting — every path here swallows its own error
 * and warns, matching userRoutes' visit handler.
 *
 * OPT-OUT. A caller that reads `file-content` for bulk/automation purposes and
 * does NOT want to be counted (a future indexer, a crawler) can send
 * `X-DTK-No-Visit: 1`. There is no opt-out for the daemon because the daemon
 * does not use this endpoint at all.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-09-15
 */

'use strict';

const visitTally = require('./visitTally');
const spaceUserStore = require('./spaceUserStore');

/** Request header a bulk/automation caller sets to stay out of the tally. */
const OPT_OUT_HEADER = 'x-dtk-no-visit';

/**
 * Viewer types that represent a document a person actually READ.
 *
 * Deliberately excludes 'download' (raw bytes, no reading happened — that branch
 * of file-content serves office/zip/unknown binaries as a download offer) and
 * the binary viewers (image/video/audio), which are assets embedded in a page,
 * not documents opened to be read. Markdown/code/text/data/web are the readable
 * ones; an office document served as its derived markdown sidecar arrives as
 * 'markdown' and so is counted, which is correct — its text was returned.
 */
const READABLE_VIEWERS = new Set(['markdown', 'code', 'text', 'data', 'web']);

/**
 * Identity a read is attributed to: the caller's email when authenticated
 * (session OR bearer token — both populate req.user), else null.
 *
 * Returns null rather than 'anonymous' on purpose: an unauthenticated read of a
 * public space is not a signal the usage screen wants (it cannot be attributed
 * to anyone and would only inflate the 'anonymous' bucket with crawler noise).
 * POST /user/visit keys anonymous activity because it also drives that reader's
 * own `recent` list in their browser session; a server-side tally has no such
 * reason to.
 *
 * @param {Object} req - Express request
 * @return {string|null} email, or null when the read should not be tallied
 */
function identityForRead(req) {
  if (typeof req.isAuthenticated === 'function' && req.isAuthenticated() && req.user && req.user.email) {
    return req.user.email;
  }
  return null;
}

/**
 * Should this read be counted at all?
 *
 * @param {Object} req - Express request
 * @param {string} viewerType - the viewer the file-content handler resolved
 * @return {boolean}
 */
function shouldRecord(req, viewerType) {
  if (!READABLE_VIEWERS.has(viewerType)) return false;
  // Explicit bulk/automation opt-out.
  const header = req.get ? req.get(OPT_OUT_HEADER) : (req.headers && req.headers[OPT_OUT_HEADER]);
  if (header && String(header).trim() && String(header).trim() !== '0' && String(header).trim().toLowerCase() !== 'false') {
    return false;
  }
  return Boolean(identityForRead(req));
}

/**
 * Count a document read in the per-day usage tally. Never throws.
 *
 * Resolves the space's CONTENT ROOT (per-user artefacts are per content root,
 * exactly like activity.json and visits.json) and records one 'viewed'. Silent
 * when the read should not be counted (see shouldRecord) so callers can call it
 * unconditionally from the read's success branch.
 *
 * @param {Object} params
 * @param {Object} params.req - Express request the read arrived on
 * @param {Object} params.space - the resolved space record
 * @param {string} params.viewerType - the viewer type the handler resolved
 * @param {string} params.appBaseDir - app base dir (for space fallback resolution)
 * @param {Object} [params.log] - logger; warns on a failed tally, never throws
 * @return {Promise<void>}
 */
async function record({ req, space, viewerType, appBaseDir, log = console }) {
  try {
    if (!shouldRecord(req, viewerType)) return;

    const identity = identityForRead(req);
    if (!identity) return;

    // Prefer the space record already resolved by the handler; fall back to the
    // request's space hint only if a record was not passed. Either way the tally
    // is keyed by the CONTENT ROOT, shared by every space sitting on it.
    const resolved = space
      || await spaceUserStore.resolveSpace(appBaseDir, spaceUserStore.spaceOf(req));
    const rootDir = spaceUserStore.spaceContentDir(resolved);
    if (!rootDir) return;

    await visitTally.record(rootDir, identity, 'viewed');
  } catch (error) {
    // Best effort by design: a read must not fail because its counter could not
    // be written. Mirrors POST /user/visit's tally handling.
    if (log && typeof log.warn === 'function') {
      log.warn(`[ReadVisit] Could not update the usage tally: ${error.message}`);
    }
  }
}

module.exports = {
  OPT_OUT_HEADER,
  READABLE_VIEWERS,
  identityForRead,
  shouldRecord,
  record
};
