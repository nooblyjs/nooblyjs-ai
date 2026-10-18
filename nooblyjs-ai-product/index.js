// The Product Factory as a NooblyJS hosted app (noobly structure.md §2a, ../nooblyjs-ai-host/.claude/steering/structure.md §2a). NooblyJS imports
// this file and calls register() with its Express app, its nooblyjs-core serverManager and what it shares (`host`);
// server.js does the same when the repo runs on its own, and the tests do it with test/fixtures/host.js. Nothing
// here listens on a port.
//
// The app owns its screens, like Teammates: the UI is a module (public/js/module.js) that the NooblyJS frame loads into
// its content area, and NooblyJS draws the rail and the sidebar from the description register() returns.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './src/routes/index.js';
import { createRepos } from './src/repos/index.js';
import { createSummaryService } from './src/services/summary.js';
import { createIdeaService, migrateFromOpportunities } from './src/services/ideas.js';
import { createCatalogue } from './src/services/catalogue.js';
import { createTemplates } from './src/services/templates.js';
import { createDocuments } from './src/services/documents.js';
import { createSpecWriteService } from './src/services/spec-writes.js';
import { createStageAgents } from './src/services/stage-agents.js';
import { createDrafting } from './src/services/drafting.js';
import { specKinds } from './src/services/draft-kinds.js';
import { createArchitectureService, architectureKinds } from './src/services/architecture.js';
import { createUxService, uxKinds } from './src/services/ux.js';
import { createUiService, uiKinds } from './src/services/ui.js';
import { createFlowService } from './src/services/flow.js';
import { seed as seedStory } from './src/seed/index.js';

