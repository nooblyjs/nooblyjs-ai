// Phase 10: settings files, in layers.
//
// Each layer can override the ones before it:
//
//   1. defaults                      src/config/defaults.js
//   2. user                          ~/.noobly/settings.json          (all your projects)
//   3. project                       .noobly/settings.json            (share with your team: commit it)
//   4. local                         .noobly/settings.local.json      (just you, this project: git-ignore it)
//   5. environment variables         NOOBLY_PROVIDER, NOOBLY_MODEL
//   6. command-line flags            --model, --allow, --permission-mode…
//
// Merging rules:
//   - plain values (model, maxTurns…): the later layer wins
//   - permission rule lists (allow, deny): ADDED together, so a project can't
//     silently remove your personal deny rules
//   - env: merged key by key
//   - hooks (Phase 12): ADDED together per event; each remembers which layer it came from
//
// Some project settings are as dangerous as a hook, so they wait for your trust
// too (config/trust.js), and are HELD BACK until then:
//   - env:               PATH=.evil/bin would swap `ls` or `git` for the repo's own program
//   - baseUrl:           would send your API key to the repo's server
//   - permissions.allow: would pre-approve commands (e.g. "Bash") for the model
//   - sandbox (Phase 20): could switch it off, or open the network or your home folder
//   - feedback (Phase 24): its checkers are commands, like hooks
//   - webSearch (Phase 28): a search server of the repo's choosing would see your queries
//
// We also remember WHERE each value came from ("provenance"), so
// `noobly config` can answer "why is the model grok-4.3?".
import fs from 'node:fs';
import path from 'node:path';
import { nooblyHome } from '../util/paths.js';
import { DEFAULTS } from './defaults.js';

const TYPES = {
  provider: 'string',
  model: 'string',
  smallModel: 'string',
  maxTokens: 'number',
  maxTurns: 'number',
  fallbacks: 'boolean',
  autoCompact: 'boolean',
  compactThreshold: 'number',
  contextWindow: 'number',
  promptCaching: 'boolean',
  baseUrl: 'string',
  thinking: 'string',
  effort: 'string',
  permissions: 'object',
  env: 'object',
  hooks: 'object',
  sandbox: 'object',
  feedback: 'object',
  editTools: 'string',
  repoMap: 'string',
  webSearch: 'object',
};

/** The settings files, from least to most specific. */
export function settingsFiles(cwd, env = process.env) {
  return [
    { layer: 'user', file: path.join(nooblyHome(env), 'settings.json') },
    { layer: 'project', file: path.join(cwd, '.noobly', 'settings.json') },
    { layer: 'local', file: path.join(cwd, '.noobly', 'settings.local.json') },
  ];
}

/** Project settings that only apply once you trust the project. */
export const NEEDS_TRUST = ['env', 'baseUrl', 'permissions.allow', 'sandbox', 'feedback', 'webSearch'];

/**
 * @param {{ cwd: string, env?: object, flags?: object }} options  `flags` are settings from the command line
 * @returns {{ settings: object, sources: Record<string, string>, warnings: string[], notices: string[], loaded: string[],
 *   held: object, layers: object[] }}
 *   `warnings` are problems (shown on every start); `notices` are worth knowing (shown by /config and the banner);
 *   `held` is what the project's files set from NEEDS_TRUST (not applied: see trustProjectSettings)
 */
export function loadSettings({ cwd, env = process.env, flags = {} }) {
  const warnings = [];
  const notices = [];
  const loaded = [];
  const layers = [{ name: 'default', values: structuredClone(DEFAULTS) }];

  for (const { layer, file } of settingsFiles(cwd, env)) {
    if (!fs.existsSync(file)) continue;
    let values;
    try {
      values = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      warnings.push(`${file}: not valid JSON (${error.message}). Ignoring it.`);
      continue;
    }
    loaded.push(file);
    const clean = check(values, file, warnings, notices, layer);
    layers.push({ name: `${layer} (${file})`, values: clean, held: layer === 'user' ? {} : holdBack(clean) });
  }

  const fromEnv = {};
  if (env.NOOBLY_PROVIDER) fromEnv.provider = env.NOOBLY_PROVIDER;
  if (env.NOOBLY_MODEL) fromEnv.model = env.NOOBLY_MODEL;
  layers.push({ name: 'environment variable', values: fromEnv });
  layers.push({ name: 'command-line flag', values: flags });

  const held = {};
  for (const layer of layers) merge(held, {}, layer.held ?? {}, layer.name);
  if (Object.keys(held).length) notices.push(`Until you trust this project, its files' ${Object.keys(held).map((k) => (k === 'permissions' ? 'permissions.allow' : k)).join(', ')} settings are not used.`);
  return { ...mergeLayers(layers, false), warnings, notices, loaded, held, layers };
}

/** The same settings, now with the project's held-back values applied (after the user trusted them). */
export function trustProjectSettings(info) {
  return { ...info, ...mergeLayers(info.layers, true), held: {} };
}

function mergeLayers(layers, trusted) {
  const settings = {};
  const sources = {};
  for (const { name, values, held } of layers) {
    merge(settings, sources, values, name);
    if (trusted && held) merge(settings, sources, held, name);
  }
  return { settings, sources };
}

