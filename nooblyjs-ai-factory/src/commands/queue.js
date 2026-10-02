// @ts-check
// Phase F06: the queue from the command line.
//
//   factory submit <issue.md> --repo <path> [--priority high]   put a run in the queue
//   factory serve [--until-idle] [--webhooks] [--dashboard]      the scheduler + workers (+ GitHub webhooks F15, dashboard F17)
//   factory status                                               what's running, what's waiting and why, spend today
//   factory stop-all · factory resume-all                        the big red button
//   factory cancel <run>                                         the small one
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { loadFactoryConfig } from '../config/factory-config.js';
import { forgeFor, githubSettings } from '../forge/index.js';
import { createNotifier } from '../notify/notifier.js';
import { createWebhookServer } from '../server/webhooks.js';
import { startDashboard } from './dashboard.js';
import { campaignStartsToday } from '../campaign/campaign.js';
import { runSchedules } from '../campaign/schedule.js';
import { factoryHome } from '../util/paths.js';
import { createDispatcher } from '../remote/dispatcher.js';
import { createHttpServer } from '../server/http.js';
import { workerApi } from '../server/workers-api.js';
import { executeRun, submitJob } from '../job/run-job.js';
import { spentToday } from '../scheduler/budgets.js';
import { cancelRun, isStopped, pauseRun, resumeAll, resumeRun, stopAll } from '../scheduler/kill-switch.js';
import { pickRuns } from '../scheduler/pick.js';
import { createScheduler } from '../scheduler/scheduler.js';
import { openStore } from '../store/events.js';
import { recoverRuns } from '../store/recovery.js';
import { describe } from './history.js';

const dim = (text) => `\x1b[2m${text}\x1b[0m`;

