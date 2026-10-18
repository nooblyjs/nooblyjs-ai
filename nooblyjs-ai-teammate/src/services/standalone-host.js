// A stand-in for the NooblyJS host, with exactly the shape of the hosted-app contract
// (../nooblyjs-ai-host/.claude/steering/structure.md §2a): an Express 5 app, an initialised nooblyjs-core serverManager, and the
// `host` object handed to register(). Teammates runs on it standalone (server.js), and the tests and
// scripts/live-smoke.js use it too (test/fixtures/host.js). Hosted, NooblyJS AI's host takes its place.
//
// People sign in with nooblyjs-core's authservice (its login page and API under /services/authservice). Their core role
// becomes a NooblyJS access role on req.person: admin/owner → Owner, manager → Approver, anything else → Viewer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express';
import { SERVICES_CSP } from './core/index.js';
import { fileSessionStore } from './core/session-store.js';
import { FsStore } from '../models/fs-store.js';

const require = createRequire(import.meta.url);
export const serverManager = require('nooblyjs-core');
// The authservice sets up its Passport (de)serializers on core's own passport, so the host uses core's copies of
// passport and express-session.
const corePaths = { paths: [path.dirname(require.resolve('nooblyjs-core'))] };
const session = require(require.resolve('express-session', corePaths));
const passport = require(require.resolve('passport', corePaths));
const { createSessionStore } = require('nooblyjs-core/src/shared/utils/sessionStore');

export const ADMIN_EMAIL = 'admin@localhost';
export const SESSION_COOKIE = 'nooblyjs.sid';
/** The double-submit CSRF cookie the UI kit's api.js sends back as X-CSRF-Token (the same name the NooblyJS host uses). */
export const CSRF_COOKIE = 'noobly.csrf';
/** nooblyjs-core's sign-in page; it sends people back to returnUrl. */
export const LOGIN_PATH = '/services/authservice/views/login.html';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Core roles people can be given on the Authentication dashboard, one per access role used here. */
const CORE_ROLES = ['owner', 'manager', 'contributor', 'viewer'];
/** Which access roles have each permission: the rows of the NooblyJS matrix (product.md §6, data/access/roles.yaml) Teammates uses. */
const MATRIX = {
  read: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'],
  draft: ['Contributor', 'Approver', 'Architect', 'Owner'],
  approve: ['Approver', 'Architect', 'Owner'],
  'set-budgets': ['Owner'],
  'hire-teammates': ['Owner'],
};
const SESSION_HOURS = 24;
// Core's file logger knows error < warn < info < log; "log" is its debug level.
const CORE_LEVEL = { error: 'error', warn: 'warn', info: 'info', debug: 'log' };

/** The NooblyJS access role for a core user's roles. */
export function accessRoleFromCore(roles = []) {
  const list = Array.isArray(roles) ? roles : [roles];
  if (list.includes('owner') || list.includes('admin')) return 'Owner';
  if (list.includes('manager')) return 'Approver';
  if (list.includes('contributor')) return 'Contributor';
  return 'Viewer';
}

/** Whether an access role has a permission, and all of a role's permissions (what the shell needs). */
export const can = async (accessRole, permission) => (MATRIX[permission] ?? []).includes(accessRole);
export const permissionsFor = async (accessRole) => Object.keys(MATRIX).filter((p) => MATRIX[p].includes(accessRole));

const cookieValue = (req, name) => {
  const match = new RegExp(`(?:^|;\\s*)${name.replace('.', '\\.')}=([^;]+)`).exec(req.headers.cookie ?? '');
  return match ? decodeURIComponent(match[1]) : null;
};

const personFromCoreUser = (u) => ({
  id: u.email, email: u.email, name: u.fullName || u.email, accessRole: accessRoleFromCore(u.roles ?? u.role), active: u.isActive !== false, lastLogin: u.lastLogin ?? null,
});

/** SESSION_SECRET, or one generated on first start and kept in <dataDir>/core/session-secret (0600). */
function loadSessionSecret(dataDir, secret) {
  if (secret) return crypto.createHmac('sha256', secret).update(SESSION_COOKIE).digest('base64url'); // not the CSRF key
  const file = path.join(dataDir, 'core', 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const fresh = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
  }
}

