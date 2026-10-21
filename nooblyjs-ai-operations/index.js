// NooblyJS Operations as a hosted app (noobly structure.md §2a, ../nooblyjs-ai-host/.claude/steering/structure.md §2a;
// root roadmap Phase 22). NooblyJS imports this file and calls register() with its Express app, its nooblyjs-core
// serverManager and what it shares (`host`); server.js does the same when the repo runs on its own, and the tests do it
// with test/fixtures/host.js. Nothing here listens on a port.
//
// Part 1 (Phase 22): releases and deployments. A release is one feature, with its evidence, release notes, rollout and
// rollback plans; two people give its deploy approval; the deployer adapter (mock until a tool is chosen) applies it
// through Infrastructure. Part 2 (Phase 23) adds SLOs, incidents and outcome reviews. Its UI is a module the frame loads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes/index.js';
import { createRepos } from './src/repos/index.js';
import { createDeployer } from './src/deployers/index.js';
import { createPolicies } from './src/services/policies.js';
import { createEvidence } from './src/services/evidence.js';
import { createNotes } from './src/services/notes.js';
import { createReleases } from './src/services/releases.js';
import { createSummary } from './src/services/summary.js';
import { withWords } from './src/services/event-words.js';
import { seed as seedStory } from './src/seed/index.js';

const NAME = 'operations';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'can', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/** Sidebar rows: `path` is relative to the mount path, `icon` names a UI kit icon. */
export const NAV = [
  { key: 'releases', label: 'Releases', path: '/releases', icon: 'box', badge: 'releases' },
  { key: 'deployments', label: 'Deployments', path: '/deployments', icon: 'upload' },
  { key: 'policies', label: 'Policies', path: '/policies', icon: 'key', group: 'Govern' },
];

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object }} options
 *   OPERATIONS_DEPLOYER names the deployer (only `mock` exists).
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/operations', dataDir, host } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted.
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-operations needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-ai-operations needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /operations, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-operations needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-operations needs host.${missing.join(', host.')} from the host.`);
  // Every event from here on carries `system: 'operations'` and the sentence Activity shows (event-words.js).
  host = { ...host, events: withWords(host.events) };
  const deployer = createDeployer({ name: process.env.OPERATIONS_DEPLOYER || 'mock', host });

  // The host's logging provider, as an instance named after this app (never one of our own).
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  // Business time comes from the host's clock, which NooblyJS's dev clock can move.
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).getTime();
  const seed = (options) => seedStory(host.store, { ...options, now });

  const repos = createRepos(host.store, { log });
  const policies = createPolicies({ repos, deployer });
  const evidence = createEvidence({ host });
  const notes = createNotes({ host, policies });
  const releases = createReleases({ repos, host, log, policies, evidence, notes, deployer, now, mountPath });
  const summary = createSummary({ releases });

  // The release's deploy approval was decided (the lifecycle engine): two approvals deploy its first step.
  const offDecided = host.events.on?.('approval.decided', (event) => {
    releases.onApprovalDecided(event?.payload ?? event).catch((err) => log.warn(`releases: ${err.message}`));
  });

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, seed, releases, policies, summary, about: { name: NAME, version: VERSION, mountPath, deployer: deployer.name, realDeployer: deployer.real } }));
  // The browser files (module, pages, CSS). redirect: false, or /operations would 301 to /operations/.
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the host's frame answers it, so deep links and refresh work.
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  return {
    name: NAME,
    label: 'Ops',
    title: 'operations',
    icon: 'upload',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/operations.css'] },
    nav: NAV,
    /** The sidebar's status card (releases waiting for approvers, pilots) and the releases badge. */
    status: () => summary.status(),
    // What other apps may call (host.service('operations'); the host's tech.md §8b).
    services: {
      /** One release, or null. NooblyJS's write gate asks whether two people approved it. */
      releaseFor: (id) => releases.releaseFor(id),
      /** Releases, as the pages show them. */
      releases: () => releases.list(),
      /**
       * The lifecycle engine relays each person's decision on a release's deploy approval (Home · Approvals or this
       * app) before it records it: the same checks as here. Two approvals then deploy (approval.decided).
       */
      decideApproval: ({ id, decision, person }) => releases.decideApproval({ id, decision, person }),
    },
    /** Writes the seed into dataDir; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seed({ reset, content });
    },
    close: async () => {
      offDecided?.();
    },
  };
}
