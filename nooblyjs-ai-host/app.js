/**
 * @fileoverview Composition root: the single entry point for NooblyJS.
 *
 * This file OWNS the shared infrastructure and wires everything together:
 *   1. creates the Express app (and, when run, the HTTP/HTTPS server),
 *   2. applies the shared middleware (helmet, compression, body parsing, rate limits, session, Passport),
 *   3. initialises nooblyjs-core's service registry and the core services. This is how core is meant to be hosted:
 *      the host owns the app and passes it to serviceRegistry.initialize(app, …),
 *   4. sets up sign-in (nooblyjs-core's authservice; Microsoft Entra ID when AUTH_METHOD=azure),
 *   5. mounts NooblyJS (src/noobly.js): the seed, the event and audit logs, CSRF, roles, dev sign-in, /api/v1/shell and
 *      the hosted apps listed in data/config/hosted-apps.yaml, which attach through register() on this same app,
 *   6. binds the port last.
 *
 * `createApp({ config })` builds everything without listening, so tests run the whole app on port 0. Running
 * `node app.js` (npm start) also creates the server, listens and handles shutdown.
 *
 * @version 0.1.0
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { loadConfig, ConfigError, SESSION_COOKIE } from './src/config.js';
import { createServer, createHttpRedirectServer } from './src/utils/createServer.js';
import StructuredLogger from './src/utils/StructuredLogger.js';
import { startup } from './src/startup/startupRunner.js';
import { prepareData, mountNoobly } from './src/noobly.js';
import { healthRoutes } from './src/routes/session.js';

const require = createRequire(import.meta.url);
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// libuv's threadpool serves EVERY async filesystem call, and its default size is 4. NooblyJS and its hosted apps run
// file-heavy work (indexing, the Markdown store) side by side, and at four threads those queue behind each other.
// It must be set before the first async fs/dns/crypto call: libuv reads it when it lazily creates the pool. A
// value already in the real environment wins, so `UV_THREADPOOL_SIZE=64 node app.js` still works.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '32';
}

// NooblyJS's own pages are server-rendered with no inline script. nooblyjs-core's /services dashboards get core's policy.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'], // blob: previews an image before it's uploaded (Teammates' avatars)
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
};

/** Parses SEARCH_SYNONYMS ("key=alt1|alt2, …") into equivalence groups for the search service. */
function parseSynonyms(raw) {
  if (!raw) return undefined;
  const groups = [];
  for (const pair of String(raw).split(/[,;\n]/)) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const members = (eq === -1 ? trimmed : `${trimmed.slice(0, eq)}|${trimmed.slice(eq + 1)}`)
      .split('|').map((s) => s.trim()).filter(Boolean);
    if (members.length > 1) groups.push(members);
  }
  return groups.length ? groups : undefined;
}

/**
 * Builds NooblyJS on a new Express app without listening.
 * @param {{ config: ReturnType<typeof loadConfig> }} options
 */
