/**
 * @fileoverview Wiki MCP endpoint — Model Context Protocol over Streamable HTTP.
 *
 * Mounted next to the OpenAPI spec so the two sit together:
 *
 *   GET  /applications/wiki/api/swagger/openapi.json   the description (for developers)
 *   POST /applications/wiki/api/mcp                    the connection  (for AI clients)
 *   GET  /applications/wiki/api/mcp/info               discovery: what this server offers
 *
 * **Stateless by choice.** `sessionIdGenerator: undefined` means no session id
 * is issued and none is validated, so a fresh server + transport is built per
 * request and torn down with it. The alternative keeps connection state in
 * process memory, which would require sticky sessions the moment this runs on
 * more than one node — and buys nothing, because neither tool pushes to the
 * client.
 *
 * **Auth.** MCP clients send `Authorization: Bearer <dtk_ token>`, which the
 * global bearer middleware has already validated by the time this handler runs.
 * We re-check `req.isAuthenticated()` here because that middleware deliberately
 * passes an invalid token through unauthenticated rather than rejecting it
 * (bearerTokenMiddleware.js) — without this gate an expired token would not
 * fail, it would quietly report an empty wiki, which is a far worse bug.
 *
 * Kill switch: `WIKI_MCP_ENABLED=false`.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

'use strict';

const internalApi = require('./internalApi');
const { createKnowledgeServer, loadSdk, TOOLS, SERVER_INFO } = require('./server');

const MCP_PATH = '/applications/wiki/api/mcp';

/**
 * JSON-RPC shaped error, so an MCP client renders something useful rather than
 * "unexpected response".
 *
 * @param {Object} res
 * @param {number} status
 * @param {number} code - JSON-RPC error code
 * @param {string} message
 */
function rpcError(res, status, code, message) {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Register the MCP routes.
 *
 * @param {Object} options - `{ app }`
 * @param {Object} eventEmitter
 * @param {Object} services - Core services (`log`, …)
 * @returns {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const log = services.log || services.logger || console;

  if (String(process.env.WIKI_MCP_ENABLED || 'true').toLowerCase() === 'false') {
    log.info('○ Wiki MCP endpoint disabled (WIKI_MCP_ENABLED=false)');
    return;
  }

  /**
   * Discovery endpoint — deliberately public, exactly like the OpenAPI spec.
   *
   * It advertises what this server offers and how to connect, and nothing about
   * the content behind it. Everything here is already in the published API
   * documentation.
   */
  app.get(`${MCP_PATH}/info`, (req, res) => {
    res.json({
      ...SERVER_INFO,
      protocol: 'mcp',
      transport: 'streamable-http',
      endpoint: `${req.protocol}://${req.get('host')}${MCP_PATH}`,
      authentication: {
        scheme: 'bearer',
        description: 'Send Authorization: Bearer <dtk_ token>. Mint one in the wiki under Profile → API Tokens.'
      },
      tools: TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.config.title,
        description: tool.config.description
      }))
    });
  });

  /**
   * The MCP endpoint itself.
   *
   * POST carries every client→server JSON-RPC message. GET (server→client SSE)
   * and DELETE (session teardown) are handed to the transport too, which
   * answers them correctly for a stateless server rather than us guessing at
   * the right status codes.
   */
  const handleMcp = async (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      // RFC 6750: tell the client HOW to authenticate, not just that it failed.
      res.setHeader('WWW-Authenticate', 'Bearer realm="noobly Wiki"');
      return rpcError(
        res,
        401,
        -32001,
        'Authentication required. Send Authorization: Bearer <dtk_ token> — mint one under Profile → API Tokens.'
      );
    }

    let server;
    let transport;

    try {
      const { StreamableHTTPServerTransport } = await loadSdk();

      server = await createKnowledgeServer({
        api: internalApi.forRequest(req),
        log
      });

      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      // Tear down with the response. Without this, an aborted client leaves the
      // transport holding the socket.
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      // req.body is already parsed by the global bodyParser.json, so it is
      // passed explicitly — the transport must not try to read the stream again.
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error(`[Wiki MCP] Request failed: ${error.message}`, error);
      if (!res.headersSent) {
        rpcError(res, 500, -32603, `Internal error: ${error.message}`);
      }
      transport?.close().catch(() => {});
      server?.close().catch(() => {});
    }
  };

  app.post(MCP_PATH, handleMcp);
  app.get(MCP_PATH, handleMcp);
  app.delete(MCP_PATH, handleMcp);

  log.info(`✓ Wiki MCP endpoint registered at ${MCP_PATH} (${TOOLS.length} tools)`);
};
