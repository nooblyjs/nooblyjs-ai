// Permissions come only from the access role (product.md §6), through the matrix in data/access/roles.yaml.
// A hidden button is not a control: every restricted route checks here. Unknown permissions are refused.
//
// Phase 27: roles.yaml also says which permission each ACTION needs (`actions:`): the code names the action it is about
// to take and the permission it needs by default ("send-back", approve); the file wins where it lists the action, so who
// may do what is configuration. The file is checked whenever it changes: one that fails (a role or permission that
// doesn't exist) is refused, the last good version keeps running (this process's, else access/applied/roles.yaml, else
// the seed's), and the reason is logged and shown on Platform · Settings · Workflow.
import fs from 'node:fs';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { sendError, wantsJson } from '../util/errors.js';

/**
 * Permissions added after a data folder was made (the nine stages, Phase 16a; lifecycle v3, Phase 16b). A folder from
 * before keeps working: a permission it doesn't list is used from here, and one it lists (edited or not) wins.
 * `accept-release-candidate` went with Verify (Phase 16b): kept so an older check still answers, no longer shown.
 */
export const BUILT_IN_PERMISSIONS = {
  'accept-requirement': ['Approver', 'Architect', 'Owner'],
  'accept-threat-model': ['Architect', 'Owner'],
  'accept-risk': ['Architect', 'Owner'],
  'accept-release-candidate': ['Approver', 'Architect', 'Owner'],
  'deploy-production': ['Approver', 'Architect', 'Owner'],
  'declare-incident': ['Contributor', 'Approver', 'Architect', 'Owner'],
  // The testers and test leads the Test approval and the Engineering sign-off's test part wait on (Phase 16b).
  'sign-off-tests': ['Approver', 'Architect', 'Owner'],
  // Phase 25a: putting an idea forward in Product's ideas portal, voting, commenting and following. Everyone, never agents.
  suggest: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'],
};

const FILE = ['access', 'roles.yaml'];
const APPLIED = ['access', 'applied', 'roles.yaml'];
const SEED = new URL('../seed/data/access/roles.yaml', import.meta.url);
const DEFAULT_ROLES = ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'];
const ACTION = /^[a-z][a-z0-9.-]{0,80}$/;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * roles.yaml's parsed `doc`, checked: { value: { roles, permissions, newPersonRole, agentCap, actions }, errors }.
 * `permissions` has the built-in ones filled in.
 */
export function checkRoles(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { errors: [{ where: 'the file', message: 'it should be a map with roles and permissions' }] };
  const roles = doc.roles ?? DEFAULT_ROLES;
  if (!Array.isArray(roles) || !roles.length || roles.some((r) => typeof r !== 'string' || !r.trim())) errors.push({ where: 'roles', message: 'it should list the access roles, lowest first' });
  else if (new Set(roles).size !== roles.length) errors.push({ where: 'roles', message: 'a role is listed twice' });
  const known = new Set(Array.isArray(roles) ? roles : []);
  const permissions = { ...BUILT_IN_PERMISSIONS };
  if (doc.permissions !== undefined && (typeof doc.permissions !== 'object' || Array.isArray(doc.permissions) || doc.permissions === null)) {
    errors.push({ where: 'permissions', message: 'it should map each permission to the roles that have it' });
  }
  for (const [p, list] of Object.entries(doc.permissions && typeof doc.permissions === 'object' ? doc.permissions : {})) {
    if (!Array.isArray(list)) { errors.push({ where: `permissions.${p}`, message: 'it should be a list of roles' }); continue; }
    const unknown = list.filter((r) => !known.has(r));
    if (unknown.length) errors.push({ where: `permissions.${p}`, message: `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a role' : 'are not roles'} (the roles are ${[...known].join(', ')})` });
    permissions[p] = list;
  }
  for (const key of ['newPersonRole', 'agentCap']) {
    if (doc[key] !== undefined && !known.has(doc[key])) errors.push({ where: key, message: `"${doc[key]}" is not a role` });
  }
  const actions = {};
  if (doc.actions !== undefined && (typeof doc.actions !== 'object' || Array.isArray(doc.actions) || doc.actions === null)) {
    errors.push({ where: 'actions', message: 'it should map each action to the permission it needs' });
  }
  for (const [a, p] of Object.entries(doc.actions && typeof doc.actions === 'object' ? doc.actions : {})) {
    if (!ACTION.test(a)) errors.push({ where: `actions.${a}`, message: 'an action is named in lower case, with dots and dashes' });
    else if (typeof p !== 'string' || !(p in permissions)) errors.push({ where: `actions.${a}`, message: `there is no permission "${p}" (the permissions are ${Object.keys(permissions).join(', ')})` });
    else actions[a] = p;
  }
  return {
    value: { roles: [...known], permissions, newPersonRole: known.has(doc.newPersonRole) ? doc.newPersonRole : 'Viewer', agentCap: known.has(doc.agentCap) ? doc.agentCap : 'Contributor', actions },
    errors,
  };
}

