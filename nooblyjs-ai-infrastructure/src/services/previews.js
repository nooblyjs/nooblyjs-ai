// NooblyJS Phase 21, roadmap I8: PREVIEWS FROM PULL REQUESTS (product.md §3.10). When the lifecycle records a new pull
// request (`pr.recorded`) on a repository a design serves (its `repos`), a preview environment is made for it from that
// design (Preview applies automatically, so no person approves it); the Factory's Test section runs its suites once it
// is provisioned. When the pull request merges (`pr.merged`) the preview is destroyed. A repository no design serves
// gets no preview, and the event says why.
import { KIND_LABEL } from '../util/ids.js';
import { blocking } from './policy-checks.js';

const SYSTEM = { id: 'infrastructure', name: 'Infrastructure', kind: 'app' };
/** PR-031-1-1 → pr-031-1-1. */
export const previewName = (prId) => `pr-${String(prId).toLowerCase().replace(/^pr-/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function createPreviews({ repos, host, log, designs, runs, now }) {
  const iso = () => new Date(now()).toISOString();
  const emit = (type, payload) => host.events.emit(type, { system: 'infrastructure', ...payload }, { actor: SYSTEM.id });

  /** The design that serves this repository (the first by id), or null. */
  async function designFor(repo) {
    const short = String(repo ?? '').split('/').pop();
    return (await repos.designs.list()).filter((d) => (d.repos ?? []).map((r) => String(r).split('/').pop()).includes(short)).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  }

  /** A new pull request: its preview. Once per pull request; a new commit on it changes nothing here. */
  async function onPrRecorded(payload = {}) {
    const prId = payload.itemId;
    if (!prId || payload.itemType !== 'pr') return null;
    const name = previewName(prId);
    if (await repos.environments.get(name)) return null;
    const pr = await host.service?.('workflows')?.item?.({ itemId: prId }).catch(() => null);
    const repo = pr?.pr?.repo ?? null;
    const design = repo ? await designFor(repo) : null;
    if (!design) {
      await emit('environment.preview_skipped', { itemId: payload.parentId ?? null, pullRequestId: prId, repo, summary: `made no preview for ${prId}: no infrastructure design serves ${repo ?? 'its repository'}` });
      return null;
    }
    const found = { product: design.product };
    const failed = blocking(await designs.policyChecks(design, 'preview'));
    if (failed.length) {
      await emit('environment.preview_skipped', { itemId: payload.parentId ?? null, pullRequestId: prId, repo, summary: `made no preview for ${prId}: a policy check is failing (${failed.map((c) => c.text).join('; ')})` });
      return null;
    }
    const env = {
      name, kind: 'preview', product: found.product, repo, prId, storyId: pr?.parentId ?? payload.parentId ?? null,
      note: `${prId} · ${pr?.title ?? ''}`.trim(), lifetime: 'destroys on merge', url: `https://${name}.preview.${found.product}.noobly.invalid`,
      designId: design.id, designVersion: design.version, status: 'provisioning', tests: [], costPerDay: await designs.estimate(design, 'preview'), createdAt: iso(),
    };
    await repos.environments.write(env);
    await emit('environment.preview_opened', { environment: name, kind: 'preview', itemId: env.storyId, pullRequestId: prId, repo, summary: `opened the preview ${name} for ${prId} on ${repo}` });
    try {
      await runs.start({ environment: env, design, reason: `Preview for ${prId}`, actor: SYSTEM });
    } catch (err) {
      log.warn(`preview ${name}: ${err.message}`);
      await repos.environments.update(name, (e) => e && { ...e, status: 'failed', failedReason: err.message });
    }
    return repos.environments.get(name);
  }

  /** The pull request merged: its preview goes. */
  async function onPrMerged(payload = {}) {
    const prId = payload.pullRequestId;
    if (!prId) return null;
    const name = previewName(prId);
    const env = await repos.environments.get(name);
    if (!env || env.status === 'destroyed') return null;
    const why = `${prId} merged`;
    await repos.environments.update(name, (e) => e && { ...e, status: 'destroyed', destroyedAt: iso(), destroyedBy: SYSTEM, destroyedReason: why });
    await host.events.emit('environment.destroyed', {
      system: 'infrastructure', environment: name, kind: 'preview', designId: env.designId ?? null, reason: why, itemId: env.storyId ?? null, pullRequestId: prId,
      summary: `destroyed ${KIND_LABEL.preview} environment ${name}: ${why}`,
    }, { actor: SYSTEM.id });
    return { environment: name, status: 'destroyed' };
  }

  return { onPrRecorded, onPrMerged };
}
