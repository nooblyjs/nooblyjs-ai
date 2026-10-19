// A stand-in for the NooblyJS host: the `host` object NooblyJS hands to register() (../nooblyjs-ai-host/src/noobly.js
// hostFor()), as far as the factory uses it. Sign-in is the X-Dev-Person header. Permissions come
// from the access role through the same matrix as NooblyJS (../nooblyjs-ai-host/src/seed/data/access/roles.yaml).
// Events and audit records are kept in memory, so a test can read them.
import { EventEmitter } from 'node:events';
import express from 'express';

/** One person per access role, and an agent (agents are capped at Contributor). */
export const PEOPLE = [
  { id: 'stevie', name: 'Stevie', accessRole: 'Owner' },
  { id: 'lerato-m', name: 'Lerato M.', accessRole: 'Approver' },
  { id: 'priya-s', name: 'Priya S.', accessRole: 'Contributor' },
  { id: 'naledi-k', name: 'Naledi K.', accessRole: 'Viewer' },
  { id: 'ada-quill', name: 'Ada Quill', accessRole: 'Contributor', kind: 'agent' },
];

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

export const FRAME = '<!doctype html><title>NooblyJS</title><script type="module" src="/ui/js/frame.js"></script>';
const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function createHost({ people = PEOPLE, now = () => Date.now() } = {}) {
  const auditLog = [];
  const eventLog = [];
  const bus = new EventEmitter();
  const can = async (accessRole, permission) => (MATRIX[permission] ?? []).includes(accessRole);
  const record = async (entry) => void auditLog.push({ at: new Date().toISOString(), ...entry });

  function auth(req, res, next) {
    req.person = people.find((p) => p.id === req.get('x-dev-person')) ?? null;
    if (req.person) return next();
    if (req.originalUrl.includes('/api/')) return sendError(res, 401, 'unauthenticated', 'Sign in to continue.');
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  const requireRole = (permission) => async (req, res, next) => {
    const role = req.person?.accessRole;
    if (await can(role, permission)) return next();
    await record({ actor: req.person?.id ?? null, action: 'access.refused', target: `${req.method} ${req.originalUrl.split('?')[0]}`, permission });
    sendError(res, 403, 'forbidden', `This needs the "${permission}" permission. Your access role is ${role ?? 'none'}.`);
  };
  const audit = Object.assign((req, res, next) => {
    res.on('finish', () => void record({ actor: req.person?.id ?? null, action: `${req.method} ${req.originalUrl.split('?')[0]}`, status: res.statusCode }));
    next();
  }, { record });
  const events = {
    async emit(type, payload = {}, { actor = null } = {}) {
      const event = { at: new Date().toISOString(), type, actor, payload };
      eventLog.push(event);
      bus.emit(type, event);
      return event;
    },
    on(type, fn) {
      bus.on(type, fn);
      return () => bus.off(type, fn);
    },
  };

  return {
    auditLog,
    eventLog,
    host: {
      express, auth, requireRole, can, audit, events,
      people: { list: async () => people, get: async (id) => people.find((p) => p.id === id) ?? null },
      clock: { now },
      service: () => undefined,
      frame: (req, res) => (req.get('x-dev-person') ? res.type('html').send(FRAME) : res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`)),
      publicBaseUrl: '',
      checksCsrf: true,
    },
  };
}

/** nooblyjs-core's memory queue, as far as the sections use it (the Product section's drafts, Infrastructure's runs). */
function memoryQueue() {
  const queues = new Map();
  const q = (name) => (queues.has(name) ? queues.get(name) : queues.set(name, []).get(name));
  return {
    enqueue: async (name, item) => void q(name).push(item),
    dequeue: async (name) => q(name).shift(),
    size: async (name) => q(name).length,
  };
}

/** The nooblyjs-core serverManager, as far as the factory and its sections use it. Only the host may initialise it. */
export function createTestServerManager() {
  const lines = [];
  return {
    initialized: true,
    lines,
    initialize() {
      throw new Error('Only the host initialises the serverManager.');
    },
    getDefaultProviderType: () => 'memory',
    getEventEmitter: () => new EventEmitter(),
    logger: (type, { instanceName } = {}) => Object.fromEntries(['error', 'warn', 'info', 'log', 'debug'].map((level) => [level, (message) => void lines.push({ level, instanceName, message: String(message) })])),
    queue: () => memoryQueue(),
  };
}
