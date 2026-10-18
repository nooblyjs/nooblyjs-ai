// A stand-in for the NooblyJS host, with exactly the shape of the `host` NooblyJS hands to register() (noobly structure.md §2a,
// ../nooblyjs-ai-host/src/noobly.js hostFor()). The tests run on it. Copied from nooblyjs-ai-product/test/fixtures/host.js; express5 is Express 5 under an alias, because the standalone platform still depends on Express 4.
//
// Sign-in is for development only: the person is named by the X-Dev-Person header (tests, curl) or the
// noobly.dev-person cookie (set by server.js's /login). Permissions come from the access role, through the same
// matrix as NooblyJS (../nooblyjs-ai-host/src/seed/data/access/roles.yaml). Events and audit records are kept in memory, and
// appended under the root folder when `persist` is set.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express5';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

/** The seeded NooblyJS people (../nooblyjs-ai-host/src/seed/data/people), one per access role. */
export const PEOPLE = [
  { id: 'stevie', name: 'Stevie', email: 'stevie@noobly.local', accessRole: 'Owner', workRole: 'Platform engineer', active: true },
  { id: 'lerato-m', name: 'Lerato M.', email: 'lerato-m@noobly.local', accessRole: 'Approver', workRole: 'Product manager', active: true },
  { id: 'thabo-n', name: 'Thabo N.', email: 'thabo-n@noobly.local', accessRole: 'Architect', workRole: 'Architect', active: true },
  { id: 'priya-s', name: 'Priya S.', email: 'priya-s@noobly.local', accessRole: 'Contributor', workRole: 'Developer', active: true },
  { id: 'naledi-k', name: 'Naledi K.', email: 'naledi-k@noobly.local', accessRole: 'Viewer', workRole: 'Product manager', active: true },
  // An agent actor: agents are capped at Contributor (roles.yaml agentCap) and marked kind: 'agent'.
  { id: 'ada-quill', name: 'Ada Quill', email: 'ada-quill@agents.noobly.local', accessRole: 'Contributor', workRole: 'Research agent', kind: 'agent', active: true },
];

/** Which access roles have each permission (NooblyJS product.md §6). Unknown permissions are refused. */
export const MATRIX = {
  read: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'],
  draft: ['Contributor', 'Approver', 'Architect', 'Owner'],
  approve: ['Approver', 'Architect', 'Owner'],
  'accept-decisions': ['Architect', 'Owner'],
  merge: ['Approver', 'Architect', 'Owner'],
  'hire-teammates': ['Owner'],
  'set-budgets': ['Owner'],
  'change-guardrails': ['Owner'],
  'change-repo-access': ['Owner'],
};

export const PERSON_HEADER = 'x-dev-person';
export const PERSON_COOKIE = 'noobly.dev-person';
export const CSRF_COOKIE = 'noobly.csrf';
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const wantsJson = (req) => req.originalUrl.split('?')[0].includes('/api/') || req.get('accept')?.includes('application/json') === true;

export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** nooblyjs-core's memory queue, as far as apps use it: enqueue and dequeue by queue name. */
function memoryQueue() {
  const queues = new Map();
  const q = (name) => (queues.has(name) ? queues.get(name) : queues.set(name, []).get(name));
  return {
    enqueue: async (name, item) => void q(name).push(item),
    dequeue: async (name) => q(name).shift(),
    size: async (name) => q(name).length,
  };
}

/**
 * A stand-in for the initialised nooblyjs-core serverManager: the methods apps may call, with a record of the calls.
 * initialize() throws, because only the host initialises it. server.js uses the real nooblyjs-core instead.
 */
export function createTestServerManager() {
  const calls = [];
  const lines = [];
  const logger = (name) => Object.fromEntries(['error', 'warn', 'info', 'log', 'debug'].map((level) => [
    level, async (message) => { lines.push({ level, instance: name, message: String(message) }); },
  ]));
  const service = (kind) => (providerType = 'memory', options = {}) => {
    calls.push({ service: kind, providerType, instanceName: options.instanceName ?? 'default' });
    if (kind === 'logging') return logger(options.instanceName ?? 'default');
    if (kind === 'queueing') return memoryQueue();
    return {};
  };
  return {
    initialized: true,
    calls,
    lines,
    initialize() {
      throw new Error('Only the host initialises the serverManager.');
    },
    getDefaultProviderType: () => 'memory',
    getEventEmitter: () => new EventEmitter(),
    logger: service('logging'),
    cache: service('caching'),
    queue: service('queueing'),
    scheduling: service('scheduling'),
    notifying: service('notifying'),
    measuring: service('measuring'),
    searching: service('searching'),
  };
}

/** Fake partner apps (the `services` they would return), recording what this engine asks of them. */
export function fakeServices() {
  const calls = [];
  const record = (name) => async (input) => {
    calls.push({ name, input });
    return { ok: true };
  };
  return {
    calls,
    services: {
      workflows: { decide: record('workflows.decide'), item: record('workflows.item'), handoff: record('workflows.handoff') },
      teammates: { runTask: record('teammates.runTask') },
      knowledge: { contextFor: async (input) => (calls.push({ name: 'knowledge.contextFor', input }), { passages: [] }) },
    },
  };
}

