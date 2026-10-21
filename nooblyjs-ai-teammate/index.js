// Teammates as a NooblyJS hosted application (../nooblyjs-ai-host/.claude/steering/structure.md §2a). NooblyJS imports this file and
// calls register() with its Express app, its nooblyjs-core serverManager and what it shares (`host`); the tests do the
// same with the stand-in host in test/fixtures/host.js. This repo is a library: nothing here listens on a port, and
// there is no standalone server.
//
// register() builds the services and models on the host's nooblyjs-core services, mounts one router at the mount path
// (src/routes/index.js: the files in public/, the API under <mountPath>/api/v1, and the host's frame for every other
// page URL) and describes the app to the host. The UI is a module (public/js/module.js) that the NooblyJS frame loads into
// its content area; NooblyJS draws the rail and the sidebar from the description below.
import path from 'node:path';
import { FsStore } from './src/models/fs-store.js';
import { createRepos } from './src/models/index.js';
import { ensureSeeded } from './src/services/seed.js';
import { TeamService } from './src/services/team.js';
import { InvocationService } from './src/services/invocation.js';
import { createProviders } from './src/services/providers/index.js';
import { EventBus } from './src/services/events.js';
import { AuthService, PERMISSION_FOR_ROLE } from './src/services/auth.js';
import { AuditService } from './src/services/audit.js';
import { BillingService } from './src/services/billing.js';
import { AlertService } from './src/services/alerts.js';
import { WebhookService } from './src/services/webhooks.js';
import { ToolService } from './src/services/tools.js';
import { SchedulerService, checkTaskName } from './src/services/scheduler.js';
import { SystemService } from './src/services/system.js';
import { HostTaskService } from './src/services/host-tasks.js';
import { BoardService } from './src/services/board.js';
import { BoardAuto } from './src/services/board-auto.js';
import { createCore } from './src/services/core/index.js';
import { teeLogger } from './src/services/core/logger.js';
import { createRouter } from './src/routes/index.js';
import { RateLimiter } from './src/utils/rate-limit.js';
import { isoDate } from './src/utils/dates.js';
import { checkMountPath, DEFAULT_MOUNT_PATH } from './src/config/app.js';

const SHUTDOWN_GRACE_MS = 10000;
// Files holding secrets (API key hashes, the CSRF secret, webhook signing secrets, MCP auth headers) are never
// cached: the cache's contents can be read on the /services/caching/ dashboard.
const UNCACHED = new Set(['config/webhooks.md', 'config/mcp-servers.md']);
const cacheable = (segments) => segments[0] !== 'system' && !UNCACHED.has(segments.join('/'));

/**
 * Where Teammates keeps its data: the host's store (host.store, the shared rule) when it is rooted at this app's
 * dataDir, with Teammates' document cache attached; otherwise (an older host, a test host) a store of its own there.
 */
export function storeFor(host, dataDir, { cache, cacheable: canCache }) {
  const given = host?.store;
  if (given instanceof FsStore && given.root === path.resolve(dataDir)) {
    // The host's store for this app is this app's alone; the cache is Teammates' (core's options, set after the fact).
    if (cache && !given.cache) Object.assign(given, { cache, cacheable: canCache });
    return given;
  }
  return new FsStore(dataDir, { cache, cacheable: canCache });
}

