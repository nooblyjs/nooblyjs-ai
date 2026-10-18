// Permissions come only from the access role (product.md §6), through the matrix in data/access/roles.yaml.
// A hidden button is not a control: every restricted route checks here. Unknown permissions are refused.
import { sendError, wantsJson } from '../util/errors.js';

export function createRoles({ store }) {
  async function matrix() {
    return (await store.readYaml(['access', 'roles.yaml']))?.permissions ?? {};
  }

  /** True when `accessRole` has `permission`. */
  async function can(accessRole, permission) {
    const allowed = (await matrix())[permission];
    return Array.isArray(allowed) && allowed.includes(accessRole);
  }

  /** Middleware: 403 (audited) unless the signed-in person's access role has `permission`. */
  function requireRole(permission) {
    return async (req, res, next) => {
      try {
        if (req.person && await can(req.person.accessRole, permission)) return next();
        res.locals.audit = { action: 'access.refused', permission, reason: `access role ${req.person?.accessRole ?? 'none'} lacks ${permission}` };
        const message = `This needs the "${permission}" permission. Your access role is ${req.person?.accessRole ?? 'none'}.`;
        if (wantsJson(req)) return sendError(res, 403, 'forbidden', message);
        res.status(403).type('text').send(message);
      } catch (err) {
        next(err);
      }
    };
  }

  /** The access role a person gets when NooblyJS creates their record on first sign-in (default Viewer). */
  async function newPersonRole() {
    const doc = await store.readYaml(['access', 'roles.yaml']);
    const role = doc?.newPersonRole ?? 'Viewer';
    return (doc?.roles ?? ['Viewer']).includes(role) ? role : 'Viewer';
  }

  /** Every permission an access role has (for ctx.can() in the browser: a hint only, the API still checks). */
  async function permissionsFor(accessRole) {
    return Object.entries(await matrix()).filter(([, roles]) => Array.isArray(roles) && roles.includes(accessRole)).map(([p]) => p);
  }

  /** The access roles, lowest first. */
  async function roleNames() {
    return (await store.readYaml(['access', 'roles.yaml']))?.roles ?? ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'];
  }

  /** The highest access role an agent can have (product.md §6: Contributor). */
  async function agentCap() {
    return (await store.readYaml(['access', 'roles.yaml']))?.agentCap ?? 'Contributor';
  }

  return { matrix, can, requireRole, newPersonRole, permissionsFor, roleNames, agentCap };
}