/** @param {string[]} argv */
export async function submitCommand(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: 'string' }, base: { type: 'string' }, priority: { type: 'string' }, driver: { type: 'string' }, line: { type: 'string' }, autonomy: { type: 'string' }, routing: { type: 'string' },
      provider: { type: 'string' }, model: { type: 'string' }, echo: { type: 'boolean' }, script: { type: 'string' },
      budget: { type: 'string' }, 'max-turns': { type: 'string' }, 'allow-unsandboxed': { type: 'boolean' },
    },
  });
  if (!positionals.length || !values.repo) throw new Error('Usage: factory submit <issue.md>… --repo <path> [--priority high|low|<n>] [--script f.json] [--budget usd]');
  const store = openStore();
  try {
    for (const file of positionals) {
      if (!fs.existsSync(file)) throw new Error(`No issue file "${file}".`);
      const limits = { budgetUsd: values.budget ? Number(values.budget) : undefined, maxTurns: values['max-turns'] ? Number(values['max-turns']) : undefined };
      const agent = { model: values.model, provider: values.echo ? 'echo' : values.provider, script: values.script, limits };
      const priority = values.priority === undefined ? undefined : ({ urgent: 20, high: 10, normal: 0, low: -10 }[values.priority] ?? Number(values.priority));
      const runId = submitJob(store, { issueFile: file, repo: values.repo, base: values.base, line: values.line, autonomy: values.autonomy, routing: values.routing, driver: values.driver, allowUnsandboxed: values['allow-unsandboxed'], agent }, { priority });
      console.log(`queued ${runId}  ${file}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

/** @param {string[]} argv */
export async function serveCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { 'until-idle': { type: 'boolean' }, webhooks: { type: 'boolean' }, dashboard: { type: 'boolean' }, port: { type: 'string' }, workers: { type: 'boolean' }, 'workers-port': { type: 'string' } } });
  const store = openStore();
  const config = loadFactoryConfig();
  const short = (id) => id.slice(-6);
  const say = (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

  // Each run uses the forge ITS request names (local or GitHub): executeRun picks it (Phase F15).
  // Phase F23: with --workers, build and repair steps run on remote workers.
  const dispatcher = values.workers ? createDispatcher({ log: (l) => say(dim(l)) }) : null;
  const execute = (runId, live) => executeRun(store, runId, { live: { ...live, remote: dispatcher, log: (line) => say(dim(`[${short(runId)}] ${line}`)) } });
  const scheduler = createScheduler({ store, config, execute });
  // Phase F25: recurring items ("schedules" in config.json), checked every tick, each fires once per matching minute.
  const scheduleTimer = config.schedules?.length
    ? setInterval(() => {
        try {
          for (const c of runSchedules(store, config.schedules, { baseDir: factoryHome() })) say(`schedule ${c.name}: campaign ${c.campaignId} across ${c.items.length} repo(s)`);
        } catch (error) {
          say(`schedules: ${error instanceof Error ? error.message : error}`);
        }
      }, 20_000)
    : null;

  // Follow the log (other processes append too: submit, cancel, stop-all), and show run-level events.
  let seen = store.read().at(-1)?.seq ?? 0;
  const follow = () => {
    for (const e of store.read({ after: seen })) {
      seen = e.seq;
      if (/^(run|system)\./.test(e.type) || (e.type === 'step.finished' && e.data.step === 'build')) say(`${e.data.runId ? `[${short(e.data.runId)}] ` : ''}${e.type.startsWith('system.') ? e.type : describe(e)}`);
    }
  };

  say(`factory serve · ${config.maxConcurrent} at a time · $${config.dailyBudgetUsd}/day · tick ${config.tickMs}ms · Ctrl+C to stop`);
  scheduler.start();

  // Phase F18: outgoing notifications (config "notify.targets"), following the log.
  const targets = config.notify?.targets ?? [];
  const notifier = targets.length ? createNotifier({ store, targets, log: say }) : null;
  const notifyTimer = notifier && setInterval(() => (notifier.poll(), notifier.flush().catch(() => {})), 2000);
  if (notifier) say(`notifications: ${targets.map((t) => t.name ?? t.format).join(', ')}`);

  let workersServer = null;
  if (dispatcher) {
    const enrollToken = process.env.FACTORY_WORKER_ENROLL_TOKEN;
    if (!enrollToken) throw new Error('--workers needs FACTORY_WORKER_ENROLL_TOKEN (the secret a new worker registers with).');
    const api = workerApi({ store, dispatcher, enrollToken });
    workersServer = createHttpServer({ routes: api.routes, authorize: api.authorize });
    const port = Number(values['workers-port'] ?? 8790);
    const host = process.env.FACTORY_WORKERS_HOST ?? '127.0.0.1';
    workersServer.listen(port, host, () => say(`workers: http://${host}:${port} (factory worker --server … --enroll …)`));
  }

  // Phase F17: the dashboard, in this process.
  let board = null;
  if (values.dashboard) {
    board = await startDashboard({ store, port: Number(values.port ?? 8788) });
    say(`dashboard: ${board.url}`);
  }

  // Phase F15: receive GitHub webhooks (labelled issues, merges, review requests).
  let hooks = null;
  if (values.webhooks) {
    const gh = githubSettings();
    const paths = Object.fromEntries((gh.repos ?? []).map((r) => [`${r.owner}/${r.name}`, r.clone]));
    const reply = (owner, name, number, text, key) => forgeFor({ forge: { kind: 'github', owner, name } }).comment('', number, text, { key });
    hooks = createWebhookServer({ store, secret: /** @type {string} */ (process.env[gh.secretEnv]), settings: gh, repoPath: (o, n) => paths[`${o}/${n}`], reply, onHandled: (r) => say(`webhook ${r.event}: ${r.handled ? `→ ${r.runId}` : r.reason}`) });
    hooks.listen(gh.webhookPort, '127.0.0.1', () => say(`webhooks: POST http://127.0.0.1:${gh.webhookPort}/webhooks/github (put a tunnel in front for GitHub)`));
  }
  const followTimer = setInterval(follow, 250);

  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    if (values['until-idle']) {
      const check = setInterval(() => {
        const busy = store.list('runs').some((r) => r.status === 'queued' || r.status === 'running');
        if (!busy && !scheduler.active.length) {
          clearInterval(check);
          resolve(undefined);
        }
      }, 500);
    }
  });
  say('stopping: interrupting runs in progress (the next serve will requeue them)…');
  hooks?.close();
  if (scheduleTimer) clearInterval(scheduleTimer);
  workersServer?.close();
  if (notifier) {
    clearInterval(notifyTimer);
    notifier.poll();
    await notifier.flush({ force: true }); // don't lose what's batched
  }
  board?.server.close();
  await scheduler.stop('serve stopped');
  follow();
  clearInterval(followTimer);
  store.close();
  return 0;
}