/** Sidebar rows; `path` is relative to the mount path, `icon` names a UI kit icon (/ui/js/icons.js). */
export const NAV = [
  { key: 'team', label: 'Team roster', path: '/team', icon: 'team' },
  { key: 'profiles', label: 'Profiles', path: '/profiles', icon: 'person' },
  { key: 'timeline', label: 'Work timeline', path: '/timeline', icon: 'clock' },
  { key: 'board', label: 'Team board', path: '/board', icon: 'chat' },
  { key: 'billing', label: 'Billing & timesheets', path: '/billing', icon: 'doc', badge: 'approvals' },
  { key: 'hire', label: 'Hire a teammate', path: '/hire', icon: 'plus', requires: PERMISSION_FOR_ROLE.hire },
  { key: 'team-memory', label: 'Team memory', path: '/team-memory', icon: 'book' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings', requires: PERMISSION_FOR_ROLE.owner },
  { key: 'admin', label: 'Admin', path: '/admin', icon: 'key', requires: PERMISSION_FOR_ROLE.owner },
];

/**
 * Attaches Teammates to a host Express app.
 *
 * `host` is what the host shares (the NooblyJS hosted-app contract): `express` and `auth` are required; `requireRole`,
 * `audit`, `events` and `people` are used when present; `signOut` is the stand-in test host's sign-out. NooblyJS passes
 * only `mountPath`, `dataDir` and `host`. The other options are for the tests: `providers`, `now`, `clock`, `fetch`,
 * `log` (replaces the console output; the log file still gets everything), `core` (createCore options), `seed`,
 * `sessionSecret`, `allowPrivateNetwork`, `scheduleIntervalMs` and `webhookRetryDelaysMs`.
 *
 * @param {import('express').Express} app   the host's app (NooblyJS, or the test stand-in)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object }} options
 * @returns {Promise<object>} the HostedApp description. Its `internals` (the services and models) are for the
 *   tests only; other apps use `services` (structure.md §0).
 */
export async function register(app, serverManager, { mountPath = DEFAULT_MOUNT_PATH, ...options } = {}) {
  // Core service instances are named after the mount path ('teammates'), so they show up as this app's on /services.
  const instanceName = mountPath.slice(1).replaceAll('/', '-');
  const teammates = await build({ ...options, app, serverManager, mountPath, core: { instanceName, ...options.core } });
  teammates.log.info(`mounted teammates at ${mountPath} (data: ${teammates.dataDir})`);

  return {
    name: 'teammates',
    label: 'Teammates',
    icon: 'team',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/teammates.css'] },
    nav: NAV,
    /** Tasks waiting for approval (the Billing badge), who is at work, and this month's spend against the budget. */
    async status() {
      const [waiting, roster, budget] = await Promise.all([
        teammates.repos.approvals.list({ status: 'pending' }),
        teammates.repos.teammates.list(),
        teammates.team.budgetFor('month').catch(() => null),
      ]);
      const active = roster.filter((t) => t.status !== 'retired');
      const busy = active.filter((t) => t.status === 'task').length;
      const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
      const card = {
        pill: waiting.length
          ? { text: `${plural(waiting.length, 'task')} to approve`, tone: 'warning' }
          : { text: 'Nothing to approve', tone: 'ok' },
        items: [{ label: 'Teammates working now', value: `${busy} of ${active.length} on a task` }],
      };
      if (budget?.budget) {
        const ratio = budget.used / budget.budget;
        card.meter = { label: 'Spent this month', value: `$${Math.round(budget.used)} of $${Math.round(budget.budget)}`, ratio, tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'ok' };
      }
      return { badges: { approvals: waiting.length }, card };
    },
    // What other NooblyJS apps may call (structure.md §0): the team, and one task run as a teammate.
    services: {
      roster: () => teammates.hostTasks.roster(),
      get: (slug) => teammates.hostTasks.get(slug),
      availability: (slug) => teammates.hostTasks.availability(slug),
      provider: () => teammates.hostTasks.provider(),
      runTask: (request) => teammates.hostTasks.runTask(request),
      // The Team board: another app posts as itself (author { system, name }) or as a teammate's task (author
      // { teammateId, workId }), lists posts for a topic, and shows who is working on what.
      board: {
        post: ({ author, ...input } = {}) => teammates.board.postFor(author, input),
        list: (query) => teammates.board.list(query),
        now: () => teammates.board.now(),
      },
    },
    /** Writes the seed story into dataDir; `reset` rewrites the seed files over what is there. */
    async seed({ reset = false, content = options.host?.sampleData !== false } = {}) {
      await ensureSeeded(teammates.store, teammates.repos, { force: reset, content, boardNow: teammates.boardClock() });
    },
    /** Stops scheduled runs and webhook retries, then gives running tasks a moment to finish. */
    async close() {
      teammates.close();
      await Promise.race([Promise.all([teammates.invocation.idle(), teammates.board.idle()]), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref())]);
    },
    internals: teammates,
  };
}

