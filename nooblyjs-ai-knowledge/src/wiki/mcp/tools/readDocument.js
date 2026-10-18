/**
 * @fileoverview MCP tool: read_document — read one document's text by path.
 *
 * Wraps `GET /applications/wiki/api/spaces/:spaceId/file-content/:documentPath`,
 * whose response shape depends on the file policy (see the filePolicy notes in
 * CLAUDE.md):
 *
 * - **markdown / code / text / data** → JSON `{success, content, path, metadata}`.
 * - **office (docx/xlsx)** → JSON too, already serving the derived markdown
 *   sidecar, with `metadata.derivedFrom` set. Nothing extra to do.
 * - **pdf / image / video / audio** → RAW BYTES with a binary content-type.
 *
 * That last case is the one that matters. A PDF's text only reaches a reader
 * through its derived sidecar (`<folder>/.system/derived/<name>.pdf.md`) — the
 * same artefact search indexes it by — so rather than hand the model a Buffer it
 * cannot use, we fall back to `GET /applications/wiki/api/documents/derived`,
 * which addresses the sidecar by the ORIGINAL's path. That endpoint keys off
 * `spaceName` rather than `spaceId`, hence the small id→name resolution below.
 *
 * Images, video and audio have no sidecar and never will; they get an honest
 * message instead of a wall of base64.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

'use strict';

const { z } = require('zod');
const { encodePath } = require('../internalApi');

/**
 * Default read window, in characters (~10k tokens).
 *
 * Documents in this wiki run long — a landscape inventory or a generated code
 * doc can be hundreds of KB. Returning one whole is how an MCP server fills a
 * context window with a single call, so the window is capped and paged rather
 * than silently truncated: the response always says when there is more and how
 * to ask for it.
 */
const DEFAULT_MAX_CHARS = 40000;
const HARD_MAX_CHARS = 200000;

/** File policies whose bytes are binary and whose text lives in a sidecar. */
const SIDECAR_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls']);

/** Binary assets with no text representation at all. */
const OPAQUE_PREFIXES = ['image/', 'video/', 'audio/'];

const DESCRIPTION = [
  'Read the text of one wiki document, addressed by `spaceId` + `path`.',
  '',
  'Get both from a search_knowledge result — do not guess a path; they are',
  'case- and separator-sensitive and relative to the space root.',
  '',
  'PDFs and office documents return their extracted text automatically. Long',
  'documents are returned in windows: if the response says it was truncated,',
  'call again with `offset` set to continue from there.'
].join('\n');

/**
 * Resolve a space id to its display name.
 *
 * Only needed for the derived-sidecar fallback, so it is done lazily — most
 * reads are markdown and never pay for it.
 *
 * @param {Object} ctx - `{ api }`
 * @param {number} spaceId
 * @returns {Promise<string|null>}
 */
async function resolveSpaceName(ctx, spaceId) {
  const response = await ctx.api.get('/applications/wiki/api/spaces');
  if (response.status !== 200 || !Array.isArray(response.json)) return null;
  const space = response.json.find((entry) => String(entry.id) === String(spaceId));
  return space ? space.name : null;
}

/**
 * Apply the read window and describe what was cut.
 *
 * @param {string} content
 * @param {number} offset
 * @param {number} maxChars
 * @returns {{text: string, truncated: boolean, notice: string}}
 */
function windowContent(content, offset, maxChars) {
  const full = String(content || '');
  const start = Math.min(offset, full.length);
  const slice = full.slice(start, start + maxChars);
  const end = start + slice.length;
  const truncated = end < full.length;

  let notice = '';
  if (truncated) {
    notice =
      `\n\n--- Truncated at character ${end} of ${full.length}. ` +
      `Call read_document again with offset=${end} to continue. ---`;
  } else if (start > 0) {
    notice = `\n\n--- End of document (characters ${start}–${end} of ${full.length}). ---`;
  }

  return { text: slice, truncated, notice };
}

/**
 * Build the successful tool result for a body of text.
 *
 * @param {Object} params
 * @returns {Object} MCP CallToolResult
 */