/**
 * Builds the stand-in host.
 * @param {object} [o]
 * @param {string} [o.rootDir]        the host's data folder; events and audit records are appended here with `persist`
 * @param {object[]} [o.people]
 * @param {Record<string, object>} [o.services]   other apps' services, by name
 * @param {Function} [o.frame]        the frame page handler (server.js passes nooblyjs-core's)
 * @param {boolean} [o.persist]       append events and audit records under rootDir
 * @param {string} [o.publicBaseUrl]
 */
export function createHost({ rootDir, people = PEOPLE, services = {}, frame, persist = false, publicBaseUrl = '' } = {}) {
  const rootStore = rootDir ? new FsStore(rootDir) : null;
  const auditLog = [];
  const eventLog = [];
  const bus = new EventEmitter().setMaxListeners(100);
  const day = (at) => [at.slice(0, 4), at.slice(5, 7), `${at.slice(0, 10)}.yaml`];

  const byId = (id) => people.find((p) => p.id === id && p.active) ?? null;
  const can = async (accessRole, permission) => (MATRIX[permission] ?? []).includes(accessRole);
  const permissionsFor = async (accessRole) => Object.keys(MATRIX).filter((p) => MATRIX[p].includes(accessRole));

  async function record(entry) {
    const full = { at: new Date().toISOString(), ...entry };
    auditLog.push(full);
    if (persist && rootStore) await rootStore.appendYaml(['audit', ...day(full.at)], full);
  }

  /** Who is signed in: the header (tests, curl) or the dev sign-in cookie. Never refuses. */
  function identify(req) {
    if (req.person !== undefined) return req.person;
    const header = req.get(PERSON_HEADER);
    req.signedInBy = header ? 'header' : 'cookie';
    req.person = byId(header ?? readCookies(req)[PERSON_COOKIE]);
    return req.person;
  }

  /** host.auth: a person on req.person, or 401 (API) / a redirect to /login (pages). */
  function auth(req, res, next) {
    if (identify(req)) return next();
    if (wantsJson(req)) return sendError(res, 401, 'unauthenticated', 'Sign in to continue.');
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  }

  /** host.requireRole(permission): 403, with an audit record, unless the access role has the permission. */
  function requireRole(permission) {
    return async (req, res, next) => {
      const role = req.person?.accessRole;
      if (await can(role, permission)) return next();
      await record({ actor: req.person?.id ?? null, action: 'access.refused', target: `${req.method} ${req.originalUrl.split('?')[0]}`, permission });
      sendError(res, 403, 'forbidden', `This needs the "${permission}" permission. Your access role is ${role ?? 'none'}.`);
    };
  }

  /** host.audit: middleware that records the write once it is answered, and record() for anything else. */
  const audit = Object.assign((req, res, next) => {
    res.on('finish', () => {
      record({ actor: req.person?.id ?? null, action: `${req.method} ${req.originalUrl.split('?')[0]}`, status: res.statusCode }).catch(() => {});
    });
    next();
  }, { record });

  const events = {
    async emit(type, payload, { actor } = {}) {
      const event = { at: new Date().toISOString(), type, actor: actor ?? null, payload };
      eventLog.push(event);
      if (persist && rootStore) await rootStore.appendYaml(['events', ...day(event.at)], event);
      bus.emit(type, event);
      return event;
    },
    on(type, fn) {
      bus.on(type, fn);
      return () => bus.off(type, fn);
    },
  };

  /**
   * The CSRF check NooblyJS makes before an app sees a change (host.checksCsrf). Only cookie sign-ins need it: a
   * browser can't add the X-Dev-Person header to a cross-site request without a preflight.
   */
  function csrf(req, res, next) {
    if (READS.has(req.method)) return next();
    identify(req);
    if (!req.person || req.signedInBy === 'header') return next();
    const token = readCookies(req)[CSRF_COOKIE];
    const sent = req.get('x-csrf-token') ?? '';
    const ok = token && sent.length === token.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
    if (ok) return next();
    sendError(res, 403, 'csrf', 'The form expired. Reload the page and try again.');
  }

  return {
    auditLog,
    eventLog,
    events,
    people,
    can,
    permissionsFor,
    auth,
    csrf,
    /** The `host` handed to one app's register(), with its store rooted at the app's dataDir. */
    hostFor(appDir) {
      return {
        express,
        auth,
        requireRole,
        can,
        audit,
        events,
        clock: { now: () => Date.now() },
        store: new FsStore(appDir),
        people: { list: async () => people, get: async (id) => byId(id), getByEmail: async (email) => people.find((p) => p.email === email) ?? null },
        service: (name) => services[name],
        frame: frame ?? ((req, res) => res.status(501).type('text').send('The NooblyJS frame is not available on the stand-in host.')),
        publicBaseUrl,
        checksCsrf: true,
      };
    },
  };
}