/**
 * @param {object} o
 * @param {object} o.store    the data folder's FsStore
 * @param {object} [o.log]
 * @param {Function} [o.onChange]  ({ changes, summary }) when a changed file applies (NooblyJS emits workflow.changed)
 * @param {Function} [o.onRefuse]  ({ errors }) when a file is refused
 */
export function createRoles({ store, log = null, onChange = null, onRefuse = null }) {
  let cached = null; // { text, value }
  let lastGood = null;
  const state = { file: 'access/roles.yaml', status: 'built-in', errors: [], warnings: [], since: null, appliedAt: null };
  // Every action the code has asked about, with the permission it needs when the file doesn't say (Members lists them).
  const seen = new Map();

  const parse = (text) => {
    try {
      return { doc: yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? null };
    } catch (err) {
      return { error: { where: `line ${(err.mark?.line ?? 0) + 1}`, message: `the YAML doesn't read: ${err.reason ?? err.message}` } };
    }
  };

  async function fallback() {
    if (lastGood) return lastGood;
    for (const text of [await store.readText(APPLIED).catch(() => null), fs.readFileSync(SEED, 'utf8')]) {
      if (!text) continue;
      const { doc } = parse(text);
      const checked = doc ? checkRoles(doc) : null;
      if (checked && !checked.errors.length) return checked.value;
    }
    return checkRoles({ roles: DEFAULT_ROLES }).value;
  }

  /** The roles, permissions and actions in use. */
  async function config() {
    const text = await store.readText(FILE);
    if (cached && cached.text === text) return cached.value;
    let value;
    if (text === null) {
      value = checkRoles({ roles: DEFAULT_ROLES }).value;
      Object.assign(state, { status: 'built-in', errors: [], since: null });
    } else {
      const { doc, error } = parse(text);
      const checked = error ? { errors: [error] } : checkRoles(doc);
      if (checked.errors.length) {
        if (state.status !== 'refused' || state.hash !== hash(text)) {
          for (const e of checked.errors) log?.error?.(`access/roles.yaml is refused, the last good version keeps running: ${e.where}: ${e.message}`);
          Object.assign(state, { status: 'refused', errors: checked.errors, since: new Date().toISOString(), hash: hash(text) });
          await Promise.resolve(onRefuse?.({ errors: checked.errors })).catch(() => {});
        }
        value = await fallback();
      } else {
        value = checked.value;
        await applied(text, value);
        Object.assign(state, { status: 'applied', errors: [], since: null, hash: hash(text) });
      }
    }
    if (state.status !== 'refused') lastGood = value;
    cached = { text, value };
    return value;
  }

  async function applied(text, value) {
    const before = await store.readText(APPLIED).catch(() => null);
    if (before === text) return;
    await store.writeText(APPLIED, text).catch((err) => log?.warn?.(`access/applied/roles.yaml: ${err.message}`));
    state.appliedAt = new Date().toISOString();
    if (before === null) return;
    const { doc } = parse(before);
    const old = doc ? checkRoles(doc) : null;
    const changes = old && !old.errors.length ? diff(old.value, value) : [];
    await Promise.resolve(onChange?.({ changes, summary: `changed who may do what (access/roles.yaml)${changes.length ? `: ${changes.join('; ')}` : ''}` })).catch(() => {});
  }

  function diff(a, b) {
    const out = [];
    for (const [p, list] of Object.entries(b.permissions)) {
      const was = a.permissions[p] ?? [];
      const added = list.filter((r) => !was.includes(r));
      const removed = was.filter((r) => !list.includes(r));
      if (added.length || removed.length) out.push(`${p}: ${[...added.map((r) => `+${r}`), ...removed.map((r) => `-${r}`)].join(' ')}`);
    }
    for (const [act, p] of Object.entries(b.actions)) if (a.actions[act] !== p) out.push(`${act} needs "${p}"${a.actions[act] ? ` (was "${a.actions[act]}")` : ''}`);
    for (const act of Object.keys(a.actions)) if (!(act in b.actions)) out.push(`${act} needs its default permission again`);
    if (a.roles.join() !== b.roles.join()) out.push(`the roles are ${b.roles.join(', ')}`);
    return out;
  }

  async function matrix() {
    return (await config()).permissions;
  }

  /** True when `accessRole` has `permission`. */
  async function can(accessRole, permission) {
    const allowed = (await matrix())[permission];
    return Array.isArray(allowed) && allowed.includes(accessRole);
  }

  /** The permission an action needs: the file's, else the default the code gives. */
  async function permissionFor(action, fallbackPermission) {
    if (!ACTION.test(String(action ?? ''))) throw new Error(`Not an action name: ${JSON.stringify(action)}`);
    if (fallbackPermission && !seen.has(action)) seen.set(action, fallbackPermission);
    return (await config()).actions[action] ?? fallbackPermission ?? null;
  }

  /** True when `accessRole` may take `action` (its permission from roles.yaml, else `fallbackPermission`). */
  async function canDo(accessRole, action, fallbackPermission) {
    const permission = await permissionFor(action, fallbackPermission);
    if (!permission) {
      log?.warn?.(`the action "${action}" has no permission in access/roles.yaml and none in the code: refused`);
      return false;
    }
    return can(accessRole, permission);
  }

  function refuseWith(req, res, permission, reason, message) {
    res.locals.audit = { action: 'access.refused', permission, reason };
    if (wantsJson(req)) return sendError(res, 403, 'forbidden', message);
    res.status(403).type('text').send(message);
  }

  /** Middleware: 403 (audited) unless the signed-in person's access role has `permission`. */
  function requireRole(permission) {
    return async (req, res, next) => {
      try {
        if (req.person && await can(req.person.accessRole, permission)) return next();
        refuseWith(req, res, permission, `access role ${req.person?.accessRole ?? 'none'} lacks ${permission}`, `This needs the "${permission}" permission. Your access role is ${req.person?.accessRole ?? 'none'}.`);
      } catch (err) {
        next(err);
      }
    };
  }

  /**
   * Middleware: 403 (audited) unless the signed-in person may take `action`: the permission roles.yaml gives it, else
   * `fallbackPermission`. The action is known from the moment the route is made, so Members can list it.
   */
  function requireAction(action, fallbackPermission) {
    if (!ACTION.test(String(action ?? ''))) throw new Error(`Not an action name: ${JSON.stringify(action)}`);
    if (fallbackPermission && !seen.has(action)) seen.set(action, fallbackPermission);
    return async (req, res, next) => {
      try {
        const permission = await permissionFor(action, fallbackPermission);
        if (req.person && permission && await can(req.person.accessRole, permission)) return next();
        refuseWith(req, res, permission, `access role ${req.person?.accessRole ?? 'none'} may not ${action} (it needs ${permission})`,
          `You can't ${action.replace(/[.-]/g, ' ')}: it needs the "${permission}" permission. Your access role is ${req.person?.accessRole ?? 'none'}.`);
      } catch (err) {
        next(err);
      }
    };
  }

  /** The access role a person gets when NooblyJS creates their record on first sign-in (default Viewer). */
  async function newPersonRole() {
    return (await config()).newPersonRole;
  }

  /** Every permission an access role has (for ctx.can() in the browser: a hint only, the API still checks). */
  async function permissionsFor(accessRole) {
    return Object.entries(await matrix()).filter(([, roles]) => Array.isArray(roles) && roles.includes(accessRole)).map(([p]) => p);
  }

  /** The access roles, lowest first. */
  async function roleNames() {
    return (await config()).roles;
  }

  /** Every permission that exists. */
  async function permissions() {
    return Object.keys(await matrix());
  }

  /** The highest access role an agent can have (product.md §6: Contributor). */
  async function agentCap() {
    return (await config()).agentCap;
  }

  /** Every action known (the code's and the file's): { action, permission, defaultPermission, fromFile, roles }. */
  async function actions() {
    const c = await config();
    const names = [...new Set([...seen.keys(), ...Object.keys(c.actions)])].sort();
    return names.map((action) => {
      const permission = c.actions[action] ?? seen.get(action) ?? null;
      return { action, permission, defaultPermission: seen.get(action) ?? null, fromFile: action in c.actions, roles: permission ? c.permissions[permission] ?? [] : [] };
    });
  }

  /** The file's state, for Platform · Settings · Workflow. */
  const status = () => ({ ...state, errors: [...state.errors] });

  return { matrix, can, canDo, requireRole, requireAction, permissionFor, newPersonRole, permissionsFor, roleNames, permissions, agentCap, actions, status };
}
