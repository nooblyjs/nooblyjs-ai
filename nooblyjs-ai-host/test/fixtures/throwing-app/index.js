// A hosted app that registers fine but whose UI module throws on import, to prove the frame's error card
// (roadmap Phase 1, step 6).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export async function register(app, serverManager, { mountPath = '/throwing', host }) {
  const router = host.express.Router();
  router.use(host.express.static(publicDir, { index: false, redirect: false }));
  router.get('/{*rest}', (req, res, next) => (req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);
  return {
    name: 'throwing-app', label: 'Throwing', icon: 'alert', mountPath,
    ui: { entry: 'js/module.js' },
    nav: [{ key: 'home', label: 'Home', path: '/' }],
    async close() {},
  };
}
