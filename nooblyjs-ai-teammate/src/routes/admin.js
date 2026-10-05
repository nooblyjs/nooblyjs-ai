// Owner-only administration: API keys, the audit log, system status, and who has which role. People, passwords and
// roles are managed on nooblyjs-core's Authentication dashboard (/services/authservice/).
import express from 'express';
import { roleFromCore } from '../services/auth.js';

export function adminRouter({ auth, audit, repos, system, coreAuth }) {
  const r = express.Router();

  // nooblyjs-core services: cache, webhook queue, schedule check and metrics.
  r.get('/system', async (req, res) => res.json(await system.status()));

  r.get('/keys', async (req, res) => res.json({ keys: await auth.listKeys() }));

  r.post('/keys', async (req, res) => {
    const { name, teammates = '*', rateLimit = 30 } = req.body ?? {};
    if (Array.isArray(teammates)) {
      const known = new Set((await repos.teammates.list({ includeRetired: true })).map((t) => t.id));
      const unknown = teammates.filter((id) => !known.has(id));
      if (unknown.length) return res.status(422).json({ error: { code: 'validation_failed', message: `Unknown teammates: ${unknown.join(', ')}`, details: { teammates: 'Unknown teammate' } } });
    }
    const created = await auth.createKey({ name, teammates, rateLimit: Number(rateLimit) });
    await audit.record(req.actor, 'api_key.create', created.record.id, { name: created.record.name, teammates: created.record.teammates, rateLimit: created.record.rateLimit });
    res.status(201).json(created);
  });

  r.delete('/keys/:id', async (req, res) => {
    const revoked = await auth.revokeKey(req.params.id);
    await audit.record(req.actor, 'api_key.revoke', revoked.id, revoked.name);
    res.json(revoked);
  });

  r.get('/audit', async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '100', 10) || 100));
    res.json({ entries: await audit.list({ limit }) });
  });

  // People who can sign in (core's users) and the Teammates role each one gets from their core roles.
  r.get('/users', async (req, res) => {
    const users = (await coreAuth.listUsers()).map((u) => ({
      email: u.email, name: u.fullName || u.email, coreRoles: u.roles ?? [], role: roleFromCore(u.roles), active: u.isActive !== false, lastLogin: u.lastLogin ?? null,
    }));
    res.json({ users: users.sort((a, b) => a.name.localeCompare(b.name)) });
  });

  return r;
}
