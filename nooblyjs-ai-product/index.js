// NooblyJS Product: a hosted app at /product (CHG-009, 2026-10-21). Strategy and the product stages: signals, ideas
// and business cases, specs with their elicitation, architecture, UX and UI, reviews, and the handoff that feeds
// Design. It was a section of the Software Factory (/factory/product) from 2026-10-19 (CHG-005) until CHG-009; an
// install's data/factory/product moves to data/product once (the host's foldData). NooblyJS imports this file and
// calls register(); the tests mount it on the stand-in host (test/fixtures/host.js). Nothing here listens on a port.
//
// Its Architecture pages are shown in the Design app's sidebar (lifecycle v3, Phase 16b): the code, the API and the
// pages stay here, and Design's UI module draws them (../nooblyjs-ai-design/public/js/module.js). NooblyJS draws the
// rail and the sidebar from what register() returns (../nooblyjs-ai-host/.claude/steering/structure.md §2a).
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
import { parseSpec } from './src/services/spec-format.js';
import { createProductChecks } from './src/services/checks-trace.js';
import { createHierarchy } from './src/services/hierarchy.js';
import { createBusinessCases } from './src/services/business-cases.js';
import { createElicitation } from './src/services/elicitation.js';
import { createFeedback } from './src/services/feedback.js';
import { createPortal } from './src/services/portal.js';
import { createLoop } from './src/services/loop.js';
import { formRoutes } from './src/routes/form.js';

const NAME = 'product';
// One or more path segments (/product, or deeper for a host that nests it).
const MOUNT = /^(\/[a-z0-9][a-z0-9-]{0,62})+$/;
const { version: VERSION } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const NEEDS = ['express', 'auth', 'requireRole', 'audit', 'events', 'store', 'people', 'service', 'frame'];
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
// Where the Design app is: its Architecture rows show this app's architecture pages (see above).
const DESIGN_PATH = '/design';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Sidebar rows (product.md §5): `path` is relative to the mount path, `icon` names a UI kit icon. Architecture is a
 * stage here, but its row is the Design app's (DESIGN_PATH).
 */
