// Owner-only administration: people and roles, API keys, password, sessions and the audit log.
import express from 'express';
import { sessionCookie, clearSessionCookie, isSecureRequest } from '../middleware/auth.js';

export function adminRouter({ auth, audit, repos, cookieSecure = false }) {
  const r = express.Router();

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

  // People and roles
  r.get('/users', async (req, res) => res.json({ users: await auth.listUsers() }));
  r.post('/users', async (req, res) => {
    const { user, password } = await auth.createUser(req.body ?? {});
    await audit.record(req.actor, 'user.create', user.username, { role: user.role });
    res.status(201).json({ user, password });
  });
  r.patch('/users/:id', async (req, res) => {
    const user = await auth.updateUser(req.params.id, req.body ?? {}, req.actor);
    await audit.record(req.actor, 'user.update', user.username, { fields: Object.keys(req.body ?? {}), role: user.role, disabled: Boolean(user.disabledAt) });
    res.json(user);
  });
  r.post('/users/:id/reset-password', async (req, res) => {
    const { user, password } = await auth.resetPassword(req.params.id);
    await audit.record(req.actor, 'user.password_reset', user.username);
    res.json({ user, password });
  });

  r.post('/password', async (req, res) => {
    const session = await auth.changePassword(req.actor.id, req.body?.current, req.body?.next);
    res.set('Set-Cookie', sessionCookie(session.token, { maxAgeMs: session.maxAgeMs, secure: isSecureRequest(req, cookieSecure) }));
    await audit.record(req.actor, 'owner.password_change');
    res.json({ csrf: session.csrf });
  });

  r.post('/sign-out-everywhere', async (req, res) => {
    await auth.signOutEverywhere();
    res.set('Set-Cookie', clearSessionCookie({ secure: isSecureRequest(req, cookieSecure) }));
    await audit.record(req.actor, 'session.sign_out_everywhere');
    res.status(204).end();
  });

  return r;
}