export async function createApp({ config, devtoolsFetch, devtoolsGitRemote, teamsFetch, graphFetch }) {
  const serviceRegistry = require('nooblyjs-core');
  if (serviceRegistry.initialized) {
    throw new Error('nooblyjs-core is already initialised in this process. NooblyJS runs one app per process.');
  }

  // ==========================================================================
  // STEP 0: Data folder and seed (before nooblyjs-core writes its own files into it)
  // ==========================================================================
  const { store, seeded } = await prepareData(config);

  // ==========================================================================
  // STEP 1: Express app
  // ==========================================================================
  const app = express();
  app.disable('x-powered-by');
  // Only behind a known proxy: trusting X-Forwarded-For otherwise lets anyone pick their own rate-limit key.
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  // Express 4's query parser, which nooblyjs-core's dashboards were written against.
  app.set('query parser', 'extended');

  // ==========================================================================
  // STEP 2: Shared middleware
  // ==========================================================================
  app.use(helmet({
    hsts: config.production ? { maxAge: 31536000 } : false, // no HSTS on localhost
    contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(healthRoutes({ express, config, version: VERSION }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));
  if (!config.production) {
    // No caching in development, so edits show up on reload.
    app.use((req, res, next) => {
      res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', Pragma: 'no-cache', Expires: '0' });
      next();
    });
  }

  // ==========================================================================
  // STEP 3: Rate limiting
  // ==========================================================================
  // Signed-in people are counted one by one (an office shares one IP address); anyone else by address, with a
  // fifth of the allowance. It is mounted after the session below: before it, nobody looks signed in.
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: (req) => (req.user?.isAdmin ? config.apiRateLimit * 4 : req.isAuthenticated?.() ? config.apiRateLimit : Math.ceil(config.apiRateLimit / 5)),
    keyGenerator: (req) => (req.isAuthenticated?.() && (req.user?.id ?? req.user?.email) ? `user:${req.user.id ?? req.user.email}` : req.ip),
    message: { error: { code: 'rate_limited', message: 'Too many requests. Try again later.' } },
    standardHeaders: true,
    legacyHeaders: false,
  });
  const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.signInRateLimit,
    message: { error: { code: 'rate_limited', message: 'Too many sign-in attempts. Try again later.' } },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.post('/login', signInLimiter);
  app.use('/services/authservice/api/login', signInLimiter);

  // ==========================================================================
  // STEP 4: Session and Passport
  // ==========================================================================
  // SESSION_SECRET is required in production (config.js); in development a random one is made per start.
  app.use(session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret ?? crypto.randomBytes(64).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      path: '/',
      httpOnly: true,
      secure: config.cookieSecure,
      // Entra replies to the OIDC callback with a cross-site form_post, so the session cookie must be
      // SameSite=None there, which requires Secure (HTTPS). Lax on plain HTTP. CSRF is checked separately.
      sameSite: config.cookieSecure ? 'none' : 'lax',
      maxAge: 12 * 60 * 60 * 1000,
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use('/api/', generalLimiter); // after the session, so it can tell who is signed in (STEP 3)

  // ==========================================================================
  // STEP 5: Service registry and core services
  // ==========================================================================
  const eventEmitter = new EventEmitter();
  eventEmitter.setMaxListeners(200); // every service instance's analytics subscribes
  const logDir = path.join(config.dataDir, 'logs');
  const level = { error: 'error', warn: 'warn', info: 'info', debug: 'log' }[config.logLevel] ?? 'info';
  serviceRegistry.setDefaultProvider('logging', 'console', { logDir, log: { level } });

  // The core dashboards use inline scripts and CDN assets, so /services gets core's own policy.
  const { buildCspDirectives } = require('nooblyjs-core/src/shared/utils/contentSecurityPolicy');
  const servicesCsp = Object.entries(buildCspDirectives())
    .filter(([, sources]) => sources)
    .map(([name, sources]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${sources.join(' ')}`)
    .join('; ');
  app.use('/services', (req, res, next) => {
    res.set('Content-Security-Policy', servicesCsp);
    next();
  });

  serviceRegistry.initialize(app, eventEmitter, {
    security: {
      apiKeyAuth: { requireApiKey: false, apiKeys: [] },
      servicesAuth: { requireLogin: true }, // /services needs a signed-in core admin (Owners)
    },
  });

  // Logging: nooblyjs-core's rotating file log in data/logs, echoed to the console (not in tests), wrapped in the
  // structured logger (JSON to stdout in production, for log aggregators).
  const fileLog = serviceRegistry.logger('file', { instanceName: 'noobly', logDir, log: { level } });
  const echo = config.nodeEnv !== 'test';
  const tee = {
    shouldLog: typeof fileLog.shouldLog === 'function' ? (l) => fileLog.shouldLog(l) : undefined,
    eventEmitter_: fileLog.eventEmitter_,
  };
  for (const [method, consoleMethod] of [['error', 'error'], ['warn', 'warn'], ['info', 'log'], ['log', 'debug']]) {
    tee[method] = (message, meta) => {
      const text = meta && typeof meta === 'object' && !(meta instanceof Error) && Object.keys(meta).length
        ? `${message} ${JSON.stringify(meta)}` : String(message);
      fileLog[method](text);
      if (echo) console[consoleMethod](text);
    };
  }
  const log = new StructuredLogger(tee, { serviceName: 'noobly', instanceName: 'noobly' });

  // Startup profiler: from here on every startup task is timed and reported once the port is bound.
  startup.setLogger(log);
  startup.checkpoint('modules loaded + logger ready');
  if (seeded.length) log.info(`wrote the seed into ${config.dataDir} (${seeded.length} files)`);

  // Caching: memory, or Redis (CACHING_SERVICE=redis).
  const cache = serviceRegistry.cache(config.services.cache === 'redis' ? 'redis' : 'memory');
  if (cache == null) throw new Error(`Failed to initialise the caching service (CACHING_SERVICE=${config.services.cache}). Expected "redis" or "memory".`);

  // Search: memory (BM25), or SOLR (SEARCH_SERVICE=solr).
  // 127.0.0.1, NOT localhost: every request to a NAMED host runs dns.lookup(), which is served by the same libuv
  // threadpool as every fs call. During a busy index build a request can time out before it is ever sent. Node
  // skips the lookup for a literal IP. Set SOLR_URL explicitly for a remote SOLR, preferably with an IP.
  const searching = config.services.search === 'solr'
    ? serviceRegistry.searching('solr', {
      SOLR_URL: process.env.SOLR_URL || 'http://127.0.0.1:8983/solr',
      SOLR_COLLECTION: process.env.SOLR_COLLECTION || undefined,
      commit: false,
      // commitWithin is per write: a minute instead of five seconds stops SOLR re-opening a searcher constantly.
      commitWithin: Number(process.env.SOLR_COMMIT_WITHIN_MS) || 60000,
      timeout: Number(process.env.SOLR_TIMEOUT_MS) || 30000,
      maxResults: Number(process.env.SOLR_MAX_ROWS) || 1000,
      dependencies: { logging: log },
    })
    : serviceRegistry.searching('memory', {
      bm25: { k1: Number(process.env.SEARCH_BM25_K1) || 1.8 },
      synonyms: parseSynonyms(process.env.SEARCH_SYNONYMS),
      snippet: { enabled: true, wordsBefore: 10, wordsAfter: 10, highlight: true },
    });
  if (searching == null) throw new Error(`Failed to initialise the search service (SEARCH_SERVICE=${config.services.search}). Expected "solr" or "memory".`);

  // Queueing: memory, or ActiveMQ (QUEUE_SERVICE=activemq).
  if (config.services.queue === 'activemq') {
    // 127.0.0.1, NOT localhost, for the same reason as SOLR_URL. `brokerName` is deliberately not set: it is the
    // JMX broker id ("localhost"), not a host to resolve.
    const activeMqOptions = {
      host: process.env.ACTIVEMQ_HOST || '127.0.0.1',
      port: parseInt(process.env.ACTIVEMQ_STOMP_PORT || '61613', 10),
      login: process.env.ACTIVEMQ_USER || 'admin',
      passcode: process.env.ACTIVEMQ_PASSWORD || 'admin',
      jolokiaUrl: process.env.ACTIVEMQ_JOLOKIA_URL || 'http://127.0.0.1:8161/api/jolokia',
      jolokiaTimeout: Number(process.env.ACTIVEMQ_JOLOKIA_TIMEOUT_MS) || 30000,
      dequeueTimeout: 1000,
    };
    // DECLARE ActiveMQ as the default queueing provider. Building the instance alone is not enough: core services
    // that take queueing as a dependency (dataservice, working, measuring, filing, and through them workflow,
    // scheduling and aiservice) resolve it through the registry's default, which is 'memory' unless declared, so
    // they would each get an in-memory queue while the broker sits idle. MUST run before the first dependent
    // service is created: dependencies are resolved at creation time and cached.
    serviceRegistry.setDefaultProvider('queueing', 'activemq', activeMqOptions);
    serviceRegistry.queue('activemq', activeMqOptions);
  } else {
    serviceRegistry.queue('memory');
  }

  // ==========================================================================
  // STEP 6: Sign-in (nooblyjs-core authservice; Microsoft Entra ID when AUTH_METHOD=azure)
  // ==========================================================================
  // The file provider creates admin@localhost with a random password on first start and writes it to
  // INITIAL_ADMIN_PASSWORD.txt (mode 0600) in its own folder. Never log the password itself.
  eventEmitter.on('auth:default-admin-password', ({ email }) => {
    log.info(`Default nooblyjs-core admin ${email} created. Its password is in ${path.join(config.dataDir, 'core', 'auth')} (INITIAL_ADMIN_PASSWORD.txt): change it after first sign-in, then delete the file.`);
  });
  eventEmitter.on('auth:default-admin-creation-error', ({ error }) => log.error(`Failed to create the default admin user: ${error}`));

  // After signing in, core sends the person back to the page they were heading to (a same-origin returnUrl),
  // otherwise to loginSuccessRedirectUrl: NooblyJS's home, not core's default /services.
  const LOGIN_SUCCESS_REDIRECT = '/';
  const authservice = serviceRegistry.authservice('file', {
    'express-app': app,
    dataDir: path.join(config.dataDir, 'core', 'auth'),
    loginSuccessRedirectUrl: LOGIN_SUCCESS_REDIRECT,
  });
  authservice.passportConfigurator().configurePassport(passport);
  // A stale session whose user no longer exists signs the person out (done(null, false)) instead of failing the
  // request with an error page.
  passport._deserializers = (passport._deserializers ?? []).map((original) => function safeDeserializer(id, done) {
    try {
      const safeDone = (err, user) => (err && err !== 'pass' ? done(null, false) : done(err, user));
      const result = original(id, safeDone);
      if (result && typeof result.catch === 'function') result.catch(() => done(null, false));
    } catch {
      done(null, false);
    }
  });
  // nooblyjs-core's sign-in page asks the site whether you are already signed in.
  app.get('/api/auth/check', (req, res) => res.json({ authenticated: Boolean(req.isAuthenticated?.() && req.user?.isActive !== false) }));
  // The file provider loads its users asynchronously (and creates admin@localhost on first start).
  for (let i = 0; i < 200 && !(await authservice.listUsers()).length; i++) await new Promise((r) => setTimeout(r, 25));

  // Every Azure "is it on?" check (the routes below, and core's /services/authservice/api/sso-config, which the
  // login page probes) keys off AZURE_AD_CLIENT_ID + AZURE_AD_TENANT_ID. Clearing them in-process when the method
  // isn't azure makes all of them agree with AUTH_METHOD. Only AZURE_AD_* is touched.
  if (config.authWarning) log.warn(config.authWarning);
  if (config.authMethod !== 'azure') {
    delete process.env.AZURE_AD_CLIENT_ID;
    delete process.env.AZURE_AD_TENANT_ID;
  } else {
    // Entra's OIDC strategy on the same Passport, with the file provider as the user store, so an Entra sign-in
    // lands in the one shared store. No 'express-app': that would register every auth route a second time.
    const azureAuth = serviceRegistry.authservice('azure', {
      passport, userStore: authservice, loginSuccessRedirectUrl: LOGIN_SUCCESS_REDIRECT,
      // Only when an admin has granted it (AZURE_AD_READ_PROFILE=true): otherwise sign-in asks for sign-in alone.
      ...(config.azureReadProfile ? { scope: ['openid', 'profile', 'email', 'User.Read'] } : {}),
    });
    app.get('/services/authservice/api/azure', (req, res, next) => azureAuth.initiateAzureAuth(req, res, next));
    const onAzureCallback = async (req, res, next) => {
      try {
        const result = await azureAuth.handleAzureCallback(req, res, next);
        const target = result?.redirectUrl;
        res.redirect(typeof target === 'string' && /^\/(?![/\\])/.test(target) ? target : LOGIN_SUCCESS_REDIRECT);
      } catch (err) {
        log.error(`Entra sign-in callback failed: ${err.message}`);
        res.redirect(`/services/authservice/views/login.html?local=1&error=${encodeURIComponent('Microsoft sign-in failed. Try again or sign in with credentials.')}`);
      }
    };
    app.post('/services/authservice/openid', onAzureCallback);
    app.get('/services/authservice/openid', onAzureCallback);
  }
  log.info(`Sign-in method: ${config.authMethod === 'azure' ? 'Microsoft Entra ID' : 'local'}${config.devLogin ? ' (+ development person picker)' : ''}`);
  startup.checkpoint('core services + sign-in ready');

  // ==========================================================================
  // STEP 7: NooblyJS (seeded people, logs, CSRF, roles, sign-in routes, shell API, hosted apps, frame)
  // ==========================================================================
  const noobly = await startup.track('noobly:mount', () => mountNoobly({ app, express, config, store, serverManager: serviceRegistry, authservice, log, devtoolsFetch, devtoolsGitRemote, teamsFetch, graphFetch, coreEvents: eventEmitter }));

  let closed = false;
  return {
    app,
    store,
    log,
    events: noobly.events,
    auditLog: noobly.auditLog,
    people: noobly.people,
    chat: noobly.chat,
    agents: noobly.agents,
    platform: noobly.platform,
    lifecycle: noobly.lifecycle,
    metrics: noobly.metrics,
    devtools: noobly.devtools,
    syncSettled: noobly.syncSettled,
    entra: noobly.entra,
    notify: noobly.notify,
    teamsBot: noobly.teamsBot,
    clock: noobly.clock,
    hosted: noobly.hosted,
    sessions: noobly.sessions,
    simulator: noobly.simulator,
    devKey: noobly.devKey,
    shell: noobly.shell,
    serviceRegistry,
    authservice,
    /** Closes the hosted apps, then every nooblyjs-core service (timers, worker threads, file handles). */
    async close() {
      if (closed) return;
      closed = true;
      await noobly.close();
      await serviceRegistry.shutdown?.();
      serviceRegistry.reset?.();
    },
  };
}

// ============================================================================
// Running: env → config → createApp → server → listen → graceful shutdown
// ============================================================================

async function main() {
  // npm start passes --env-file-if-exists=.env; `node app.js` on its own loads it here. Real env vars win.
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

  // Trust the OS certificate store for outbound TLS, so the OpenID metadata fetch to login.microsoftonline.com
  // (Entra) works behind a TLS-inspecting corporate proxy. Before the first outbound HTTPS request.
  require('nooblyjs-core/src/shared/utils/trustSystemCa').trustSystemCa();

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`NooblyJS refused to start: ${err.message}`);
    process.exit(1);
  }

  const noobly = await createApp({ config });
  const { log } = noobly;
  const { server, protocol } = createServer(noobly.app, { baseDir: ROOT });
  let redirectServer = null;

  server.on('error', async (err) => {
    log.error(err.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Stop the other process or set PORT.`
      : `The server failed: ${err.message}`);
    await noobly.close();
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    startup.markListening();
    const { port } = server.address();
    log.info(`NooblyJS is listening on ${protocol}://${config.host}:${port} (data: ${config.dataDir})`);
    if (config.devLogin) log.info('Development sign-in is on: /login shows the person picker.');
  });

  // Over HTTPS, also listen on HTTP and 301 to HTTPS. A failure to bind it is logged, not fatal.
  if (config.httpsEnabled) {
    const { server: redirect, port: redirectPort } = createHttpRedirectServer({ httpsPort: config.port });
    redirectServer = redirect;
    redirect.on('error', (err) => log.warn(`HTTP→HTTPS redirect on port ${redirectPort} not started: ${err.code ?? err.message}. Set HTTP_REDIRECT_PORT to a free port above 1024.`));
    redirect.listen(redirectPort, () => log.info(`HTTP→HTTPS redirect listening on port ${redirectPort}`));
  }

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: stopping NooblyJS`);
    setTimeout(() => process.exit(1), 10_000).unref();
    redirectServer?.close();
    server.close();
    server.closeAllConnections?.();
    await noobly.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const runDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (runDirectly) {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
  main().catch((error) => {
    console.error(`NooblyJS failed to start: ${error.stack ?? error.message}`);
    process.exit(1);
  });
}
