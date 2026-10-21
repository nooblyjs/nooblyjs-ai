// The Test section of the Software Factory (Phase 16d, root product.md §3.2b, §4): quality, built inside the Factory.
// It starts with Test analysis: for each story in Engineer, test cases from its acceptance criteria (given/when/then),
// which the AI must automate and at which level (the test policy), a contract test per interface, an E2E test for its
// journey and what a person checks by hand, each marked ready by a test analyst. The Factory's register()
// (src/services/sections.js) mounts it at /factory/quality, its data in data/factory/quality; its pages are in
// public/quality/. Its Test analysis row sits in the sidebar's Engineering group. Test approvals, runs, coverage and
// defects come into it with Phases 16e and 20. register() takes the same arguments as a hosted app's, so its tests
// mount it on its own. Nothing here listens on a port.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes.js';
import { createAnalysis } from './src/services/analysis.js';
import { seed as seedSection } from './src/seed/index.js';

const NAME = 'quality';
const MOUNT = /^(\/[a-z0-9][a-z0-9-]{0,62})+$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'quality');

/** Sidebar rows: `factoryGroup` puts a row in one of the Factory's own groups (Test analysis is Engineering's). */
export const NAV = [
  { key: 'test-analysis', label: 'Test analysis', path: '/test-analysis', icon: 'list', factoryGroup: 'Engineering' },
];

/**
 * @param {import('express').Express} app
 * @param {object} serverManager
 * @param {{ mountPath?: string, dataDir: string, host: object }} options
 */
export async function register(app, serverManager, { mountPath = '/quality', dataDir, host } = {}) {
  if (typeof app?.use !== 'function') throw new Error("The Test section needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('The Test section needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /quality, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('The Test section needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`The Test section needs host.${missing.join(', host.')} from the host.`);

  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const analysis = createAnalysis({ host, log });
  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, analysis, about: { name: NAME, version: VERSION, mountPath } }));
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  return {
    name: NAME,
    label: 'Test',
    icon: 'approve',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/quality.css'] },
    nav: NAV,
    /** The Factory's status card: how far the test analysis is. */
    async status() {
      const list = await analysis.stories().catch(() => []);
      const criteria = list.reduce((n, s) => n + s.summary.criteria, 0);
      const ready = list.reduce((n, s) => n + s.summary.ready, 0);
      return { badges: {}, card: { pill: { text: list.length ? `${ready} of ${criteria} criteria ready across ${list.length} ${list.length === 1 ? 'story' : 'stories'}` : 'No story in Engineer', tone: list.length && ready < criteria ? 'warning' : 'neutral' } } };
    },
    // What other apps may call (host.service('quality')).
    services: {
      /** The sign-off's test checks for a story ({ storyId, facts }), or null when it is not a story. */
      readinessFacts: (storyId) => analysis.readinessFacts(storyId),
      /** The test cases a work item on one repository carries. */
      casesFor: (storyId, repo) => analysis.casesFor(storyId, repo),
      /** Its part of an item's trace (NooblyJS Phase 16f): the test cases and what each verifies. */
      trace: (itemId) => analysis.trace(itemId),
      /** A story's coverage in words. */
      summaryFor: (storyId) => analysis.summaryOf(storyId),
      /** The stories in Engineer with their coverage. */
      stories: () => analysis.stories(),
    },
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seedSection(host.store, { reset, content, now: () => new Date(host.clock?.now?.() ?? Date.now()).toISOString() });
    },
    close: async () => {},
  };
}
