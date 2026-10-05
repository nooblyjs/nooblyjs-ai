import path from 'node:path';
import crypto from 'node:crypto';
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
import { sessionRouter, authCheck } from './routes/session.js';
import { adminRouter } from './routes/admin.js';
import { billingRouter } from './routes/billing.js';
import { BillingService } from './services/billing.js';
import { AlertService } from './services/alerts.js';
import { WebhookService } from './services/webhooks.js';
import { ToolService } from './services/tools.js';
import { SchedulerService } from './services/scheduler.js';
import { SystemService } from './services/system.js';
import { createCore, coreRouter, coreSession, configureSessions, prepareAuth, LOGIN_PATH, SERVICES_CSP } from './core/index.js';
import { teeLogger } from './core/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const SPA_ROUTES = ['/', '/team', '/team/:id', '/billing', '/hire', '/profiles', '/team-memory', '/timeline', '/settings', '/admin'];
// Where to go back to after signing in: a path on this site only.
const safeReturn = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) && !next.startsWith('/login') ? next : '/team');
// Files holding secrets (password and API key hashes, the session secret, webhook signing secrets, MCP auth headers)
// are never cached: the cache's contents can be read on the /services/caching/ dashboard.
const UNCACHED = new Set(['config/webhooks.md', 'config/mcp-servers.md']);
const cacheable = (segments) => segments[0] !== 'system' && !UNCACHED.has(segments.join('/'));
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'";

/**
 * Builds the app on nooblyjs-core services (see src/core). `log` replaces the console output (everything is still
 * written to the log file); `core` passes options to createCore (logDir, logLevel, consoleLevel, instanceName).
 */
export async function createApp({
  dataDir,
  providers = createProviders(),
  now = () => isoDate(),
  log,
  core: coreOptions = {},
  seed = true,
  sessionSecret = process.env.SESSION_SECRET,
  cookieSecure = process.env.COOKIE_SECURE === 'true',
  trustProxy = process.env.TRUST_PROXY,
  fetch = globalThis.fetch,
  allowPrivateNetwork = process.env.ALLOW_PRIVATE_FETCH === 'true',
  clock = () => Date.now(),
  scheduleIntervalMs = 30000,
  webhookRetryDelaysMs,
} = {}) {
  const core = createCore({ dataDir, ...(log ? { consoleLevel: false } : {}), ...coreOptions });
  log = log ? teeLogger(core.log, log) : core.log;
  const { metrics } = core;
  const store = new FsStore(dataDir, { cache: core.cache, cacheable });
  const repos = createRepos(store);
  if (seed) await ensureSeeded(store, repos, { today: now() });

  const auth = new AuthService(store, { sessionSecret, log });
  await auth.init();
  // People sign in with core's authservice; wait for it to load and make sure the Teammates roles exist there.
  await prepareAuth(core.auth);
  // Sessions for core's /services sign-in, signed with a key derived from ours (a different cookie, a different key).
  configureSessions({
    secret: crypto.createHmac('sha256', auth.secret).update('nooblyjs.sid').digest('base64url'),
    secure: cookieSecure,
    file: path.join(dataDir, 'core', 'sessions.json'), // kept across restarts
    log,
  });
  const audit = new AuditService(store, { log });
  const limiter = new RateLimiter({ windowMs: 60000 });

  const events = new EventBus(core.notifying, { log });
  const webhooks = new WebhookService({ store, repos, fetch, log, queue: core.queue, metrics, ...(webhookRetryDelaysMs && { retryDelaysMs: webhookRetryDelaysMs }) });
  await webhooks.init();
  const tools = new ToolService({ store, webhooks, fetch, allowPrivateNetwork, log });
  const team = new TeamService(repos, { now, events, tools });
  const alerts = new AlertService({ repos, team, store, events, webhooks, log });
  const invocation = new InvocationService(repos, providers, { now, log, events, alerts, tools, webhooks, metrics });
  const billing = new BillingService(repos, team, { now, store });
  const scheduler = new SchedulerService({ repos, invocation, events, webhooks, clock, log, intervalMs: scheduleIntervalMs, scheduling: core.scheduling, metrics });
  scheduler.start();
  const system = new SystemService({ core, store, webhooks, scheduler, invocation, providers });
  // Sign-ins happen on core's login page; they are recorded in the Teammates audit log as well.
  const onLogin = ({ email }) => audit.record({ type: 'user', name: email }, 'session.login', email);
  core.events.on('auth:login-api', onLogin);

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      // The core dashboards under /services use inline scripts and CDN assets, so they get core's own policy.
      'Content-Security-Policy': req.path.startsWith('/services') ? SERVICES_CSP : APP_CSP,
    });
    next();
  });
  // API timings go to the measuring service, and to the log file at debug level. Query strings are never logged.
  app.use((req, res, next) => {
    const path = req.path;
    if (!path.startsWith('/api/') || path === '/api/events') return next();
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      metrics.record('http.request_ms', ms);
      if (res.statusCode >= 500) metrics.record('http.server_error');
      log.debug(`[http] ${req.method} ${path} ${res.statusCode} ${ms}ms`);
    });
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (req, res) => {
    res.json({ ok: true, provider: providers.describe() });
  });
  // Signing in is core's: /login sends people to its login page, which brings them back here afterwards.
  app.get('/login', (req, res) => res.redirect(`${LOGIN_PATH}?returnUrl=${encodeURIComponent(safeReturn(req.query.next))}`));
  app.use(['/api', '/uploads'], coreSession(), identify({ auth }));
  app.get('/api/auth/check', authCheck);
  app.use('/api/session', sessionRouter({ auth, audit, repos, coreAuth: core.auth, cookieSecure }));
  app.use('/api/admin', requireUserWithRole('owner'), adminRouter({ auth, audit, repos, system, coreAuth: core.auth }));
  app.use('/api', billingRouter({ billing, invocation, alerts, webhooks, audit }));
  app.use('/api', apiRouter({ team, invocation, repos, store, events, auth, audit, limiter, tools, scheduler, log }));

  app.get('/uploads/:file', requireUser, async (req, res, next) => {
    try {
      res.sendFile(store.resolve(['uploads', req.params.file]), { dotfiles: 'deny' }, (err) => err && next());
    } catch {
      next();
    }
  });
  // nooblyjs-core service dashboards and APIs, behind core's own sign-in (admin@localhost, see src/core).
  app.use(coreRouter());
  app.use(express.static(publicDir, { index: false }));
  app.get(SPA_ROUTES, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err instanceof StoreError ? 400 : err.status ?? err.statusCode ?? 500;
    if (status >= 500) log.error(err, { method: req.method, path: req.path });
    if (res.headersSent) return res.end();
    res.status(status).json({
      error: { code: err.code ?? (status === 400 ? 'bad_request' : 'internal_error'), message: status >= 500 && !err.code ? 'Something went wrong' : err.message, details: err.details },
    });
  });

  /** Stops the schedule check and pending webhook retries. Core itself is shut down once per process (shutdownCore). */
  const close = () => {
    scheduler.stop();
    webhooks.close();
    core.events.off('auth:login-api', onLogin);
  };

  return { app, core, log, store, repos, team, invocation, billing, alerts, webhooks, tools, scheduler, events, auth, audit, system, close };
}