export const NAV = [
  { key: 'overview', label: 'Overview', path: '/', icon: 'grid' },
  { key: 'portfolios', label: 'Portfolios', path: '/portfolios', icon: 'layers', group: 'Strategy' },
  // NooblyJS Phase 25a: what colleagues say (and the feedback form's links), and the ideas they put forward.
  { key: 'feedback', label: 'Feedback', path: '/feedback', icon: 'chat', group: 'Customers' },
  { key: 'portal', label: 'Ideas portal', path: '/portal', icon: 'spark', group: 'Customers' },
  { key: 'board', label: 'Product', path: '/board', icon: 'product', group: 'Stages' },
  { key: 'specs', label: 'Specs', path: '/specs', icon: 'doc', group: 'Stages' },
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
  if (typeof app?.use !== 'function') throw new Error("The Product section needs the host's Express app.");
  if (!serverManager?.initialized) throw new Error('The Product section needs an initialised serverManager (the host initialises it).');
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /product, not ${JSON.stringify(mountPath)}`);
  if (!dataDir) throw new Error('The Product section needs a dataDir.');
  const missing = NEEDS.filter((key) => !host?.[key]);
  if (missing.length) throw new Error(`The Product section needs host.${missing.join(', host.')} from the host.`);

  // The host's logging provider, as an instance named after this app, so its lines are labelled and it shows up
  // once on /services.
  const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: NAME });
  const seed = (options) => seedStory(host.store, options);
  // Ideas were "opportunities" until 2026-10-12: a data folder from before is moved over first.
  await migrateFromOpportunities(host.store, log);
  const repos = createRepos(host.store, { log });
  const people = host.people;
  const flow = createFlowService({ repos, host, log, people: host.people, mountPath });
  // Where signals, ideas and specs sit: strategic themes, portfolios (each with a document made from the
  // portfolio template), value streams (the same) and products. A data folder from before them is brought up to date now.
  const templates = createTemplates({ repos, host });
  const documents = createDocuments({ repos, host, templates });
  // NooblyJS Phase 17: the work hierarchy (portfolio epics, epics, features) and business cases.
  const hierarchy = createHierarchy({ repos, host, documents });
  const catalogue = createCatalogue({ repos, host, log, documents, hierarchy });
  await catalogue.migrate();
  const ideas = createIdeaService({ repos, host, catalogue, hierarchy });
  // NooblyJS Phase 25a: feedback notes and their insights, the ideas portal, and telling the people who asked.
  const feedback = createFeedback({ repos, host, log });
  const portal = createPortal({ repos, host, ideas });
  const loop = createLoop({ repos, host, log, feedback });
  const businessCases = createBusinessCases({ repos, host, hierarchy, log });
  const specWrites = createSpecWriteService({ repos, host, log, flow, catalogue });
  const architecture = createArchitectureService({ repos, host, log });
  // NooblyJS Phase 18: where requirements come from, and who accepted them.
  const elicitation = createElicitation({ repos, host, architecture, log });
  // NooblyJS Phase 16f: this section's checks (the spec's readiness, the standards check) and its part of the trace.
  const productChecks = createProductChecks({ repos, architecture, specWrites, mountPath });
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
  const summary = createSummaryService({ repos, people, host, budget: drafting.budget, architecture, stageAgents, mountPath });

  const router = host.express.Router();
  // The feedback form on a link (Phase 25a): anyone with the link, signed in or not, so before the API's sign-in.
  router.use(formRoutes({ host, feedback }));
  router.use('/api/v1', createApi({ host, log, seed, repos, people, catalogue, documents, templates, ideas, hierarchy, businessCases, elicitation, specWrites, drafting, summary, architecture, ux, ui, flow, stageAgents, feedback, portal, kindKeys: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, Object.keys(v)])), mountPath, about: { name: NAME, version: VERSION, mountPath } }));
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
    // NooblyJS Phase 25a: everyone who asked hears when it ships (Operations' release) and whether it worked.
    host.events.on('release.deployed', (event) => loop.onReleaseDeployed(event).catch((err) => log.warn(`product: telling who asked about ${event?.payload?.itemId}: ${err.message}`))),
    host.events.on('outcome_review.closed', (event) => loop.onOutcomeReviewed(event).catch((err) => log.warn(`product: telling who asked about ${event?.payload?.itemId}: ${err.message}`))),
    // NooblyJS Phase 18: meeting notes a person had a teammate post to a spec become one of its elicitation sessions.
    host.events.on('teams.meeting_notes_posted', (event) => {
      const p = event?.payload ?? {};
      if (!p.itemId || !p.notes) return;
      repos.specs.get(p.itemId).then((spec) => spec && elicitation.addSession(p.itemId, { kind: 'meeting', title: p.meeting ?? 'Teams meeting', notes: p.notes, with: p.with ?? [] }, { id: p.teammateId ?? 'teams', name: p.actorName ?? 'Teams', kind: 'agent' }, { source: 'teams' }))
        .catch((err) => log.warn(`product: ${p.itemId}'s meeting notes were not recorded as a session: ${err.message}`));
    }),
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
      /**
       * NooblyJS Phase 23: a signal from production (Operations: an incident, an alert) on the Product board, linked to
       * the release and item it came from. The same key twice is one signal, its count raised.
       */
      async raiseSignal({ key, title, product = null, theme = null, count = 1, unit = 'incidents', sourceLabel = 'Production', release = null, itemId = null, detail = '', actor } = {}) {
        const words = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!words) throw new Error('A signal needs a title.');
        const id = `sig_${String(key ?? words).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'production'}`;
        const by = { id: actor?.id ?? 'operations', name: actor?.name ?? 'Operations', kind: actor?.kind ?? 'app' };
        const at = new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
        const existing = await repos.signals.get(id);
        const record = existing
          ? { ...existing, count: (existing.count ?? 0) + (Number(count) || 1), updatedAt: at }
          : { id, title: words, theme, product, source: 'production', sourceLabel, count: Number(count) || 1, unit, week: null, status: 'new', release, itemId, raisedBy: by, createdAt: at, body: String(detail ?? '').slice(0, 4000) };
        await repos.signals.write(record);
        await host.events.emit('signal.raised', { signalId: id, title: record.title, product: record.product, release, itemId, count: record.count, summary: `raised the signal "${record.title}" from production${release ? ` (${release})` : ''}` }, { actor: by.id });
        return record;
      },
      /** NooblyJS Phase 25a: the PM's home: notes not linked yet, Ada's suggestions waiting, portal ideas waiting, who will be told. */
      evidence: () => feedback.home(),
      /** NooblyJS Phase 25a: customer importance of ideas, features and specs, by id ("3 colleagues across 1 portfolio; …"). */
      importance: (ids) => feedback.importance(Array.isArray(ids) ? ids : [ids]),
      /** NooblyJS Phase 25a: the people who asked for an item (voted, follow, or whose notes are linked). */
      peopleToTell: (itemId, options) => feedback.peopleToTell(itemId, options).then((r) => r.people),
      /** NooblyJS Phase 23: an idea another app opens (an incident's follow-up, an outcome review's goal missed). */
      createIdea: ({ title, product = null, problem = '', signals = [], actor }) => ideas.createFromBody({ title: String(title ?? '').slice(0, 200), ...(product ? { product } : {}), problem, signals }, actor),
      artefactsFor: (itemId, options) => summary.artefactsFor(itemId, options),
      summary: (person) => summary.summary(person),
      // An idea's (Phase 17): "Business case complete", the Discover exit's check. A spec's: the spec's checks.
      // A spec with questions (Phase 18) also has "Every question is answered", failing while one is open.
      readinessFacts: async (itemId) => {
        if (/^IDEA-/.test(String(itemId))) return businessCases.facts(itemId);
        const spec = await specWrites.facts(itemId);
        return spec ? { ...spec, facts: { ...spec.facts, ...(await elicitation.facts(itemId).catch(() => ({}))) } } : spec;
      },
      /** An item's elicitation (Phase 18): stakeholders, sessions, candidates, requirements, the NFR walk, questions. */
      elicitationFor: (itemId) => elicitation.view(itemId),
      /** Every spec's elicitation in words (the Business analyst's home). */
      elicitations: () => elicitation.all(),
      /** A decision on a candidate requirement from another app: { itemId, candidateId, decision, into?, reason?, actor } (agents refused). */
      decideCandidate: (input) => elicitation.decide(input),
      /** A spec's accepted requirements, each with its sources and who accepted it. */
      requirementsFor: (itemId) => elicitation.requirementsFor(itemId),
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
        return adr ? { id: adr.id, title: adr.title ?? adr.id, itemId: adr.itemId, status: adr.status ?? null, href: `${DESIGN_PATH}/architecture/${adr.itemId}` } : null;
      },
      /** The item's gates with the decisions still open on them: { gates, proposedAdrs, standards }, or null. */
      architectureFor: (itemId) => architecture.summaryFor(itemId).catch(() => null),
      /**
       * What the Design section works from (Phase 16c): the spec, parsed ({ problem, goals, stories, acceptanceCriteria,
       * … }), its repositories, the container view's containers and relations, the quality attributes and the ADRs.
       * Null when there is no spec for the item.
       */
      designInputs: async (itemId) => {
        const spec = await repos.specs.get(itemId).catch(() => null);
        if (!spec) return null;
        const [diagram, qa, adrs] = await Promise.all([
          architecture.diagram(itemId).catch(() => null),
          architecture.qualityAttributes(itemId).catch(() => null),
          architecture.adrs(itemId).catch(() => []),
        ]);
        return {
          itemId, title: spec.title, product: spec.product ?? null, version: spec.version ?? null,
          // The spec's own (confirmed in Architecture), else its product's defaults (Phase 11).
          repositories: spec.repositories?.length ? spec.repositories : (await catalogue.defaultsFor(spec.product).catch(() => null))?.repositories ?? [],
          spec: parseSpec(spec.body),
          containers: (diagram?.nodes ?? []).map(({ id, kind, label, tech, description, status }) => ({ id, kind, label, tech, description, status })),
          relations: (diagram?.edges ?? []).map(({ from, to, label, tech }) => ({ from, to, label, tech })),
          qualityAttributes: qa?.attributes ?? [],
          adrs: adrs.map(({ id, title, status }) => ({ id, title, status })),
        };
      },
      /** The quality attributes that become Software Factory gates on every PR for this item. */
      gatesFor: async (itemId) => (await architecture.qualityAttributes(itemId).catch(() => null))?.attributes ?? [],
      /**
       * Where an item sits (Phase 17): { product, portfolio, valueStream, feature, epic } for a spec or an idea, from its
       * product and its feature; null when it is neither. Metrics places spend with it.
       */
      placeOf: async (itemId) => {
        const record = /^IDEA-/.test(String(itemId)) ? await repos.ideas.get(itemId).catch(() => null) : await repos.specs.get(itemId).catch(() => null);
        if (!record) return null;
        const c = (await repos.catalogue.get()) ?? {};
        const product = (c.products ?? []).find((p) => String(p.name).toLowerCase() === String(record.product ?? '').toLowerCase());
        const place = record.feature ? await hierarchy.placeOf(record.feature).catch(() => null) : null;
        return { product: record.product ?? null, portfolio: product?.portfolio ?? place?.portfolio ?? null, valueStream: product?.valueStream ?? place?.valueStream ?? null, feature: place?.feature ?? null, epic: place?.epic ?? null };
      },
      /** The portfolios and their value streams (Platform's budgets by portfolio, Metrics). */
      portfolios: async () => (await catalogue.view()).portfolios.map((p) => ({ id: p.id, name: p.name, valueStreams: p.valueStreams.map((v) => v.name) })),
      /** Every open idea's and every epic's business case, in words (the Business owner's home). */
      businessCases: () => businessCases.all(),
      /** The work hierarchy: { epics, features } (Phase 17). */
      hierarchy: () => hierarchy.view(),
      /** The spec's readiness and the standards check, in NooblyJS's one shape (Phase 16f). */
      checksFor: (itemId) => productChecks.checksFor(itemId),
      /** The spec, its goals, decisions and quality attributes, linked to the item: { nodes, links } (Phase 16f). */
      trace: (itemId) => productChecks.trace(itemId),
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
