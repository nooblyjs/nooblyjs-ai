// The NooblyJS layer, mounted by the composition root (app.js) once its infrastructure is in place: sessions, Passport
// and nooblyjs-core are ready. Order matters (structure.md §2a): who is signed in → audit → CSRF → NooblyJS routes →
// the UI kit and NooblyJS's own pages → hosted apps → the frame for built-in pages → 404 → errors.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HOME, PLATFORM, DEV, statusFor } from './built-in-apps.js';
import { loadHostedApps } from './hosted-apps.js';
import { seedFiles, seedMissing, isEmptyDir, isBlank } from './seed/index.js';
import { renameOpportunitiesToIdeas } from './seed/ideas.js';
import { createEvents } from './services/events.js';
import { createAuditLog } from './services/audit-log.js';
import { createPeople, ensureCoreAccounts } from './services/people.js';
import { createClock } from './services/clock.js';
import { createActivity } from './services/activity.js';
import { createMetrics } from './services/metrics/index.js';
import { createDevtools } from './services/devtools/index.js';
import { createBackups, nightlyBackup } from './services/backup.js';
import { devtoolsRoutes } from './routes/devtools.js';
import { createWorkRoles } from './services/work-roles.js';
import { createProfiles } from './services/profiles.js';
import { createTeams } from './services/teams.js';
import { createForYou } from './services/for-you.js';
import { createChat } from './services/chat.js';
import { createAgents } from './services/agents.js';
import { createPlatform } from './services/platform/index.js';
import { register as registerLifecycle } from './lifecycle/index.js';
import { createSessions } from './teams/sessions.js';
import { loadCards } from './teams/cards.js';
import { createBot } from './teams/bot.js';
import { createSimulator } from './teams/simulator.js';
import { teamsEndpoint, teamsRoutes, TEAMS_ENDPOINT } from './routes/teams.js';
import { createTokenCheck } from './teams/auth.js';
import { createConnector } from './teams/connector.js';
import { createEntraSignIn } from './services/entra.js';
import { createNotify } from './services/notify.js';
import { csrf } from './middleware/csrf.js';
import { identify, requireSignIn } from './middleware/auth.js';
import { createRoles } from './middleware/roles.js';
import { auditRequests } from './middleware/audit.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { sessionRoutes } from './routes/session.js';
import { eventRoutes } from './routes/events.js';
import { homeRoutes } from './routes/home.js';
import { devRoutes } from './routes/dev.js';
import { meRoutes } from './routes/me.js';
import { chatRoutes } from './routes/chat.js';
import { platformRoutes } from './routes/platform.js';
import { createMembers, createAuditQuery } from './services/platform/governance.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');
const { createShell, UI_DIR } = require('nooblyjs-core/src/shell');
export { FsStore };

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const STATIC = { index: false, redirect: false };

/**
 * Creates DATA_DIR and writes the seed when it is empty. Runs before nooblyjs-core starts, because core writes its own
 * files (logs, sign-in accounts) into DATA_DIR.
 */
export async function prepareData(config) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const store = new FsStore(config.dataDir);
  // A data folder seeded by an earlier phase gets what later phases added to the seed (Platform's files, new permissions).
  // NOOBLY_SAMPLE_DATA=false starts an empty folder blank: system files only, no sample story (npm run seed:blank
  // does the same ahead of time). A blank folder stays blank on every later start.
  const seeded = (await isEmptyDir(config.dataDir)) ? await seedFiles(store, { content: config.sampleData }) : await seedMissing(store);
  // Ideas were "opportunities" until 2026-10-12: an older folder's ids and words are brought up to date.
  await renameOpportunitiesToIdeas(store);
  return { store, seeded, blank: await isBlank(store) };
}

/**
 * Mounts NooblyJS on `app`. Returns the services the composition root and tests use, and close().
 * @param {object} o
 * @param {import('express').Express} o.app
 * @param {typeof import('express')} o.express
 * @param {object} o.config            from loadConfig()
 * @param {object} o.store             FsStore rooted at DATA_DIR (from prepareData)
 * @param {object} o.serverManager     the initialised nooblyjs-core registry
 * @param {object} o.authservice       nooblyjs-core authservice (file provider)
 * @param {object} o.log
 */