const NAME = 'product';
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Sidebar rows (product.md §5): `path` is relative to the mount path, `icon` names a UI kit icon. */
export const NAV = [
  { key: 'overview', label: 'Overview', path: '/', icon: 'grid' },
  { key: 'portfolios', label: 'Portfolios', path: '/portfolios', icon: 'layers', group: 'Strategy' },
  { key: 'board', label: 'Product', path: '/board', icon: 'product', group: 'Stages' },
  { key: 'specs', label: 'Specs', path: '/specs', icon: 'doc', group: 'Stages' },
  { key: 'architecture', label: 'Architecture', path: '/architecture', icon: 'cube', group: 'Stages' },
  { key: 'ux', label: 'UX Design', path: '/ux', icon: 'pen', group: 'Stages' },
  { key: 'ui', label: 'UI Design', path: '/ui', icon: 'screen', group: 'Stages' },
  { key: 'reviews', label: 'Reviews', path: '/reviews', icon: 'inbox', group: 'Flow', badge: 'reviews' },
  { key: 'handoffs', label: 'Handoffs', path: '/handoffs', icon: 'handoff', group: 'Flow' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings', group: 'Setup' },
];

/**
 * @param {import('express').Express} app   the host's app (NooblyJS, or server.js when standalone)
 * @param {object} serverManager            nooblyjs-core ServiceRegistry, already initialised by the host
 * @param {{ mountPath?: string, dataDir: string, host: object, draftStepMs?: number }} options
 *   draftStepMs: the mock agent's pause between progress steps (tests pass 0; PRODUCT_MOCK_DRAFT_MS sets it too)
 * @returns {Promise<object>} the HostedApp description
 */
export async function register(app, serverManager, { mountPath = '/product', dataDir, host, draftStepMs } = {}) {
  // Check everything before mounting anything, so a failed start leaves nothing half-mounted (noobly structure.md §2a).
  if (typeof app?.use !== 'function') throw new Error("nooblyjs-ai-product needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('nooblyjs-ai-product needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /product, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('nooblyjs-ai-product needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`nooblyjs-ai-product needs host.${missing.join(', host.')} from the host.`);

  // The host's logging provider, as an instance named after this app, so its lines are labelled and it shows up
  // once on /services.
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const seed = (options) => seedStory(host.store, options);
  // Ideas were "opportunities" until 2026-10-12: a data folder from before is moved over first.
  await migrateFromOpportunities(host.store, log);
  const repos = createRepos(host.store, { log });
  const people = host.people;
  const flow = createFlowService({ repos, host, log, people: host.people });
  // Where signals, ideas and specs sit: strategic themes, portfolios (each with a document made from the
  // portfolio template), value streams (the same) and products. A data folder from before them is brought up to date now.
  const templates = createTemplates({ repos, host });
  const documents = createDocuments({ repos, host, templates });
  const catalogue = createCatalogue({ repos, host, log, documents });
  await catalogue.migrate();
  const ideas = createIdeaService({ repos, host, catalogue });
  const specWrites = createSpecWriteService({ repos, host, log, flow, catalogue });
  const architecture = createArchitectureService({ repos, host, log });
  const ux = createUxService({ repos, host });
  const ui = createUiService({ repos, host, log, flow });
  const kinds = {
    spec: specKinds({ repos, specWrites }),
    architecture: architectureKinds({ repos, architecture }),
    ux: uxKinds({ repos, ux }),
    ui: uiKinds({ repos, ui, architecture }),
  };
  // Who drafts each stage: one of the teammates hired in Digital Teammates (stage-agents.js).
  const stageAgents = createStageAgents({ host, log });
  const drafting = createDrafting({
    stageAgents,
    repos, host, log,
    // The host's queueing provider, as this app's instance (noobly structure.md §2a: never a queue of our own).
    queue: serverManager.queue(serverManager.getDefaultProviderType('queueing'), { instanceName: NAME }),
    kinds: { ...kinds.spec, ...kinds.architecture, ...kinds.ux, ...kinds.ui },
    stepMs: draftStepMs ?? (Number(process.env.PRODUCT_MOCK_DRAFT_MS) || 400),
    // A draft's sources (what Knowledge gave it) go on the item's spec.
    linkSources: (itemId, links, actor) => specWrites.linkSources(itemId, links, actor),
  });
  const summary = createSummaryService({ repos, people, host, budget: drafting.budget, architecture, stageAgents });

  const router = host.express.Router();
  router.use('/api/v1', createApi({ host, log, seed, repos, people, catalogue, documents, templates, ideas, specWrites, drafting, summary, architecture, ux, ui, flow, stageAgents, kindKeys: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Object.keys(v)])), mountPath, about: { name: NAME, version: VERSION, mountPath } }));
  // The browser files (module, pages, CSS). redirect: false, or /product would 301 to /product/ (public/ is a folder).
  router.use(host.express.static(PUBLIC_DIR, { index: false, redirect: false }));
  // Every other GET without a file extension is a page: the host's frame answers it, so deep links and refresh land
  // on the right screen. A missing .js or .css is still a 404.
  router.get('/{*rest}', (req, res, next) => (path.extname(req.path) || req.path.startsWith('/api/') ? next() : host.frame(req, res, next)));
  app.use(mountPath, router);

  // the NooblyJS lifecycle engine records approvals; the engine reflects the outcome on the spec (it never approves itself).
  const unsubscribe = [
    host.events.on('approval.decided', (event) => specWrites.onApprovalDecided(event)),
    // An ADR accepted on NooblyJS's Approvals screen is accepted here too.
    host.events.on('approval.decided', (event) => architecture.onApprovalDecided(event)),
    // the NooblyJS lifecycle engine moves items; an item entering Architecture shows on that stage's list (nothing drafts by itself, D3).
    host.events.on('item.stage_changed', (event) => architecture.onStageChanged(event)),
    host.events.on('handoff.created', (event) => ui.onHandoffCreated(event)),
    host.events.on('item.sent_back', (event) => flow.onSentBack(event)),
    host.events.on('knowledge.answer_flagged', (event) => flow.onKnowledgeFlagged(event)),
  ];
  // Jobs that were waiting when the process last stopped are queued again.
  await drafting.recover();

  return {
    name: NAME,
    label: 'Product',
    title: 'product factory',
    icon: 'product',
    mountPath,
    ui: { entry: 'js/module.js', styles: ['css/product.css'] },
    nav: NAV,
    /** The sidebar's status card ("3 agents on duty", "October spend $412 of $1,500") and the Reviews badge. */
    async status() {
      const [card, specs] = await Promise.all([summary.summary(), repos.specs.list()]);
      const { agentsOnDuty, spend } = card;
      const month = MONTHS[Number(spend.month.slice(5, 7)) - 1];
      const ratio = spend.budgetUsd ? spend.usedUsd / spend.budgetUsd : 0;
      const dollars = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
      return {
        badges: { reviews: specs.filter((s) => s.status === 'in-review').length },
        card: {
          pill: { text: agentsOnDuty.text, tone: agentsOnDuty.count ? 'info' : 'neutral' },
          ...(agentsOnDuty.names.length ? { items: [{ label: 'Working now', value: agentsOnDuty.names.join(', ') }] } : {}),
          meter: {
            label: `${month} spend`,
            value: spend.budgetUsd ? `${dollars(spend.usedUsd)} of ${dollars(spend.budgetUsd)}` : dollars(spend.usedUsd),
            ratio,
            tone: ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : undefined,
          },
        },
      };
    },
    // What other apps may call (structure.md §6).
    services: {
      artefactsFor: (itemId, options) => summary.artefactsFor(itemId, options),
      summary: (person) => summary.summary(person),
      readinessFacts: (itemId) => specWrites.facts(itemId),
      /**
       * A person's edit of a spec's sections from outside this app (NooblyJS team chat's "Apply to spec"). The caller has
       * checked the person's permission; an agent actor is refused here. Resolves with the new { id, version }.
       */
      updateSpec: ({ itemId, fields, changeNote, actor }) => specWrites.updateFromHost(itemId, fields, changeNote, actor),
      /** Knowledge links for an item's spec, from the Knowledge Repository (a person's "Add to item"). Resolves with { added, links }. */
      linkKnowledge: ({ itemId, links, actor }) => specWrites.linkFromHost(itemId, links, actor),
      /** An architecture decision by its id, for apps that show it by name: { id, title, itemId, status, href }, or null. */
      adrFor: async (adrId) => {
        const adr = await architecture.findAdr(adrId).catch(() => null);
        return adr ? { id: adr.id, title: adr.title ?? adr.id, itemId: adr.itemId, status: adr.status ?? null, href: `${mountPath}/architecture/${adr.itemId}` } : null;
      },
      /** The item's gates with the decisions still open on them: { gates, proposedAdrs, standards }, or null. */
      architectureFor: (itemId) => architecture.summaryFor(itemId).catch(() => null),
      /** The quality attributes that become Software Factory gates on every PR for this item. */
      gatesFor: async (itemId) => (await architecture.qualityAttributes(itemId).catch(() => null))?.attributes ?? [],
      /** Rows for Home · Waiting on you and the For you pages. */
      waitingFor: (person) => flow.waitingFor(person),
      /** Facts for NooblyJS Metrics: lead time, sent-back rate per stage, spend. */
      metrics: () => flow.metrics(),
    },
    /** Writes the seed story into dataDir; `reset` removes what is there first. */
    seed: async ({ reset = false, content = host.sampleData !== false } = {}) => {
      await seed({ reset, content });
    },
    /** Stops listening to other apps' events and lets the running draft finish. */
    close: async () => {
      for (const off of unsubscribe.splice(0)) if (typeof off === 'function') off();
      await drafting.close();
    },
    /** For the tests: resolves when no draft is queued or running. */
    idle: () => drafting.idle(),
  };
}
