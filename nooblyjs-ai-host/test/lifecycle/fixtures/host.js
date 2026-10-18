// A stand-in for the NooblyJS host, with the shape of the `host` NooblyJS hands to register() (NooblyJS structure.md §2a,
// ../nooblyjs-ai-host/src/noobly.js hostFor()). The tests run on it, and so does server.js (standalone mode).
//
// Sign-in is for development only: the person is named by the X-Dev-Person header. Permissions come from the access
// role, through the same matrix as NooblyJS. Events and audit records are kept in memory. The clock can be moved.
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

/** The seeded NooblyJS people (../nooblyjs-ai-host/src/seed/data/people), plus an agent actor. */
export const PEOPLE = [
  { id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true },
  { id: 'lerato-m', name: 'Lerato M.', accessRole: 'Approver', active: true },
  { id: 'thabo-n', name: 'Thabo N.', accessRole: 'Architect', active: true },
  { id: 'priya-s', name: 'Priya S.', accessRole: 'Contributor', active: true },
  { id: 'naledi-k', name: 'Naledi K.', accessRole: 'Viewer', active: true },
  // Agents are capped at Contributor; this one's role is wrongly raised, to prove decisions still refuse it.
  { id: 'ada-quill', name: 'Ada Quill', accessRole: 'Owner', kind: 'agent', active: true },
];

export const MATRIX = {
  read: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'],
  draft: ['Contributor', 'Approver', 'Architect', 'Owner'],
  approve: ['Approver', 'Architect', 'Owner'],
  'accept-decisions': ['Architect', 'Owner'],
  merge: ['Approver', 'Architect', 'Owner'],
  'change-repo-access': ['Owner'],
};

export const PERSON_HEADER = 'x-dev-person';
const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

/** A stand-in for the initialised nooblyjs-core serverManager: the methods apps may call. */
export function createTestServerManager() {
  const lines = [];
  const logger = (name) => Object.fromEntries(['error', 'warn', 'info', 'log', 'debug'].map((level) => [level, (message) => { lines.push({ level, instance: name, message: String(message) }); }]));
  return {
    initialized: true,
    lines,
    initialize() {
      throw new Error('Only the host initialises the serverManager.');
    },
    getDefaultProviderType: () => 'memory',
    getEventEmitter: () => new EventEmitter(),
    logger: (type, options = {}) => logger(options.instanceName ?? 'default'),
  };
}

/**
 * @param {object} o
 * @param {string} o.dataDir                      the app's own data folder
 * @param {Record<string, object>} [o.services]   other apps' services, by name
 * @param {string} [o.now]                        where the clock starts (ISO; default the real now)
 */
export function createHost({ dataDir, people = PEOPLE, services = {}, now } = {}) {
  const auditLog = [];
  const eventLog = [];
  const bus = new EventEmitter().setMaxListeners(100);
  let offset = now ? new Date(now).getTime() - Date.now() : 0;
  const clock = { now: () => Date.now() + offset };
  const iso = () => new Date(clock.now()).toISOString();
  const can = async (accessRole, permission) => (MATRIX[permission] ?? []).includes(accessRole);
  const byId = (id) => people.find((p) => p.id === id && p.active) ?? null;

  async function record(entry) {
    auditLog.push({ at: iso(), ...entry });
  }

  function auth(req, res, next) {
    req.person ??= byId(req.get(PERSON_HEADER));
    if (req.person) return next();
    sendError(res, 401, 'unauthenticated', 'Sign in to continue.');
  }

  function requireRole(permission) {
    return async (req, res, next) => {
      if (await can(req.person?.accessRole, permission)) return next();
      res.locals.audit = { action: 'access.refused', permission };
      sendError(res, 403, 'forbidden', `This needs the "${permission}" permission. Your access role is ${req.person?.accessRole ?? 'none'}.`);
    };
  }

  // Like NooblyJS: one record per write and per refusal, written when the answer has gone, with what the route named.
  const audit = Object.assign((req, res, next) => {
    res.on('finish', () => {
      record({ actor: req.person?.id ?? null, action: `${req.method} ${req.originalUrl.split('?')[0]}`, status: res.statusCode, ...(res.locals.audit ?? {}) });
    });
    next();
  }, { record });

  const events = {
    async emit(type, payload, { actor } = {}) {
      const event = { id: `evt_${eventLog.length + 1}`, at: iso(), type, actor: actor ?? null, payload };
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
    people, auditLog, eventLog, clock, can,
    /** Moves the clock to an ISO time, or forward by milliseconds. */
    setNow(value) {
      offset = typeof value === 'number' ? offset + value : new Date(value).getTime() - Date.now();
    },
    host: {
      express, auth, requireRole, can, audit, events, clock,
      store: new FsStore(dataDir),
      // Like NooblyJS's people service: no `kind`. An agent is known by the actor another app passes, or its sign-in.
      people: { list: async () => people.filter((p) => p.kind !== 'agent'), get: async (id) => people.find((p) => p.id === id && p.kind !== 'agent') ?? null },
      service: (name) => services[name],
      frame: (req, res) => res.type('html').send('<!doctype html><title>frame</title>'),
      publicBaseUrl: '',
      checksCsrf: true,
    },
  };
}
