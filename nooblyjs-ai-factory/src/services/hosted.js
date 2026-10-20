// @ts-check
// Phase F26: the factory as a NooblyJS HOSTED APP. NooblyJS (../nooblyjs-ai-host) is one Node process that
// loads each app and calls its register() with its own Express app, its nooblyjs-core
// serverManager and what it shares (`host`: sign-in, permissions, audit, events, the frame
// page). We mount ONE router at the mount path and describe ourselves; NooblyJS draws the rail,
// the sidebar and the page around our content. Nothing here listens on a port.
//
//   /factory/api/v1/…     the dashboard API (the same route table `factory dashboard` serves),
//                         behind the host's sign-in, its permissions matrix and its audit log
//   /factory/js, /css     the UI module the NooblyJS frame loads (public/js/module.js)
//   /factory/product/…    the Product section (sections.js): its own API, pages and data, mounted before our own
//                         router
//   /factory/<anything>   a page URL: the host's frame answers, and our module draws the page
//
// The event log is still the only source of truth. Hosted, it lives in the folder NooblyJS
// gives us (data/factory/events/, daily YAML streams) instead of ~/.factory.
//
// NooblyJS Phase 7: the SCHEDULER runs here, in the NooblyJS process (separate workers come later),
// so `npm start` in NooblyJS is all it takes. A handoff approved in NooblyJS becomes runs
// (intake/handoff.js); what the runs do is passed on to NooblyJS as events that carry the
// lifecycle item; a stuck run's question reaches the people who can answer it; and a
// hosted run never merges (stations/merge.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFactoryConfig } from '../config/factory-config.js';
import { answerable } from '../controllers/api.js';
import { createIntake } from './intake/handoff.js';
import { setHostDevtools } from './forge/index.js';
import { seedDemo } from './intake/demo-repo.js';
import { executeRun } from './job/run-job.js';
import { workerName } from './scheduler/leases.js';
import { createScheduler } from './scheduler/scheduler.js';
import { openEntries } from '../models/inbox.js';
import { openStore } from '../models/store/events.js';
import { apiRoutes } from '../routes/api.js';
import { spentToday } from './scheduler/budgets.js';
import { cancelRun, isStopped, stopAll } from './scheduler/kill-switch.js';
import { toExpressRouter } from './to-express.js';
import { mountSections, sectionsFromEnv } from './sections.js';

const NAME = 'factory';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'frame'];
const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const STATIC = { index: false, redirect: false };

/**
 * The Factory's own sidebar rows (the Build group): `path` is relative to the mount path, `icon` names a NooblyJS UI
 * kit icon. register() puts the Product and Design sections' rows before them, and Engineering's before and Test's
 * after (lifecycle v3, Phase 16b; sections.js).
 */
export const NAV = [
  { key: 'line', label: 'Line', path: '/line', icon: 'flow' },
  { key: 'runs', label: 'Runs', path: '/runs', icon: 'list' },
  { key: 'pull-requests', label: 'Pull requests', path: '/pull-requests', icon: 'repo' },
  { key: 'inbox', label: 'Inbox', path: '/inbox', icon: 'inbox', badge: 'inbox' },
  { key: 'campaigns', label: 'Campaigns', path: '/campaigns', icon: 'layers' },
  { key: 'metrics', label: 'Metrics', path: '/metrics', icon: 'chart' },
];

/**
 * The Engineering group (Phase 16b): each story's application architecture, from the code, and its test analysis,
 * signed off before anything is built. The pages say which phase brings them (16d).
 */
export const ENGINEERING_NAV = [
  { key: 'app-architecture', label: 'Application architecture', path: '/engineering/architecture', icon: 'layers' },
  { key: 'test-analysis', label: 'Test analysis', path: '/engineering/test-analysis', icon: 'list' },
  { key: 'engineering-signoff', label: 'Engineering sign-off', path: '/engineering/sign-off', icon: 'approve' },
];

