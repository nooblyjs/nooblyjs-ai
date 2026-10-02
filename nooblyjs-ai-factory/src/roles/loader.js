// @ts-check
// Phase F09: ROLES. Who does what, with which model, allowed to do what.
//
// A role is a Markdown file: frontmatter (the settings) + a body (the prompt).
//
//   ---
//   name: reviewer
//   tier: balanced               fast | balanced | strong → a model, chosen by the operator
//   readOnly: true               may look, never touch (harness permission mode "plan")
//   permissionMode: acceptEdits  for roles that do write
//   allow: [Edit({{specDir}}/**)]    harness allow rules ({{vars}} filled in per run)
//   deny: [WebFetch]             harness deny rules, ADDED to the factory's own
//   maxTurns: 30 · budgetUsd: 1.5
//   ---
//   You are the reviewer…
//
// Three layers, later wins:
//
//   built-in     src/roles/builtin/*.md                  what ships with the factory
//   repo         <repo>/.factory/roles/*.md (base commit)  a repo's own tuning: prompt, model, limits
//   operator     ~/.factory/config.json "roles"          yours: e.g. { "builder": { "tier": "strong" } }
//
// And INVARIANTS no layer can change (separation of duties is a permission, not a hope):
//   - a built-in read-only role stays read-only (a reviewer must never be able to edit what it reviews)
//   - permission mode "bypass" is never accepted from config
//   - the factory's always-deny rules (git push, git remote, git config, gh) are always added
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../exec/workspace/git.js';
import { readFileAt } from '../exec/workspace/mirror.js';
import { ALWAYS_DENY } from '../exec/workspace/harness-settings.js';
import { parseFrontmatter } from '../util/frontmatter.js';

const BUILT_IN = fileURLToPath(new URL('./builtin/', import.meta.url));
export const TIERS = ['fast', 'balanced', 'strong'];
const MODES = ['default', 'acceptEdits', 'plan'];

/**
 * @typedef {Object} Role
 * @property {string} name
 * @property {string} description
 * @property {string} tier
 * @property {string} [model]            a specific model (overrides the tier)
 * @property {boolean} readOnly
 * @property {string} permissionMode
 * @property {string[]} allow
 * @property {string[]} deny
 * @property {boolean} stopHook
 * @property {number} [maxTurns]
 * @property {number} [budgetUsd]
 * @property {string} output
 * @property {string} body
 * @property {string[]} sources         where each layer came from
 * @property {string[]} warnings        overrides that were refused
 */

/** @returns {Role} */
function fromFile(text, source) {
  const { data, body } = parseFrontmatter(text);
  const list = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
  return {
    name: String(data.name ?? path.basename(source, '.md')),
    description: String(data.description ?? ''),
    tier: TIERS.includes(String(data.tier)) ? String(data.tier) : 'balanced',
    model: data.model ? String(data.model) : undefined,
    readOnly: data.readOnly === 'true' || data.readOnly === true,
    permissionMode: String(data.permissionMode ?? 'acceptEdits'),
    allow: list(data.allow),
    deny: list(data.deny),
    stopHook: !(data.stopHook === 'false' || data.stopHook === false),
    maxTurns: data.maxTurns ? Number(data.maxTurns) : undefined,
    budgetUsd: data.budgetUsd ? Number(data.budgetUsd) : undefined,
    output: String(data.output ?? 'summary'),
    body: body.trim(),
    sources: [source],
    warnings: [],
    _set: Object.keys(data), // which fields THIS file set (for layering)
  };
}

export function builtInRoles() {
  return Object.fromEntries(
    fs.readdirSync(BUILT_IN).filter((f) => f.endsWith('.md')).map((f) => {
      const role = fromFile(fs.readFileSync(path.join(BUILT_IN, f), 'utf8'), `built-in ${f}`);
      return [role.name, role];
    }),
  );
}

/**
 * Put a layer over a role: only the fields the layer sets; a non-empty body replaces the body.
 * Then enforce the invariants.
 */
