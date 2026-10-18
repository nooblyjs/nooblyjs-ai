// Tools teammates can be allowed, and the MCP servers behind some of them.
import { recorder } from '../utils/request.js';

export function toolsController({ tools, audit }) {
  const record = recorder(audit);
  return {
    async catalogue(req, res) {
      res.json({ tools: await tools.catalogue() });
    },
    async listServers(req, res) {
      res.json({ servers: await tools.listServers() });
    },
    async addServer(req, res) {
      const server = await tools.addServer(req.body ?? {});
      await record(req, 'mcp.create', server.id, { name: server.name, url: server.url });
      res.status(201).json(server);
    },
    async editServer(req, res) {
      const server = await tools.editServer(req.params.id, req.body ?? {});
      await record(req, 'mcp.update', server.id, { fields: Object.keys(req.body ?? {}).filter((k) => k !== 'authorization') });
      res.json(server);
    },
    async removeServer(req, res) {
      await tools.removeServer(req.params.id);
      await record(req, 'mcp.delete', req.params.id);
      res.status(204).end();
    },
    async checkServer(req, res) {
      res.json(await tools.checkServer(req.params.id));
    },
  };
}
