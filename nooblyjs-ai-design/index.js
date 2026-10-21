// NooblyJS Design: a hosted app at /design (CHG-009, 2026-10-21; Phase 16c, root product.md §3.2a). Business
// requirements, the solution architecture (impacted systems, NFRs, the feature landscape), the functional analysis
// (interface and technical requirements) and the stories, each handed to Engineering on its own. It was a section of
// the Software Factory (/factory/design) until CHG-009; an install's data/factory/design moves to data/design once.
//
// Its Architecture rows are the Product app's architecture pages (moved under Design in Phase 16b): the code and API
// stay Product's (/product/api/v1), and this app's UI module draws them in Product's scope (public/js/module.js).
// Nothing here listens on a port.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes.js';
import { createDesignRepo } from './src/repo.js';
import { createCatalogue } from './src/services/catalogue.js';
import { createDrafter } from './src/services/drafter.js';
import { createDesignService } from './src/services/design.js';
import { createDesignTrace } from './src/services/trace.js';
import { seed as seedCatalogue } from './src/seed/index.js';

const NAME = 'design';
// One or more path segments (/design, or deeper for a host that nests it).
const MOUNT = /^(\/[a-z0-9][a-z0-9-]{0,62})+$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
// Where the Product app is: the Architecture rows are its pages, drawn with its stylesheet.
const PRODUCT_PATH = '/product';

/** Sidebar rows (root product.md §4, the Design group): `path` is relative to the mount path. */
export const NAV = [
  // The Product app's architecture pages (Phase 16b), drawn here (public/js/module.js).
  { key: 'architecture', label: 'Architecture', path: '/architecture', icon: 'cube' },
  { key: 'requirements', label: 'Business requirements', path: '/requirements', icon: 'doc' },
  { key: 'solution', label: 'Solution architecture', path: '/solution', icon: 'layers' },
  { key: 'functional', label: 'Functional analysis', path: '/functional', icon: 'flow' },
  { key: 'stories', label: 'Stories', path: '/stories', icon: 'list' },
  { key: 'handoff', label: 'Handoff to the Factory', path: '/handoff', icon: 'handoff' },
];

/**
 * @param {import('express').Express} app   the host's app
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object }} options
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/design', dataDir, host } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (noobly structure.md §2a).
  if (typeof app?.use !== 'function') throw new Error("The Design section needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('The Design section needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /design, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('The Design section needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`The Design section needs host.${missing.join(', host.')} from the host.`);

  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const repo = createDesignRepo(host.store);
  const catalogue = createCatalogue({ store: host.store, log });
  const drafter = createDrafter({ host, log });
  const design = createDesignService({ host, repo, catalogue, drafter, log, mountPath });
  const designTrace = createDesignTrace({ repo, host });

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, design, catalogue, drafter, about: { name: NAME, version: VERSION, mountPath } }));
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the host's frame answers it.
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  return {
    name: NAME,
    label: 'Design',
    icon: 'pen',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/design.css', `${PRODUCT_PATH}/css/product.css`] },
    nav: NAV,
    /** The sidebar's status card. */
    async status() {
      const s = await design.status();
      return { badges: {}, card: { pill: { text: s.text, tone: s.inDesign ? 'info' : 'neutral' } } };
    },
    // What other apps may call (host.service('design')).
    services: {
      /** Design's readiness checks for an item ({ itemId, facts }), or null when it has no Design work. */
      readinessFacts: (itemId) => design.readinessFacts(itemId),
      /** One item's design, as its page shows it. */
      designFor: (itemId) => design.view(itemId).catch(() => null),
      /** The items in Design, each part in words. */
      items: () => design.items(),
      /** The NFR catalogue: categories, each with its prompt and entries (NooblyJS Phase 18: the elicitation's walk). */
      nfrCatalogue: () => catalogue.read(),
      /** Its part of an item's trace (NooblyJS Phase 16f): requirements, features, stories, criteria, interfaces. */
      trace: (itemId) => designTrace.trace(itemId),
      /** A person's acceptance of a business requirement, relayed by another app; an agent is refused and audited. */
      acceptRequirement: ({ itemId, requirementId, actor }) => design.acceptRequirement(itemId, requirementId, actor),
    },
    /** Writes the NFR catalogue and, with sample content, the sample designs; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seedCatalogue(host.store, { reset, content, now: () => new Date(host.clock?.now?.() ?? Date.now()).toISOString() });
    },
    close: async () => {},
  };
}
