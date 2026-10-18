/**
 * @fileoverview Composition root — the single entry point for the platform.
 *
 * This file OWNS the shared infrastructure and wires everything together:
 *   1. creates the Express app + HTTP/HTTPS server + Socket.IO,
 *   2. applies the shared middleware (helmet, CORS, session, passport, limits),
 *   3. initializes nooblyjs-core's service registry and the core
 *      services (this is how core is meant to be hosted — the host owns the app
 *      and passes it to serviceRegistry.initialize(app, …)),
 *   4. passes that wired context to the backend (API modules) and to each web
 *      application, which attach their routes/assets onto the SAME app,
 *   5. binds the port last.
 *wiki/server.js
 * Layout: everything lives under ./src — the API modules (src/datasources,
 * src/wiki, src/shared, wired by src/initialize.js) and the web frontends
 * (src/web/*). There is ONE package.json and one node_modules, at the repo
 * root. `nooblyjs-core` is a symlink, so every requirer shares one registry
 * singleton regardless of where it's resolved from.
 *
 * Teams is a separate application (its own Vite/TS server) and is reverse-
 * proxied below at /applications/teams.
 *
 * @version 2.0.0
 */

'use strict';

// Load environment variables from the repo-root .env.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });

// libuv's threadpool serves EVERY async filesystem call, and its default size is
// 4. This process routinely runs several file-heavy jobs at once — the search
// index build reads and tokenises the whole corpus, chokidar stats every file
// under each watched root, and the folder-tree endpoint issues ~44,000 stat()s
// per cold build. At four threads those queue behind each other: a 7-second tree
// walk was observed taking minutes while an index build was running, with the
// browser showing folder-tree requests pending indefinitely. Endpoints that
// touch no files stayed fast throughout, which is the signature of threadpool
// starvation rather than a blocked event loop.
//
// MUST be set before the first async fs/dns/crypto call — libuv reads it when it
// lazily creates the pool. `require()` uses synchronous fs, so setting it here,
// ahead of everything else, is early enough. A value already present in the real
// environment always wins, so `UV_THREADPOOL_SIZE=64 node app.js` still works.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '32';
}

// Trust the OS certificate store for outbound TLS so the OpenID-metadata fetch to
// login.microsoftonline.com (Entra SSO) succeeds behind a TLS-inspecting corporate
// proxy. Must run before the first outbound HTTPS request; harmless when not needed.
require('nooblyjs-core/src/shared/utils/trustSystemCa').trustSystemCa();

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Server } = require('socket.io');
const serviceRegistry = require('nooblyjs-core');

// Shared utils and module wiring live under ./src. Certificate paths in
// createServer resolve against the repo root (./certs — see scripts/generate-certs.js).
const ROOT_DIR = __dirname;
const { createServer, createHttpRedirectServer } = require('./src/shared/utils/createServer');
const StructuredLogger = require('./src/shared/utils/StructuredLogger');
const { startup } = require('./src/shared/startup/startupRunner');
const { registerProxies } = require('./src/shared/proxies/proxyManager');
const backend = require('./src/initialize.js');

// Pulls a user's Microsoft Entra (Azure AD) profile photo into the shared avatar
// store on sign-in — see STEP 5's Entra callback.
const { syncEntraAvatar } = require('./src/shared/auth/entraAvatar');

// Web application mount modules (each attaches to the passed app + express).
const webApps = [
  require('./src/web/datasources'),
  require('./src/web/wiki')
];

// Base directory for all application data (override via APP_BASE_DIR env var).
const APP_BASE_DIR = process.env.APP_BASE_DIR
  ? path.resolve(process.env.APP_BASE_DIR)
  : path.join(__dirname, '.application');

const isProduction = process.env.NODE_ENV === 'production';

// ============================================================================
// STEP 1: Express app + HTTP/HTTPS server
// ============================================================================

const app = express();

// Transport controlled by HTTPS_ENABLED in .env. Certs resolve against the repo root.
// Generate development certificates with: npm run certs
const { server, protocol, httpsEnabled } = createServer(app, { baseDir: ROOT_DIR });

// ============================================================================
// STEP 1b: Configurable reverse proxies (/proxies/<name> -> host)
// ============================================================================
// Mounted FIRST, ahead of helmet / CORS / session / body-parser, so each proxy
// is transparent in both directions: the target sees the untouched request
// stream (so POST/PUT bodies work) and the client sees only the target's
// response headers, not this app's security headers bolted onto content this
// app did not generate. Driven by <APP_BASE_DIR>/configuration/proxies/
// proxies.json — see src/shared/proxies/proxyManager.js.
//
// The logger does not exist until STEP 5, so this logs to console; the entries
// are re-reported in the startup profile.
const proxySummary = startup.trackSync('proxies:register', () =>
  registerProxies({ app, appBaseDir: APP_BASE_DIR }));

// ============================================================================
// STEP 2: Shared middleware
// ============================================================================

