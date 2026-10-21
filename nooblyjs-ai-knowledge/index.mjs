// The Wiki as a NooblyJS hosted app (noobly structure.md §2a, ../nooblyjs-ai-host/.claude/steering/structure.md §2a). NooblyJS imports
// this file and calls register() with its Express app, its nooblyjs-core serverManager and what it shares (`host`);
// the tests do the same with the stand-in host in test/fixtures/host.mjs. Nothing here listens on a port.
//
// The platform's API modules (src/datasources, src/wiki) are CommonJS written for the standalone Express 4 app
// (app.js). They run here unchanged behind src/hosted/platform.cjs, which builds their core services from the
// host's registry and maps their routes under <mountPath>/api/v1. See "Hosted in NooblyJS" in CLAUDE.md.
//
// NooblyJS draws the rail and the sidebar from the description register() returns, and loads the UI module
// (public/js/module.js) into its content area.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApi, apiNotFound } from './src/hosted/api.mjs';

const require = createRequire(import.meta.url);

const NAME = 'wiki';
export const DEFAULT_MOUNT_PATH = '/wiki';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(ROOT, 'public');
// public/ also holds the standalone platform's landing page and documents. The hosted app never serves a page of
// its own (the frame is the only HTML), so these are refused rather than served as files.
const NOT_SERVED = new Set(['.html', '.htm', '.md']);
// Folders the browser loads files (or the API) from. A URL under one of them is never a page.
const FILE_FOLDERS = /^\/(api|app|js|css|vendor|images|services|media|avatars)\//;

/**
 * Sidebar rows: `path` is relative to the mount path, `icon` names a UI kit icon (/ui/js/icons.js). The wiki itself
 * takes the whole area (layout: 'full'), so these show beside the datasources screens (standalone:
 * /applications/datasources), which is what the rows after the first one are. From the wiki, the way in is the
 * Administration link in its top bar (public/js/pages/wiki.js). Everyone signed in to NooblyJS sees them: no row asks
 * for a permission.
 */
