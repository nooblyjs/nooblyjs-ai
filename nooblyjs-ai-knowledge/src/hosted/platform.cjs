'use strict';

/**
 * @fileoverview Runs the Wiki Platform's API modules (src/datasources, src/wiki)
 * inside a NooblyJS host, on the host's nooblyjs-core registry and behind the host's
 * sign-in.
 *
 * Standalone, app.js builds the core services and hands them to
 * src/initialize.js. Hosted, the registry is already initialised by NooblyJS, so this
 * builds the same set from it — as instances named after the app wherever the
 * wiki keeps data of its own, so its cache, search index, queue and schedules do
 * not mix with NooblyJS's — and hands src/initialize.js a facade app (legacyApp.cjs)
 * instead of the Express app.
 *
 * Sign-in needs no translation: NooblyJS runs the same nooblyjs-core Passport, so
 * `req.user` / `req.isAuthenticated()` mean here what they mean standalone.
 */

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { AsyncLocalStorage } = require('node:async_hooks');
const StructuredLogger = require('../shared/utils/StructuredLogger');
const { createLegacyApp } = require('./legacyApp.cjs');
const agentTasks = require('../shared/ai/agentTasks');

const INSTANCE = 'wiki';
// The teammate the wiki's agents work as (NooblyJS Phase 24): Ada Quill, the Research Analyst, unless told otherwise.
const TEAMMATE = process.env.KNOWLEDGE_AGENT_TEAMMATE || 'ada-quill';

/** SEARCH_SYNONYMS ("key=alt1|alt2, …") → equivalence groups, as app.js parses it. */
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
 * The core services the modules take, from the host's registry.
 *
 * A provider the host has already configured against an external system (Redis,
 * SOLR, ActiveMQ) is shared as the host's own instance: a second, differently
 * named instance would need the connection options only the host has.
 */
function buildServices({ registry, appBaseDir, log }) {
  const named = { instanceName: INSTANCE };
  const typeOf = (service, fallback) => registry.getDefaultProviderType?.(service) || fallback;
  const own = (create, type, options = {}) => (type === 'memory' ? create.call(registry, type, { ...named, ...options }) : create.call(registry, type));

  const settingsSecret = process.env.SETTINGS_SECRET;
  if ((!settingsSecret || settingsSecret.length < 32) && process.env.NODE_ENV === 'production') {
    throw new Error('SETTINGS_SECRET must be set to a strong value (≥32 chars) in production: it encrypts the wiki settings store.');
  }
  const settings = registry.settings('file', {
    ...named,
    filepath: path.join(appBaseDir, 'configuration', 'settings', 'settings.enc.json'),
    secret: settingsSecret,
    dependencies: { log },
  });

  const cache = own(registry.cache, process.env.CACHING_SERVICE === 'redis' ? 'redis' : 'memory');
  const searching = own(registry.searching, process.env.SEARCH_SERVICE === 'solr' ? 'solr' : 'memory', {
    bm25: { k1: Number(process.env.SEARCH_BM25_K1) || 1.8 },
    synonyms: parseSynonyms(process.env.SEARCH_SYNONYMS),
    snippet: { enabled: true, wordsBefore: 10, wordsAfter: 10, highlight: true },
  });
  const queue = own(registry.queue, typeOf('queueing', 'memory') === 'activemq' ? 'activemq' : 'memory');

  const filing = registry.filing('local', named);
  const scheduling = registry.scheduling('memory', named);
  if (typeof scheduling?.saveSettings === 'function') {
    const jobTimeout = parseInt(process.env.SCHEDULER_JOB_TIMEOUT_MS, 10) || 28800000;
    Promise.resolve(scheduling.saveSettings({ jobTimeout })).catch((err) => log.warn('Failed to set scheduler jobTimeout', { error: err.message }));
  }
  const workflow = registry.workflow('memory', named);
  const notifying = registry.notifying('memory', named);
  const measuring = registry.measuring('default', { ...named, dependencies: { logging: log }, dataRetention: 30, aggregationInterval: 60, metricsLimit: 1000 });
  // The host's sign-in store: one set of accounts for NooblyJS and the wiki.
  const authservice = registry.getServiceInstance('authservice', 'file') || registry.authservice('file');
  const aiservice = registry.aiservice('ollama', {
    ...named,
    model: process.env.AI_MODEL || 'tinyllama:1.1b',
    tokensStorePath: path.join(appBaseDir, 'data', 'ai-tokens.json'),
  });

  return { authservice, filing, cache, log, queue, scheduling, workflow, aiservice, measuring, searching, notifying, settings };
}

/** An agent's name as a work type Teammates accepts ('knowledge.chat-processing'). */
function workTypeOf(agent) {
  const slug = String(agent || 'wiki').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  return `knowledge.${slug || 'wiki'}`;
}

/**
 * The wiki's AI agents as teammate tasks (NooblyJS Phase 24: mocking audit A6, security audit S-08). Each prompt is
 * one task run as TEAMMATE through `host.service('teammates').runTask`: Platform checks it first, it is billed to the
 * teammate's timesheet, attributed to the person whose request it serves (or NooblyJS, for a workflow), and audited.
 * The task has no tools: what comes back is text, and what the wiki does with it is the wiki's code. Nothing calls the
 * agent's own provider: without Teammates the prompt is refused.
 *
 * With no model configured, Teammates plays the script, which for the wiki is "no answer": the prompt fails as an
 * unreachable provider does, and the AI panel answers from the sources' own passages (`offline()`).
 */
