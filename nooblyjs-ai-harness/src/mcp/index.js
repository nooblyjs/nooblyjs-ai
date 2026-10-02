// Phase 14: which MCP servers to start, and starting them.
//
//   .noobly/mcp.json     (this project; needs your trust once, see config/trust.js)
//   ~/.noobly/mcp.json   (you, every project)
//
//   {
//     "servers": {
//       "echo": { "command": "node", "args": ["test/fixtures/echo-mcp.js"] },
//       "git":  { "command": "uvx", "args": ["mcp-server-git"], "env": { "LOG_LEVEL": "error" } }
//     }
//   }
//
// ("mcpServers" is accepted as well, the name Claude Code's .mcp.json uses.)
// A server that fails to start is reported, never fatal.
import fs from 'node:fs';
import path from 'node:path';
import { nooblyHome } from '../util/paths.js';
import { adaptMcpTool } from './adapter.js';
import { McpClient } from './client.js';

/** @returns {{ user: object, project: object, warnings: string[] }} servers by name, per scope */
export function loadMcpConfig(cwd, { env = process.env } = {}) {
  const warnings = [];
  const read = (file) => {
    if (!fs.existsSync(file)) return {};
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const servers = json.servers ?? json.mcpServers ?? {};
      for (const [name, server] of Object.entries(servers)) {
        if (typeof server?.command !== 'string') {
          warnings.push(`${file}: server "${name}" has no "command" (ignored).`);
          delete servers[name];
        }
      }
      return servers;
    } catch (error) {
      warnings.push(`${file}: not valid JSON (${error.message}). Ignoring it.`);
      return {};
    }
  };
  return {
    user: read(path.join(nooblyHome(env), 'mcp.json')),
    project: read(path.join(cwd, '.noobly', 'mcp.json')),
    warnings,
  };
}

/**
 * Start every server (in parallel) and list their tools.
 * @returns {Promise<{ servers: Array<{ name, status: 'connected' | 'failed', error?, tools: object[], client, scope }>, tools: object[], close: () => void }>}
 */
export async function connectMcpServers(configs, { cwd, clientVersion, timeoutMs = 30_000 } = {}) {
  const servers = await Promise.all(
    Object.entries(configs).map(async ([name, config]) => {
      const client = new McpClient({ name, command: config.command, args: config.args, env: config.env, cwd, clientVersion });
      try {
        await client.start({ timeoutMs });
        const tools = (await client.listTools()).map((tool) => adaptMcpTool(client, tool));
        return { name, scope: config.scope, status: 'connected', tools, client };
      } catch (error) {
        client.close();
        return { name, scope: config.scope, status: 'failed', error: error.message, tools: [], client };
      }
    }),
  );
  return {
    servers,
    tools: servers.flatMap((server) => server.tools),
    close: () => servers.forEach((server) => server.client.close()),
  };
}