export const NAV = [
  { key: 'home', label: 'Wiki', path: '/', icon: 'book' },
  { key: 'dashboard', label: 'Dashboard', path: '/datasources', icon: 'chart', group: 'Administration' },
  { key: 'workflows', label: 'Workflows', path: '/datasources/workflows', icon: 'flow', group: 'Workflow' },
  { key: 'schedules', label: 'Schedules', path: '/datasources/schedules', icon: 'clock', group: 'Workflow' },
  { key: 'executions', label: 'Execution history', path: '/datasources/executions', icon: 'list', group: 'Workflow' },
  { key: 'repositories', label: 'Repositories', path: '/datasources/repositories', icon: 'repo', group: 'Content' },
  { key: 'spaces', label: 'Spaces', path: '/datasources/spaces', icon: 'layers', group: 'Content' },
  { key: 'sources', label: 'Sources', path: '/datasources/sources', icon: 'download', group: 'Content' },
  { key: 'needs-review', label: 'Needs review', path: '/datasources/needs-review', icon: 'alert', group: 'Content', badge: 'needs-review' },
  { key: 'agents', label: 'Agents', path: '/datasources/agents', icon: 'spark', group: 'AI' },
  { key: 'prompts', label: 'Prompts', path: '/datasources/prompts', icon: 'pen', group: 'AI' },
  { key: 'user-activity', label: 'Users', path: '/datasources/user-activity', icon: 'users', group: 'System' },
  { key: 'settings', label: 'Settings', path: '/datasources/settings', icon: 'settings', group: 'System' },
];

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or the test stand-in)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object, platform?: boolean }} options
 *   platform: false mounts the frame's files and /about only, without the platform's API modules (the contract
 *   tests, which run on a stand-in serverManager)
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = DEFAULT_MOUNT_PATH, dataDir, host, platform = true } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (noobly structure.md §2a).
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-knowledge needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-ai-knowledge needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /wiki, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-knowledge needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-knowledge needs host.${missing.join(', host.')} from the host.`);

  // The host's logging provider, as an instance named after this app, so its lines are labelled.
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const about = { name: NAME, version: VERSION, mountPath };

  // Where the platform keeps its files. WIKI_APP_BASE_DIR points it at an existing standalone .application folder.
  const appBaseDir = process.env.WIKI_APP_BASE_DIR ? path.resolve(process.env.WIKI_APP_BASE_DIR) : dataDir;

  const router = host.express.Router();
  // Everything the browser is not handed as a plain file is signed-in only: the API, uploaded media and avatars.
  router.use(['/api/v1', '/media', '/avatars'], host.auth);
  router.use('/api/v1', createApi({ host, about: { ...about, hosted: { platform } } }));
  let mounted = null;
  if (platform) {
    const { mountPlatform } = require('./src/hosted/platform.cjs');
    mounted = await mountPlatform({ router, hostApp: app, registry: serverManager, appBaseDir, host, mountPath, onBroadcast: (b) => broadcast(host, log, b) });
  }
  router.use('/api/v1', apiNotFound);
  const topLevel = (req) => req.path.indexOf('/', 1) === -1;
  router.use((req, res, next) => (topLevel(req) && NOT_SERVED.has(path.extname(req.path).toLowerCase()) ? res.status(404).end() : next()));
  // The browser files (module, pages, CSS). redirect: false, or /wiki would 301 to /wiki/ (public/ is a folder).
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET is a page, answered by the host's frame so deep links and refresh land on the right screen.
  // A wiki location is <Space>/<folders>/<document.md>, so an extension does not make a URL a file here: what is
  // a file is anything in a folder the browser loads files from, and those still answer 404 when missing.
  router.get('/{*rest}', (req, res, next) => {
    const file = FILE_FOLDERS.test(req.path) || (topLevel(req) && path.extname(req.path));
    return file ? next() : host.frame(req, res, next);
  });
  app.use(mountPath, router);
  /** Knowledge on top of the wiki (src/wiki/knowledge), or null when the platform is not mounted. */
  const knowledge = () => mounted?.app.get('knowledge') ?? null;
  log.info(`mounted ${NAME} at ${mountPath} (data: ${dataDir})`);

  return {
    name: NAME,
    label: 'Wiki',
    icon: 'book',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/wiki-app.css', 'css/wiki-ds.css', 'css/wiki-hosted.css'] },
    nav: NAV,
    /** The sidebar's status card: how many spaces there are, and how many documents need review (the nav badge). */
    async status() {
      const spaces = mounted?.app.get('spaceManager')?.spaces;
      const count = spaces instanceof Map ? spaces.size : Array.isArray(spaces) ? spaces.length : null;
      if (count === null) return { badges: {}, card: { pill: { text: 'Wiki', tone: 'neutral' } } };
      const known = await knowledge()?.service.status().catch(() => null);
      return {
        badges: known?.needsReview ? { 'needs-review': known.needsReview } : {},
        card: {
          pill: { text: `${count} space${count === 1 ? '' : 's'}`, tone: 'info' },
          ...(known ? { items: [{ label: 'Imported', value: `${known.documents} document${known.documents === 1 ? '' : 's'} · ${known.sources} source${known.sources === 1 ? '' : 's'}` }] } : {}),
        },
      };
    },
    // Other apps ask for Knowledge by what it is, not by this app's name (NooblyJS Phase 8).
    provides: ['knowledge'],
    // What other apps may call through host.service('knowledge'): see src/wiki/knowledge/index.js.
    services: {
      contextFor: async (query) => (await knowledge()?.service.contextFor(query)) ?? [],
      search: async (query, options) => (await knowledge()?.service.search(query, options)) ?? [],
      find: async (query, options) => (await knowledge()?.service.find(query, options)) ?? { files: [], folders: [] },
      locate: async (link) => (await knowledge()?.service.locate(link)) ?? null,
      contextOf: async (links, options) => (await knowledge()?.service.contextOf(links, options)) ?? [],
      flagged: async () => (await knowledge()?.service.flagged()) ?? [],
      status: async () => (await knowledge()?.service.status()) ?? null,
      /** NooblyJS Phase 23: a page another app writes for a person (a post-incident review): { spaceName, path, href } or null. */
      writePage: async (input) => (await knowledge()?.service.writePage(input)) ?? null,
    },
    /**
     * The platform writes its own first-run files (default space, settings) when it starts. The seed adds the
     * sample export for the PRD-031 story (an Enterprise Space with the process model, a Acme Space), once.
     */
    seed: async ({ content = host.sampleData !== false } = {}) => {
      // No sample content (a blank NooblyJS): the wiki's own first-run files only, and no sample export.
      if (!content) return;
      const made = await knowledge()?.importer.importSample({ by: 'system', once: true });
      if (made) log.info(`${NAME}: the sample export is imported (${made.documents} documents)`);
    },
    /** Stops the workflow bridge. The core services are the host's to shut down. */
    close: async () => {
      await mounted?.close();
    },
  };
}

/**
 * The platform's Socket.IO broadcasts, as NooblyJS events (the frame's one event stream carries them to every tab).
 * A message to one person's room is announced without its content, so nobody else's stream carries it: that
 * person's page fetches the notification itself.
 */
function broadcast(host, log, { event, payload, room }) {
  const emit = (type, body) => Promise.resolve(host.events.emit(type, body)).catch((err) => log.warn(`could not emit ${type}: ${err.message}`));
  if (room?.startsWith('user:')) return emit('wiki.user_notified', { userId: room.slice(5) });
  if (event === 'wiki:file-change') return emit('wiki.file_changed', payload ?? {});
  return emit('wiki.broadcast_sent', { event, payload: payload ?? null });
}
