// The Test section of the Software Factory (Phase 16d, root product.md §3.2b, §4): quality, built inside the Factory.
// It starts with Test analysis: for each story in Engineer, test cases from its acceptance criteria (given/when/then),
// which the AI must automate and at which level (the test policy), a contract test per interface, an E2E test for its
// journey and what a person checks by hand, each marked ready by a test analyst. The Factory's register()
// (src/services/sections.js) mounts it at /factory/quality, its data in data/factory/quality; its pages are in
// public/quality/. Its Test analysis row sits in the sidebar's Engineering group. Phase 20 adds test runs (each verify
// of a commit by the line, recorded against the story's cases and requirements), coverage of an item, its features and
// stories, and defects (lifecycle items, raised here). Their pages are the Factory's Test group (public/js/pages/
// testing.js). register() takes the same arguments as a hosted app's, so its tests mount it on its own. Nothing here
// listens on a port.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes.js';
import { createAnalysis } from './src/services/analysis.js';
import { createRuns } from './src/services/runs.js';
import { createCoverage } from './src/services/coverage.js';
import { createDefects } from './src/services/defects.js';
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
  const runs = createRuns({ host, log, analysis });
  const coverage = createCoverage({ host, analysis, runs });
  const defects = createDefects({ host, runs });
  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, analysis, runs, coverage, defects, about: { name: NAME, version: VERSION, mountPath } }));
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  // Phase 20: Design changed a story's criterion: its test cases are "criterion changed" for a person (Activity says so).
  const offCriterion = host.events.on?.('design.criterion_changed', (event) => {
    const p = event?.payload ?? event ?? {};
    analysis.view(p.storyId).then((v) => {
      const flagged = v.cases.filter((c) => c.criterion === p.index && c.criterionChanged).map((c) => c.id);
      if (!flagged.length) return null;
      return host.events.emit('quality.cases_flagged', { system: 'factory', section: 'quality', itemId: p.storyId, storyId: p.storyId, cases: flagged, criterion: p.ref ?? null, summary: `marked ${flagged.join(', ')} of ${p.storyId} "criterion changed": a person checks ${flagged.length === 1 ? 'it' : 'them'}` }, { actor: null });
    }).catch((err) => log.warn?.(`quality: the cases of ${p.storyId} were not flagged: ${err.message}`));
  });

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
      /** Phase 20: the line verified a commit: a test run (the Factory's hosted.js calls it from its log). */
      recordGates: (input) => runs.recordGates(input),
      /** Phase 20: deliver looked for each required test in the commit: the run's cases get their result. */
      recordRequired: (input) => runs.recordRequired(input),
      /** Test runs of a story or an item, newest first. */
      testRuns: (input) => runs.list(input),
      /** Coverage of an item (or a story), its features and stories, in words; null when there is no such item. */
      coverageOf: (itemId) => coverage.coverageOf(itemId),
      /** Coverage of every item with stories past Design. */
      coverage: () => coverage.all(),
      /** Criteria with no passing test, per story in Build or Test (the tester's home). */
      gaps: () => coverage.gaps(),
      /** Defects, as the pages show them. */
      defects: (input) => defects.list(input),
      /** Raise a defect from a failing test run ({ testRunId, title?, severity?, caseId?, requirementId?, actor }). */
      raiseDefect: ({ testRunId, actor, ...body } = {}) => defects.raiseFromRun(testRunId, body, actor),
      /** Decide a defect ({ defectId, decision, reason, actor }): the lifecycle engine checks who. */
      decideDefect: ({ defectId, actor, ...body } = {}) => defects.decide(defectId, body, actor),
    },
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seedSection(host.store, { reset, content, now: () => new Date(host.clock?.now?.() ?? Date.now()).toISOString() });
    },
    close: async () => { offCriterion?.(); },
  };
}