// Security headers (helmet)
app.use(helmet({
  hsts: isProduction ? { maxAge: 31536000 } : false, // Disable HSTS on localhost for development
  contentSecurityPolicy: {
    useDefaults: false, // Don't use helmet's defaults (which include upgrade-insecure-requests)
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://cdn.socket.io", "https://unpkg.com", "https://www.googletagmanager.com"], // unsafe-inline/eval needed for some frontend components; CDN for marked, mermaid, swagger-ui, socket.io; Google Analytics; unpkg for swagger-ui
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, onchange, etc.) — modern browsers split this from script-src
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://cdn.socket.io", "https://unpkg.com", "https://www.googletagmanager.com"], // CDN source maps, socket.io, and analytics; unpkg for swagger docs
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      // Explicitly omit upgradeInsecureRequests for development - this directive was forcing HTTP to HTTPS upgrade
      ...(isProduction ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Gzip/Brotli compression for responses
app.use(compression());

// Body parser (10MB limit — increase per-route if needed for file uploads)
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ----------------------------------------------------------------------------
// CORS — parse CORS_ORIGINS (comma-separated; /regex/ entries become RegExp).
// Example: "http://example.com,/^chrome-extension:\/\//,https://other.com"
// ----------------------------------------------------------------------------
function parseCorsOrigins() {
  const corsOriginsEnv = process.env.CORS_ORIGINS || '';
  const origins = [];

  // Only allow localhost origins in non-production environments
  if (!isProduction) {
    origins.push(
      'http://localhost:3000',        // Frontend dev
      'http://localhost:5000',        // Alt frontend port
      'http://localhost:11002',       // Teams wiki tab server
      'http://localhost:11003',       // Teams datasources tab server
      'http://localhost:9101',       // Unified backend
      'https://localhost:9101'       // Unified backend HTTPS
    );
  }

  if (corsOriginsEnv) {
    const envOrigins = corsOriginsEnv.split(',').map(o => o.trim()).filter(o => o);
    for (const origin of envOrigins) {
      if (origin.startsWith('/') && origin.endsWith('/')) {
        origins.push(new RegExp(origin.slice(1, -1)));
      } else {
        origins.push(origin);
      }
    }
  }

  return origins;
}

const corsOptions = {
  origin: parseCorsOrigins(),
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD']
};

app.use(cors(corsOptions));

// Session — use SESSION_SECRET, or generate a strong random one in non-prod.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET must be set to a strong value (≥32 chars) in production');
    process.exit(1);
  } else {
    sessionSecret = crypto.randomBytes(64).toString('hex');
    console.warn('WARNING: No strong SESSION_SECRET provided. Generated a temporary random secret for this session.');
  }
}

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'sid',
  cookie: {
    // Send the cookie only over TLS in production or whenever HTTPS is enabled
    secure: isProduction || httpsEnabled,
    httpOnly: true,
    // Entra replies to the OIDC callback via a cross-site form_post; the session
    // cookie (which carries the OIDC state/nonce) is only sent on that POST when it
    // is SameSite=None, and None requires Secure (HTTPS). Fall back to Lax on plain
    // HTTP, where the form_post flow can't work anyway.
    sameSite: (isProduction || httpsEnabled) ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Token query-param support for /applications/wiki/api/* (for <img>/<iframe>
// src that can't set an Authorization header).
app.use('/applications/wiki/api/', (req, res, next) => {
  if (req.query && req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

// Protect direct filing API access — session, ?token=, or bearer/core-auth.
app.use('/services/filing/api/', async (req, res, next) => {
  // 1. Session-based auth (browser cookies)
  if (req.isAuthenticated()) return next();

  // 2. Token via query parameter (for <img>/<iframe> src that can't set headers)
  if (req.query && req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }

  // 3. Bearer token auth (wiki tokens + core auth service fallback)
  if (global.bearerTokenMiddleware) {
    const bearerMiddleware = global.bearerTokenMiddleware.middleware();
    await new Promise((resolve) => bearerMiddleware(req, res, resolve));
    if (req.isAuthenticated()) return next();
  } else {
    // Bearer middleware not yet initialized — try core auth service directly
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
      try {
        const authservice = app.get('authservice');
        if (authservice && authservice.validateSession) {
          const validated = await authservice.validateSession(token);
          if (validated) {
            const userRoles = Array.isArray(validated.roles) ? validated.roles : [validated.role || 'user'];
            req.user = { id: validated.userId, username: validated.username, roles: userRoles };
            req.isAuthenticated = () => true;
            return next();
          }
        }
      } catch (e) {
        // Token not valid
      }
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
});

// Trust proxy for reverse proxy environments
app.set('trust proxy', 1);

// Bearer token auth for /api/ routes (daemon, VS Code/Chrome extensions).
app.use('/api/', async (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (global.bearerTokenMiddleware) {
    const bearerMiddleware = global.bearerTokenMiddleware.middleware();
    await new Promise((resolve) => bearerMiddleware(req, res, resolve));
  }
  next();
});

// Disable caching for development
app.use((req, res, next) => {
  if (!isProduction) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// ============================================================================
// STEP 3: Rate limiting
// ============================================================================

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    if (req.user?.isAdmin) return 2000;          // Admins
    if (req.isAuthenticated?.()) return 500;     // Authenticated users
    return 100;                                  // Anonymous
  },
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const executionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many executions' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/auth/login', authLimiter);
app.set('executionLimiter', executionLimiter);

// ============================================================================
// STEP 4: Event emitter + Socket.IO
// ============================================================================

const eventEmitter = new EventEmitter();

const io = new Server(server, {
  cors: { origin: corsOptions.origin, methods: ['GET', 'POST'], credentials: true }
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => { /* handled silently */ });
});

global.io = io;

// ============================================================================
// STEP 5: Service registry + core services
// ============================================================================

serviceRegistry.initialize(app, eventEmitter, {
  logDir: path.join(APP_BASE_DIR, 'logs'),
  dataDir: path.join(APP_BASE_DIR, 'data'),
  security: {
    apiKeyAuth: { requireApiKey: false, apiKeys: [] },
    servicesAuth: { requireLogin: process.env.REQUIRE_LOGIN !== 'false' }
  }
});

// ============================================================================
// lOGGING Provider - Console but add the structured logger
// ============================================================================
const coreLog = serviceRegistry.logger('console');
const log = new StructuredLogger(coreLog, { serviceName: 'nooblyjs-ai-knowledge' });

// Startup profiler — from here on every startup task is timed and reported.
// Instrumentation only: it changes no ordering and no concurrency.
// See src/shared/startup/startupRunner.js.
startup.setLogger(log);
startup.checkpoint('modules required + logger ready');

