// The seed: the files in src/seed/data, copied into DATA_DIR. Existing files are never overwritten, so seeding is
// idempotent and safe on a data folder people have edited. `reset` wipes DATA_DIR first.
//
// There are two kinds of seed file. SYSTEM files are what NooblyJS needs to run at all: access roles and permissions,
// the work roles, budgets, guardrails, model routes, base images. Everything else is SAMPLE CONTENT for the PRD-031
// story: people, teams, repositories, activity, spend, the metrics history. `content: false` writes the system
// files only (npm run seed:blank), and records that in config/seed.yaml so no later start adds the samples.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { daySegments } from '../util/dates.js';
import { seedMetricsHistory } from './metrics-history.js';

export const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
/** Where a data folder says what it was seeded with: { content: false } for a blank one (system files only). */
export const SEED_MARKER = ['config', 'seed.yaml'];
/** The system files, copied as they are. */
export const SYSTEM_FILES = Object.freeze([
  'access/roles.yaml', 'access/job-title-roles.yaml',
  'config/hosted-apps.yaml', 'config/organisation.yaml', 'config/settings.yaml',
  'platform/budgets.yaml', 'platform/guardrails.yaml', 'platform/model-routes.yaml',
]);
/** System files whose seed copy carries samples: what a blank data folder gets instead. */
export const BLANK_FILES = Object.freeze({
  // The seed's image list has made-up repository counts and CVE numbers. Nothing is listed until a registry is connected.
  'platform/base-images.yaml': '# Base images agents\' sandboxes are built from. Listed here once an image registry is connected.\nregistry: "[PLACEHOLDER image registry]"\nimages: []\n',
  'platform/environments.yaml': 'cloud: "[PLACEHOLDER cloud]"\nregion: "[PLACEHOLDER region]"\n# Environments are owned by Infrastructure; this list is what Platform shows when Infrastructure is not running.\nenvironments: []\n',
  'platform/secrets.yaml': '# Secrets are references only (vault:scope/NAME), never values.\nsecrets: []\n',
  'platform/pools.yaml': [
    'cluster: { name: "[PLACEHOLDER cluster]", region: "[PLACEHOLDER region]", vcpu: 96, memoryGb: 256, computeDailyCap: 120, computeToday: 0 }',
    'pools:',
    '  - { id: factory, name: Factory stations, slots: 3, queued: 0, note: One per run }',
    '  - { id: teammate, name: Teammate sandboxes, slots: 8, queued: 0, note: One per teammate on a task }',
    '  - { id: preview, name: Preview environments, slots: 6, queued: 0, note: One per open PR · torn down on merge }',
    '  - { id: indexer, name: Knowledge indexers, slots: 2, queued: 0, note: Nightly full sync at 02:00 }',
    'samples: []', '',
  ].join('\n'),
  // With no model configured an agent answers from a script. A blank folder has only the answer for "no script".
  'chat/scripts.yaml': 'fallback:\n  text: "No model is configured, and there is no scripted answer for that."\n  costUsd: 0\nreplies: []\n',
  'teams/scripts.yaml': 'intros: []\nfallback:\n  text: "No model is configured, and there is no scripted answer for that."\n  costUsd: 0\nanswers: []\n',
  'teams/links.yaml': 'conversations: {}\n',
});

/** True when this data folder was seeded without sample content (config/seed.yaml says content: false). */
export async function isBlank(store) {
  return (await store.readYaml(SEED_MARKER).catch(() => null))?.content === false;
}
const ACTIVITY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'activity.yaml');

async function* walk(dir, prefix = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isDirectory()) yield* walk(path.join(dir, e.name), [...prefix, e.name]);
    else if (e.isFile()) yield [...prefix, e.name];
  }
}

/**
 * Writes the seed files that are missing from the store's root. Returns the paths it wrote, relative to the root.
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} store  rooted at DATA_DIR
 */