/** @param {string[]} argv */
export async function statusCommand(argv) {
  parseArgs({ args: argv, options: {} });
  const store = openStore();
  try {
    const config = loadFactoryConfig();
    recoverRuns(store);
    const now = Date.now();
    const runs = store.list('runs');
    const running = runs.filter((r) => r.status === 'running');
    const queued = runs.filter((r) => r.status === 'queued');
    const spent = spentToday(store, now);
    const stopped = isStopped(store);

    console.log(`${stopped ? '🛑 STOPPED (factory resume-all)' : '🟢 accepting work'} · spent today $${spent.toFixed(2)} of $${config.dailyBudgetUsd} · ${running.length}/${config.maxConcurrent} running · ${queued.length} queued`);
    for (const r of running) console.log(`  ⏳ ${r.id}  ${r.title}  ${dim(`attempt ${r.attempt} · ${r.worker ?? `pid ${r.pid}`}`)}`);
    const why = pickRuns({ queued, running, config, spentAll: spent, spentBySlug: {}, stopped, campaignToday: campaignStartsToday(store, now) });
    for (const r of queued) {
      const reason = why.waiting.find((w) => w.runId === r.id)?.reason ?? 'starts at the next tick (is factory serve running?)';
      console.log(`  ⌛ ${r.id}  ${r.title}  ${dim(`priority ${r.priority ?? 0} · ${reason}`)}`);
    }
    const counts = {};
    for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(dim(`  all runs: ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(' · ') || 'none'}`));
    return 0;
  } finally {
    store.close();
  }
}

export async function stopAllCommand() {
  const store = openStore();
  stopAll(store);
  store.close();
  console.log('Stopped: no new runs will start, and running ones stop at their next heartbeat. Undo with factory resume-all.');
  return 0;
}

export async function resumeAllCommand() {
  const store = openStore();
  resumeAll(store);
  store.close();
  console.log('Resumed: queued runs will start again. Runs that were stopped stay stopped (factory run retry <run>).');
  return 0;
}

/** @param {string[]} argv */
export async function cancelCommand(argv) {
  if (!argv[0]) throw new Error('Usage: factory cancel <run-id>');
  const store = openStore();
  try {
    const what = cancelRun(store, argv[0]);
    console.log({ cancelled: 'Cancelled.', requested: 'Asked to stop: it will at its next heartbeat.', finished: 'That run has already finished.' }[what]);
    return 0;
  } finally {
    store.close();
  }
}

/** Phase F07 @param {string[]} argv */
export async function pauseCommand(argv) {
  if (!argv[0]) throw new Error('Usage: factory pause <run-id>');
  const store = openStore();
  try {
    const what = pauseRun(store, argv[0]);
    console.log({ paused: 'Paused.', requested: 'It will pause when its current station finishes.', finished: 'That run has already finished.' }[what]);
    return 0;
  } finally {
    store.close();
  }
}

/** Phase F07 @param {string[]} argv */
export async function resumeCommand(argv) {
  if (!argv[0]) throw new Error('Usage: factory resume <run-id>');
  const store = openStore();
  try {
    resumeRun(store, argv[0]);
    console.log('Back in the queue: factory serve carries on from its next station.');
    return 0;
  } finally {
    store.close();
  }
}