/** The Test group (Phase 16b): testers verify each pull request and give the Test approval (16e, Phase 20). */
export const TEST_NAV = [
  { key: 'test-approvals', label: 'Test approvals', path: '/test/approvals', icon: 'approve' },
  { key: 'test-runs', label: 'Test runs', path: '/test/runs', icon: 'pulse' },
  { key: 'coverage', label: 'Coverage', path: '/test/coverage', icon: 'chart' },
  { key: 'defects', label: 'Defects', path: '/test/defects', icon: 'alert' },
];

/**
 * The NooblyJS permission each WRITE needs (rows of NooblyJS's matrix, data/access/roles.yaml).
 * Every read needs `read`. A write that isn't listed here stops register(): a new POST
 * can't reach people ungated by accident.
 *
 * The inbox takes `draft` to get in, because a stuck run's QUESTION is for the developers
 * (NooblyJS Phase 7). An APPROVAL or a policy change in the inbox still needs `approve`: that is
 * checked per entry (inboxGate below). Only people sign in to NooblyJS, so an agent never gets here.
 */
export const PERMISSIONS = {
  'POST /api/inbox/:id': 'draft',
  'POST /api/runs/:id/:action': 'draft',
  'POST /api/stop-all': 'approve',
  'POST /api/resume-all': 'approve',
};

const words = (status) => String(status).replace(/_/g, ' ');

/**
 * The factory's events other NooblyJS apps hear about (Activity, Home, the item's page and thread),
 * and how each reads. Each returns a list of [type, summary, extra]: one log event can be
 * more than one thing to NooblyJS (a finished run that opened a PR). The run's cost is counted
 * once, on run.finished.
 */
const SHARED = {
  'run.started': (e, run) => [['run.started', `started run "${run?.title ?? e.data.runId}"`]],
  'run.leased': (e, run) => (run?.attempt > 1 ? [] : [['run.started', `started run "${run?.title ?? e.data.runId}"`]]),
  'run.finished': (e, run) => {
    // workType names the model route the run's spend counts against (NooblyJS Platform · Settings · Models).
    const out = [['run.finished', `finished run "${run?.title ?? e.data.runId}": ${words(e.data.status)}`, { outcome: e.data.status, costUsd: run?.costUsd ?? 0, pr: e.data.pr ?? null, workType: 'implementation' }]];
    if (e.data.pr && run?.attempt <= 1) out.push(['pr.opened', `opened ${e.data.status === 'delivered' ? 'a pull request' : 'a draft pull request'} for "${run?.title ?? e.data.runId}"`, { pr: e.data.pr, draft: e.data.status !== 'delivered' }]);
    return out;
  },
  'step.finished': (e, run) => (e.data.result?.passed === false && e.data.result?.gates
    ? [['gate.failed', `gate failed on "${run?.title ?? e.data.runId}": ${(e.data.result.gates.results ?? []).filter((g) => g.status !== 'passed' && g.status !== 'skipped').map((g) => g.name).join(', ') || 'a check'}`]]
    : []),
  'inbox.opened': (e, run) => [['run.asked', `asks: ${e.data.title}`, { inboxId: e.data.inboxId, kind: e.data.kind, title: e.data.title, runTitle: run?.title ?? null }]],
  'inbox.answered': (e, run) => [['run.answered', `${e.data.by ?? 'A person'} answered "${run?.title ?? e.data.runId}": ${e.data.decision}`, { inboxId: e.data.inboxId }]],
  'merge.refused': (e, run) => [['merge.refused', `was refused a merge of "${run?.title ?? e.data.runId}": ${e.data.reason}`, { reason: e.data.reason }]],
  'intake.waiting': (e) => [['run.waiting', `work item "${e.data.title}" started nothing: ${e.data.reason}`, { itemId: e.data.nooblyItemId, workItemId: e.data.workItemId }]],
};

const STATUS_TEXT = { queued: 'Queued', running: 'Running', parked: 'Waiting for a person', paused: 'Paused', delivered: 'PR ready', merged: 'Merged', gate_failed: 'Gate failed · draft PR', agent_failed: 'Agent failed', no_changes: 'No changes', needs_info: 'Needs information', rejected: 'Rejected', interrupted: 'Interrupted', error: 'Error', suggested: 'Suggested' };