// ============================================================================
// Settings Provider - grouped key/value store, AES-256-GCM encrypted at rest
// ============================================================================
// Anchored to APP_BASE_DIR like every other data path. This used to be the
// literal relative string '../.application/settings/settings.enc.json', which
// the provider resolves with path.resolve() — i.e. against process.cwd(), not
// against this file — so launching the server from any other directory silently
// opened a DIFFERENT (empty) store. It now also sits beside the platform's other
// configuration files (settings-agents.json, settings-general.json, prompts/)
// rather than in a directory of its own.
//
// Backs the datasources Settings screen and the wiki feature flags
// (src/wiki/config/featureFlags.js).
//
// SETTINGS_SECRET is the AES-256-GCM key for that at-rest encryption. In
// production it MUST be provided and strong: a missing/weak key means either the
// store is written with a predictable key (no meaningful protection) or, if the
// provider derives a per-boot key, an existing encrypted store can no longer be
// decrypted. This mirrors the SESSION_SECRET fail-fast above — but deliberately
// does NOT auto-generate a random fallback even in dev, because a random per-boot
// key would silently orphan any store already on disk; dev simply runs with a
// warning (dev stores are regenerable).
const settingsSecret = process.env.SETTINGS_SECRET;
if (!settingsSecret || settingsSecret.length < 32) {
  if (isProduction) {
    console.error('FATAL: SETTINGS_SECRET must be set to a strong value (≥32 chars) in production');
    process.exit(1);
  } else {
    console.warn('WARNING: No strong SETTINGS_SECRET provided. The encrypted settings store is not securely protected in this session.');
  }
}

const settings = serviceRegistry.settings('file', {
  filepath: path.join(APP_BASE_DIR, 'configuration', 'settings', 'settings.enc.json'),
  secret: settingsSecret,
  dependencies: { log }
});

// ============================================================================
// Caching Provider - Switch between memory and Redis
// ============================================================================
let cache;
if (process.env.CACHING_SERVICE === 'redis') {
  cache = serviceRegistry.cache('redis');
  console.log('✓ Redis caching enabled');
} else {
  cache = serviceRegistry.cache('memory');
  console.log('✓ Memory caching enabled');
}

// `Exception` is not a JavaScript global — this guard used to throw
// "ReferenceError: Exception is not defined", hiding the very message it exists
// to print.
if (cache == null) {
  throw new Error(
    `Failed to initialize caching service (CACHING_SERVICE=${process.env.CACHING_SERVICE || 'unset'}). `
    + 'Expected "redis" or "memory"; check .env and that the required dependencies are installed.'
  );
}

// ============================================================================
// Search Provider - Switch between memory and SOLR
// ============================================================================
// Parse SEARCH_SYNONYMS from .env into equivalence groups for the search service.
// Format: comma/semicolon/newline-separated pairs, each "key=alt1|alt2".
//   SEARCH_SYNONYMS=bitrix=bitrix24, knect=k'nect|knct, aws=amazon web services
// A search for any member of a group also matches the others (e.g. "bitrix"
// finds documents indexed as "bitrix24").
function parseSynonyms(raw) {
  if (!raw) return undefined;
  const groups = [];
  for (const pair of String(raw).split(/[,;\n]/)) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const members = (eq === -1 ? trimmed : `${trimmed.slice(0, eq)}|${trimmed.slice(eq + 1)}`)
      .split('|').map(s => s.trim()).filter(Boolean);
    if (members.length > 1) groups.push(members);
  }
  return groups.length ? groups : undefined;
}

let searching;
if (process.env.SEARCH_SERVICE === 'solr') {
  // 127.0.0.1, NOT localhost — this is load-bearing, not a style choice.
  //
  // Every axios request to a NAMED host runs dns.lookup(), and dns.lookup() is
  // served by the SAME libuv threadpool as every fs call (see the
  // UV_THREADPOOL_SIZE note at the top of this file). During an index build,
  // chokidar is stat-ing tens of thousands of files and the tree walk is issuing
  // ~44,000 more, so all 32 slots are busy — and a SOLR request sits in that
  // queue with its axios deadline already ticking, timing out BEFORE IT IS EVER
  // SENT. That is what "timeout of 30000ms exceeded" was: a query SOLR answers
  // in 1ms, never delivered to it. Raising the timeout does not help, because
  // the starvation lasts longer than any deadline worth setting.
  //
  // Node short-circuits dns.lookup for a literal IP (isIP → nextTick, no
  // threadpool), so an IP address takes the search client out of the contention
  // entirely. Set SOLR_URL explicitly for a remote SOLR; prefer an IP there too,
  // or accept that the first request after each idle period pays a real lookup.
  searching = serviceRegistry.searching('solr', {
    SOLR_URL: process.env.SOLR_URL || 'http://127.0.0.1:8983/solr',
    SOLR_COLLECTION: process.env.SOLR_COLLECTION || undefined,
    commit: false,
    // commitWithin is per WRITE, and the indexer writes one document at a time —
    // so 5s meant SOLR re-opened a searcher every 5 seconds for the entire build.
    // Measured on this box: 1,490 index flushes and 799 segment merges in 85
    // minutes of uptime, on a 512MB heap holding a 210MB index. A document is
    // searchable a minute after it lands instead of five seconds, which no caller
    // here notices, and the merge churn stops competing with the build.
    commitWithin: Number(process.env.SOLR_COMMIT_WITHIN_MS) || 60000,
    // Client-side deadline (axios/follow-redirects), not a SOLR one. Kept generous
    // for the bulk-write path; with the IP host above it should never be reached.
    timeout: Number(process.env.SOLR_TIMEOUT_MS) || 30000,
    // The provider's own default `rows` is 50, applied to any search that does not
    // name a row count of its own. That is a chunk-row count, not a document
    // count: the wiki indexes long documents as several chunks and folds them back
    // together, so 50 rows is roughly 9 documents. The wiki search now sizes every
    // request explicitly (see CHUNK_FANOUT in searchIndexer.js) — this raises the
    // floor for anything that does not, so nothing silently inherits 50 again.
    maxResults: Number(process.env.SOLR_MAX_ROWS) || 1000,
    dependencies: { logging: log }
  });
  console.log('✓ SOLR search enabled');
} else {
  // BM25 k1 controls how much repeated occurrences of a term count toward
  // relevance (higher = repeats matter more, less saturation). Default is 1.2;
  // the wiki favours "more references ⇒ more relevant", so bump it. Synonyms let a
  // query term match configured equivalents. Only the wiki uses this search
  // service, so both are effectively wiki-scoped. Override via env.
  searching = serviceRegistry.searching('memory', {
    bm25: { k1: Number(process.env.SEARCH_BM25_K1) || 1.8 },
    synonyms: parseSynonyms(process.env.SEARCH_SYNONYMS),
    // Retain indexed text so search results carry a match-centered context
    // snippet (≈10 words either side of the hit, clamped at a full stop) that the
    // frontend can show under each result. The hit is wrapped in <mark>…</mark>.
    snippet: { enabled: true, wordsBefore: 10, wordsAfter: 10, highlight: true }
  });
  console.log('✓ Memory search enabled');
}

