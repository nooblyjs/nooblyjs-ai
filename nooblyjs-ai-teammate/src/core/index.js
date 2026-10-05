// nooblyjs-core: the shared NooblyJS service registry. Teammates uses its logging (rotating log files), caching
// (parsed Markdown documents), queueing (webhook deliveries), notifying (live events), scheduling (the schedule
// check) and measuring (task, webhook and request metrics). Every service also has a dashboard under /services/.
//
// People sign in with core's authservice (file provider), for the whole app: the Teammates pages send them to
// /services/authservice/views/login.html and core sends them back. On first start it creates the admin account
// admin@localhost, with DEFAULT_ADMIN_PASSWORD or a generated password written to
// <dataDir>/core/auth/INITIAL_ADMIN_PASSWORD.txt. The session (express-session + Passport, `nooblyjs.sid`) is
// shared by core's routes and the app's (see coreSession()).
//
// The registry is a process-wide singleton: it binds to the first Express app it is initialised with and ignores
// later calls. Each createCore() call gets its own named service instances, so the tests, which start several apps
// in one process, stay isolated. The first (and in production the only) app uses the "default" instances.
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { fileSessionStore } from './session-store.js';

const require = createRequire(import.meta.url);
const registry = require('nooblyjs-core');
// Core registers Express 4 route patterns (e.g. `/upload/*`) that Express 5's router rejects, so its services live
// on a separate app built from core's own Express copy. The main app forwards /services traffic to it.
const corePaths = { paths: [path.dirname(require.resolve('nooblyjs-core'))] };
const coreExpress = require(require.resolve('express', corePaths));
// The authservice registers its Passport (de)serializers on core's own passport instance, so use core's copies.
const session = require(require.resolve('express-session', corePaths));
const passport = require(require.resolve('passport', corePaths));
const { createSessionStore } = require('nooblyjs-core/src/shared/utils/sessionStore');
const { buildCspDirectives } = require('nooblyjs-core/src/shared/utils/contentSecurityPolicy');

export const ADMIN_EMAIL = 'admin@localhost';
export const LOGIN_PATH = '/services/authservice/views/login.html';
export const PROFILE_PATH = '/services/authservice/views/profile.html';
export const USERS_PATH = '/services/authservice/';
/** Core roles that map to Teammates roles (core's own `admin` also counts as owner). */
export const TEAMMATE_ROLES = ['owner', 'manager', 'viewer'];
const SESSION_HOURS = 24;

// Core's file logger knows error < warn < info < log; "log" is its debug level.
const CORE_LEVEL = { error: 'error', warn: 'warn', info: 'info', debug: 'log' };