/** Move the NEEDS_TRUST values out of a project layer. Returns them. */
function holdBack(values) {
  const held = {};
  for (const key of ['env', 'baseUrl', 'sandbox', 'feedback', 'webSearch']) {
    if (values[key] === undefined) continue;
    held[key] = values[key];
    delete values[key];
  }
  if (values.permissions?.allow?.length) {
    held.permissions = { allow: values.permissions.allow };
    values.permissions = { ...values.permissions, allow: undefined };
  }
  return held;
}

function check(values, file, warnings, notices, layer) {
  const clean = {};
  for (const [key, value] of Object.entries(values)) {
    if (!TYPES[key]) {
      warnings.push(`${file}: unknown setting "${key}" (ignored).`);
      continue;
    }
    if (typeof value !== TYPES[key] || value === null) {
      warnings.push(`${file}: "${key}" should be a ${TYPES[key]} (ignored).`);
      continue;
    }
    clean[key] = value;
  }
  // Safety: a settings file (which could come from a repo you just cloned) may
  // not switch permissions off entirely. Bypass needs the command-line flag.
  if (clean.permissions?.defaultMode === 'bypass') {
    warnings.push(`${file}: permissions.defaultMode "bypass" is only allowed with --dangerously-skip-permissions (ignored).`);
    clean.permissions = { ...clean.permissions, defaultMode: undefined };
  }
  // Phase 12: remember where each hook came from. Hooks from the project need your trust first (config/trust.js).
  if (clean.hooks) {
    clean.hooks = Object.fromEntries(
      Object.entries(clean.hooks).map(([event, list]) => [event, Array.isArray(list) ? list.map((entry) => ({ ...entry, source: layer })) : list]),
    );
  }
  if (layer !== 'user' && Array.isArray(clean.permissions?.allow) && clean.permissions.allow.length) {
    // A cloned repo can pre-approve commands for you, so make that visible.
    notices.push(`${path.relative(process.cwd(), file) || file} allows without asking (once trusted): ${clean.permissions.allow.join(', ')}`);
  }
  return clean;
}

function merge(settings, sources, values, layerName) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (key === 'permissions') {
      settings.permissions ??= { allow: [], deny: [] };
      for (const [sub, subValue] of Object.entries(value)) {
        if (subValue === undefined) continue;
        const name = `permissions.${sub}`;
        if (sub === 'allow' || sub === 'deny') {
          // Lists add up (and duplicates are dropped).
          settings.permissions[sub] = [...new Set([...(settings.permissions[sub] ?? []), ...subValue])];
          if (subValue.length) sources[name] = sources[name] && sources[name] !== 'default' ? `${sources[name]} + ${layerName}` : layerName;
          else sources[name] ??= layerName;
        } else {
          settings.permissions[sub] = subValue;
          sources[name] = layerName;
        }
      }
    } else if (key === 'hooks') {
      settings.hooks ??= {};
      for (const [event, list] of Object.entries(value)) {
        settings.hooks[event] = [...(settings.hooks[event] ?? []), ...(Array.isArray(list) ? list : [])];
        const name = `hooks.${event}`;
        sources[name] = sources[name] ? `${sources[name]} + ${layerName}` : layerName;
      }
    } else if (key === 'env') {
      settings.env = { ...settings.env, ...value };
      for (const name of Object.keys(value)) sources[`env.${name}`] = layerName;
    } else if (key === 'sandbox') {
      // Merged key by key, like env: a layer can change the network without restating the rest.
      settings.sandbox = { ...settings.sandbox, ...value };
      for (const name of Object.keys(value)) sources[`sandbox.${name}`] = layerName;
    } else {
      settings[key] = value;
      sources[key] = layerName;
    }
  }
}

/** Text for `noobly config` / `/config`: every setting, its value, and where it came from. */
export function describeSettings({ settings, sources, warnings, notices = [], loaded }) {
  const rows = [];
  const add = (name, value) => rows.push([name, JSON.stringify(value), sources[name] ?? 'default']);
  for (const key of Object.keys(TYPES)) {
    if (key === 'permissions') {
      for (const sub of ['defaultMode', 'allow', 'deny']) add(`permissions.${sub}`, settings.permissions?.[sub]);
    } else if (key === 'env') {
      for (const [name, value] of Object.entries(settings.env ?? {})) add(`env.${name}`, value);
    } else if (key === 'sandbox') {
      for (const [name, value] of Object.entries(settings.sandbox ?? {})) add(`sandbox.${name}`, value);
    } else if (key === 'hooks') {
      for (const [event, list] of Object.entries(settings.hooks ?? {})) add(`hooks.${event}`, list.map((hook) => hook.command ?? '(nested)'));
    } else if (settings[key] !== undefined) {
      add(key, settings[key]);
    }
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  return [
    loaded.length ? `Settings files loaded:\n${loaded.map((f) => `  ${f}`).join('\n')}` : 'No settings files found (using defaults).',
    '',
    ...rows.map(([name, value, source]) => `${name.padEnd(width)}  ${value}   ← ${source}`),
    ...(notices.length ? ['', 'Notes:', ...notices.map((n) => `  • ${n}`)] : []),
    ...(warnings.length ? ['', 'Warnings:', ...warnings.map((w) => `  ⚠ ${w}`)] : []),
  ].join('\n');
}