// Fail here rather than 400 lines later inside backend.initialize(), where the
// only symptom is "Cannot read properties of undefined (reading
// 'ensureCollection')" and nothing points back at SEARCH_SERVICE.
if (searching == null) {
  throw new Error(
    `Failed to initialize search service (SEARCH_SERVICE=${process.env.SEARCH_SERVICE || 'unset'}). `
    + 'Expected "solr" or "memory"; check .env and that the required dependencies are installed.'
  );
}

// ============================================================================
// Queue Provider - Switch between memory and ActiveMQ
// ============================================================================
let queue;
if (process.env.QUEUE_SERVICE === 'activemq') {
  // 127.0.0.1, NOT localhost — for the same reason as SOLR_URL above, and it
  // bites HARDER here. The worker manager polls `size()` on a timer, and every
  // poll is an axios GET to Jolokia with a hard-coded 10s deadline. Against a
  // NAMED host each of those runs dns.lookup(), which libuv serves from the same
  // threadpool as all file I/O — so during a search index build the request sits
  // in the queue until its own deadline expires, and the log fills with:
  //   [WorkerManager] Queue processor tick failed
  //   Failed to get size of queue "…-working-incoming": timeout of 10000ms exceeded
  // Observed exactly that: clean until "Starting search index build", then a
  // failed tick every ~10-20s. The broker was healthy throughout — the request
  // was never delivered to it.
  //
  // `brokerName` is deliberately NOT set here: it is the JMX broker identifier
  // in the MBean name, which really is the string "localhost" on this broker,
  // not a hostname to resolve. Overriding it to an IP breaks every lookup.
  const activeMqOptions = {
    host: process.env.ACTIVEMQ_HOST || '127.0.0.1',
    port: parseInt(process.env.ACTIVEMQ_STOMP_PORT || '61613', 10),
    login: process.env.ACTIVEMQ_USER || 'admin',
    passcode: process.env.ACTIVEMQ_PASSWORD || 'admin',
    jolokiaUrl: process.env.ACTIVEMQ_JOLOKIA_URL || 'http://127.0.0.1:8161/api/jolokia',
    // Deadline for each Jolokia call. The provider used to hard-code 10s, which
    // this app defeats: `working` polls queue depth every second, and a search
    // index build makes the process busy enough that a poll goes unserved past
    // its own deadline — logging a timeout against a broker that answers the
    // same call in ~13ms. Nothing is gained by failing fast (the next tick
    // retries), so give it room.
    jolokiaTimeout: Number(process.env.ACTIVEMQ_JOLOKIA_TIMEOUT_MS) || 30000,
    dequeueTimeout: 1000
  };

  // DECLARE ActiveMQ as the default 'queueing' provider — building the instance
  // below is NOT enough on its own, and this line is the whole difference
  // between a broker that carries the platform's traffic and one that sits idle.
  //
  // Four core services take queueing as a DEPENDENCY: dataservice, working,
  // measuring and filing (transitively workflow, scheduling and aiservice).
  // The registry resolves a dependency by asking getDefaultProviderType(), which
  // answers 'memory' for queueing unless an app has declared otherwise — so
  // every one of them was handed a SECOND, in-memory queue while the ActiveMQ
  // instance built here was used by nothing but its own admin screens. The boot
  // log showed both, three milliseconds apart:
  //   [QUEUE:ACTIVEMQ] Queue service initialized
  //   [QUEUE:MEMORY]   Queue service initialized
  // and every dependent then reported hasQueueing:true — of the wrong one. The
  // visible symptom is an ActiveMQ console with no destinations, because nothing
  // ever sent or subscribed: the STOMP client connects lazily.
  //
  // MUST run before the first dependent service is constructed — dependencies
  // are resolved at creation time and cached. `filing` below is the first, and
  // it was what triggered the memory instance. The singleton cache is keyed
  // service:provider:instance, so the queue() call that follows returns this
  // same instance rather than a third one.
  //
  // REQUIRES nooblyjs-core >= 2.1.0 of the working service. Enabling
  // this against an older core HANGS EVERY WORKFLOW after its first step:
  // `working` used to put the caller's completionCallback ON the task it
  // enqueued, and WorkflowService awaits a promise that ONLY that callback
  // settles. The in-memory queue passes the object by reference so the function
  // survived; ActiveMQ enqueues with JSON.stringify and dequeues with
  // JSON.parse, and JSON silently drops functions — so the step ran, nothing
  // called back, and no error was logged anywhere. Core now keeps the callback
  // in-process keyed by task id and correlates results back by that id; verify
  // with `grep -c pendingCallbacks_ core/src/working/providers/working.js`.
  serviceRegistry.setDefaultProvider('queueing', 'activemq', activeMqOptions);
  queue = serviceRegistry.queue('activemq', activeMqOptions);
  console.log('✓ ActiveMQ queueing enabled (declared as the default queueing provider)');
} else {
  queue = serviceRegistry.queue('memory');
  console.log('✓ Memory queueing enabled');
}