function overlay(base, layer, source, fields) {
  const next = { ...base, sources: [...base.sources, source], warnings: [...base.warnings] };
  for (const key of fields) {
    if (!(key in layer) || layer[key] === undefined) continue;
    // Rule lists ADD UP across layers (like the harness's settings layers): a layer can grant a
    // role more (an approved policy gap), but can't quietly drop the rules below it.
    if (key === 'allow' || key === 'deny') next[key] = [...new Set([...base[key], ...(layer[key] ?? [])])];
    else next[key] = layer[key];
  }
  if (layer.body) next.body = layer.body;
  if (base.readOnly && !next.readOnly) {
    next.readOnly = true;
    next.warnings.push(`${source}: "${base.name}" is read-only and stays read-only (separation of duties).`);
  }
  if (next.permissionMode === 'bypass' || !MODES.includes(next.permissionMode)) {
    next.warnings.push(`${source}: permission mode "${next.permissionMode}" is not allowed for factory roles; using "${base.permissionMode}".`);
    next.permissionMode = base.permissionMode;
  }
  return next;
}

/**
 * All roles for a run: built-in, then the repo's (at its base commit), then the operator's.
 * @param {{ mirrorDir?: string, sha?: string, operator?: Record<string, object> }} [options]
 * @returns {Promise<Record<string, Role>>}
 */
export async function loadRoles({ mirrorDir, sha, operator = {} } = {}) {
  const roles = builtInRoles();
  if (mirrorDir && sha) {
    const names = (await git(['ls-tree', '--name-only', `${sha}:.factory/roles`], { cwd: mirrorDir }).catch(() => '')).split('\n').filter((f) => f.endsWith('.md'));
    for (const file of names) {
      const layer = fromFile(/** @type {string} */ (await readFileAt(mirrorDir, sha, `.factory/roles/${file}`)), `repo .factory/roles/${file}`);
      const base = roles[layer.name];
      roles[layer.name] = base ? overlay(base, layer, layer.sources[0], layer._set.filter((k) => k !== 'name')) : layer;
    }
  }
  for (const [name, settings] of Object.entries(operator ?? {})) {
    if (!roles[name]) continue;
    roles[name] = overlay(roles[name], settings, '~/.factory/config.json', Object.keys(settings));
  }
  return roles;
}

/** Fill {{name}} placeholders. Unknown ones become '' (a role may mention optional context). */
export function render(text, vars) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => String(key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars) ?? ''));
}

/**
 * A role → the agent options for runStep: model, permissions, limits.
 * @param {Role} role
 * @param {{ request: any, config: any, vars?: object, budgetUsd?: number }} context
 */
export function agentOptionsFor(role, { request, config, vars = {}, budgetUsd }) {
  const asked = request.agent ?? {};
  // A run's explicit --model wins; otherwise the role's own model, otherwise its tier's.
  // Tiers are Anthropic model ids by default, so they're skipped for another named provider.
  const otherProvider = typeof asked.provider === 'string' && !['anthropic'].includes(asked.provider);
  const model = asked.model ?? role.model ?? (otherProvider ? undefined : config.models?.[role.tier]);
  const limits = { ...asked.limits };
  if (role.maxTurns && !limits.maxTurns) limits.maxTurns = role.maxTurns;
  const caps = [limits.budgetUsd, role.budgetUsd, budgetUsd].filter((v) => typeof v === 'number');
  if (caps.length) limits.budgetUsd = Math.min(...caps);
  return {
    model,
    permissionMode: role.readOnly ? 'plan' : role.permissionMode,
    allowedTools: role.readOnly ? [] : [...role.allow.map((r) => render(r, vars)), ...(asked.allowedTools ?? [])],
    disallowedTools: [...ALWAYS_DENY, ...role.deny.map((r) => render(r, vars)), ...(asked.disallowedTools ?? [])],
    limits,
    stopHook: role.stopHook && !role.readOnly,
  };
}