/** Builds the services and models on the host's nooblyjs-core services and mounts the router. */
async function build({
  app,
  serverManager,
  host = {},
  mountPath,
  dataDir,
  providers = createProviders(),
  now = () => isoDate(),
  log,
  core: coreOptions = {},
  seed = true,
  sessionSecret = process.env.SESSION_SECRET,
  fetch = globalThis.fetch,
  allowPrivateNetwork = process.env.ALLOW_PRIVATE_FETCH === 'true',
  clock = () => Date.now(),
  scheduleIntervalMs = 30000,
  webhookRetryDelaysMs,
  // What lists the models the providers offer (Settings · Models & pricing); tests pass a fake.
  discoverModels,
}) {
  if (!app?.use) throw new Error("Teammates needs the host's Express app.");
  if (!host.express?.Router || typeof host.auth !== 'function') throw new Error('Teammates needs host.express and host.auth from the host.');
  if (!dataDir) throw new Error('Teammates needs a dataDir.');
  checkMountPath(mountPath);
  const { express } = host;

  // Everything started so far, stopped again if a later step fails, so a failed start leaves nothing running.
  const stops = [];
  try {
    // The host's log level (host.logLevel) is this app's too, so its lines appear in the host's log at the same level.
    const core = createCore({ serverManager, dataDir, ...(host.logLevel ? { logLevel: host.logLevel } : {}), ...(log ? { consoleLevel: false } : {}), ...coreOptions });
    stops.push(core.close);
    log = log ? teeLogger(core.log, log) : core.log;
    const { metrics } = core;
    const store = storeFor(host, dataDir, { cache: core.cache, cacheable });
    const repos = createRepos(store);
    // The Team board's time is the host's business time (NooblyJS host.clock) when there is one.
    const boardClock = host.clock?.now ? () => host.clock.now() : clock;
    if (seed) await ensureSeeded(store, repos, { today: now(), boardNow: boardClock(), content: host.sampleData !== false });

    const auth = new AuthService(store, { sessionSecret, log });
    await auth.init();
    const audit = new AuditService(store, { log });
    const limiter = new RateLimiter({ windowMs: 60000 });

    const events = new EventBus(core.notifying, { log, hostEvents: host.events });
    const webhooks = new WebhookService({ store, repos, fetch, log, queue: core.queue, metrics, hostEvents: host.events, ...(webhookRetryDelaysMs && { retryDelaysMs: webhookRetryDelaysMs }) });
    await webhooks.init();
    stops.push(() => webhooks.close());
    const tools = new ToolService({ store, webhooks, fetch, allowPrivateNetwork, log });
    const team = new TeamService(repos, { now, events, tools });
    const alerts = new AlertService({ repos, team, store, events, webhooks, log });
    const invocation = new InvocationService(repos, providers, { now, log, events, alerts, tools, webhooks, metrics });
    const billing = new BillingService(repos, team, { now, store, ...(discoverModels ? { discover: discoverModels } : {}) });
    const scheduler = new SchedulerService({ repos, invocation, events, webhooks, clock, log, intervalMs: scheduleIntervalMs, scheduling: core.scheduling, metrics, taskName: checkTaskName(core.instanceName) });
    scheduler.start();
    stops.push(() => scheduler.stop());
    const system = new SystemService({ core, store, webhooks, scheduler, invocation, providers });
    const hostTasks = new HostTaskService({ repos, team, invocation, providers, hostEvents: host.events, hostAudit: host.audit, platform: () => host.service?.('platform') ?? null, log });

    // The Team board. A mention wakes a teammate as a host task (checked by Platform and billed); the automatic posts
    // run on the schedule check.
    const board = new BoardService({
      repo: repos.board, repos, events, hostEvents: host.events, hostAudit: host.audit, audit, clock: boardClock, log,
      runTask: (request) => hostTasks.runTask(request), availability: (slug) => hostTasks.availability(slug),
      workflows: () => host.service?.('workflows') ?? null,
    });
    const boardAuto = new BoardAuto({ board, repos, clock: boardClock, runTask: (request) => hostTasks.runTask(request), log });
    invocation.board = board;
    invocation.boardAuto = boardAuto;
    scheduler.alsoRun(() => boardAuto.tick());

    // Role checks are the host's: each Teammates role stands for a NooblyJS permission (see services/auth.js).
    const roleGates = host.requireRole
      ? Object.fromEntries(Object.entries(PERMISSION_FOR_ROLE).map(([role, permission]) => [role, host.requireRole(permission)]))
      : null;
    const people = host.people ?? { list: async () => [] };

    const router = createRouter({
      express, host, roleGates, people, log, metrics, providers,
      store, repos, auth, audit, limiter, events, webhooks, tools, team, alerts, invocation, billing, scheduler, system, board,
    });
    app.use(mountPath, router);

    /** Stops the schedule check and pending webhook retries. The serverManager itself is the host's to shut down. */
    const close = () => {
      for (const stop of stops.reverse()) stop();
      stops.length = 0;
    };

    return { app, router, mountPath, dataDir, core, log, store, repos, team, invocation, hostTasks, billing, alerts, webhooks, tools, scheduler, events, auth, audit, system, board, boardAuto, boardClock, close };
  } catch (err) {
    for (const stop of stops.reverse()) {
      try {
        stop();
      } catch { /* already failing */ }
    }
    throw err;
  }
}
