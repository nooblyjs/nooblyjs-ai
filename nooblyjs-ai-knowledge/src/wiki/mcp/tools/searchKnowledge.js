/**
 * @fileoverview MCP tool: search_knowledge — the front door to the wiki.
 *
 * Wraps `GET /applications/wiki/api/search`, which returns a bare array of hits
 * carrying `{title, path, spaceId, spaceName, snippet, ...}` — enough for the
 * model to decide what to read without a second round trip.
 *
 * Two deliberate departures from the HTTP endpoint's defaults:
 *
 * - **`limit` defaults to 10, capped at 50.** The endpoint itself defaults to
 *   200, which is right for a UI that paginates and catastrophic for a context
 *   window.
 * - **`includeContent` is never set.** It appends a body to *every* hit, so a
 *   10-result search would drop ten documents into the transcript before the
 *   model has decided any of them are relevant. Reading is `read_document`'s
 *   job, and it only happens for what the model actually picked.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

'use strict';

const { z } = require('zod');

/** Snippets arrive match-centered and can still run long on a dense page. */
const MAX_SNIPPET_CHARS = 400;

const DESCRIPTION = [
  'Full-text search across the knowledge wiki. START HERE for any question about',
  'the organisation\'s documentation — it is far cheaper than browsing folders,',
  'and every result carries the exact `spaceId` + `path` needed to read it.',
  '',
  'Returns a ranked list with a match-centered snippet per hit. Read the snippets',
  'first; call read_document only for the ones that actually look relevant.',
  '',
  'Searches every space the caller can see unless `spaceId` is given. Results are',
  'already filtered to what this user is allowed to read.'
].join('\n');

/**
 * Strip the search engine's `<mark>` highlighting.
 *
 * The tags mark where the term hit, which is useful to a UI and noise to a
 * model — it cannot click them, and they cost tokens on every result. The
 * snippet stays match-centered either way, which is the part that carries value.
 *
 * @param {string} snippet
 * @returns {string}
 */
function cleanSnippet(snippet) {
  const text = String(snippet || '')
    .replace(/<\/?mark>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS)}…` : text;
}

/**
 * Reduce one API hit to the fields a model can act on.
 *
 * Everything dropped here (facet axes, tags, relevance, size, id) exists for the
 * search UI's filter rail. None of it changes what the model does next, and all
 * of it costs tokens on every result.
 *
 * @param {Object} hit
 * @returns {Object}
 */
function shapeResult(hit) {
  const shaped = {
    title: hit.title || hit.path,
    spaceId: hit.spaceId,
    spaceName: hit.spaceName,
    path: hit.path,
    type: hit.type || undefined,
    modifiedAt: hit.modifiedAt || undefined
  };

  // Prefer the match-centered snippet; fall back to the static excerpt only when
  // the engine did not produce one (non-local search providers).
  const snippet = cleanSnippet(hit.snippet || hit.excerpt);
  if (snippet) shaped.snippet = snippet;

  return shaped;
}

const config = {
  title: 'Search the knowledge wiki',
  description: DESCRIPTION,
  inputSchema: {
    query: z
      .string()
      .min(1)
      .describe(
        'Search terms. Wrap a phrase in double quotes for an exact adjacent match, e.g. "payment gateway".'
      ),
    spaceId: z
      .number()
      .int()
      .optional()
      .describe('Restrict to one space. Omit to search everything the caller can see.'),
    fileTypes: z
      .string()
      .optional()
      .describe(
        'Comma-separated file types to restrict to, e.g. "markdown" or "markdown,pdf". Omit for all types.'
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum results to return. Keep this small; 10 is usually plenty.')
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: true
  }
};

/**
 * Execute the tool.
 *
 * @param {Object} args - Validated tool arguments
 * @param {Object} ctx - `{ api }` bound to the incoming MCP request
 * @returns {Promise<Object>} MCP CallToolResult
 */
async function handler(args, ctx) {
  const params = new URLSearchParams({ q: args.query, limit: String(args.limit ?? 10) });
  if (args.spaceId != null) params.set('spaceId', String(args.spaceId));
  if (args.fileTypes) params.set('fileTypes', args.fileTypes);

  const response = await ctx.api.get(`/applications/wiki/api/search?${params}`);

  if (response.status === 401) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Not authenticated. The API token is missing, expired or revoked — mint a new one in the wiki under Profile → API Tokens.'
        }
      ]
    };
  }

  if (response.status !== 200) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Search failed (HTTP ${response.status}).` }]
    };
  }

  // The endpoint answers with a bare array, and swallows its own errors into an
  // empty one — so "no results" and "search is broken" look identical here. Say
  // only what is true.
  const hits = Array.isArray(response.json) ? response.json : [];

  if (hits.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No documents matched "${args.query}". Try broader or different terms, or drop the spaceId filter if one was set.`
        }
      ]
    };
  }

  const results = hits.map(shapeResult);

  return {
    content: [
      {
        type: 'text',
        text:
          `${results.length} result(s) for "${args.query}".\n` +
          'Read one with read_document using its spaceId and path.\n\n' +
          JSON.stringify(results, null, 1)
      }
    ]
  };
}

module.exports = { name: 'search_knowledge', config, handler, cleanSnippet, shapeResult };