if (queue == null) {
  throw new Error(
    `Failed to initialize queueing service (QUEUE_SERVICE=${process.env.QUEUE_SERVICE || 'unset'}). `
    + 'Expected "activemq" or "memory"; check .env and that the required dependencies are installed.'
  );
}


// ============================================================================
// Filing Provider - Local
// ============================================================================
const filing = serviceRegistry.filing('local');

// ============================================================================
// Scheduling Provider - Local
// ============================================================================
const scheduling = serviceRegistry.scheduling('memory');
// Scheduled workflows run in worker threads and can take far longer than the
// scheduler's default 30s jobTimeout (git clones, AI doc generation, etc.).
// Without this, a long run is reported as a (false) failure at 30s while the
// worker keeps going — corrupting schedule stats/history. Give scheduled runs
// up to eight hours by default; override with SCHEDULER_JOB_TIMEOUT_MS.
//
// NOTE this is a FALSE-FAILURE GUARD, not a cap: expiry marks the execution
// failed but does NOT kill the worker thread, which runs on to completion. So
// raising it never makes a run finish sooner and never frees a stuck one — if
// runs keep outgrowing it (30s → 1h → 2h → 4h), the thing to look at is the
// slow step (ARIS extracts, git clones, per-document AI calls), not this
// number.
if (scheduling && typeof scheduling.saveSettings === 'function') {
  const schedulerJobTimeout = parseInt(process.env.SCHEDULER_JOB_TIMEOUT_MS, 10) || 28800000;
  Promise.resolve(scheduling.saveSettings({ jobTimeout: schedulerJobTimeout }))
    .catch((err) => log.warn('Failed to set scheduler jobTimeout', { error: err.message }));
}

const workflow = serviceRegistry.workflow('memory');
const notifying = serviceRegistry.notifying('memory');
const fetching = serviceRegistry.fetching('memory');
const measuring = serviceRegistry.measuring('default', {
  dependencies: { logging: log },
  dataRetention: 30,
  aggregationInterval: 60,
  metricsLimit: 1000
});

// Surface the auto-generated default admin credentials on first run. The 'file'
// authservice provider creates an 'administrator' user with a random password
// when no users exist yet and emits this event once. Listener must be attached
// BEFORE serviceRegistry.authservice('file', …) — the event fires synchronously.
eventEmitter.on('auth:default-admin-password', ({ username, email, password, message }) => {
  // SECURITY: never write the plaintext password to the structured logger (it goes
  // to stdout, aggregators and on-disk files). Persist it once to a 0600 file and
  // log only its location; the operator retrieves it, changes it, then deletes it.
  const bar = '='.repeat(70);
  const credsPath = path.join(APP_BASE_DIR, 'data', 'auth', 'INITIAL_ADMIN_PASSWORD.txt');
  try {
    fs.mkdirSync(path.dirname(credsPath), { recursive: true });
    fs.writeFileSync(
      credsPath,
      `Default admin credentials (generated on first run)\n` +
      `Username: ${username}\nEmail: ${email}\nPassword: ${password}\n\n` +
      `Change this password after first login, then DELETE this file.\n`,
      { mode: 0o600 }
    );
    fs.chmodSync(credsPath, 0o600); // enforce perms even if umask widened them
  } catch (err) {
    log.error(`Failed to write initial admin credentials file: ${err.message}`);
  }
  log.info(bar);
  log.info('DEFAULT ADMIN USER CREATED');
  log.info(`  Username:    ${username}`);
  log.info(`  Email:       ${email}`);
  log.info(`  Password:    written to ${credsPath} (mode 0600)`);
  if (message) log.info(message);
  log.info('Retrieve the password from that file, change it after first login, then delete the file.');
  log.info(bar);
});

eventEmitter.on('auth:default-admin-creation-error', ({ error }) => {
  log.error(`Failed to create default admin user: ${error}`);
});

const authservice = serviceRegistry.authservice('file', {
  'express-app': app,
  dataDir: path.join(APP_BASE_DIR, 'data', 'auth')
});

const aiservice = serviceRegistry.aiservice('ollama', {
  model: process.env.AI_MODEL || 'tinyllama:1.1b',
  'express-app': app,
  tokensStorePath: path.join(APP_BASE_DIR, 'data', 'ai-tokens.json')
});

// Configure Passport via the authservice's configurator.
const passportConfigurator = authservice.passportConfigurator();
passportConfigurator.configurePassport(passport);

// CRITICAL FIX: wrap Passport's deserializers so a "user not found" returns
// done(null, false) instead of throwing (which returns HTML error pages on JSON
// endpoints and spams the console for stale sessions). The bearer token
// middleware sets the real user when applicable.
const originalDeserializers = passport._deserializers ? passport._deserializers.slice() : [];
passport._deserializers = originalDeserializers.map(originalFn => {
  return function safeDeserializer(username, done) {
    try {
      const safeDone = (err, user) => {
        if (err && err !== 'pass') return done(null, false);
        done(err, user);
      };
      const result = originalFn(username, safeDone);
      if (result && typeof result.catch === 'function') {
        result.catch(() => done(null, false));
      }
    } catch (e) {
      done(null, false);
    }
  };
});

app.set('authservice', authservice);
app.set('serviceRegistry', serviceRegistry);

startup.checkpoint('core services constructed');

