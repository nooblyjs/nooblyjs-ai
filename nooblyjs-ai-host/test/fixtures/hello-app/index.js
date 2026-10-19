// A stub hosted app that proves the register() contract (structure.md §2a, roadmap Phase 0 step 9).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export async function register(app, serverManager, { mountPath = '/hello', dataDir, host }) {
  if (!serverManager?.initialized) throw new Error('hello-app needs an initialised serverManager');
  const router = host.express.Router();
  // redirect: false, or /hello would 301 to /hello/ because public/ is a folder.
  router.use(host.express.static(publicDir, { index: false, redirect: false }));

  router.get('/api/v1/ping', host.auth, (req, res) => res.json({ pong: true, person: req.person.id, dataDir }));
  router.post('/api/v1/notes', host.auth, host.requireRole('draft'), host.audit, async (req, res, next) => {
    try {
      const id = `note-${Date.now()}`;
      await host.store.writeDoc(['notes', `${id}.md`], { id, by: req.person.id }, String(req.body?.text ?? ''));
      await host.events.emit('hello.note_added', { id }, { actor: req.person.id });
      res.status(201).json({ id });
    } catch (err) {
      next(err);
    }
  });
  router.get('/api/v1/greeting', host.auth, (req, res) => res.json({ text: host.service('hello-app')?.greet(req.person.name) }));
  // A section's services, under a name of their own (`provides` as an object, as the Software Factory does).
  router.get('/api/v1/section-greeting', host.auth, (req, res) => res.json({ text: host.service('hello-section')?.wave(req.person.name) ?? null }));
  // Every other GET under the mount path is a UI route: the host's frame answers it.
  router.get('/{*rest}', (req, res, next) => (req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));

  app.use(mountPath, router);
  return {
    name: 'hello-app',
    label: 'Hello',
    icon: 'spark',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/hello.css'] },
    nav: [
      { key: 'home', label: 'Hello', path: '/' },
      { key: 'owners', label: 'Owners only', path: '/owners', requires: 'change-guardrails' },
    ],
    async status() {
      return { badges: { home: 1 }, card: { lines: ['The stub app is running'], tone: 'ok' } };
    },
    services: { greet: (name) => `Hello, ${name}` },
    provides: { 'hello-section': { wave: (name) => `A wave for ${name}` } },
    async seed() {
      await host.store.writeDoc(['notes', 'welcome.md'], { id: 'welcome', seeded: true }, 'Seeded by hello-app on first start.');
    },
    async close() {},
  };
}
