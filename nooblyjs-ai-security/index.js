// NooblyJS Security as a hosted app (noobly structure.md §2a, ../nooblyjs-ai-host/.claude/steering/structure.md §2a;
// root roadmap Phase 19). NooblyJS imports this file and calls register() with its Express app, its nooblyjs-core
// serverManager and what it shares (`host`); server.js does the same when the repo runs on its own, and the tests do it
// with test/fixtures/host.js. Nothing here listens on a port.
//
// The app owns threat models, findings, risk acceptances and policies, and scans every Software Factory run through its
// scanner adapter (mock until a scanner is approved). Its UI is a module (public/js/module.js) the frame loads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes/index.js';
import { createRepos } from './src/repos/index.js';
import { createScanner } from './src/scanners/index.js';
import { createPolicies } from './src/services/policies.js';
import { createFindings } from './src/services/findings.js';
import { createScans } from './src/services/scans.js';
import { createApprovals } from './src/services/approvals.js';
import { createThreatModels } from './src/services/threat-models.js';
import { createSummary } from './src/services/summary.js';
import { createChecksTrace } from './src/services/checks-trace.js';
import { withWords } from './src/services/event-words.js';
import { seed as seedStory } from './src/seed/index.js';

const NAME = 'security';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'can', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

/** Sidebar rows: `path` is relative to the mount path, `icon` names a UI kit icon. */
export const NAV = [
  { key: 'threat-models', label: 'Threat models', path: '/threat-models', icon: 'flow' },
  { key: 'findings', label: 'Findings', path: '/findings', icon: 'alert', badge: 'findings' },
  { key: 'risks', label: 'Risk register', path: '/risks', icon: 'list' },
  { key: 'policies', label: 'Policies', path: '/policies', icon: 'key', group: 'Govern' },
];

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object, sweepEveryMs?: number }} options
 *   sweepEveryMs: how often to look for risk acceptances that have expired (0: only when findings are read; tests).
 *   SECURITY_SWEEP_MS sets it too (default one minute). SECURITY_SCANNER names the scanner (only `mock` exists).
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/security', dataDir, host, sweepEveryMs = Number(process.env.SECURITY_SWEEP_MS) || 60_000 } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted.
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-security needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-ai-security needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /security, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-security needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-security needs host.${missing.join(', host.')} from the host.`);
  const scanner = createScanner({ name: process.env.SECURITY_SCANNER || 'mock' });
  // Every event from here on carries `system: 'security'` and the sentence Activity shows (event-words.js).
  host = { ...host, events: withWords(host.events) };

  // The host's logging provider, as an instance named after this app (never one of our own).
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  // Business time comes from the host's clock, which NooblyJS's dev clock can move: fix-by dates and expiries use it.
  const now = () => new Date(host.clock?.now?.() ?? Date.now()).getTime();
  const seed = (options) => seedStory(host.store, { ...options, now });

  const repos = createRepos(host.store, { log });
  const policies = createPolicies({ repos, scanner });
  const findings = createFindings({ repos, host, log, policies, now, mountPath });
  const scans = createScans({ repos, host, scanner, policies, findings, now });
  const approvals = createApprovals({ host, log, mountPath });
  const threatModels = createThreatModels({ repos, host, log, policies, approvals, now, mountPath });
  const summary = createSummary({ host, findings, threatModels, now });
  const checksTrace = createChecksTrace({ findings, threatModels, mountPath });

  // An accepted risk whose expiry passed is open again; a timer only looks, on the business clock.
  const sweepTimer = sweepEveryMs > 0 ? setInterval(() => findings.expireDue().catch((err) => log.warn(`risk expiry: ${err.message}`)), sweepEveryMs) : null;
  sweepTimer?.unref();
  // A fix run delivered its pull request: the finding links to it.
  const offRun = host.events.on?.('run.finished', (event) => {
    findings.onRunFinished(event?.payload ?? event).catch((err) => log.warn(`findings: ${err.message}`));
  });

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, seed, threatModels, findings, scans, policies, summary, about: { name: NAME, version: VERSION, mountPath, scanner: scanner.name, realScanner: scanner.real } }));
  // The browser files (module, pages, CSS). redirect: false, or /security would 301 to /security/.
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the host's frame answers it, so deep links and refresh work.
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  return {
    name: NAME,
    label: 'Security',
    title: 'security',
    icon: 'key',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/security.css'] },
    nav: NAV,
    /** The sidebar's status card (findings past fix-by, threat models waiting, the scanner) and the findings badge. */
    status: () => summary.status(),
    // What other apps may call (host.service('security'); the host's tech.md §8b).
    services: {
      /** An item's threat model, or null. */
      threatModelFor: (itemId) => threatModels.forItem(itemId),
      /** The security agent drafts the item's threat model (a person asked; Design · Solution architecture). */
      draftThreatModel: ({ itemId, actor }) => threatModels.draft(itemId, actor),
      /** Findings by item or repository: { itemId } | { repo }. */
      findingsFor: (ref = {}) => findings.list({ itemId: ref.itemId, repo: ref.repo, state: ref.state }),
      /** What a release of the item carries: its open findings and accepted risks (Phase 22 reads it). */
      riskFor: async ({ itemId } = {}) => {
        const all = await findings.list({ itemId });
        return { open: all.filter((f) => f.state === 'open' || f.state === 'fixing'), accepted: all.filter((f) => f.state === 'accepted') };
      },
      /** Phase 21: an environment's DAST or image scan, as one of its suites (the Factory's Test section asks). */
      scanEnvironment: (input) => scans.scanEnvironment(input),
      /** The Software Factory scans a run's commit: each kind is a gate, with the SBOM (scans.js). */
      scanChange: (input) => scans.scanChange(input),
      /** A person accepts a finding's risk, relayed by another app; an agent is refused and audited. */
      acceptRisk: ({ findingId, actor, ...body }) => findings.acceptRisk(findingId, body, actor),
      /** The Security engineer's home (NooblyJS For you). */
      home: () => summary.home(),
      /** The item's threat model acceptance and findings, in NooblyJS's one shape (Phase 16f). */
      checksFor: (itemId) => checksTrace.checksFor(itemId),
      /** The item's threat model, threats, mitigations and findings: { nodes, links } (Phase 16f). */
      trace: (itemId) => checksTrace.trace(itemId),
      /**
       * The lifecycle engine's `threat-model` approval was decided on Home · Approvals: decide the threat model exactly
       * as its screen does (same rules, same refusals). The engine records the approval once this returns.
       */
      async decideApproval({ id, version, decision, comment = null, person }) {
        return threatModels.decide(id, { decision, comment, version }, person, { via: 'workflows' });
      },
    },
    /** Writes the seed story into dataDir; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seed({ reset, content });
    },
    close: async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      offRun?.();
    },
    /** For the tests: the expiry sweep. */
    sweep: () => findings.expireDue(),
  };
}
