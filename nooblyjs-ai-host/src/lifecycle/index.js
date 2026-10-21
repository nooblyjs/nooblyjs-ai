// The lifecycle engine (product.md §4): items, the eight stages (lifecycle v3), readiness, approvals with target times and
// escalation, handoffs and send-back. It was the hosted app nooblyjs-ai-workflows until 2026-10-10 and is part of NooblyJS
// now: src/noobly.js mounts it at start, before any hosted app, so it is always there.
//
// What did not change: it answers at /workflows/api/v1, keeps its files in data/workflows/, and other apps reach it
// as host.service('workflows'). It still takes the host as a hosted app does (register(app, serverManager,
// { dataDir, host })), which is how its own tests run it on a stand-in host (test/lifecycle/).
//
// API only: its screens are Home's (Overview, Lifecycle, Approvals) and the stage parts of the Product Factory's.
import fs from 'node:fs';
import { createRepos } from './repos.js';
import { createEngine } from './services/engine.js';
import { createViews } from './services/views.js';
import { createApi } from './routes.js';
import { seed as seedStory } from './seed/index.js';

const NAME = 'workflows';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'can', 'audit', 'events', 'store', 'people', 'service'];
const SWEEP_EVERY_MS = 60_000;

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object, sweepEveryMs?: number }} options
 *   sweepEveryMs: how often reminders and escalations are checked (0 turns the timer off; tests sweep by hand)
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/workflows', dataDir, host, sweepEveryMs = SWEEP_EVERY_MS } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted.
  if (typeof app?.use !== 'function') throw new Error("The lifecycle engine needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('The lifecycle engine needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /workflows, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('The lifecycle engine needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`The lifecycle engine needs host.${missing.join(', host.')} from the host.`);

  // The host's logging provider, as an instance named after this app, so its lines are labelled and it shows up
  // once on /services.
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  // The host's clock (NooblyJS's dev clock can move it); Date when a host has none.
  const clock = host.clock ?? Date;
  const repos = createRepos(host.store);
  const engine = createEngine({ repos, host, log, clock });
  const views = createViews({ repos, host, engine });
  const about = { name: NAME, version: VERSION, mountPath };

  // Lifecycle v3 (Phase 16b): items in a stage from before (Specify, UX, UI, Architect, Verify, Ship) move to where it
  // belongs now, once, on record. A failure here is logged and NooblyJS starts anyway; the next start tries again.
  try {
    await engine.migrateStages();
  } catch (err) {
    log.error(`moving items to the lifecycle v3 stages failed: ${err.message}`);
  }

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, engine, views, about }));
  // API only: anything else under the mount path isn't ours (structure.md §2a).
  app.use(mountPath, router);

  const unsubscribe = [
    host.events.on('adr.accepted', (event) => engine.onAdrAccepted(event)),
    // The dev clock moved: reminders and escalations that are now due go out straight away.
    host.events.on('clock.moved', () => engine.sweep().catch(() => {})),
  ];
  const timer = sweepEveryMs > 0 ? setInterval(() => engine.sweep().catch(() => {}), sweepEveryMs) : null;
  timer?.unref?.();

  return {
    name: NAME,
    label: 'Workflows',
    icon: 'flow',
    mountPath,
    // No `ui`: an API-only app has no rail item and no pages.
    nav: [],
    // What other apps may call through host.service('workflows') (structure.md §6).
    services: {
      /** A person's decision on an item's open spec approval (the Product Factory's Approve / Request changes). */
      decide: (input) => engine.decide(input),
      /** Ask for a spec's review: opens the approval (and the item, when it is new) with the team's reviewers. */
      requestApproval: (input) => engine.requestApproval(input),
      /** Another app's approval on its own artefact (NooblyJS Infrastructure's design versions); see engine.js APP_TYPES. */
      requestAppApproval: (input) => engine.requestAppApproval(input),
      /** The app decided on its own screen: close the matching open approval with that decision. */
      closeAppApproval: (input) => engine.closeAppApproval(input),
      /** The app's artefact no longer waits for this approval. */
      withdrawAppApprovals: (input) => engine.withdrawAppApprovals(input),
      /** A person merged the item's pull requests in Bitbucket: before its Build and Test approvals, it is flagged (Phase 16b). */
      movedByMerge: (input) => engine.movedByMerge(input),
      /** Send an item back to an earlier stage, with a reason. */
      sendBack: ({ itemId, to, reason, actor }) => engine.sendBack(itemId, { to, reason }, actor),
      /** The Design handoff (Design → Engineering) with the planned work items; they go to the Software Factory on the Engineering sign-off. */
      handoff: (input) => engine.handoff(input),
      /** The Design section's stories for an item in Design (Phase 16c): new ones become items, removed ones are withdrawn. */
      syncStories: (input) => engine.syncStories(input),
      /** One story's Design handoff (Phase 16c): it moves to Engineer; its item follows when its last story has gone. */
      handoffStory: (input) => engine.handoffStory(input),
      /** The Engineering sign-off of an item in Engineer (Phase 16d), with its readiness checks or an override. */
      signOffEngineering: (input) => engine.signOffEngineering(input),
      /** A person's decision on one approval (the Factory's pull request page): approve or request changes, `for` someone. */
      decideApproval: ({ approvalId, actor, ...input } = {}) => engine.decideApproval(approvalId, input, actor),
      /** The Software Factory delivered a pull request for a story, or its branch moved (Phase 16e): see pull-requests.js. */
      recordPullRequest: (input) => engine.pullRequests.recordPullRequest(input),
      /** Refuses (422, saying what is missing) unless this person may merge the pull request now. */
      canMerge: (input) => engine.pullRequests.canMerge(input),
      /** A person merged the pull request (the Factory carried it out): it is done, and its story follows. */
      pullRequestMerged: (input) => engine.pullRequests.pullRequestMerged(input),
      /** A pull request merged in Bitbucket: counted with both approvals, else flagged. Null when it is not a lifecycle pull request. */
      pullRequestMergedOutside: (input) => engine.pullRequests.pullRequestMergedOutside(input),
      /** One pull request with its approvals, who gave them for whom, and what stops a merge. */
      pullRequest: ({ prId } = {}) => engine.pullRequests.pullRequestView(prId),
      /** A story's pull requests, or every pull request the Factory delivered. */
      pullRequests: async ({ storyId = null } = {}) => (storyId ? engine.pullRequests.prsOf(storyId) : (await repos.items.list()).filter((i) => i.type === 'pr')),
      /** An item's features, each with its stories and where it is (Phase 16e). */
      featuresOf: ({ itemId } = {}) => engine.pullRequests.featuresOf(itemId),
      /** The readiness of an item for its current stage's decision (the Factory's Engineering sign-off page). */
      readinessOf: async ({ itemId } = {}) => {
        const item = await repos.items.get(itemId);
        return item ? engine.readinessOf(item) : null;
      },
      /** An item's stories as the lifecycle sees them: [{ id, title, stage, status, feature }]. */
      storiesOf: async ({ itemId } = {}) => (await engine.storiesOf(itemId)).map(({ id, ref, title, stage, status, feature, stageEnteredAt }) => ({ id, ref, title, stage, status, feature: feature ?? null, stageEnteredAt })),
      /** One handoff with its work items ({ id, itemId, workItems: [{ id, repo, title, status }], … }), or null. The Software Factory reads it. */
      handoffOf: async ({ handoffId } = {}) => repos.handoffs.get(handoffId),
      /** One item, as the lifecycle sees it (null when unknown). */
      item: async ({ itemId } = {}) => repos.items.get(itemId),
      /** Approvals, optionally of one type (the Factory's Pull requests and Test approvals pages). */
      approvals: async ({ type = null } = {}) => (await repos.approvals.list()).filter((a) => !type || a.type === type),
      /** Items, optionally those in one stage (the Design section's lists, Phase 16c). */
      items: async ({ stage = null } = {}) => (await repos.items.list()).filter((i) => !stage || i.stage === stage),
      /** Approvals waiting on this person (Home, For you). */
      waitingFor: (person) => views.waitingFor(person),
      /** Items in flight, approvals waiting on the person, agents working. */
      counts: (person) => views.counts(person),
      overview: (person) => views.overview(person),
      live: () => views.live(),
      /** Every item row, open approval and stage health in one read, unfiltered (NooblyJS's For you homes). */
      snapshot: (person) => views.snapshot(person),
      /** The Who approves what table. */
      rules: () => views.rulesTable(),
      /** Reminders and escalations due now (the timer calls it every minute). */
      sweep: (at) => engine.sweep(at),
    },
    /** Writes the seed story into dataDir, with its times moved to "now"; `reset` removes what is there first. */
    seed: async ({ reset = false, content = true } = {}) => {
      await seedStory(host.store, { reset, content, now: new Date(clock.now()).toISOString() });
      log.info(content ? `seeded the lifecycle story${reset ? ' (reset)' : ''}` : 'wrote the lifecycle rules (no sample items)');
    },
    async close() {
      if (timer) clearInterval(timer);
      for (const off of unsubscribe) off?.();
    },
  };
}