function textResult({ path, spaceId, content, offset, maxChars, source }) {
  const { text, notice } = windowContent(content, offset, maxChars);

  if (!text.trim() && offset === 0) {
    return {
      content: [
        {
          type: 'text',
          text:
            `${path} (space ${spaceId}) is empty${source === 'derived' ? ' — no text has been extracted from it yet' : ''}.`
        }
      ]
    };
  }

  const header =
    source === 'derived'
      ? `# ${path} (space ${spaceId}) — extracted text\n\n`
      : `# ${path} (space ${spaceId})\n\n`;

  return { content: [{ type: 'text', text: header + text + notice }] };
}

const config = {
  title: 'Read a wiki document',
  description: DESCRIPTION,
  inputSchema: {
    spaceId: z.number().int().describe('Space id, as returned by search_knowledge.'),
    path: z
      .string()
      .min(1)
      .describe('Document path relative to the space root, `/` separated, e.g. "Platform/Streaming/kafka.md".'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Character offset to start reading from. Use the value the previous truncated response reported.'),
    maxChars: z
      .number()
      .int()
      .min(500)
      .max(HARD_MAX_CHARS)
      .default(DEFAULT_MAX_CHARS)
      .describe('Maximum characters to return in this window.')
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
  const { spaceId, path: documentPath } = args;
  const offset = args.offset ?? 0;
  const maxChars = args.maxChars ?? DEFAULT_MAX_CHARS;

  const encoded = encodePath(documentPath);
  const response = await ctx.api.get(
    `/applications/wiki/api/spaces/${encodeURIComponent(spaceId)}/file-content/${encoded}`
  );

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

  // A curated-away path answers 404 by design (a 403 would confirm the document
  // exists, which is exactly what the curation hides). So these two are one
  // message to the model: it cannot tell them apart, and neither can we.
  if (response.status === 404 || response.status === 403) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `No readable document at "${documentPath}" in space ${spaceId}. ` +
            'It may not exist, or this space may not expose it. ' +
            'Use search_knowledge to find the correct spaceId and path.'
        }
      ]
    };
  }

  // Text-ish document: the endpoint already did the right thing, including
  // serving an office document's derived markdown.
  if (response.json && response.json.success) {
    return textResult({
      path: documentPath,
      spaceId,
      content: response.json.content,
      offset,
      maxChars,
      source: response.json.metadata && response.json.metadata.derivedFrom ? 'derived' : 'original'
    });
  }

  // Raw bytes. Anything with no text representation stops here.
  if (OPAQUE_PREFIXES.some((prefix) => response.contentType.startsWith(prefix))) {
    return {
      content: [
        {
          type: 'text',
          text:
            `"${documentPath}" is a binary asset (${response.contentType}) with no text to read. ` +
            'It can be downloaded via the wiki download endpoint, but its contents cannot be summarised here.'
        }
      ]
    };
  }

  // PDF (and any other sidecar-backed policy): read the extracted text instead.
  const extension = documentPath.slice(documentPath.lastIndexOf('.')).toLowerCase();
  if (SIDECAR_EXTENSIONS.has(extension) || response.contentType.includes('pdf')) {
    const spaceName = await resolveSpaceName(ctx, spaceId);
    if (!spaceName) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Could not resolve space ${spaceId} to read extracted text.` }]
      };
    }

    const params = new URLSearchParams({ path: documentPath, spaceName });
    const derived = await ctx.api.get(`/applications/wiki/api/documents/derived?${params}`);

    if (derived.status === 200 && derived.json && derived.json.exists) {
      return textResult({
        path: documentPath,
        spaceId,
        content: derived.json.content,
        offset,
        maxChars,
        source: 'derived'
      });
    }

    return {
      content: [
        {
          type: 'text',
          text:
            `"${documentPath}" is a ${extension.replace('.', '').toUpperCase()} whose text has not been extracted yet, ` +
            'so there is nothing to read. An administrator can generate it by rebuilding the search index ' +
            '(POST /applications/wiki/api/search/rebuild).'
        }
      ]
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Could not read "${documentPath}" (HTTP ${response.status}, content-type ${response.contentType || 'unknown'}).`
      }
    ]
  };
}

module.exports = {
  name: 'read_document',
  config,
  handler,
  windowContent,
  resolveSpaceName,
  DEFAULT_MAX_CHARS
};