export async function seedFiles(store, { reset = false, now, content = true } = {}) {
  if (reset) {
    // Remove the contents, not the folder itself: it may be a mount point.
    for (const name of await fs.readdir(store.root).catch(() => [])) {
      await fs.rm(path.join(store.root, name), { recursive: true, force: true });
    }
  }
  const written = [];
  if (!content) {
    // A blank data folder: the system files, the blank versions of the mixed ones, and the marker. No people, teams,
    // repositories, activity, spend or metrics history: those come from people using NooblyJS.
    for (const rel of SYSTEM_FILES) {
      const segments = rel.split('/');
      if (await store.exists(segments)) continue;
      await store.writeText(segments, await fs.readFile(path.join(SEED_DIR, ...segments), 'utf8'));
      written.push(rel);
    }
    // The work roles (onboarding and the For you homes) are system copy, but each role's "first week" tasks name the
    // sample story's items. A blank folder keeps the roles and drops those tasks.
    if (!(await store.exists(['config', 'work-roles.yaml']))) {
      const roles = yaml.load(await fs.readFile(path.join(SEED_DIR, 'config', 'work-roles.yaml'), 'utf8'), { schema: yaml.CORE_SCHEMA });
      for (const role of roles.roles ?? []) role.firstWeek = [];
      await store.writeText(['config', 'work-roles.yaml'], `# The work roles: onboarding copy and the layout of each "For you" home. Made by npm run seed:blank from the seed's\n# copy, without the first-week tasks that name sample items. See src/seed/data/config/work-roles.yaml for the fields.\n${yaml.dump(roles, { lineWidth: 200, noRefs: true })}`);
      written.push('config/work-roles.yaml');
    }
    for (const [rel, text] of Object.entries(BLANK_FILES)) {
      const segments = rel.split('/');
      if (await store.exists(segments)) continue;
      await store.writeText(segments, text);
      written.push(rel);
    }
    if (!(await store.exists(SEED_MARKER))) {
      await store.writeYaml(SEED_MARKER, { content: false, seededAt: now ?? new Date().toISOString(), note: 'System files only: no sample people, teams, items or history. Made by npm run seed:blank.' });
      written.push(SEED_MARKER.join('/'));
    }
    return written;
  }
  for await (const segments of walk(SEED_DIR)) {
    if (await store.exists(segments)) continue;
    await store.writeText(segments, await fs.readFile(path.join(SEED_DIR, ...segments), 'utf8'));
    written.push(segments.join('/'));
  }
  written.push(...await seedActivity(store, { now }));
  written.push(...await seedSpend(store, { now }));
  written.push(...await seedMetricsHistory(store, { now }));
  return written;
}

// The seed's October spend for the PRD-031 story (Platform → Settings → Budgets), in USD per system for the month
// so far. Spread over the days before today, so today starts at nothing and no daily cap is already reached.
const SAMPLE_SPEND = { teammates: 1816, product: 412, factory: 366, knowledge: 96 };

/**
 * This month's spend ledger (data/platform/spend/YYYY-MM.yaml) with the story's sample numbers, when there is no
 * ledger yet. Returns the files it wrote.
 */
