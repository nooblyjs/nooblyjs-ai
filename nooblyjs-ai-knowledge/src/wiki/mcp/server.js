/**
 * @fileoverview Builds the wiki's MCP server instance and registers its tools.
 *
 * One server is built **per request** (see mount.js) so the tool handlers can
 * close over that request's authenticated API client. That is cheap — building
 * a server is object construction, not I/O — and it means there is no session
 * table mapping MCP connections to users, and therefore nothing to leak between
 * them.
 *
 * The SDK is ESM-only (`"type": "module"`) and this backend is CommonJS, so it
 * is pulled in with a memoised dynamic `import()` rather than `require()`.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

'use strict';

const searchKnowledge = require('./tools/searchKnowledge');
const readDocument = require('./tools/readDocument');

const TOOLS = [searchKnowledge, readDocument];

const SERVER_INFO = {
  name: 'nooblyjs-ai-knowledge',
  version: '1.0.0'
};

/**
 * Server-level instructions.
 *
 * The host injects this once per session, which makes it the cheapest place to
 * put the workflow — cheaper than repeating it in every tool description. It is
 * the same discovery order the OpenAPI spec documents for human integrators:
 * find, then read.
 */
const INSTRUCTIONS = [
  'This server exposes the noobly Wiki wiki — the organisation\'s',
  'internal documentation, organised into spaces, folders and documents.',
  '',
  'Workflow: call search_knowledge first to find candidate documents, then',
  'read_document on the ones worth reading. Every search result carries the exact',
  'spaceId and path that read_document needs.',
  '',
  'Do not guess document paths — they are case-sensitive, `/` separated and relative',
  'to a space root. Always get them from a search result.',
  '',
  'Results are already scoped to what the authenticated user is allowed to see, so',
  'an empty result means "nothing you can read matched", not "nothing exists".',
  '',
  'When answering from these documents, cite the document title and path so the',
  'user can open the source.'
].join('\n');

/** Memoised — the SDK is loaded once per process, not per request. */
let sdkPromise = null;

const MCP_ENTRY = '@modelcontextprotocol/sdk/server/mcp.js';
const HTTP_ENTRY = '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * Load the MCP SDK pieces this module needs.
 *
 * The SDK is ESM-only and this backend is CommonJS. Node ≥22.12 can `require()`
 * an ESM module that has no top-level await — which this one does not — so the
 * synchronous path is tried first and dynamic `import()` is the fallback for
 * older runtimes.
 *
 * The order matters for the test suite, not just for old Node: Jest runs CJS in
 * its own VM where a dynamic `import()` needs `--experimental-vm-modules`, but
 * `require()` resolves through Jest's own registry and works untouched. Flipping
 * these two lines makes every test that builds a server fail.
 *
 * @returns {Promise<{McpServer: Function, StreamableHTTPServerTransport: Function}>}
 */
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      try {
        return {
          McpServer: require(MCP_ENTRY).McpServer,
          StreamableHTTPServerTransport: require(HTTP_ENTRY).StreamableHTTPServerTransport
        };
      } catch (error) {
        if (error.code !== 'ERR_REQUIRE_ESM') throw error;
        const [mcp, streamable] = await Promise.all([import(MCP_ENTRY), import(HTTP_ENTRY)]);
        return {
          McpServer: mcp.McpServer,
          StreamableHTTPServerTransport: streamable.StreamableHTTPServerTransport
        };
      }
    })();
  }
  return sdkPromise;
}

/**
 * Build a server bound to one request's API client.
 *
 * @param {Object} params
 * @param {Object} params.api - Client from `internalApi.forRequest(req)`
 * @param {Object} [params.log] - Logger
 * @returns {Promise<Object>} A connected-ready McpServer
 */
async function createKnowledgeServer({ api, log = console }) {
  const { McpServer } = await loadSdk();
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  const ctx = { api, log };

  for (const tool of TOOLS) {
    server.registerTool(tool.name, tool.config, async (args) => {
      try {
        return await tool.handler(args, ctx);
      } catch (error) {
        // A thrown handler would surface to the model as a protocol error with
        // no usable detail. Turn it into a tool-level error it can read and
        // decide about — while logging the real stack for us.
        // Log the STACK, not the error object — the platform logger serialises
        // an Error to its enumerable properties, which for most errors is just
        // `{code}` and tells you nothing about where it came from.
        log.error(`[Wiki MCP] Tool ${tool.name} failed: ${error.stack || error.message}`);
        return {
          isError: true,
          content: [{ type: 'text', text: `${tool.name} failed: ${error.message}` }]
        };
      }
    });
  }

  return server;
}

module.exports = { createKnowledgeServer, loadSdk, TOOLS, SERVER_INFO, INSTRUCTIONS };