// ----------------------------------------------------------------------------
// AUTH METHOD SWITCH  (.env:  AUTH_METHOD = local | azure)
// ----------------------------------------------------------------------------
// One flag selects how users sign in to the whole platform:
//   • local  → file-based username / password (Passport local strategy). Default.
//   • azure  → Microsoft Entra (Azure AD) SSO. Local credentials still work as an
//              admin escape hatch at  /services/authservice/views/login.html?local=1
//
// Why this also blanks two env vars: every Azure "is it enabled?" check — the
// provider block just below, the seamless-SSO redirect guard (STEP 7), AND the
// core authservice's /services/authservice/api/sso-config endpoint that the login
// page probes to decide whether to auto-bounce to Microsoft — all key off the
// presence of AZURE_AD_CLIENT_ID + AZURE_AD_TENANT_ID. Resolving the method here
// and clearing those two vars in-process when the method isn't 'azure' makes all
// of them agree from this single switch, with no edits to the shared core package.
// The values stay in .env on disk, so flipping AUTH_METHOD back to 'azure' restores
// SSO. Only AZURE_AD_* is touched — never AZURE_OPENAI_* / AZURE_KEYVAULT_*.
const AUTH_METHOD = (() => {
  const raw = (process.env.AUTH_METHOD || 'local').trim().toLowerCase();
  const wantsAzure = ['azure', 'ad', 'entra', 'aad', 'sso'].includes(raw);
  const knownLocal = ['local', 'file', 'passport', 'password', ''].includes(raw);
  if (!wantsAzure && !knownLocal) {
    log.warn(`AUTH_METHOD="${raw}" not recognised — using local sign-in. Set AUTH_METHOD=local or AUTH_METHOD=azure.`);
  }
  if (wantsAzure) {
    if (process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_TENANT_ID) return 'azure';
    log.warn('AUTH_METHOD=azure but AZURE_AD_CLIENT_ID / AZURE_AD_TENANT_ID are not set — falling back to local sign-in.');
  }
  return 'local';
})();
if (AUTH_METHOD !== 'azure') {
  delete process.env.AZURE_AD_CLIENT_ID;
  delete process.env.AZURE_AD_TENANT_ID;
}
log.info(`Sign-in method: ${AUTH_METHOD === 'azure' ? 'AZURE AD (Microsoft Entra SSO)' : 'LOCAL (file-based username/password)'} [AUTH_METHOD=${process.env.AUTH_METHOD || 'local'}]`);

// ----------------------------------------------------------------------------
// Microsoft Entra (Azure AD) single sign-on — added ALONGSIDE the file provider.
// ----------------------------------------------------------------------------
// The file provider above owns the persisted users and configured passport's
// serializers. We mount Entra's OIDC strategy on the SAME passport singleton and
// point its user persistence at the file provider (userStore), so an Entra login
// lands in the one shared store and the session deserializes no matter how the
// user signed in. We deliberately do NOT pass 'express-app' — that would make the
// authservice factory register every auth route a second time; instead we register
// just the two Entra routes here. Enabled when AUTH_METHOD=azure (resolved above).
let azureAuth = null;
if (AUTH_METHOD === 'azure') {
  azureAuth = serviceRegistry.authservice('azure', {
    passport,               // host passport singleton (core ships its own copy)
    userStore: authservice  // file provider = shared, persisted user store
    // no 'express-app' (avoid duplicate routes); no loginSuccessRedirectUrl (returnUrl wins)
  });
  app.set('azureAuth', azureAuth);

  // Begin the OIDC flow. The login page's auto-redirect and the SSO guard (below)
  // both send unauthenticated users here.
  app.get('/services/authservice/api/azure', (req, res, next) => {
    azureAuth.initiateAzureAuth(req, res, next);
  });

  // Entra's registered redirect URI. form_post (POST) is the configured response
  // mode; GET is accepted for query-mode setups. On success the provider has
  // already established the passport session, so we send the user to where they
  // were headed (returnUrl) or the wiki home. On failure we show the credential
  // form — ?local=1 stops the login page bouncing straight back into SSO.
  const onAzureCallback = async (req, res, next) => {
    try {
      const result = await azureAuth.handleAzureCallback(req, res, next);

      // Pull the user's Entra profile photo into the shared avatar store so it
      // shows wherever uploaded pictures do. Best-effort and non-fatal: we give it
      // a short window to land on the first paint, then redirect regardless — if
      // Graph is slow the write finishes in the background and shows on next load.
      const email = result && result.user && result.user.email;
      if (email) {
        let azureId = result.user.azureId;
        if (!azureId) {
          try { azureId = (await authservice.getUser(email))?.azureId; } catch (_) { /* email is a fine fallback */ }
        }
        const sync = syncEntraAvatar({ appBaseDir: APP_BASE_DIR, email, azureId, log })
          .catch((e) => log.warn(`Entra avatar sync failed for ${email}: ${e.message}`));
        await Promise.race([sync, new Promise((r) => setTimeout(r, 4000))]);
      }

      // Load images
      app.use('/images/noobly-logo.png', express.static(path.join(__dirname, '/public/images/nooblyjs-core.png')));

      // redirect the app
      res.redirect((result && result.redirectUrl) || '/applications/wiki/');

    } catch (err) {
      log.error(`Entra SSO callback failed: ${err.message}`);
      res.redirect('/services/authservice/views/login.html?local=1&error=' +
        encodeURIComponent('Microsoft sign-in failed. Please try again or sign in with credentials.'));
    }
  };
  app.post('/services/authservice/openid', onAzureCallback);
  app.get('/services/authservice/openid', onAzureCallback);

  log.info('✓ Microsoft Entra (Azure AD) SSO enabled');
} else {
  log.info('Microsoft Entra (Azure AD) SSO disabled (AUTH_METHOD=local). Set AUTH_METHOD=azure with AZURE_AD_* to enable.');
}

// ============================================================================
// STEP 6: Static assets + Teams reverse proxy
// ============================================================================