/** Content-Security-Policy for the core dashboards, which use inline scripts and CDN assets. */
export const SERVICES_CSP = Object.entries(buildCspDirectives())
  .filter(([, sources]) => sources)
  .map(([name, sources]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${sources.join(' ')}`)
  .join('; ');

let shared = null;
let instances = 0;

function initRegistry({ logDir, level }) {
  if (shared) return shared;
  const app = coreExpress();
  app.set('x-powered-by', false);
  app.use(coreExpress.json({ limit: '2mb' }));
  app.use(coreExpress.urlencoded({ extended: true, limit: '2mb' }));
  // Sessions for the /services sign-in. The secret is only known once the app has loaded it (configureSessions),
  // so the session middleware is installed now and filled in then.
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200); // every service instance's analytics subscribes
  const state = { app, emitter, session: null, sessionStore: null };
  app.use((req, res, next) => (state.session ? state.session(req, res, next) : next()));
  app.use(passport.initialize());
  app.use(passport.session());
  // Core's services log through an injected logging dependency, by default to stdout. Send it to the log file.
  registry.setDefaultProvider('logging', 'file', { logDir, log: { level } });
  // /services requires a signed-in admin of core's authservice (the default).
  registry.initialize(app, emitter, {});
  shared = state;
  return shared;
}

/**
 * Turns on sessions for the core sign-in: the `nooblyjs.sid` cookie, used by core's /services routes and the app's
 * own (see coreSession()). Called once the signing secret is known; later calls (other apps in the process) are ignored.
 */
export function configureSessions({ secret, secure = false, file, log = null }) {
  if (!shared || shared.session) return;
  // Redis when SESSION_REDIS_URL/REDIS_URL is set (core's store, shared between servers); otherwise a file, so a
  // restart doesn't sign everyone out. Core's default in-memory store loses every session on restart.
  const useRedis = Boolean(process.env.SESSION_REDIS_URL || process.env.REDIS_URL);
  const FileStore = fileSessionStore(session);
  const store = useRedis ? createSessionStore(session, { logger: log }) : (() => {
    const fileStore = new FileStore({ file, log });
    return { type: 'file', store: fileStore, close: () => fileStore.close() };
  })();
  shared.sessionStore = store;
  shared.session = session({
    name: 'nooblyjs.sid',
    store: store.store,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_HOURS * 3600000 },
  });
}

/**
 * Middleware for the app's own routes: the same session and Passport user as core's, so `req.user` is the person
 * signed in with core's authservice and `req.sessionID` identifies their session.
 */
export function coreSession() {
  const init = passport.initialize();
  const restore = passport.session();
  return (req, res, next) => {
    if (!shared?.session) return next();
    shared.session(req, res, (err) => (err ? next(err) : init(req, res, (err2) => (err2 ? next(err2) : restore(req, res, next)))));
  };
}

/**
 * Waits until core's authservice has loaded its files (and created admin@localhost on first start), then makes sure
 * the Teammates roles exist so they can be given to people on the Authentication dashboard.
 */
export async function prepareAuth(auth, { timeoutMs = 5000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (!(await auth.listUsers()).length && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  const existing = await auth.listRoles();
  for (const role of TEAMMATE_ROLES) if (!existing.includes(role)) await auth.createRole(role).catch(() => {});
}

/**
 * Creates this app's core services. Logs go to `logDir` (default <dataDir>/logs), one file per day, rotated at 10 MB.
 * `logLevel` is what reaches the log file. `consoleMode` is what the console shows: 'all' (the default: every line
 * of the log file, core's services included), 'app' (only the app's own messages, from `consoleLevel` up) or 'none'.
 */
export function createCore({
  dataDir,
  logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(dataDir, 'logs'),
  logLevel = process.env.LOG_LEVEL ?? 'info',
  consoleLevel = logLevel,
  consoleMode = process.env.LOG_CONSOLE ?? 'all',
  authDir = path.join(dataDir, 'core', 'auth'),
  instanceName,
} = {}) {
  const level = CORE_LEVEL[logLevel] ?? 'info';
  const { emitter } = initRegistry({ logDir, level });
  instances += 1;
  const name = instanceName ?? (instances === 1 ? 'default' : `teammates-${instances}`);
  const opts = { instanceName: name };
  const mode = consoleLevel === false ? 'none' : consoleMode;

  // 'all': mirror the log file on the console. The file logger announces every line it writes on the shared
  // emitter; for the first app that logger is also the one core's services use, so their messages show too.
  if (mode === 'all') {
    for (const [event, method] of [['error', 'error'], ['warn', 'warn'], ['info', 'log'], ['log', 'log']]) {
      emitter.on(`log:${event}:${name}`, ({ message }) => console[method](message));
    }
  }
  const fileLog = registry.logger('file', { ...opts, logDir, log: { level } });
  const log = createLogger({ file: fileLog, consoleLevel: mode === 'app' ? consoleLevel : false });
  const cache = registry.cache('memory', opts);
  const queue = registry.queue('memory', opts);
  // One subscriber per open browser tab (the /api/events stream).
  const notifying = registry.notifying('memory', { ...opts, maxSubscribers: 1000 });
  const metrics = new Metrics(registry.measuring('memory', opts));
  // People, roles and sessions for signing in, in <dataDir>/core/auth (users.json, roles.json, …). Core's login
  // routes and Passport use the first authservice created in the process, so later apps (tests) share it.
  const existingAuth = registry.services && [...registry.services.keys()].some((k) => k.startsWith('authservice:'));
  const auth = existingAuth ? registry.authservice() : registry.authservice('file', { ...opts, dataDir: authDir });
  // Scheduling pulls in the working service (worker threads, timers), so it is only created when first needed.
  let scheduling = null;

  return {
    instanceName: name,
    events: shared.emitter, // core's event bus (auth:login-api, scheduler:*, …)
    logDir,
    log,
    auth,
    authDir: auth.settings?.datadir ?? authDir,
    adminPasswordFile: path.join(auth.settings?.datadir ?? authDir, 'INITIAL_ADMIN_PASSWORD.txt'),
    cache,
    queue,
    notifying,
    metrics,
    // A failed beat is not retried: the next one is due shortly anyway.
    scheduling: () => (scheduling ??= registry.scheduling('memory', { ...opts, retryAttempts: 0 })),
    hasScheduling: () => scheduling !== null,
  };
}

/**
 * Middleware that hands /services requests to core's own Express app. Called rather than mounted with app.use(),
 * so Express 5 never adopts an Express 4 app as a sub-app and core sees the full path.
 */
export function coreRouter() {
  return (req, res, next) => {
    if (!shared || !(req.path === '/services' || req.path.startsWith('/services/'))) return next();
    // The main app has already read the body. Core's body-parser 1.x only knows that from the `_body` flag.
    if (req.body !== undefined) req._body = true;
    // Express 5 serves req.query from a prototype getter. Express 4 sees it as already parsed, then swaps the
    // request's prototype for its own, which loses the getter. Keep the parsed query as an own property.
    Object.defineProperty(req, 'query', { value: req.query, writable: true, configurable: true, enumerable: true });
    return shared.app(req, res, next);
  };
}

/** Stops every core service (timers, worker threads, file handles). Once per process, at exit. */
export async function shutdownCore() {
  if (!shared) return;
  const { sessionStore } = shared;
  shared = null;
  instances = 0;
  await registry.shutdown();
  await sessionStore?.close();
}

export { registry };