function teammateRunner({ host, log }) {
  const asking = new AsyncLocalStorage();
  const teammates = () => host?.service?.('teammates') ?? null;
  const run = async ({ agent, text, via } = {}) => {
    const t = teammates();
    if (typeof t?.runTask !== 'function') {
      throw Object.assign(new Error("Teammates is not running in NooblyJS: the wiki's AI agents work only as teammate tasks, never straight to a model."), { code: 'teammates_unavailable' });
    }
    const person = asking.getStore() ?? null;
    const result = await t.runTask({
      slug: TEAMMATE,
      workType: workTypeOf(agent),
      system: 'knowledge',
      caller: person?.id ? { type: 'user', id: person.id, name: person.name ?? person.id } : null,
      input: { task: text, context: `The wiki's "${agent}" agent${via === 'workflow' ? ', in a workflow step' : ''}. Answer with text only.` },
      scripted: async () => ({ output: { offline: true } }),
    });
    if (result.scripted) {
      throw Object.assign(new Error(`No model is configured for the wiki's agents in NooblyJS (${TEAMMATE} answers offline), so "${agent}" has no answer.`), { code: 'model_offline' });
    }
    log.debug?.(`wiki agent "${agent}" ran as ${result.workId} (${result.modelRoute})`);
    return { content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output), model: result.modelRoute, costUsd: result.costUsd, workId: result.workId };
  };
  /** Whether Teammates answers offline (no model configured): the AI panel then answers from the sources. */
  run.offline = async () => {
    const t = teammates();
    if (typeof t?.runTask !== 'function') return true;
    return typeof t.provider === 'function' ? (await t.provider()) === 'mock' : false;
  };
  /** Middleware: the person signed in to this request is the one the task is for. */
  run.middleware = (req, res, next) => asking.run(req.person ?? null, next);
  return run;
}

/**
 * What the modules use of Socket.IO. NooblyJS has no WebSocket: broadcasts are handed
 * to `onBroadcast`, which the hosted entry forwards to the host's event stream.
 */
function createIo(onBroadcast) {
  const send = (room) => (event, payload) => {
    try {
      onBroadcast({ event, payload, room });
    } catch { /* a listener's failure must not fail the write that broadcast */ }
    return true;
  };
  return { emit: send(null), to: (room) => ({ emit: send(room) }), on() {}, close() {} };
}

/**
 * Mounts the platform's API on `router`.
 *
 * @param {object} o
 * @param {import('express').Router} o.router   the hosted router, already behind the host's sign-in for /api/v1
 * @param {import('express').Express} o.hostApp
 * @param {object} o.registry                   the host's initialised nooblyjs-core registry
 * @param {string} o.appBaseDir                 where the platform keeps its files (the hosted dataDir)
 * @param {(broadcast: { event: string, payload: any, room: string|null }) => void} o.onBroadcast
 * @param {object} [o.host]                      the NooblyJS host (permissions, audit, events, other apps' services)
 * @param {string} [o.mountPath]                 where the wiki is mounted, for links to its pages
 * @returns {Promise<{ app: object, services: object, close: () => Promise<void> }>}
 */
async function mountPlatform({ router, hostApp, registry, appBaseDir, onBroadcast, host = null, mountPath = '/wiki' }) {
  const coreLog = registry.logger(registry.getDefaultProviderType?.('logging') || 'console', { instanceName: INSTANCE });
  const log = new StructuredLogger(coreLog, { serviceName: INSTANCE });
  // Hosted, the wiki's model clients run their prompts as teammate tasks: the modules get a registry whose
  // aiservice() hands back such clients (shared/ai/agentTasks.js), and worker threads follow through the bridge.
  const runner = teammateRunner({ host, log });
  agentTasks.useTeammates(runner, { appBaseDir });
  registry = agentTasks.routedRegistry(registry, { appBaseDir });
  const services = buildServices({ registry, appBaseDir, log });

  const app = createLegacyApp({ router, hostApp });
  app.set('authservice', services.authservice);
  app.set('serviceRegistry', registry);
  // Standalone this is a 20-per-15-minutes limiter on workflow runs; hosted, rate limits are the host's.
  app.set('executionLimiter', (req, res, next) => next());
  // In NooblyJS everyone signed in may use the datasources screens: their API keeps the sign-in and drops the
  // 'Datasources Administrator' / 'admin' role it asks for standalone (roleValidationMiddleware).
  app.set('datasourcesOpenToSignedIn', true);
  // NooblyJS Phase 8: Knowledge (src/wiki/knowledge) asks the host who may do what, tells it what happened,
  // and gives other apps links to the wiki's pages.
  app.set('nooblyHost', host);
  app.set('nooblyMountPath', mountPath);
  router.use(runner.middleware);
  router.use(app.prepare);

  const { initialize } = require('../initialize');
  await initialize({
    app,
    server: new EventEmitter(), // nothing listens here: the host owns the HTTP server
    io: createIo(onBroadcast),
    eventEmitter: registry.getEventEmitter?.() || new EventEmitter(),
    serviceRegistry: registry,
    appBaseDir,
    services,
  });
  if (app.skipped.length) log.debug?.(`not mounted in NooblyJS (standalone-only routes): ${app.skipped.join(', ')}`);

  return {
    app,
    services,
    /** Stops what the modules expose a stop for. The registry and its services are the host's to shut down. */
    async close() {
      agentTasks.stopTeammates({ appBaseDir });
      for (const name of ['workflowBridgeServer', 'workflowBridge']) {
        try {
          app.get(name)?.stop?.();
        } catch (err) {
          log.error(`Error stopping ${name}: ${err.message}`);
        }
      }
    },
  };
}

module.exports = { mountPlatform, buildServices, createIo, teammateRunner, workTypeOf };