export async function mountNoobly({ app, express, config, store, serverManager, authservice, log, devtoolsFetch, devtoolsGitRemote = null, teamsFetch, graphFetch, coreEvents = null }) {
  // One clock for events, the audit log and every hosted app. Only development can move it (/dev/clock).
  const clock = await createClock({ store, movable: config.devLogin });
  const events = createEvents({ store, clock });
  const auditLog = createAuditLog({ store, clock });
  const people = createPeople({ store });
  const activity = createActivity({ store, people, clock });
  const metrics = createMetrics({ store, activity, clock, log });
  const workRoles = createWorkRoles({ store });
  const profiles = createProfiles({ store, workRoles, events, clock });
  const teams = createTeams({ store, people });
  // The first-week checklist is ticked by events, never by a page (tech.md §7.1).
  events.on('*', (event) => { profiles.onEvent(event).catch((err) => log.error(`first week: ${err.message}`)); });
  const roles = createRoles({ store });
  const created = await ensureCoreAccounts({ authservice, people });
  if (created.length) log.info(`created sign-in accounts for ${created.join(', ')}`);

  // Someone who signed in (e.g. with Microsoft) but has no NooblyJS record gets one: newPersonRole from roles.yaml,
  // or Owner when their email is in NOOBLY_OWNERS. Audited and evented like any other write.
  const onNewPerson = async (coreUser) => {
    const email = String(coreUser.email).toLowerCase();
    const accessRole = config.owners.includes(email) ? 'Owner' : await roles.newPersonRole();
    const { person, created } = await people.provision(coreUser, { accessRole });
    if (created) {
      await auditLog.record({ actor: person.id, action: 'person.created', target: person.id, accessRole, source: 'sign-in' });
      await events.emit('person.created', { personId: person.id, email: person.email, accessRole, source: 'sign-in' }, { actor: person.id });
      log.info(`created the NooblyJS record for ${person.email} (${person.id}, ${accessRole}) on first sign-in`);
    }
    return person;
  };
  // A Microsoft sign-in records the person's Entra object id (how the Teams bot knows them) and job title (Phase 12).
  const entra = createEntraSignIn({ people, authservice, onNewPerson, auditLog, fetch: graphFetch, log, readProfile: config.azureReadProfile });
  coreEvents?.on?.('auth:azure-login', ({ email } = {}) => { entra.signedIn(email).catch((err) => log.warn(`entra: ${email}: ${err.message}`)); });
  const who = identify({ people, onNewPerson });
  const signedIn = requireSignIn({ people, onNewPerson });
  app.use(who);
  app.use(auditRequests({ auditLog, log }));
  // The Teams bot endpoint is called by Teams, not by a signed-in person: it checks the caller itself (routes/teams.js).
  app.use(csrf({ secure: config.cookieSecure, skip: (req) => req.path === TEAMS_ENDPOINT }));
  app.use(sessionRoutes({ express, config, people, authservice, events, identify: who, requireSignIn: signedIn }));

  // The shell (nooblyjs-core): the frame page, GET /api/v1/shell and /status. Home comes first on the rail, then the
  // hosted apps in hosted-apps.yaml order (Product first), then Platform. The dev app (styleguide) only exists with dev sign-in.
  // features.events tells the frame the event stream exists, so it opens its one EventSource.
  const services = new Map();
  // The NooblyJS teams, for an app that needs to name the team an item belongs to (who pays for an agent's work).
  services.set('teams', { list: () => teams.list(), get: async (id) => (await teams.list()).find((t) => t.id === id) ?? null });
  // Agent teammates come from Digital Teammates when it is hosted (services/agents.js).
  const agents = createAgents({ services, teams });
  // Platform: repositories, model routes, budgets and guardrails, and the check every agent action passes first.
  const platform = createPlatform({ store, events, auditLog, clock, services, production: config.production, log });
  services.set('platform', platform);
  // Development tools: Bitbucket and Jira, read (Phase 11) and, through the write gate, written (Phase 13). Hosted
  // apps ask host.service('devtools'); none holds a token.
  const devtools = createDevtools({ store, settings: config.devtools, fetch: devtoolsFetch, gitRemote: devtoolsGitRemote, clock, log, services, auditLog, events, publicBaseUrl: config.publicBaseUrl });
  services.set('devtools', devtools);
  const shell = createShell({ express, auth: signedIn, can: roles.can, permissionsFor: roles.permissionsFor, features: { events: true, chat: true }, log });
  shell.builtIn({ ...HOME, status: statusFor('home', { shell, services, activity, profiles }) });
  shell.builtIn({ ...PLATFORM, status: statusFor('platform', { shell, services }) }, { position: 'end' });
  if (config.devLogin) shell.builtIn(DEV, { position: 'end' });
  app.use(shell.router);
  const stream = eventRoutes({ express, events, activity, store, clock, requireSignIn: signedIn, log });
  app.use(stream.router);
  const forYou = createForYou({ services, profiles, workRoles, teams, agents });
  app.use(homeRoutes({
    express, shell, services, activity, metrics, forYou, teams, agents, events, clock, requireSignIn: signedIn, requireRole: roles.requireRole,
    // An invited person can sign in straight away: their nooblyjs-core account is made now, not at the next start.
    onInvited: () => ensureCoreAccounts({ authservice, people }),
  }));
  app.use(meRoutes({ express, profiles, workRoles, teams, agents, requireSignIn: signedIn }));
  // Team chat: threads next to the work. An agent's reply is a task run by Digital Teammates.
  const chat = createChat({ store, events, auditLog, people, agents, roles, services, clock, replyDelayMs: config.chatReplyMs, log });
  app.use(chatRoutes({ express, chat, requireSignIn: signedIn, requireRole: roles.requireRole }));
  // Platform: repositories, containers, settings, environments, secrets, members and the audit log.
  const members = createMembers({ people, roles, agents });
  const auditQuery = createAuditQuery({ store, clock });
  // The repository list follows Bitbucket from the start, without holding the start up (a test asks for it itself).
  if (config.devtools.bitbucket.token && config.nodeEnv !== 'test') {
    platform.importRepositories()
      .then((r) => (r.ok ? log.info(`Bitbucket: ${r.added.length} repositories added, ${r.updated.length} refreshed${r.missing.length ? `, not found: ${r.missing.join(', ')}` : ''}`) : log.warn(`Bitbucket: repositories not imported (${r.message})`)))
      .catch((err) => log.warn(`Bitbucket: repositories not imported (${err.message})`));
  }
  app.use(devtoolsRoutes({ express, devtools, auditLog, events, requireSignIn: signedIn, requireRole: roles.requireRole }));
  app.use(platformRoutes({ express, platform, devtools, notify: { status: () => notify.status() }, teamsConfig: config.teams, members, auditQuery, events, store, clock, roles, requireSignIn: signedIn, requireRole: roles.requireRole }));
  // A signed-in person who hasn't been through onboarding (no profile.md) is sent there from any page. Skip for
  // now writes a profile too, so this happens once.
  const frame = (req, res, next) => signedIn(req, res, (err) => {
    if (err) return next(err);
    if (!req.person.hasProfile) return res.redirect(302, '/onboarding');
    shell.frame(req, res, next);
  });
  // The Teams bot (tech.md §7.3). Until the real bot (Phase 12) its only channel is the simulator at /dev/teams,
  // which exists with dev sign-in: without it there is no key, and the endpoint answers 401 to everyone.
  const sessions = createSessions({ store, clock });
  const simulator = config.devLogin ? createSimulator({ store, events, people, sessions, clock }) : null;
  // Replies go back the way the activity came: the simulator's transcript, or the Bot Connector (Teams, Playground).
  const connector = createConnector({ bot: config.teams, simulator: simulator?.connector ?? null, allowLocal: config.teams.devUnsigned, fetch: teamsFetch, log });
  const cards = await loadCards();
  // Approvals reach their reviewers in Teams and Outlook (Phase 12).
  const notify = createNotify({ store, people, profiles, connector, cards, events, auditLog, config, fetch: graphFetch, clock, log });
  const bot = createBot({
    agents, teams, people, roles, sessions, cards, connector, notify,
    chat, events, auditLog, store, publicBaseUrl: config.publicBaseUrl, log,
  });
  const devKey = config.devLogin ? crypto.randomBytes(24).toString('base64url') : null;
  const tokens = createTokenCheck({ appId: config.teams.appId, fetch: teamsFetch, log });
  const teamsBot = teamsEndpoint({ bot, devKey, tokens, devUnsigned: config.teams.devUnsigned, devPerson: config.teams.devPerson, log });
  app.use(teamsRoutes({ express, endpoint: teamsBot, auditLog, log }));
  if (config.teams.devUnsigned) log.warn(`Teams bot: unsigned activities from the Agents Playground are accepted (development), as ${config.teams.devPerson}`);
  else if (!config.teams.appId) log.info('Teams bot: no bot registered (TEAMS_BOT_APP_ID), so only the /dev/teams simulator can reach it');
  if (config.devLogin) {
    app.use(devRoutes({
      express, clock, events, requireSignIn: signedIn, simulator,
      deliver: (activity) => teamsBot.receive(activity, { authorization: `Bearer dev:${devKey}` }),
    }));
  }

  // The shared UI kit (/ui/) and NooblyJS's own browser files (/js/modules, /js/pages, /css). Files only: no index pages.
  app.use('/ui', express.static(UI_DIR, STATIC));
  app.use(express.static(PUBLIC_DIR, STATIC));

  // What every hosted app gets (structure.md §2a). NooblyJS already audits every write app-wide, so host.audit as
  // middleware only passes through; host.audit.record() adds records of its own.
  const audit = Object.assign((req, res, next) => next(), { record: (entry) => auditLog.record(entry) });
  // A blank data folder (npm run seed:blank) has no sample story, and no app adds one.
  const sampleData = !(await isBlank(store));
  const hostFor = (appDir) => ({
    // false: write your system files only, no sample content (structure.md §2a).
    sampleData,
    express,
    auth: signedIn,
    requireRole: roles.requireRole,
    // The same check requireRole makes, for rules decided in a service (who may approve this approval).
    can: roles.can,
    audit,
    events: { emit: events.emit, on: events.on },
    store: new FsStore(appDir),
    people: { list: people.list, get: people.get, getByEmail: people.getByEmail },
    // Business time: read it here, not from Date, so the dev clock moves approval targets and reminders too.
    clock: { now: clock.now },
    service: (name) => services.get(name),
    frame,
    publicBaseUrl: config.publicBaseUrl,
    // What the host logs at (LOG_LEVEL), so an app's own log lines are as quiet or as loud as NooblyJS's.
    logLevel: config.logLevel,
    // True only with dev sign-in (which config refuses in production). The Software Factory runs a repository's own
    // commands without a sandbox only when this is set.
    development: config.devLogin === true,
    // NooblyJS checks the CSRF token on every change before an app sees it (middleware/csrf.js), so apps don't add their own.
    checksCsrf: true,
  });
  // The lifecycle engine (src/lifecycle/, the hosted app nooblyjs-ai-workflows until 2026-10-10) is part of NooblyJS: mounted
  // here, before any hosted app, so host.service('workflows') is there for all of them from their first line. Its
  // API stays at /workflows/api/v1 and its files in data/workflows/. On a first start it writes its seed story.
  const lifecycleDir = path.join(config.dataDir, 'workflows');
  await fs.mkdir(lifecycleDir, { recursive: true });
  const lifecycleIsNew = await isEmptyDir(lifecycleDir);
  const lifecycle = await registerLifecycle(app, serverManager, { mountPath: '/workflows', dataDir: lifecycleDir, host: hostFor(lifecycleDir) });
  services.set('workflows', lifecycle.services);
  if (lifecycleIsNew) await lifecycle.seed({ reset: false, content: sampleData });

  const hosted = await loadHostedApps({ app, serverManager, config, store, shell, hostFor, services, log, sampleData });

  // A Software Factory run that is stuck asks a person. The question is also a line in the item's thread, so the
  // people working on the item see it next to the work. The Factory never writes to a thread itself.
  events.on('run.asked', (event) => {
    const p = event.payload ?? {};
    if (!p.itemId) return;
    chat.note(p.itemId, `A Software Factory run is asking a person: ${p.title}. Answer it on your For you page or in the Factory inbox.`)
      .catch((err) => log.warn(`run.asked for ${p.itemId}: ${err.message}`));
  });

  // Work items in step with Jira and Bitbucket (Phase 13). An approved handoff makes the Jira issues; a run that
  // starts moves its issue on; a timer reads the linked issues and the open pull requests back. Each write these
  // cause goes through the write gate, which sends nothing while writes are recorded only.
  const syncing = new Set();
  const inSync = (what, work) => {
    const p = Promise.resolve().then(work).catch((err) => log.warn(`devtools sync (${what}): ${err.message}`)).finally(() => syncing.delete(p));
    syncing.add(p);
  };
  events.on('handoff.created', (event) => inSync('handoff', () => devtools.sync.onHandoff({ handoffId: event.payload?.handoffId })));
  events.on('run.started', (event) => {
    if (event.payload?.workItemId) inSync('run', () => devtools.sync.onRunStarted({ workItemId: event.payload.workItemId, runId: event.payload.runId ?? null }));
  });
  // The nightly backup of data/ (Phase 13), when BACKUP_DIR is set: looked at every half hour, made once a day.
  const backups = createBackups({ dataDir: config.dataDir, backupDir: config.backup.dir, keep: config.backup.keep, clock, log });
  const backupNow = async () => {
    const made = await nightlyBackup(backups, { clock, hour: config.backup.hour });
    if (made) await auditLog.record({ actor: 'system', action: 'backup.created', target: made.name, system: 'platform', files: made.files, bytes: made.bytes, auditRecords: made.audit.records, removed: made.removed });
    return made;
  };
  const backupTimer = config.backup.dir && config.nodeEnv !== 'test'
    ? setInterval(() => backupNow().catch((err) => log.error(`backup failed: ${err.message}`)), 30 * 60_000) : null;
  backupTimer?.unref();
  if (config.backup.dir && config.nodeEnv !== 'test') log.info(`backups: nightly at ${String(config.backup.hour).padStart(2, '0')}:00 to ${config.backup.dir}, keeping ${config.backup.keep}`);

  const syncTimer = config.nodeEnv === 'test' ? null : setInterval(() => inSync('poll', () => devtools.sync.poll()), config.devtools.syncMinutes * 60_000);
  syncTimer?.unref();

  // Every page of a built-in app, and of a listed app that isn't installed or didn't start, gets the frame, which
  // shows the page or says why it can't. Hosted apps that started answer their own UI routes with host.frame.
  const framed = shell.list().filter((a) => !a.apiOnly && (a.state !== 'ready' || [HOME.name, PLATFORM.name, DEV.name].includes(a.name)));
  for (const a of framed) {
    if (a.mountPath === '/') app.get(['/', '/home', '/home/{*rest}'], frame);
    else app.get([a.mountPath, `${a.mountPath}/{*rest}`], (req, res, next) => (req.path.includes('/api/') ? next() : frame(req, res, next)));
  }
  app.use(notFound);
  app.use(errorHandler({ log }));

  return {
    events, auditLog, people, roles, shell, hosted, clock, activity, metrics, devtools, backups, backupNow, entra, notify, profiles, chat, agents, platform, lifecycle, sessions, simulator, teamsBot, devKey,
    /** Resolves when the sync work started by events so far is done (tests). */
    syncSettled: async () => { while (syncing.size) await Promise.allSettled([...syncing]); },
    async close() {
      if (syncTimer) clearInterval(syncTimer);
      if (backupTimer) clearInterval(backupTimer);
      stream.closeAll();
      platform.close();
      chat.close();
      await hosted.close();
      await lifecycle.close();
    },
  };
}