export async function seedSpend(store, { now = new Date().toISOString() } = {}) {
  if (await store.exists(['platform', 'spend'])) return [];
  const month = now.slice(0, 7);
  const today = Number(now.slice(8, 10));
  const earlier = Array.from({ length: today - 1 }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const days = {};
  for (const [system, amount] of Object.entries(SAMPLE_SPEND)) {
    // On the 1st there are no earlier days: the month's sample goes on today, except the Software Factory's, whose
    // cap is daily.
    const spread = earlier.length ? earlier : system === 'factory' ? [] : [now.slice(0, 10)];
    spread.forEach((day, i) => {
      const share = Math.round((amount / spread.length) * 100) / 100;
      const last = i === spread.length - 1;
      const value = last ? Math.round((amount - share * (spread.length - 1)) * 100) / 100 : share;
      days[day] ??= { systems: {}, routes: {} };
      days[day].systems[system] = value;
    });
  }
  const segments = ['platform', 'spend', `${month}.yaml`];
  await store.writeYaml(segments, { month, sampleData: true, days, reached: {} });
  return [segments.join('/')];
}

/**
 * What a data folder seeded before a phase is missing from that phase's seed: Platform's files (Phase 9) when it
 * has no platform/ folder, and permissions added to roles.yaml since (granted as the seed grants them; existing
 * permissions are never changed), and the sample history for Metrics (Phase 10). Returns what it added.
 */
export async function seedMissing(store, { now } = {}) {
  const added = [];
  // A blank data folder stays blank: only system files a later phase added, and new permissions.
  const blank = await isBlank(store);
  if (blank) added.push(...(await seedFiles(store, { now, content: false })));
  if (!blank && !(await store.exists(['platform']))) {
    for await (const segments of walk(path.join(SEED_DIR, 'platform'), ['platform'])) {
      await store.writeText(segments, await fs.readFile(path.join(SEED_DIR, ...segments), 'utf8'));
      added.push(segments.join('/'));
    }
    added.push(...await seedSpend(store, { now }));
  }
  if (!blank) added.push(...await seedMetricsHistory(store, { now }));
  const roles = await store.readYaml(['access', 'roles.yaml']);
  if (roles?.permissions) {
    const seed = yaml.load(await fs.readFile(path.join(SEED_DIR, 'access', 'roles.yaml'), 'utf8'), { schema: yaml.CORE_SCHEMA });
    const missing = Object.keys(seed.permissions).filter((p) => !(p in roles.permissions));
    if (missing.length) {
      // Appended as text, so the file's comments stay.
      const text = await store.readText(['access', 'roles.yaml']);
      const lines = missing.map((p) => `  ${p}: [${seed.permissions[p].join(', ')}]`);
      await store.writeText(['access', 'roles.yaml'], insertPermissions(text, lines));
      added.push(...missing.map((p) => `access/roles.yaml#${p}`));
    }
  }
  return added;
}

/** Adds lines at the end of the `permissions:` block of roles.yaml text. */
function insertPermissions(text, lines) {
  const all = text.split(/\r?\n/);
  const start = all.findIndex((l) => /^permissions:\s*$/.test(l));
  if (start < 0) return `${text.trimEnd()}\npermissions:\n${lines.join('\n')}\n`;
  let end = start + 1;
  while (end < all.length && (/^\s+\S/.test(all[end]) || all[end].trim() === '')) end++;
  while (end > start + 1 && all[end - 1].trim() === '') end--;
  all.splice(end, 0, ...lines);
  return all.join('\n');
}

/**
 * The seed story's Activity history (activity.yaml), appended to data/events/ when there are no events yet. Its
 * times are moved so the story's "now" is the moment of seeding. Returns the day files it wrote.
 */
export async function seedActivity(store, { now = new Date().toISOString() } = {}) {
  if (await store.exists(['events'])) return [];
  const story = yaml.load(await fs.readFile(ACTIVITY_FILE, 'utf8'), { schema: yaml.CORE_SCHEMA });
  const shift = new Date(now).getTime() - new Date(story.anchor).getTime();
  const days = new Set();
  for (const [i, event] of story.events.entries()) {
    const at = new Date(new Date(event.at).getTime() + shift).toISOString();
    const segments = ['events', ...daySegments(at)];
    await store.appendYaml(segments, { id: `evt_seed${String(i + 1).padStart(2, '0')}`, type: event.type, at, actor: event.actor ?? null, payload: { ...event.payload, sampleData: true } });
    days.add(segments.join('/'));
  }
  return [...days];
}

/** True when DATA_DIR has nothing in it yet (first start). */
export async function isEmptyDir(dir) {
  const names = await fs.readdir(dir).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
  return names.length === 0;
}
