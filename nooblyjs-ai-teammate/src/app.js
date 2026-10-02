import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { FsStore, StoreError } from './store/fs-store.js';
import { createRepos } from './repos/index.js';
import { ensureSeeded } from './seed/index.js';
import { TeamService } from './services/team.js';
import { InvocationService } from './services/invocation.js';
import { createProviders } from './providers/index.js';
import { apiRouter } from './routes/api.js';
import { isoDate } from './util/dates.js';
import { EventBus } from './services/events.js';
import { AuthService } from './services/auth.js';
import { AuditService } from './services/audit.js';
import { RateLimiter } from './util/rate-limit.js';
import { identify, requireUser, requireUserWithRole } from './middleware/auth.js';
import { sessionRouter } from './routes/session.js';
import { adminRouter } from './routes/admin.js';
import { billingRouter } from './routes/billing.js';
import { BillingService } from './services/billing.js';
import { AlertService } from './services/alerts.js';
import { WebhookService } from './services/webhooks.js';
import { ToolService } from './services/tools.js';
import { SchedulerService } from './services/scheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const SPA_ROUTES = ['/', '/team', '/team/:id', '/billing', '/hire', '/profiles', '/team-memory', '/timeline', '/settings', '/admin', '/login'];

export async function createApp({
  dataDir,
  providers = createProviders(),
  now = () => isoDate(),
  log = console,
  seed = true,
  ownerPassword = process.env.OWNER_PASSWORD,
  sessionSecret = process.env.SESSION_SECRET,
  cookieSecure = process.env.COOKIE_SECURE === 'true',
  trustProxy = process.env.TRUST_PROXY,
  fetch = globalThis.fetch,
  allowPrivateNetwork = process.env.ALLOW_PRIVATE_FETCH === 'true',
  clock = () => Date.now(),
  scheduleIntervalMs = 30000,
} = {}) {
  const store = new FsStore(dataDir);
  const repos = createRepos(store);
  if (seed) await ensureSeeded(store, repos, { today: now() });

  const auth = new AuthService(store, { sessionSecret, log });
  await auth.init({ ownerPassword, owner: (await repos.config.getSettings()).owner });
  const audit = new AuditService(store, { log });
  const limiter = new RateLimiter({ windowMs: 60000 });
  const loginLimiter = new RateLimiter({ windowMs: 15 * 60000 });

  const events = new EventBus();
  const webhooks = new WebhookService({ store, repos, fetch, log });
  await webhooks.init();
  const tools = new ToolService({ store, webhooks, fetch, allowPrivateNetwork, log });
  const team = new TeamService(repos, { now, events, tools });
  const alerts = new AlertService({ repos, team, store, events, webhooks, log });
  const invocation = new InvocationService(repos, providers, { now, log, events, alerts, tools, webhooks });
  const billing = new BillingService(repos, team, { now, store });
  const scheduler = new SchedulerService({ repos, invocation, events, webhooks, clock, log, intervalMs: scheduleIntervalMs });
  scheduler.start();

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (req, res) => {
    res.json({ ok: true, provider: providers.describe() });
  });
  app.use(['/api', '/uploads'], identify({ auth, repos }));
  app.use('/api/session', sessionRouter({ auth, audit, repos, limiter: loginLimiter, cookieSecure }));
  app.use('/api/admin', requireUserWithRole('owner'), adminRouter({ auth, audit, repos, cookieSecure }));
  app.use('/api', billingRouter({ billing, invocation, alerts, webhooks, audit }));
  app.use('/api', apiRouter({ team, invocation, repos, store, events, auth, audit, limiter, tools, scheduler, log }));

  app.get('/uploads/:file', requireUser, async (req, res, next) => {
    try {
      res.sendFile(store.resolve(['uploads', req.params.file]), { dotfiles: 'deny' }, (err) => err && next());
    } catch {
      next();
    }
  });
  app.use(express.static(publicDir, { index: false }));
  app.get(SPA_ROUTES, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof StoreError ? 400 : err.status ?? err.statusCode ?? 500;
    if (status >= 500) log.error?.(err);
    if (res.headersSent) return res.end();
    res.status(status).json({
      error: { code: err.code ?? (status === 400 ? 'bad_request' : 'internal_error'), message: status >= 500 && !err.code ? 'Something went wrong' : err.message, details: err.details },
    });
  });

  return { app, store, repos, team, invocation, billing, alerts, webhooks, tools, scheduler, events, auth, audit };
}