const dollars = (n) => `$${(n ?? 0).toFixed(2).replace(/\.00$/, '')}`;

/**
 * Attach the Software Factory to a host Express app.
 * @param {any} app             the host's Express app
 * @param {any} serverManager   nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir?: string, host?: any, pollMs?: number, schedule?: boolean, tickMs?: number, sections?: string[], sectionOptions?: Record<string, object> }} [options]
 *   pollMs: how often new log events are passed on to the host (0: only when flush() is called; for tests)
 *   schedule: false to not work the queue here (tests drive it with tick()); tickMs: how often it looks
 *   sections: which sections to mount (default FACTORY_SECTIONS, else all: product; [] for none)
 *   sectionOptions: extra register() options per section, by key (tests: { product: { draftStepMs: 0 } })
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/factory', dataDir, host, pollMs = 2000, schedule = true, tickMs, sections: only = sectionsFromEnv(process.env.FACTORY_SECTIONS), sectionOptions = {} } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted.
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-factory needs the host's Express app.");
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /factory, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-factory needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-factory needs host.${missing.join(', host.')} from the host.`);

  const log = serverManager?.logger?.(serverManager.getDefaultProviderType?.('logging'), { instanceName: NAME }) ?? console;
  // The sections first: their routers must be mounted before ours, whose page fallback would answer their URLs. If one
  // fails, nothing of the Factory is left mounted.
  const sections = await mountSections({ app, serverManager, mountPath, dataDir, host, only, options: sectionOptions, log });
  const now = () => Number(host.clock?.now?.() ?? Date.now());
  // Everything the factory keeps goes under the folder the host gave us.
  // FACTORY_HOSTED tells the stations they run inside NooblyJS: a hosted run never merges.
  const env = { ...process.env, FACTORY_HOME: dataDir, FACTORY_HOSTED: 'noobly' };
  // A repository's gate is often `node --test`. If NooblyJS itself was started by a test runner, that variable
  // would make the gate report as a child of it and exit 0 whatever failed. A gate always runs on its own.
  delete env.NODE_TEST_CONTEXT;
  // Unsandboxed commands (a repository's own gates) only when the host says this is development,
  // and never in production. Elsewhere the factory needs a real sandbox, as it always did.
  const development = host.development === true && process.env.NODE_ENV !== 'production';
  let store;
  try {
    store = openStore({ env });
  } catch (error) {
    await sections.close();
    throw error;
  }
  // The log was a SQLite file before NooblyJS Phase 7. It is not read any more, and never written.
  if (fs.existsSync(path.join(dataDir, 'factory.db'))) log.warn?.(`factory: ${path.join(dataDir, 'factory.db')} is from before the log moved to files (events/). It is ignored; delete it when you no longer need it.`);

  /**
   * Who may answer one inbox entry. A question or an escalation is the developers' (`draft`, already
   * checked). An approval or a policy change decides something, so it needs `approve`. An agent is
   * refused whatever it holds: agents propose, people decide.
   */
  const inboxGate = async (req, res, next) => {
    try {
      const refuse = (message, permission) => {
        host.audit.record?.({ actor: req.person?.id ?? null, action: 'access.refused', target: `${mountPath}/api/v1/inbox/${req.params.id}`, permission, reason: message });
        res.status(403).json({ error: { code: 'forbidden', message, details: { permission } } });
      };
      if (req.person?.kind === 'agent') return refuse('Agents propose and people decide: an agent cannot answer the inbox.', 'people-only');
      const entry = store.get('inbox', req.params.id);
      if (entry && !answerable(entry.kind) && !(await host.can?.(req.person?.accessRole, 'approve'))) {
        return refuse(`This is an approval, so it needs the approve permission. Your access role is ${req.person?.accessRole ?? 'none'}.`, 'approve');
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  let router;
  try {
    router = host.express.Router();
    const routes = apiRoutes({ store, env }).filter(([, pattern]) => pattern !== '/api/events'); // live updates are the host's stream
    const before = (method, pattern) => {
      if (method === 'GET') return [host.requireRole('read')];
      const permission = PERMISSIONS[`${method} ${pattern}`];
      if (!permission) throw new Error(`${method} ${pattern} has no permission in PERMISSIONS.`);
      return pattern === '/api/inbox/:id' ? [host.requireRole(permission), inboxGate, host.audit] : [host.requireRole(permission), host.audit];
    };
    const principal = (req) => ({ role: 'operator', by: `${req.person?.name ?? req.person?.id ?? 'someone'} (NooblyJS)` });
    router.use('/api/v1', host.auth, toExpressRouter(routes, { express: host.express, before, principal }));
    router.use('/js', host.express.static(path.join(PUBLIC_DIR, 'js'), STATIC));
    router.use('/css', host.express.static(path.join(PUBLIC_DIR, 'css'), STATIC));
    // Every other GET without a file extension is a page: the host's frame answers it, so deep
    // links and refresh land on the right screen. A missing .js or .css is still a 404.
    router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  } catch (error) {
    store.close();
    await sections.close();
    throw error;
  }
  app.use(mountPath, router);

  // The log → the host's events. Other processes may append to the same folder (factory submit),
  // so we poll it, like the dashboard's SSE feed does (src/services/sse.js). Each event carries
  // the NooblyJS item the run is for, so Activity, the item's page and its thread can show it.
  let seq = store.read().at(-1)?.seq ?? 0;
  async function flush() {
    for (const e of store.read({ after: seq })) {
      seq = e.seq;
      const run = e.data?.runId ? store.get('runs', e.data.runId) : null;
      // A refused merge is a governance decision, so it is in NooblyJS's audit log as well as its events.
      if (e.type === 'merge.refused') await host.audit.record?.({ actor: 'factory', action: 'merge.refused', target: `${mountPath}/runs/${e.data.runId}`, itemId: run?.request?.noobly?.itemId ?? null, system: NAME, reason: e.data.reason });
      for (const [type, summary, extra = {}] of SHARED[e.type]?.(e, run) ?? []) {
        await host.events.emit(type, { system: NAME, runId: e.data.runId ?? null, itemId: run?.request?.noobly?.itemId ?? null, workItemId: run?.request?.noobly?.workItemId ?? null, repo: run?.request?.noobly?.repoName ?? null, summary, ...extra });
      }
    }
  }
  const timer = pollMs > 0 ? setInterval(() => flush().catch((error) => log.warn?.(`factory events: ${error.message}`)), pollMs) : null;
  timer?.unref();

  // A handoff approved in NooblyJS becomes runs (once per work item, however often the event arrives).
  const intake = createIntake({ store, env, host, development, log });
  // A run on a repository from Bitbucket asks NooblyJS to push and open its pull request (NooblyJS Phase 13).
  setHostDevtools(() => host.service?.('devtools') ?? null);
  const offHandoff = host.events.on?.('handoff.created', (event) => {
    intake.onHandoff(event?.payload ?? event).catch((error) => log.error?.(`factory intake: ${error.message}`));
  });

  // The scheduler: the same loop `factory serve` runs, here in the NooblyJS process. Leases and
  // heartbeats are on the machine's clock, not NooblyJS's business clock, which a developer can move.
  const config = { ...loadFactoryConfig(env), ...(tickMs ? { tickMs } : {}) };

  // NooblyJS Platform (Phase 9): the Software Factory's daily cap is set in Platform · Settings · Budgets. The scheduler
  // reads `config` on every tick, so a change applies to the next run that starts.
  const platform = () => host.service?.('platform') ?? null;
  async function syncCap() {
    const cap = (await platform()?.budgets?.read?.())?.systems?.find((s) => s.key === NAME && s.period === 'day')?.limit;
    if (Number.isFinite(cap) && cap >= 0 && cap !== config.dailyBudgetUsd) {
      log.info?.(`factory: daily budget $${config.dailyBudgetUsd} → $${cap} (NooblyJS Platform)`);
      config.dailyBudgetUsd = cap;
    }
  }
  await syncCap().catch((error) => log.warn?.(`factory: daily cap from Platform: ${error.message}`));
  const offBudget = host.events.on?.('budget.changed', () => { syncCap().catch((error) => log.warn?.(`factory: daily cap from Platform: ${error.message}`)); });

  // While a run executes here it is a workload on NooblyJS Platform · Containers, where Stop cancels it.
  const execute = (runId, live) => {
    const run = store.get('runs', runId);
    const unregister = platform()?.containers?.register?.({
      kind: 'factory', title: `Run ${runId.slice(-6)} · ${run?.title ?? 'run'}`, repo: run?.request?.noobly?.repoName ?? null,
      itemId: run?.request?.noobly?.itemId ?? null, runId, system: NAME, href: `${mountPath}/runs/${runId}`,
      stop: () => cancelRun(store, runId),
    }) ?? (() => {});
    return executeRun(store, runId, { live: { ...live, log: (line) => log.debug?.(`[factory ${runId.slice(-6)}] ${line}`) } }).finally(unregister);
  };
  const scheduler = createScheduler({ store, config, execute, worker: workerName('noobly') });
  if (schedule) {
    scheduler.start();
    intake.retryWaiting().catch((error) => log.warn?.(`factory intake: ${error.message}`));
  }

  /** A run as the rest of NooblyJS shows it: what it is, where it is, and what it is for. */
  const runView = (r) => {
    const stations = Object.entries(r.steps ?? {});
    const current = stations.filter(([, st]) => st.status === 'running').map(([id]) => id).at(-1) ?? null;
    const gates = r.steps?.verify?.result?.gates?.results;
    return {
      id: r.id, title: r.title, status: r.status, statusText: STATUS_TEXT[r.status] ?? words(r.status), station: current,
      repo: r.request?.noobly?.repoName ?? null, itemId: r.request?.noobly?.itemId ?? null, workItemId: r.request?.noobly?.workItemId ?? null,
      gates: gates ? gates.map((g) => `${g.name} ${g.status}`).join(', ') : null,
      pr: r.pr ?? null, costUsd: r.costUsd ?? 0, queuedAt: r.queuedAt, endedAt: r.endedAt ?? null, href: `${mountPath}/runs/${r.id}`,
    };
  };

  /** What the sidebar card and other apps show: honest numbers, straight from the projections. */
  function summary() {
    const runs = store.list('runs');
    return {
      stopped: isStopped(store),
      running: runs.filter((r) => r.status === 'running').length,
      queued: runs.filter((r) => r.status === 'queued').length,
      maxConcurrent: config.maxConcurrent,
      spentToday: spentToday(store, now()),
      dailyBudgetUsd: config.dailyBudgetUsd,
      inbox: openEntries(store).length,
    };
  }

  return {
    name: NAME,
    label: 'Factory',
    icon: 'factory',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/factory.css', ...sections.styles] },
    // Product, Design, then the Factory's own Engineering, Build and Test: the order work moves in (lifecycle v3).
    nav: [
      ...sections.nav('before'),
      ...ENGINEERING_NAV.map((row) => ({ ...row, group: 'Engineering' })),
      ...NAV.map((row) => ({ ...row, group: 'Build' })),
      ...TEST_NAV.map((row) => ({ ...row, group: 'Test' })),
      ...sections.nav('after'),
    ],
    // The sidebar's group headers: an icon and a line saying what each part of the Factory does.
    groups: sections.groups(),
    /**
     * The sidebar's status card and badges: the line's (slots, today's spend, the Inbox badge), with one line per
     * section saying how it stands in words (the Product section's agents on duty).
     */
    async status() {
      const s = summary();
      const ratio = s.dailyBudgetUsd ? s.spentToday / s.dailyBudgetUsd : 0;
      const parts = await sections.status();
      return {
        badges: { inbox: s.inbox, ...Object.assign({}, ...parts.map((p) => p.badges)) },
        card: {
          pill: s.stopped ? { text: 'Stopped', tone: 'danger' } : { text: 'Accepting work', tone: 'ok' },
          items: [
            { label: 'Running now', value: `${s.running} of ${s.maxConcurrent} slots · ${s.queued} queued` },
            ...parts.filter((p) => p.card?.pill?.text).map((p) => ({ label: p.section.label, value: p.card.pill.text })),
          ],
          meter: { label: 'Spent today', value: `${dollars(s.spentToday)} of ${dollars(s.dailyBudgetUsd)}`, ratio, tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'ok' },
        },
      };
    },
    // host.service('product'): the section's services, under the name other NooblyJS apps have always asked for (the
    // host's loader reads an object here as name → services).
    provides: sections.provides,
    // What other apps may call through host.service('factory').
    services: {
      status: async () => summary(),
      /** The runs a NooblyJS lifecycle item's work items became, newest first. */
      runsForItem: async (itemId) => store.list('runs').filter((r) => (r.request?.noobly?.itemId ?? r.itemId) === itemId).map(runView),
      /** Runs for the Developer home. Until repositories have owners (NooblyJS Phase 9), that is every run. */
      runsFor: async () => store.list('runs').map(runView),
      /** What stuck runs are asking, oldest first, and whether this person may answer each. */
      questionsFor: async (person) => {
        const mayApprove = Boolean(await host.can?.(person?.accessRole, 'approve'));
        const mayDraft = Boolean(await host.can?.(person?.accessRole, 'draft'));
        return openEntries(store).map((entry) => {
          const run = store.get('runs', entry.runId);
          const canAnswer = answerable(entry.kind) ? mayDraft : false;
          return {
            id: entry.id, runId: entry.runId, kind: entry.kind, title: entry.title, body: String(entry.body ?? '').slice(0, 2000),
            itemId: run?.request?.noobly?.itemId ?? null, repo: run?.request?.noobly?.repoName ?? null, href: `${mountPath}/runs/${entry.runId}`,
            canAnswer,
            needs: canAnswer ? null : answerable(entry.kind) ? 'Answering needs the draft permission.' : `This is an approval${mayApprove ? '' : ', which needs the approve permission'}. Decide it in the Factory inbox.`,
          };
        });
      },
      /** Work items that were handed over but started nothing, and why (one NooblyJS item's, or all). */
      waitingWork: async (itemId) => intake.waiting(itemId),
      /** Take a handoff's work items in now (the handoff.created event does this by itself). */
      intake: (payload) => intake.onHandoff(payload),
      /**
       * Cancel one run (NooblyJS Platform · Containers → Stop): a queued one at once, a running one at its next
       * heartbeat. Returns 'cancelled', 'requested' or 'finished' (nothing to do).
       */
      cancel: async (runId) => cancelRun(store, runId),
      /** The big red button (NooblyJS Platform → Stop all containers): no new runs start, running ones stop. */
      stopAll: async ({ by = 'NooblyJS', reason = '' } = {}) => {
        stopAll(store, `NooblyJS Platform: stop all containers by ${by}${reason ? ` (${reason})` : ''}`);
        return { stopped: true };
      },
    },
    /** The demo repository, the map that names it and the seed story's scripted agents (development and demos). */
    async seed({ reset = false, content = host.sampleData !== false } = {}) {
      // The sections seeded themselves when their folders were new (sections.js); a reset writes them again.
      if (reset) await sections.seed({ reset, content });
      // No sample content: no demo repository and no scripted agents. Repositories come from data/factory/repos.yaml.
      if (!content) return;
      const made = seedDemo(env);
      if (made.created || made.wrote.length) log.info?.(`factory: seeded the demo repository (${made.repo})`);
    },
    /** Stops the scheduler (interrupting what runs here; it is requeued at the next start), then closes the log. */
    async close() {
      setHostDevtools(null);
      offHandoff?.();
      offBudget?.();
      if (timer) clearInterval(timer);
      await scheduler.stop('NooblyJS is stopping');
      await flush().catch(() => {});
      store.close();
      await sections.close();
    },
    /** For the tests: pass new log events on to the host now. */
    flush,
    /** For the tests: the scheduler (tick(), idle()), the intake and the store. */
    internals: { scheduler, intake, store, env, sections: Object.fromEntries(sections.list.map(({ section, hosted }) => [section.key, hosted])) },
  };
}
