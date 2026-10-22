// NooblyJS Infrastructure as a hosted app (noobly structure.md §2a, ../nooblyjs-ai-host/.claude/steering/structure.md §2a). NooblyJS imports this
// file and calls register() with its Express app, its nooblyjs-core serverManager and what it shares (`host`);
// server.js does the same when the repo runs on its own, and the tests do it with test/fixtures/host.js. Nothing
// here listens on a port.
//
// The app owns its screens: the UI is a module (public/js/module.js) that the NooblyJS frame loads into its content
// area, and NooblyJS draws the rail and the sidebar from the description register() returns.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes/index.js';
import { createRepos } from './src/repos/index.js';
import { createProvisioner } from './src/provisioners/index.js';
import { createCost } from './src/services/cost.js';
import { createRuns } from './src/services/runs.js';
import { createDesigns } from './src/services/designs.js';
import { createDrafts } from './src/services/drafts.js';
import { createInfraChecks } from './src/services/checks-trace.js';
import { createEnvironments } from './src/services/environments.js';
import { createDrift } from './src/services/drift.js';
import { createPolicies } from './src/services/policies.js';
import { createSummary } from './src/services/summary.js';
import { createApprovals } from './src/services/approvals.js';
import { createSweep } from './src/services/sweep.js';
import { createPreviews } from './src/services/previews.js';
import { createReleases } from './src/services/releases.js';
import { withWords } from './src/services/event-words.js';
import { seed as seedStory } from './src/seed/index.js';