// Application docs folder, exposed on the public site.
app.use('/docs', express.static(path.join(__dirname, 'docs')));
app.get('/docs/list', (req, res) => {
  let files = [];
  fs.readdirSync(path.join(__dirname, 'docs')).forEach(file => {
    if (fs.lstatSync(path.join(__dirname, 'docs', file)).isDirectory()) {
      fs.readdirSync(path.join(__dirname, 'docs', file)).forEach(subfile => {
        files.push('/' + file + '/' + subfile);
      });
    }
    files.push('/' + file);
  });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(files));
});

// Host the styles
app.use(express.static(path.join(__dirname, 'public')));

// Redirect to services
app.get('/', (req, res) => {
  res.redirect('/applications/wiki/');
});

// ----------------------------------------------------------------------------
// Reverse proxies: /applications/teams/<app> → that Teams tab server.
// ----------------------------------------------------------------------------
// Each Teams tab app (wiki, datasources) runs as its own HTTP-only
// server (TLS is terminated here, the fronting proxy) on its own fixed port. We
// proxy each under the unified domain so they sit alongside /applications/wiki.
// The Teams SDK serves every tab at /tabs/home, so each public sub-path is
// rewritten to /tabs/home on its target. `ws:true` proxies websocket upgrades.
//
// Framing: Teams renders tabs in an iframe on Microsoft-owned origins. helmet's
// X-Frame-Options: SAMEORIGIN blocks that, so the proxyRes hook drops it and sets
// a CSP frame-ancestors allow-list scoped to the Teams / Microsoft 365 hosts.
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  'teams.microsoft.com', '*.teams.microsoft.com',
  '*.teams.microsoft.us', 'local.teams.office.com',
  '*.skype.com',
  '*.office.com', 'outlook.office.com', 'outlook.office365.com',
  '*.microsoft365.com', '*.cloud.microsoft'
].join(' ');

// Public sub-path → tab-server origin. One proxy is registered per entry; a
// tab server that isn't running simply returns 502 on its path until it is.
const TEAMS_TAB_TARGETS = {
  '/applications/teams/wiki': 'http://localhost:11002',
  '/applications/teams/datasources': 'http://localhost:11003'
};

