// Owner-only administration: API keys, the audit log, system status, and who has which role. People and their
// access roles belong to the host (NooblyJS); this app only reads them (host.people).
import { roleFromAccess } from '../services/auth.js';

export function adminController({ auth, audit, repos, system, people }) {
  return {
    // nooblyjs-core services: cache, webhook queue, schedule check and metrics.
    async system(req, res) {
      res.json(await system.status());
    },

    async listKeys(req, res) {
      res.json({ keys: await auth.listKeys() });
    },

    async createKey(req, res) {
      const { name, teammates = '*', rateLimit = 30 } = req.body ?? {};
      if (Array.isArray(teammates)) {
        const known = new Set((await repos.teammates.list({ includeRetired: true })).map((t) => t.id));
        const unknown = teammates.filter((id) => !known.has(id));
        if (unknown.length) return res.status(422).json({ error: { code: 'validation_failed', message: `Unknown teammates: ${unknown.join(', ')}`, details: { teammates: 'Unknown teammate' } } });
      }
      const created = await auth.createKey({ name, teammates, rateLimit: Number(rateLimit) });
      await audit.record(req.actor, 'api_key.create', created.record.id, { name: created.record.name, teammates: created.record.teammates, rateLimit: created.record.rateLimit });
      res.status(201).json(created);
    },

    async revokeKey(req, res) {
      const revoked = await auth.revokeKey(req.params.id);
      await audit.record(req.actor, 'api_key.revoke', revoked.id, revoked.name);
      res.json(revoked);
    },

    async audit(req, res) {
      const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '100', 10) || 100));
      res.json({ entries: await audit.list({ limit }) });
    },

    // People who can sign in (the host's) and the Teammates role each one gets from their access role.
    async users(req, res) {
      const users = (await people.list()).map((p) => ({
        email: p.email ?? p.id, name: p.name || p.email || p.id, accessRole: p.accessRole ?? null, role: roleFromAccess(p.accessRole), active: p.active !== false, lastLogin: p.lastLogin ?? null,
      }));
      res.json({ users: users.sort((a, b) => a.name.localeCompare(b.name)) });
    },
  };
}
