// nooblyjs-core: the shared NooblyJS service registry (the host's `serverManager`). Teammates uses its logging (rotating log
// files), caching (parsed Markdown documents), queueing (webhook deliveries), notifying (live events), scheduling
// (the schedule check) and measuring (task, webhook and request metrics).
//
// The registry belongs to the host: NooblyJS, or the stand-in host in test/fixtures/host.js (tests). The host initialises it
// with its Express app (the /services dashboards and core's sign-in pages are served there) and signs people in.
// Teammates never calls initialize(); it only creates its own named service instances ("teammates" by default), so
// the tests, which mount several apps on one host, stay isolated.
import path from 'node:path';
import { createRequire } from 'node:module';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';

const require = createRequire(import.meta.url);
const { buildCspDirectives } = require('nooblyjs-core/src/shared/utils/contentSecurityPolicy');

// Core's file logger knows error < warn < info < log; "log" is its debug level.
const CORE_LEVEL = { error: 'error', warn: 'warn', info: 'info', debug: 'log' };

/** Content-Security-Policy for the core dashboards, which use inline scripts and CDN assets. For the host. */
export const SERVICES_CSP = Object.entries(buildCspDirectives())
  .filter(([, sources]) => sources)
  .map(([name, sources]) => `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${sources.join(' ')}`)
  .join('; ');

/**
 * Creates this app's core services on the host's serverManager. Logs go to `logDir` (default <dataDir>/logs), one
 * file per day, rotated at 10 MB. `logLevel` is what reaches the log file. `consoleMode` is what the console shows:
 * 'all' (the default: every line of this app's log file), 'app' (only the app's own messages, from `consoleLevel`
 * up) or 'none'.
 */
export function createCore({
  serverManager,
  dataDir,
  logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(dataDir, 'logs'),
  logLevel = process.env.LOG_LEVEL ?? 'info',
  consoleLevel = logLevel,
  consoleMode = process.env.LOG_CONSOLE ?? 'all',
  instanceName = 'teammates',
} = {}) {
  if (!serverManager?.initialized) throw new Error("Teammates needs the host's nooblyjs-core serverManager, initialised with its Express app.");
  const level = CORE_LEVEL[logLevel] ?? 'info';
  const opts = { instanceName };
  const mode = consoleLevel === false ? 'none' : consoleMode;
  const emitter = serverManager.getEventEmitter();
  const listeners = [];

  // 'all': mirror the log file on the console. The file logger announces every line it writes on the registry's
  // emitter, tagged with its instance name.
  if (mode === 'all') {
    for (const [event, method] of [['error', 'error'], ['warn', 'warn'], ['info', 'log'], ['log', 'log']]) {
      const listener = ({ message }) => console[method](message);
      emitter.on(`log:${event}:${instanceName}`, listener);
      listeners.push([`log:${event}:${instanceName}`, listener]);
    }
  }
  const fileLog = serverManager.logger('file', { ...opts, logDir, log: { level } });
  const log = createLogger({ file: fileLog, consoleLevel: mode === 'app' ? consoleLevel : false });
  const cache = serverManager.cache('memory', opts);
  const queue = serverManager.queue('memory', opts);
  // Live events are kept here for /services/notifying/; browsers get them over NooblyJS's event stream.
  const notifying = serverManager.notifying('memory', { ...opts, maxSubscribers: 1000 });
  const metrics = new Metrics(serverManager.measuring('memory', opts));
  // Scheduling pulls in the working service (worker threads, timers), so it is only created when first needed.
  let scheduling = null;

  return {
    instanceName,
    logLevel,
    events: emitter, // core's event bus (scheduler:*, …)
    logDir,
    log,
    cache,
    queue,
    notifying,
    metrics,
    // A failed beat is not retried: the next one is due shortly anyway.
    scheduling: () => (scheduling ??= serverManager.scheduling('memory', { ...opts, retryAttempts: 0 })),
    hasScheduling: () => scheduling !== null,
    /** Stops echoing this app's log lines on the console. The services themselves are the host's to shut down. */
    close: () => listeners.forEach(([event, listener]) => emitter.off(event, listener)),
  };
}