const NAME = 'infrastructure';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'can', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/** Sidebar rows (product.md §5): `path` is relative to the mount path, `icon` names a UI kit icon. */
export const NAV = [
  { key: 'environments', label: 'Environments', path: '/environments', icon: 'layers' },
  { key: 'designs', label: 'Designs', path: '/designs', icon: 'flow' },
  { key: 'runs', label: 'Provisioning runs', path: '/runs', icon: 'pulse', badge: 'runs' },
  { key: 'testing', label: 'Testing in environments', path: '/testing', icon: 'check' },
  { key: 'blueprints', label: 'Blueprints', path: '/blueprints', icon: 'grid', group: 'Govern' },
  { key: 'cost', label: 'Cost', path: '/cost', icon: 'chart', group: 'Govern' },
  { key: 'policies', label: 'Policies', path: '/policies', icon: 'key', group: 'Govern' },
];

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object, provisionStepMs?: number, sweepEveryMs?: number }} options
 *   provisionStepMs: the mock provisioner's pause for each 10% of a run (tests pass 0; INFRA_MOCK_STEP_MS sets it too)
 *   sweepEveryMs: how often to check whether the drift sweep is due (0: only when sweep() is called; for tests).
 *   INFRA_SWEEP_CHECK_MS sets it too (default one minute)
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/infrastructure', dataDir, host, provisionStepMs, sweepEveryMs = Number(process.env.INFRA_SWEEP_CHECK_MS) || 60_000 } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (noobly structure.md §2a).
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-infrastructure needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-ai-infrastructure needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /infrastructure, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-infrastructure needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-infrastructure needs host.${missing.join(', host.')} from the host.`);
  // Every event from here on carries `system: 'infrastructure'` and the sentence Activity shows (event-words.js).
  host = { ...host, events: withWords(host.events) };
  const provisioner = createProvisioner({
    name: process.env.INFRA_PROVISIONER || 'mock',
    stepMs: provisionStepMs ?? (process.env.INFRA_MOCK_STEP_MS === undefined ? 1200 : Number(process.env.INFRA_MOCK_STEP_MS) || 0),
  });

  // The host's logging and queueing providers, as instances named after this app (never ones of our own).
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const queue = serverManager.queue(serverManager.getDefaultProviderType('queueing'), { instanceName: NAME });
  // Business time comes from the host's clock, which NooblyJS's dev clock can move.
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).getTime();
  const seed = (options) => seedStory(host.store, { ...options, now });

  const repos = createRepos(host.store, { log });
  const deps = { repos, host, log, provisioner, queue, now, mountPath };
  const cost = createCost(deps);
  const runs = createRuns({ ...deps, cost });
  const approvals = createApprovals(deps);
  const designs = createDesigns({ ...deps, cost, runs, approvals });
  // NooblyJS Phase 26 (I7): Ines Tau drafts a new version of a design from the item's architecture, when a person asks.
  const drafts = createDrafts({ ...deps, approvals });
  // NooblyJS Phase 16f: the designs' policy checks in the one shape, and the designs in the trace.
  const infraChecks = createInfraChecks({ repos, designs, mountPath });
  const environments = createEnvironments({ ...deps, designs, runs });
  const drift = createDrift({ ...deps, designs, runs, approvals });
  const policies = createPolicies(deps);
  // The drift sweep is due every 6 business hours (the host's clock); a timer only checks whether it is.
  const sweep = createSweep({ ...deps, drift });
  const sweepTimer = sweepEveryMs > 0 ? setInterval(() => sweep.tick().catch((err) => log.warn(`drift sweep: ${err.message}`)), sweepEveryMs) : null;
  sweepTimer?.unref();
  const summary = createSummary({ ...deps, cost, runs, drift, designs, environments });
  // NooblyJS Phase 21 (I8): a preview per pull request the lifecycle records, destroyed when it merges.
  const previews = createPreviews({ ...deps, designs, runs });
  // NooblyJS Phase 22 (I10): Production changes only through a release (Operations' deployer).
  const releases = createReleases(deps);
  const offPreviews = [
    host.events.on?.('pr.recorded', (event) => previews.onPrRecorded(event?.payload ?? event).catch((err) => log.warn(`preview: ${err.message}`))),
    host.events.on?.('pr.merged', (event) => previews.onPrMerged(event?.payload ?? event).catch((err) => log.warn(`preview: ${err.message}`))),
    // NooblyJS Phase 26 (I7): an accepted ADR or a changed architecture offers a new draft of the item's designs.
    host.events.on?.('adr.accepted', (event) => drafts.offer(event).catch((err) => log.warn(`redraft: ${err.message}`))),
    host.events.on?.('architecture.updated', (event) => drafts.offer(event).catch((err) => log.warn(`redraft: ${err.message}`))),
  ];

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, seed, designs, environments, runs, drift, policies, cost, summary, releases, drafts, about: { name: NAME, version: VERSION, mountPath, provisioner: provisioner.name } }));
  // The browser files (module, pages, CSS). redirect: false, or /infrastructure would 301 to /infrastructure/.
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the host's frame answers it, so deep links and refresh
  // land on the right screen. A missing .js or .css is still a 404.
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  // Runs that were queued or under way when the process last stopped are picked up again.
  await runs.recover();

  return {
    name: NAME,
    label: 'Infra',
    title: 'infrastructure',
    // 'cube': Platform already has 'layers' on the rail.
    icon: 'cube',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/infrastructure.css'] },
    nav: NAV,
    /** The sidebar's status card ("1 drift detected", live environments, cloud spend) and the runs badge. */
    // The lifecycle engine mounts after this app, so the design approvals are opened there on the first status call
    // (the frame asks for it on every page), once.
    status: async () => {
      await approvals.syncAll().catch((err) => log.warn(`approvals: ${err.message}`));
      return summary.status();
    },
    // What other apps may call (structure.md §6).
    services: {
      ...summary.services,
      /** A month's cloud spend per lifecycle item: { month, items, unattributed, basis } (Phase 17, Metrics' spend by value stream). */
      cloudByItem: (month) => cost.byItem(month),
      /** A month of an item's infrastructure in production, from its design: { usd, perDay, design } or null (Phase 17). */
      monthlyCostFor: (itemId) => cost.monthlyFor(itemId),
      /** Phase 22: Operations' deployer applies an approved release to a product's Production ({ product, releaseId, approvalId, version, deployed, percent, by }). */
      deployRelease: (input) => releases.deployRelease(input),
      /** Phase 22: Production returns to what was there before the release ({ product, releaseId, reason, by }). */
      rollbackRelease: (input) => releases.rollbackRelease(input),
      /** Phase 22: what a release of an item would put in production ({ itemId }): its product, Staging's and Production's versions. */
      releaseCandidate: (input) => releases.candidate(input),
      /** Phase 21: one environment as the Test section needs it to run its suites, or null. */
      environment: (name) => environments.environment(name),
      /** Phase 21: the suites that ran in an environment ({ environment, suites, testRunId }). */
      recordTests: (input) => environments.recordTests(input),
      /** Phase 21: a pull request's preview ({ name, status, url, tests, href }), or null. */
      async previewForPr(prId) {
        const env = (await repos.environments.listAll()).filter((e) => e.kind === 'preview' && e.prId === prId).at(-1);
        if (!env) return null;
        return { name: env.name, status: env.status, url: env.url ?? null, tests: env.tests ?? [], testRunId: env.testRunId ?? null, testedAt: env.testedAt ?? null, destroyedAt: env.destroyedAt ?? null, href: `${mountPath}/environments/${env.name}` };
      },
      /** The policy checks of the item's designs, per kind of environment, in NooblyJS's one shape (Phase 16f). */
      checksFor: (itemId) => infraChecks.checksFor(itemId),
      /** The item's designs, linked to it: { nodes, links } (Phase 16f). */
      trace: (itemId) => infraChecks.trace(itemId),
      /**
       * The lifecycle engine's `infra-design` approval was decided on Home · Approvals: decide the design exactly as
       * the Design screen does (same rules, same refusals). The engine records the approval once this returns.
       */
      async decideApproval({ designId, version, kind, decision, comment = null, person }) {
        const design = await repos.designs.get(designId);
        if (design && version != null && design.version !== version) {
          const err = new Error(`${designId} is at version ${design.version} now; this approval was for version ${version}. Decide it on the design.`);
          throw Object.assign(err, { status: 409, code: 'stale_version' });
        }
        return designs.decide(designId, { decision, kind, comment }, person, null, { via: 'workflows' });
      },
    },
    /** Opens or withdraws the lifecycle engine approvals so they match every design (tests, and at start). */
    syncApprovals: () => approvals.syncAll(),
    /** Writes the seed story into dataDir; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seed({ reset, content });
    },
    /** Stops the run in progress (it resumes at the next start) and waits for the queue to settle. */
    close: async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      for (const off of offPreviews) off?.();
      await runs.close();
    },
    /** For the tests, and a person in a hurry: the drift sweep's due check, and the sweep itself. */
    sweep: { tick: () => sweep.tick(), now: () => sweep.sweep() },
    /** For the tests: resolves when no run is queued or running. */
    idle: () => runs.idle(),
  };
}