Object.entries(TEAMS_TAB_TARGETS).forEach(([publicPath, target]) => {
  app.use(createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: false,
    ws: true,
    pathFilter: publicPath,
    pathRewrite: { [`^${publicPath}`]: '/tabs/home' },
    on: {
      proxyRes: (proxyRes, req, res) => {
        res.removeHeader('X-Frame-Options');
        delete proxyRes.headers['x-frame-options'];

        const currentCsp = res.getHeader('Content-Security-Policy');
        const cspBase = typeof currentCsp === 'string' ? currentCsp.replace(/;\s*$/, '') : '';
        if (!/frame-ancestors/i.test(cspBase)) {
          res.setHeader(
            'Content-Security-Policy',
            `${cspBase ? cspBase + ';' : ''}frame-ancestors ${TEAMS_FRAME_ANCESTORS}`
          );
        }
        delete proxyRes.headers['content-security-policy'];

        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        delete proxyRes.headers['cross-origin-resource-policy'];

        // Redirects from the tab server live in its own /tabs/home path space
        // (e.g. the Teams SDK's 301 trailing-slash redirect /tabs/home → /tabs/home/).
        // Rewrite the Location header back into this app's public sub-path so the
        // browser stays inside the reverse proxy instead of bouncing to a bare
        // /tabs/home URL that isn't proxied. Strips any absolute origin too, since
        // the tab server's host differs from the public one.
        const location = proxyRes.headers['location'];
        if (location) {
          proxyRes.headers['location'] = location.replace(
            /^(?:https?:\/\/[^/]+)?\/tabs\/home/,
            publicPath
          );
        }
      },
      error: (err, req, res) => {
        log.error(`Teams proxy error for ${req.url || ''} → ${target}: ${err.message}`);
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Teams app unavailable — is the tab server running at ${target}?`);
        } else if (res && typeof res.destroy === 'function') {
          res.destroy();
        }
      }
    }
  }));
});

// ============================================================================
// STEP 7: Mount web frontends + backend API modules, then listen
// ============================================================================

// Declared at module scope so the graceful-shutdown handler can close it.
let httpRedirectServer;

// Context handed to the backend and web applications so they attach onto the
// SAME Express app / server / services this root created.
const context = {
  app,
  express,
  server,
  io,
  eventEmitter,
  serviceRegistry,
  appBaseDir: APP_BASE_DIR,
  services: { authservice, filing, cache, log, queue, scheduling, workflow, aiservice, measuring, searching, notifying, fetching, settings }
};

async function start() {
  // The Teams tabs embed the web wiki and datasources apps in an
  // iframe (the default Teams surface — see applications/teams/*/src/Tab/components/
  // Embedded*.tsx). Give those mount paths the SAME framing treatment the Teams
  // proxy gives itself: drop helmet's X-Frame-Options (SAMEORIGIN, which would
  // block the embed) and allow the Teams / Microsoft 365 hosts via CSP
  // frame-ancestors. Appends to (rather than replaces) helmet's CSP so its other
  // directives are preserved. Registered before the web static/SPA handlers so
  // it runs first per request.
  const allowTeamsFraming = (req, res, next) => {
    res.removeHeader('X-Frame-Options');
    const currentCsp = res.getHeader('Content-Security-Policy');
    const cspBase = typeof currentCsp === 'string' ? currentCsp.replace(/;\s*$/, '') : '';
    if (!/frame-ancestors/i.test(cspBase)) {
      res.setHeader(
        'Content-Security-Policy',
        `${cspBase ? cspBase + ';' : ''}frame-ancestors ${TEAMS_FRAME_ANCESTORS}`
      );
    }
    next();
  };
  app.use('/applications/wiki', allowTeamsFraming);
  app.use('/applications/datasources', allowTeamsFraming);

  // Seamless SSO (no app-shell flash): when Entra is enabled, intercept an
  // UNAUTHENTICATED top-level page navigation to an app and bounce it straight to
  // the IdP, carrying the original URL as returnUrl. Without this the SPA shell
  // would load, call /api/auth/check, and only then redirect — a brief logged-out
  // flash. We catch ONLY real document navigations and leave everything else alone:
  //   • not GET, already authenticated, or an XHR/fetch → fall through
  //   • Sec-Fetch-Dest other than 'document' (iframes incl. Teams embeds, images,
  //     scripts, fetch) → fall through, so the Teams iframe + static assets are safe
  //   • */api/* and any path with a file extension → fall through (assets + APIs
  //     return their own 401s; the SPA handles those)
  if (azureAuth) {
    const ssoRedirectGuard = (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.isAuthenticated && req.isAuthenticated()) return next();
      const dest = req.headers['sec-fetch-dest'];
      if (dest && dest !== 'document') return next();        // skip iframes/assets/xhr
      if (req.xhr || !req.accepts('html')) return next();    // skip programmatic requests
      if (req.query && req.query.embedWiki) return next();    // skip Teams embed shell
      if (/\/api\//.test(req.path)) return next();            // skip API calls
      if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next();    // skip files with an extension
      const returnUrl = req.originalUrl || req.url;
      return res.redirect('/services/authservice/api/azure?returnUrl=' + encodeURIComponent(returnUrl));
    };
    app.use(['/applications/wiki', '/applications/datasources'], ssoRedirectGuard);
  }

  // Phase 1 — web static bundles BEFORE the backend modules, so the canonical
  // src/web/*/public folders win over the wiki module's legacy ./views
  // static mounts (registered during backend.initialize).
  startup.trackSync('web:static-mounts', () => {
    webApps.forEach((web) => web.serveStatic(app, express));
  });

  // Backend API modules (datasources / wiki, incl. continuous explorations) + health endpoints.
  // This is the only awaited work between process start and listen(), so its
  // duration IS the critical path; the tasks it spawns run on past it.
  await startup.track('backend:initialize (critical path)', () => backend.initialize(context));

  // Phase 2 — SPA deep-link fallbacks AFTER the API routes, so /applications/
  // wiki/api/* (etc.) win over the catch-alls.
  startup.trackSync('web:spa-fallbacks', () => {
    webApps.forEach((web) => web.serveSpaFallback && web.serveSpaFallback(app));
  });

  listen();
}

// Bind the HTTP/HTTPS server. Called once every route is registered.
function listen() {
  const PORT = process.env.PORT || 11101;

  server.listen(PORT, () => {
    startup.markListening();
    const baseUrl = `${protocol}://localhost:${PORT}`;
    log.info('='.repeat(70));
    log.info(`✓ Knowledge Platform unified backend running on port ${PORT} (${protocol.toUpperCase()})`);
    log.info('='.repeat(70));
    log.info(`  Datasources API: ${baseUrl}/api/workflows/`);
    log.info(`  Wiki API: ${baseUrl}/applications/wiki/api/`);
    log.info(`  Continuous Explorations API: ${baseUrl}/applications/wiki/api/continuous-explorations/`);
    log.info(`  Datasources UI: ${baseUrl}/applications/datasources/`);
    log.info(`  Wiki UI: ${baseUrl}/applications/wiki/`);
    proxySummary.forEach((proxy) => {
      log.info(`  Proxy: ${baseUrl}${proxy.mountPath}/* → ${proxy.host}`);
    });
    if (httpsEnabled) {
      log.info('  Note: self-signed certificates trigger a browser warning — accept it to proceed.');
    }
    log.info('='.repeat(70));
  });

  // When serving HTTPS, also listen on HTTP and 301-redirect to HTTPS. Failure to
  // bind the redirect port is logged but does not stop the main server.
  if (httpsEnabled) {
    const { server: redirectServer, port: redirectPort } = createHttpRedirectServer({ httpsPort: PORT });
    httpRedirectServer = redirectServer;

    httpRedirectServer.on('error', (error) => {
      if (error.code === 'EACCES') {
        log.warn(`HTTP→HTTPS redirect: cannot bind port ${redirectPort} (insufficient privileges). ` +
          'Set HTTP_REDIRECT_PORT to an unprivileged port (>1024), or run with elevated privileges.');
      } else if (error.code === 'EADDRINUSE') {
        log.warn(`HTTP→HTTPS redirect: port ${redirectPort} already in use. Set HTTP_REDIRECT_PORT to a free port.`);
      } else {
        log.warn(`HTTP→HTTPS redirect server error: ${error.message}`);
      }
    });

    httpRedirectServer.listen(redirectPort, () => {
      log.info(`✓ HTTP→HTTPS redirect listening on port ${redirectPort} → https://localhost:${PORT}`);
    });
  }
}

// Kick off async startup. Any rejection that escapes is fatal.
start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});

// ============================================================================
// STEP 8: Graceful shutdown
// ============================================================================

const gracefulShutdown = async (signal) => {
  log.info(`Received ${signal}. Shutting down gracefully...`);

  io.close(() => log.info('Socket.IO server closed.'));
  server.close(() => log.info('HTTP server closed.'));

  if (httpRedirectServer) {
    httpRedirectServer.close(() => log.info('HTTP→HTTPS redirect server closed.'));
  }

  const workflowBridge = app.get('workflowBridge');
  if (workflowBridge?.stop) {
    try {
      workflowBridge.stop();
      log.info('WorkflowBridge stopped.');
    } catch (error) {
      log.error('Error stopping WorkflowBridge:', error.message);
    }
  }

  if (searching?.close) {
    try {
      await searching.close();
      log.info('Search provider client released.');
    } catch (error) {
      log.error('Error releasing search provider client:', error.message);
    }
  }

  const exitTimeout = setTimeout(() => {
    log.warn('Graceful shutdown timeout exceeded. Force exiting...');
    process.exit(0);
  }, 10000);
  exitTimeout.unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================================
// STEP 9: Error handling
// ============================================================================

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
