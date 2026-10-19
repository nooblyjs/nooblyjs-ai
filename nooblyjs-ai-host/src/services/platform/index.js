// Platform (product.md §5.7): repositories, model routing, budgets, guardrails, environments and secrets, in one
// place, and the one check every agent action passes before it starts (checkAgentWork). Other apps reach it as
// host.service('platform'); none of them reads data/platform/ itself. Every file is read fresh (files.js), so a
// change applies to the next check without a restart.
import { HttpError } from '../../util/errors.js';
import { now as nowIso } from '../../util/dates.js';
import { createFiles } from './files.js';
import { createRepositories } from './repositories.js';
import { createRoutes } from './routes.js';
import { createBudgets, SPEND_EVENTS, systemKey } from './budgets.js';
import { createGuardrails } from './guardrails.js';
import { createContainers } from './containers.js';
import { money } from './budgets.js';

const SECRETS = ['platform', 'secrets.yaml'];
const ENVIRONMENTS = ['platform', 'environments.yaml'];
// vault:<scope>/<NAME>. Agents and previews get staging values only (product.md §3.8).
const REF = /^vault:(dev|test|staging|preview|production)\/[A-Z][A-Z0-9_]{0,63}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function createPlatform({ store, events, auditLog, clock, services = new Map(), production = false, log }) {
  const files = createFiles(store);
  const repositories = createRepositories({ store });
  const routes = createRoutes({ files, production });
  // A budget whose spend is another app's: the cloud budget's is Infrastructure's cost ledger (Phase 9a).
  const external = async (source) => {
    const app = services.get(source);
    // cloudSpend(), not metrics(): metrics() reads the budget from here, which would come straight back.
    if (typeof app?.cloudSpend !== 'function') return null;
    return Number(await app.cloudSpend()) || 0;
  };
  const budgets = createBudgets({ files, external });
  const guardrails = createGuardrails({ files });
  const at = () => nowIso(clock);
  const containers = createContainers({ files, clock, events, services, log });

  /**
   * Whether an agent may start this work now. Returns { ok: true, route, repository } or { ok: false, code, message }.
   * Checks, in order: the route's provider is allowed here, the repository allows it, the budget isn't reached.
   * `needs` is what the work does to the repository: 'read' (a teammate reading it) or 'openPrs' (a Factory run).
   * A refusal is audited here, so it is recorded whoever asked.
   */
  async function checkAgentWork({ system = null, workType = null, repo = null, needs = 'read', teammateId = null, itemId = null } = {}) {
    const route = workType ? await routes.forWorkType(workType) : null;
    let repository = null;
    let refusal = null;
    if (route && !routes.allowed(route.provider)) {
      refusal = { code: 'provider_not_allowed', message: `The "${route.label}" route uses the direct ${route.provider} API, which is refused in production. An Owner can move it to Bedrock, Vertex AI or Azure in Platform · Settings · Models.` };
    }
    if (!refusal && repo) {
      repository = await repositories.get(repo);
      refusal = repoRefusal(repo, repository, needs);
    }
    if (!refusal) {
      const b = await budgets.refusal(system, at());
      if (b) refusal = { code: b.code, message: b.message };
      // The cloud budget's spend isn't on the ledger, so the first refusal is where it is said (once).
      if (b?.budget === 'cloud') await sayReached().catch((err) => log?.warn?.(`platform: budget.reached: ${err.message}`));
    }
    if (refusal) {
      await auditLog.record({
        actor: teammateId ?? 'platform', action: 'agent.work_refused', target: repository?.name ?? repo ?? system ?? null,
        code: refusal.code, reason: refusal.message, system, workType, itemId, teammateId, repo: repository?.name ?? repo ?? null,
      }).catch((err) => log?.warn?.(`platform: audit of a refusal failed: ${err.message}`));
      return { ok: false, ...refusal };
    }
    return { ok: true, route, repository };
  }

  // ---------- Spend: every costed agent action, by system and route ----------

  async function onSpend(event) {
    const p = event.payload ?? {};
    const cost = Number(p.costUsd);
    if (!(cost > 0)) return;
    const route = p.workType ? await routes.forWorkType(p.workType) : null;
    await budgets.addSpend({ system: p.system, costUsd: cost, routeId: route?.id ?? null, at: event.at ?? at() });
    await sayReached();
  }

  /** Emits budget.reached (and audits it) for each limit newly reached in its period. */
  async function sayReached({ again = [], actor = 'platform' } = {}) {
    const { fresh, pauseOnLimit } = await budgets.newlyReached(at(), { again });
    for (const r of fresh) {
      const cap = r.period === 'day' ? 'daily cap' : 'budget';
      const payload = {
        system: 'platform', budget: r.key, label: r.label, limitUsd: r.limit, spentUsd: r.spent, period: r.period, paused: pauseOnLimit,
        summary: `${r.label} reached its ${money(r.limit)} ${cap} (${money(r.spent)} spent)${pauseOnLimit ? (r.key === 'cloud' ? ': new provisioning is paused' : ': its agents are paused') : ''}`,
      };
      await events.emit('budget.reached', payload, { actor });
      await auditLog.record({ actor, action: 'budget.reached', target: `budget:${r.key}`, ...payload });
    }
    return fresh;
  }

  // The listener returns its promise, so a caller that awaits listeners (tests) knows when the spend is recorded.
  const unsubscribe = SPEND_EVENTS.map((type) => events.on(type, (event) => onSpend(event)
    .catch((err) => log?.error?.(`platform: spend from ${event.type} not recorded: ${err.message}`))));

  // ---------- Secrets (references only) and environments ----------

  async function secretList() {
    return ((await files.yaml(SECRETS))?.secrets ?? []).map((s) => ({ ...s, scope: String(s.ref).slice(6).split('/')[0] }));
  }

  async function addSecret({ repo, name, ref }) {
    const repository = await repositories.get(repo);
    if (!repository) throw new HttpError(404, 'repository_not_found', `No connected repository "${repo}".`);
    const n = String(name ?? '').trim();
    const r = String(ref ?? '').trim();
    if (!SECRET_NAME.test(n)) throw new HttpError(400, 'invalid_secret', 'A secret name is upper case letters, digits and _, e.g. REDIS_URL.');
    if (!REF.test(r)) throw new HttpError(400, 'invalid_reference', 'A secret is a reference such as vault:staging/REDIS_URL, never a value.');
    if (r.startsWith('vault:production/')) {
      throw new HttpError(422, 'production_secret_refused', 'Agents never see production secrets. Preview environments get staging values only.');
    }
    let added;
    await files.updateYaml(SECRETS, (doc) => {
      const next = doc ?? { secrets: [] };
      next.secrets ??= [];
      if (next.secrets.some((s) => s.repo === repository.name && s.name === n)) throw new HttpError(409, 'secret_exists', `${repository.name} already maps ${n}.`);
      next.secrets.push((added = { repo: repository.name, name: n, ref: r }));
      return next;
    });
    return added;
  }

  async function removeSecret({ repo, name }) {
    const repository = await repositories.get(repo);
    let removed = null;
    await files.updateYaml(SECRETS, (doc) => {
      const next = doc ?? { secrets: [] };
      const i = (next.secrets ?? []).findIndex((s) => s.repo === (repository?.name ?? repo) && s.name === name);
      if (i < 0) throw new HttpError(404, 'secret_not_found', `No secret ${name} on ${repo}.`);
      [removed] = next.secrets.splice(i, 1);
      return next;
    });
    return removed;
  }

  /** Environments: Infrastructure's when it is hosted (it owns them), else data/platform/environments.yaml. */
  async function environments() {
    const infra = services.get('infrastructure');
    if (typeof infra?.environments === 'function') {
      try {
        const list = await infra.environments();
        return { source: 'infrastructure', href: '/factory/infrastructure', ...list };
      } catch (err) {
        log?.warn?.(`platform: Infrastructure's environments are unavailable: ${err.message}`);
      }
    }
    const doc = (await files.yaml(ENVIRONMENTS)) ?? {};
    return { source: 'platform', cloud: doc.cloud ?? '[PLACEHOLDER cloud]', region: doc.region ?? '[PLACEHOLDER region]', environments: doc.environments ?? [] };
  }

  return {
    files,
    repositories,
    routes,
    budgets,
    guardrails,
    checkAgentWork,
    sayReached,
    /** The route for a work type, or null. */
    route: (workType) => routes.forWorkType(workType),
    /** A system's budget limit in USD (monthly; the Software Factory's is daily), or null when it has none. */
    budgetFor: async (system) => (await budgets.status(at())).systems.find((s) => s.key === systemKey(system))?.limit ?? null,
    /** What a system has spent this month, in USD (from the spend ledger). */
    spendFor: async (system) => (await budgets.status(at())).systems.find((s) => s.key === systemKey(system))?.monthSpent ?? 0,
    /** One guardrail ({ key, on, … }), or null. */
    guardrail: (key) => guardrails.get(key),
    /** A repository by id, owner/repo or short name, or null. */
    repository: (ref) => repositories.get(ref),
    /**
     * Brings the repository list in line with Bitbucket (what the devtools service is configured to see). Reads
     * Bitbucket, writes only NooblyJS's files. Resolves { ok, added, updated, gone, missing } or { ok: false, reason }.
     */
    async importRepositories(options = {}) {
      const devtools = services.get('devtools');
      if (!devtools) return { ok: false, reason: 'not-configured', message: 'The development tools service is not running.' };
      const found = await devtools.repositories(options);
      if (!found.ok) return found;
      const result = await repositories.importBitbucket(found, { now: at() });
      return { ok: true, ...result, missing: found.missing };
    },
    secrets: { list: secretList, add: addSecret, remove: removeSecret },
    environments,
    containers,
    close() { for (const off of unsubscribe) off(); },
  };
}

function repoRefusal(ref, repository, needs) {
  if (!repository) {
    // Not connected: agents may read it (the safe default for a repository Platform doesn't know), never change it.
    return needs === 'read' ? null : { code: 'repo_no_access', message: `${ref} is not connected in Platform · Repositories, so agents may not open pull requests on it.` };
  }
  if (repository.access === 'none' || (needs === 'read' && !repository.may.readCode)) {
    return { code: 'repo_no_access', message: `Agents have no access to ${repository.name}. An Owner can grant it in Platform · Repositories.` };
  }
  if (needs === 'openPrs' && !repository.may.openPrs) {
    return { code: 'repo_no_access', message: `Agents may not open pull requests on ${repository.name} (${repository.accessText}). An Owner can change it in Platform · Repositories.` };
  }
  return null;
}
