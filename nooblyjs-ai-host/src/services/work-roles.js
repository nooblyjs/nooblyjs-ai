// Work roles (product.md §2, §5.8): the six roles a person can pick, what onboarding says about each, and the
// first-week tasks that follow. Read from data/config/work-roles.yaml on every use (the copy can be edited without
// a restart); a data folder from before Phase 3 falls back to the seed's file. A work role shapes the home only.
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { SEED_DIR } from '../seed/index.js';

const FILE = ['config', 'work-roles.yaml'];
const TITLES = ['access', 'job-title-roles.yaml'];

export function createWorkRoles({ store }) {
  async function config() {
    const own = await store.readYaml(FILE);
    if (own?.roles?.length) return own;
    return yaml.load(await fs.readFile(path.join(SEED_DIR, ...FILE), 'utf8'), { schema: yaml.CORE_SCHEMA });
  }

  async function list() {
    return (await config()).roles;
  }

  async function get(key) {
    return (await list()).find((r) => r.key === key) ?? null;
  }

  /** The first-week tasks for a role: the one everyone has, then the role's first three things. */
  async function firstWeek(key) {
    const c = await config();
    const role = c.roles.find((r) => r.key === key);
    return [...(c.common?.firstWeek ?? []), ...(role?.firstWeek ?? [])];
  }

  /** The role suggested by a job title (the first matching rule), or null. */
  async function suggest(jobTitle) {
    if (!jobTitle) return null;
    for (const rule of (await store.readYaml(TITLES))?.rules ?? []) {
      try {
        if (new RegExp(rule.match, 'i').test(jobTitle)) return rule.workRole;
      } catch { /* a rule that isn't a valid pattern is skipped */ }
    }
    return null;
  }

  return { list, get, firstWeek, suggest };
}

const nameOf = (id) => String(id ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const first = (name) => String(name ?? '').split(/\s+/)[0];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The agent teammate who works for a role here: the one the role names when that one is hired, else the first hired
 * teammate. Null when nobody is hired. `roster` is NooblyJS's agents.roster() (Digital Teammates' hired teammates).
 */
export function teammateFor(role, roster = []) {
  const hired = (roster ?? []).filter((a) => a?.id);
  if (!role?.agent || !hired.length) return null;
  const found = hired.find((a) => a.id === role.agent) ?? [...hired].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)))[0];
  return { id: found.id, name: found.name ?? nameOf(found.id) };
}

/**
 * The role's copy with the teammate actually hired here in place of the example teammate it was written with
 * ("Ada Quill clusters tickets…" → "StevieB clusters tickets…"). With nobody hired it says "your agent teammate".
 */
export function withTeammate(role, roster = []) {
  if (!role?.agent) return role;
  const example = nameOf(role.agent);
  const teammate = teammateFor(role, roster);
  const full = teammate ? teammate.name : 'Your agent teammate';
  const short = teammate ? first(teammate.name) : 'your agent teammate';
  const swap = (text) => (typeof text === 'string'
    ? text.replace(new RegExp(`\\b${escape(example)}\\b`, 'g'), full).replace(new RegExp(`\\b${escape(first(example))}\\b`, 'g'), short)
    : text);
  const purpose = String(role.agents ?? '').split(' · ').slice(1).join(' · ');
  return {
    ...role,
    agent: teammate?.id ?? null,
    teammate,
    agents: teammate ? [teammate.name, purpose].filter(Boolean).join(' · ') : `No agent teammate hired yet${purpose ? ` (for ${purpose})` : ''}`,
    blurb: swap(role.blurb),
    promise: swap(role.promise),
    tasks: (role.tasks ?? []).map((t) => ({ ...t, title: swap(t.title), detail: swap(t.detail) })),
    leadsWith: (role.leadsWith ?? []).map(swap),
  };
}