/**
 * Builds the host: an Express 5 app with sessions, Passport and the nooblyjs-core serverManager (dashboards and sign-in
 * under /services), core's file logging in `logDir`, and the authservice's people in <dataDir>/core/auth. The
 * serverManager is a process-wide singleton, so there is one host per process. hostFor() gives each app its `host`.
 */
export async function createHost({
  dataDir,
  logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(dataDir, 'logs'),
  logLevel = process.env.LOG_LEVEL ?? 'info',
  consoleMode = process.env.LOG_CONSOLE ?? 'all',
  sessionSecret = process.env.SESSION_SECRET,
  cookieSecure = process.env.COOKIE_SECURE === 'true',
  trustProxy = process.env.TRUST_PROXY,
  publicBaseUrl = '',
} = {}) {
  if (serverManager.initialized) throw new Error('The nooblyjs-core serverManager already has a host in this process.');
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'extended'); // Express 4's default, which core's dashboards were written against
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Redis when SESSION_REDIS_URL/REDIS_URL is set (core's store, shared between servers); otherwise a file, so a
  // restart doesn't sign everyone out. Core's default in-memory store loses every session on restart.
  const sessions = process.env.SESSION_REDIS_URL || process.env.REDIS_URL
    ? createSessionStore(session)
    : (() => {
      const FileStore = fileSessionStore(session);
      const store = new FileStore({ file: path.join(dataDir, 'core', 'sessions.json') });
      return { store, close: () => store.close() };
    })();
  app.use(session({
    name: SESSION_COOKIE,
    store: sessions.store,
    secret: loadSessionSecret(dataDir, sessionSecret),
    resave: false,
    saveUninitialized: false,
    cookie: { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: SESSION_HOURS * 3600000 },
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  // The dashboards use inline scripts and CDN assets, so they get core's own policy.
  app.use('/services', (req, res, next) => {
    res.set('Content-Security-Policy', SERVICES_CSP);
    next();
  });

  // Core's services log to the file too. 'all' shows those lines on the console.
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200); // every service instance's analytics subscribes
  if (consoleMode === 'all') {
    for (const [event, method] of [['error', 'error'], ['warn', 'warn'], ['info', 'log'], ['log', 'log']]) {
      emitter.on(`log:${event}:default`, ({ message }) => console[method](message));
    }
  }
  serverManager.setDefaultProvider('logging', 'file', { logDir, log: { level: CORE_LEVEL[logLevel] ?? 'info' } });
  // /services requires a signed-in admin of core's authservice (the default).
  serverManager.initialize(app, emitter, {});
  const authDir = path.join(dataDir, 'core', 'auth');
  const authservice = serverManager.authservice('file', { 'express-app': app, dataDir: authDir });
  // Core's login page asks the site whether you are already signed in.
  app.get('/api/auth/check', (req, res) => res.json({ authenticated: Boolean(req.isAuthenticated?.() && req.user?.isActive !== false) }));

  // Wait for the authservice to load its files (it creates admin@localhost on first start), then make sure the
  // core roles exist, so they can be given to people on the Authentication dashboard.
  for (let i = 0; i < 200 && !(await authservice.listUsers()).length; i++) await new Promise((r) => setTimeout(r, 25));
  const existing = await authservice.listRoles();
  for (const role of CORE_ROLES) if (!existing.includes(role)) await authservice.createRole(role).catch(() => {});

  // The shared audit log and event log: in memory here (NooblyJS appends them to data/audit/ and data/events/).
  const auditLog = [];
  const eventLog = [];
  const bus = new EventEmitter().setMaxListeners(100);
  const record = (entry) => {
    auditLog.push({ at: new Date().toISOString(), ...entry });
    if (auditLog.length > 5000) auditLog.shift();
  };
  emitter.on('auth:login-api', ({ email }) => record({ actor: email, action: 'session.login' }));

  const signedIn = (req) => Boolean(req.user?.email && req.user.isActive !== false);
  const auth = (req, res, next) => {
    if (signedIn(req)) {
      req.person = personFromCoreUser(req.user);
      return next();
    }
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
  };
  // The frame's sign-in: a page sends someone signed out to core's login page, which brings them back.
  const pageAuth = (req, res, next) => {
    if (signedIn(req) || req.originalUrl.includes('/api/')) return auth(req, res, next);
    res.redirect(302, `${LOGIN_PATH}?returnUrl=${encodeURIComponent(req.originalUrl)}`);
  };
  // Standalone, the host checks CSRF the way NooblyJS does (host.checksCsrf): a readable cookie holds a random token
  // and every change sends it back as X-CSRF-Token (or the _csrf field of a form). Core's own routes under /services
  // and its sign-in API keep their own checks.
  const csrf = (req, res, next) => {
    if (req.path.startsWith('/services/') || req.path.startsWith('/api/auth/')) return next();
    let token = cookieValue(req, CSRF_COOKIE);
    if (!token && signedIn(req)) {
      token = crypto.randomBytes(24).toString('base64url');
      res.append('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax${cookieSecure ? '; Secure' : ''}`);
    }
    if (!UNSAFE.has(req.method)) return next();
    const sent = req.get('x-csrf-token') ?? req.body?._csrf;
    if (token && sent && sent.length === token.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token))) return next();
    res.status(403).json({ error: { code: 'csrf_failed', message: 'Your session has expired. Refresh the page and try again.' } });
  };
  const requireRole = (permission) => (req, res, next) => {
    const role = req.person?.accessRole;
    if ((MATRIX[permission] ?? []).includes(role)) return next();
    record({ actor: req.person?.email, action: 'access.refused', target: `${req.method} ${req.originalUrl.split('?')[0]}`, permission });
    res.status(403).json({ error: { code: 'forbidden', message: `This needs the ${permission} permission. Your access role is ${role ?? 'none'}.` } });
  };
  const audit = Object.assign((req, res, next) => {
    res.on('finish', () => record({ actor: req.person?.email, action: `${req.method} ${req.originalUrl.split('?')[0]}`, status: res.statusCode }));
    next();
  }, { record });
  const events = {
    emit(type, payload) {
      eventLog.push({ at: new Date().toISOString(), type, payload });
      if (eventLog.length > 5000) eventLog.shift();
      bus.emit(type, payload);
    },
    on: (type, fn) => bus.on(type, fn),
  };
  const people = {
    list: async () => (await authservice.listUsers()).map(personFromCoreUser),
    get: async (id) => {
      const u = await authservice.getUser(id).catch(() => null);
      return u ? personFromCoreUser(u) : null;
    },
  };
  // The app's own page still has a sign-out button (document mode): end the core session and revoke its token.
  const signOut = async (req, res, { token } = {}) => {
    if (token) await authservice.logout(token).catch(() => {});
    await new Promise((resolve) => (req.logout ? req.logout(() => resolve()) : resolve()));
    await new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  };

  return {
    app,
    serverManager,
    authservice,
    sessionCookie: SESSION_COOKIE,
    logDir,
    authDir,
    auditLog,
    eventLog,
    auth,
    pageAuth,
    csrf,
    can,
    permissionsFor,
    signOut,
    /**
     * The `host` handed to one app's register(). Standalone, server.js passes the shell's `frame` and checksCsrf
     * (it runs `csrf` first); the tests leave both out, so the app checks its own CSRF token.
     */
    hostFor({ dataDir: appDir, frame, checksCsrf = false }) {
      return {
        express,
        auth,
        requireRole,
        audit,
        events,
        store: new FsStore(appDir),
        people,
        service: () => undefined, // no other apps run here
        frame: frame ?? ((req, res) => res.status(501).type('text').send('The NooblyJS frame is not available on the stand-in host.')),
        checksCsrf,
        publicBaseUrl,
        signOut,
      };
    },
    /** Stops every core service (timers, worker threads, file handles) and the session store. */
    async close() {
      await serverManager.shutdown();
      await sessions.close?.();
    },
  };
}
