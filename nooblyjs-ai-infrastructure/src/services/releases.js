// NooblyJS Phase 22, roadmap I10: PRODUCTION CHANGES ONLY THROUGH A RELEASE (product.md §3.10). NooblyJS Operations'
// deployer applies a release here: Infrastructure checks the release's `deploy` approval in the lifecycle engine (given
// by two people, for that release) before Production changes, keeps what was there for a rollback in one action, and
// says each step. Anything else that tries to change Production is refused and audited.
import { HttpError, notFound } from '../util/errors.js';

const SYSTEM = { id: 'infrastructure', name: 'Infrastructure', kind: 'app' };

export function createReleases({ repos, host, now }) {
  const iso = () => new Date(now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'infrastructure', ...payload }, { actor: actor ?? SYSTEM.id });

  /** The production environment of a product's path. */
  async function productionOf(product) {
    const path = (await repos.config.promotionPaths())[product];
    const name = path?.environments?.production;
    const env = name ? await repos.environments.get(name) : null;
    if (!env || env.status === 'destroyed') throw notFound(`${product} has no production environment.`);
    return env;
  }

  /** The release's deploy approval, given by two people for this release, or a refusal that says why. */
  async function approvalOf(releaseId, approvalId) {
    const all = (await Promise.resolve(host.service?.('workflows')?.approvals?.({ type: 'deploy' })).catch(() => [])) ?? [];
    const a = all.find((x) => x.id === approvalId);
    if (!a || a.ref?.app !== 'operations' || a.ref?.id !== releaseId) throw new HttpError(422, 'no_release_approval', `There is no deploy approval for ${releaseId}: Production changes only through a release two people approved.`);
    if (a.status !== 'approved') throw new HttpError(422, 'not_approved', `${releaseId}'s deploy approval is ${a.status === 'open' ? 'still waiting' : a.status}: Production changes only through a release two people approved.`);
    return a;
  }

  /**
   * Operations' deployer applies a release to a product's Production, to `percent` of it (a pilot first, then all).
   * @param {{ product: string, releaseId: string, approvalId: string, version: string, deployed: Array<{ service, version }>, percent: number, by?: object }} input
   */
  async function deployRelease({ product, releaseId, approvalId, version, deployed = [], percent = 100, by = null } = {}) {
    await approvalOf(releaseId, approvalId);
    const env = await productionOf(product);
    const pct = Math.max(1, Math.min(100, Math.round(Number(percent) || 100)));
    const at = iso();
    const before = env.rollout?.releaseId === releaseId ? env.rollout.previous : { deployed: env.deployed ?? [], releaseId: env.rollout?.releaseId ?? null };
    const updated = await repos.environments.update(env.name, (e) => e && {
      ...e, deployed, deployedAt: at, rollout: { releaseId, version, percent: pct, approvalId, previous: before, at },
      releases: [...(e.releases ?? []), { releaseId, version, percent: pct, at, by: by ? { id: by.id, name: by.name } : null }],
    });
    await emit('environment.deployed', {
      environment: env.name, kind: 'production', product, releaseId, version, percent: pct, deployed,
      summary: `deployed ${releaseId} (${version}) to ${pct}% of ${env.name}: ${deployed.map((d) => `${d.service} ${d.version}`).join(' · ')}`,
    }, by?.id);
    return { environment: updated.name, percent: pct, deployed: updated.deployed, previous: before.deployed };
  }

  /** Rollback in one action: Production returns to what was there before the release, and says why. */
  async function rollbackRelease({ product, releaseId, reason, by = null } = {}) {
    const env = await productionOf(product);
    if (env.rollout?.releaseId !== releaseId) throw new HttpError(409, 'not_deployed', `${releaseId} is not what ${env.name} runs, so there is nothing of it to roll back.`);
    const previous = env.rollout.previous ?? { deployed: [] };
    const at = iso();
    const updated = await repos.environments.update(env.name, (e) => e && {
      ...e, deployed: previous.deployed, deployedAt: at, rollout: previous.releaseId ? { releaseId: previous.releaseId, percent: 100, at } : null,
      releases: [...(e.releases ?? []), { releaseId, rolledBack: true, reason, at, by: by ? { id: by.id, name: by.name } : null }],
    });
    await emit('environment.rolled_back', {
      environment: env.name, kind: 'production', product, releaseId, reason, deployed: updated.deployed,
      summary: `rolled ${env.name} back from ${releaseId} to ${updated.deployed.map((d) => `${d.service} ${d.version}`).join(' · ') || 'what was there'}: ${reason}`,
    }, by?.id);
    return { environment: updated.name, deployed: updated.deployed };
  }

  /** Anything else that tries to change Production: refused, audited. */
  async function refuseDirect(name, person) {
    const env = await repos.environments.get(name);
    if (!env || env.status === 'destroyed') throw notFound(`No environment called ${name}.`);
    const what = `apply to ${name} without a release`;
    await host.audit.record({ actor: person?.id ?? null, action: 'deploy.refused', target: name, reason: env.kind === 'production' ? 'Production changes only through a release' : 'other environments change through promotion' });
    await emit('environment.deploy_refused', { environment: name, kind: env.kind, summary: `refused to ${what}` }, person?.id);
    if (env.kind === 'production') throw new HttpError(422, 'release_only', `${name} is Production: it changes only through a release with two approvers (NooblyJS Operations). Nothing was applied.`);
    throw new HttpError(422, 'promote_instead', `${name} changes through promotion along its path, not by applying a version to it.`);
  }

  /**
   * What a release of an item would put in production: the product of the item's design, what its Staging runs (the
   * last environment before Production on its path), and what Production runs now.
   */
  async function candidate({ itemId } = {}) {
    const design = (await repos.designs.list()).find((d) => d.itemId === itemId);
    if (!design?.product) return null;
    const path = (await repos.config.promotionPaths())[design.product];
    if (!path) return null;
    const kinds = Object.keys(path.environments ?? {}).filter((k) => k !== 'production');
    const before = kinds.length ? await repos.environments.get(path.environments[kinds.at(-1)]) : null;
    const prod = path.environments.production ? await repos.environments.get(path.environments.production) : null;
    return {
      product: design.product, label: path.label ?? design.product, release: path.release ?? null,
      from: before ? { name: before.name, kind: before.kind, deployed: before.deployed ?? [], tests: before.tests ?? [], testRunId: before.testRunId ?? null } : null,
      production: prod ? { name: prod.name, deployed: prod.deployed ?? [], rollout: prod.rollout ?? null } : null,
    };
  }

  return { deployRelease, rollbackRelease, refuseDirect, candidate };
}
