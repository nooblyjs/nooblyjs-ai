/**
 * @fileoverview Who may do what with the Knowledge routes (NooblyJS Phase 8).
 *
 * Hosted in NooblyJS, the answer comes from NooblyJS's permissions matrix through the
 * host (`host.can(accessRole, permission)`): the wiki decides nothing itself.
 * An agent is refused every write whatever its access role allows: agents
 * propose, people decide. Standalone there is no matrix, so a write needs a
 * signed-in user and the two administrative actions need the `admin` role.
 *
 *   draft                answer actions (add to item, this is wrong)
 *   approve              marking a flagged document as reviewed
 *   change-repo-access   importing a source (an Owner's permission in NooblyJS)
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const { rolesOf } = require('../components/spacePermissions');

const ADMIN_STANDALONE = new Set(['approve', 'change-repo-access']);

/**
 * @param {Object|null} host - the NooblyJS host when hosted, else null
 * @return {{ check: Function, actor: Function, record: Function }}
 */
function createAccess(host) {
  /**
   * @param {Object} req
   * @param {string} permission
   * @return {Promise<{ ok: boolean, status?: number, message?: string }>}
   */
  async function check(req, permission) {
    if (!req.isAuthenticated || !req.isAuthenticated()) return { ok: false, status: 401, message: 'Not authenticated' };
    if (host) {
      const person = req.person;
      if (!person) return { ok: false, status: 401, message: 'Not authenticated' };
      if (person.kind === 'agent') return { ok: false, status: 403, message: 'Agents propose and people decide: an agent cannot do this.' };
      const allowed = typeof host.can === 'function' && await host.can(person.accessRole, permission);
      return allowed ? { ok: true } : { ok: false, status: 403, message: `This needs the ${permission} permission. Your access role is ${person.accessRole || 'none'}.` };
    }
    if (ADMIN_STANDALONE.has(permission) && !rolesOf(req.user).includes('admin')) return { ok: false, status: 403, message: 'Admin role required' };
    return { ok: true };
  }

  /** Who is asking, for records: an id NooblyJS knows when hosted, the email otherwise. */
  function actor(req) {
    const person = req.person;
    return {
      id: person?.id || req.user?.email || 'unknown',
      name: person?.name || req.user?.name || req.user?.email || 'Someone',
      email: req.user?.email || person?.email || null,
    };
  }

  /** A line in NooblyJS's audit log (hosted); the wiki has no audit log of its own. */
  async function record(req, action, target, extra = {}) {
    if (!host?.audit?.record) return;
    try {
      await host.audit.record({ actor: actor(req).id, action, target, system: 'knowledge', ...extra });
    } catch { /* an audit failure must not fail the request it describes */ }
  }

  /** A refusal, written to the audit log like the host's own refusals. */
  async function refuse(req, res, result, permission, target) {
    if (result.status === 403) await record(req, 'access.refused', target, { permission, reason: result.message });
    return res.status(result.status).json({ success: false, error: result.message });
  }

  return { check, actor, record, refuse };
}

module.exports = { createAccess };
