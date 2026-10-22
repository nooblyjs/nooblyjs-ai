// RELEASES (root product.md §3.7, roadmap Phase 22). A release is one feature, released on its own once all its stories
// have passed Test: its merged work, a version, the evidence pack, release notes the release agent drafts, a rollout plan
// (a pilot, then everyone) and a rollback plan.
//
//   draft ──(ask for approval: refused while an open finding at or above the threshold has no accepted risk)──►
//   waiting ──(the lifecycle's deploy approval: two different people with deploy-production)──► deployed to the pilot
//   ──(a person: the next step)──► complete          piloting | complete ──(a person, with a reason)──► rolled back
//
// The deployer adapter applies each step through Infrastructure (I10), which checks the approval itself. The Jira fix
// version and a Bitbucket tag per repository are asked for through NooblyJS's write gate, recorded until it is open.
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { atLeast, isFeatureId, isItemId } from '../util/ids.js';
import { needs, peopleOnly } from '../util/http.js';

const STATUS_TEXT = {
  draft: 'Draft: ask for the deploy approval', 'waiting-approval': 'Waiting for two approvers', 'changes-requested': 'Changes asked for',
  piloting: 'In production: pilot', complete: 'In production: everyone', 'rolled-back': 'Rolled back',
};
const IN_PRODUCTION = new Set(['piloting', 'complete']);
const clean = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const versionsText = (list) => (list ?? []).map((d) => `${d.service} ${d.version}`).join(' · ') || 'nothing';

export function createReleases({ repos, host, log, policies, evidence, notes, deployer, now, mountPath, onFirstDeploy = async () => {} }) {
  const iso = () => new Date(now()).toISOString();
  const svc = (name) => host.service?.(name) ?? null;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });
  const who = (p) => (p ? { id: p.id, name: p.name ?? p.id } : null);

  async function getOr404(id) {
    const r = await repos.releases.get(id);
    if (!r) throw notFound(`There is no release ${id}.`);
    return r;
  }

  const shape = (r) => r && ({
    ...r, body: undefined, statusText: STATUS_TEXT[r.status] ?? r.status, href: `${mountPath}/releases/${r.id}`,
    inProduction: IN_PRODUCTION.has(r.status), percent: r.deployments?.filter((d) => !d.rolledBack).at(-1)?.percent ?? 0,
  });

  /** The feature and its stories as the lifecycle sees them; refused unless every story has passed Test. */
  async function featureOf(itemId, featureId) {
    const w = svc('workflows');
    if (typeof w?.featuresOf !== 'function') throw new HttpError(503, 'workflows_unavailable', 'The lifecycle engine is not running here.');
    const feature = (await w.featuresOf({ itemId })).find((f) => f.id === featureId);
    if (!feature) throw notFound(`${itemId} has no feature ${featureId}.`);
    return feature;
  }

  /**
   * A new release of one feature. Its stories must all be in Release (they passed Test); what it deploys is what the
   * product's Staging runs (Infrastructure), and its rollback is what Production runs now.
   */
  async function create(body = {}, person) {
    await needs(host, person, 'draft', 'make a release');
    const itemId = clean(body.itemId, 40);
    const featureId = clean(body.featureId, 40);
    if (!isItemId(itemId) || !isFeatureId(featureId)) throw badRequest('Name the item and the feature, like PRD-031 and FEAT-031-1.', { itemId: 'PRD-…', featureId: 'FEAT-…' });
    const feature = await featureOf(itemId, featureId);
    const behind = feature.stories.filter((st) => st.status === 'active' && st.stage !== 'release');
    if (feature.stage !== 'release') throw new HttpError(409, 'feature_not_ready', `${featureId} isn't ready to release: ${behind.map((st) => `${st.ref} is in ${st.stage}`).join(', ') || 'its stories have not passed Test'}.`);
    if ((await repos.releases.list()).some((r) => r.itemId === itemId && r.featureId === featureId && r.status !== 'rolled-back')) throw conflict(`${featureId} already has a release.`);
    const candidate = await Promise.resolve(svc('infrastructure')?.releaseCandidate?.({ itemId })).catch(() => null);
    if (!candidate?.production) throw new HttpError(409, 'no_production', `${itemId} has no infrastructure design with a Production environment, so there is nowhere to release it.`);
    const p = await policies.read();
    const storyIds = feature.stories.filter((st) => st.status === 'active').map((st) => st.id);
    const version = clean(body.version, 40) || '1.0.0';
    const name = clean(body.name, 120) || candidate.release?.name || `${feature.title} ${version}`;
    const pack = await evidence.assemble({ itemId, storyIds });
    const draft = await notes.draft({ itemId, name, version, feature, pack, person });
    const at = iso();
    const release = await repos.releases.create({
      title: name, name, version, product: candidate.product, itemId, featureId, featureTitle: feature.title, stories: storyIds,
      deploys: candidate.from?.deployed ?? [], from: candidate.from ? { environment: candidate.from.name, testRunId: candidate.from.testRunId } : null,
      production: candidate.production.name, previous: candidate.production.deployed,
      rollout: { strategy: p.rollout.strategy, steps: p.rollout.steps, featureFlags: p.featureFlags?.tool ?? null, text: p.rollout.steps.map((s) => s.label).join(', then ') },
      rollback: { text: `Return ${candidate.production.name} to ${versionsText(candidate.production.deployed)} in one action (the deployer, through Infrastructure).` },
      evidence: pack, notes: draft, status: 'draft', deployments: [], writes: [], createdBy: who(person), createdAt: at,
      history: [{ at, what: `${person.name ?? person.id} made the release of ${featureId} (${feature.title}): ${pack.text}` }],
    });
    await emit('release.created', { releaseId: release.id, itemId, featureId, version, summary: `made the release ${release.id} · ${name} (${version}) of ${featureId}` }, person);
    return shape(release);
  }

  /** Open findings at or above the threshold, with no accepted risk: they hold the release. */
  async function blockers(release) {
    const p = await policies.read();
    const pack = await evidence.assemble({ itemId: release.itemId, storyIds: release.stories });
    return { pack, holding: pack.findings.open.filter((f) => atLeast(f.severity, p.riskThreshold)), threshold: p.riskThreshold };
  }
  const holdingText = (holding) => holding.map((f) => `${f.id} (${f.severityLabel}): ${f.title}`).join('; ');

  /** Ask for the lifecycle's deploy approval: two different people with deploy-production. */
  async function requestApproval(id, person) {
    await needs(host, person, 'draft', `ask for ${id}'s deploy approval`);
    const release = await getOr404(id);
    if (!['draft', 'changes-requested'].includes(release.status)) throw conflict(`${id} is ${STATUS_TEXT[release.status].toLowerCase()}: there is no approval to ask for.`);
    const { pack, holding, threshold } = await blockers(release);
    await repos.releases.update(id, (cur) => ({ ...cur, evidence: pack }));
    if (holding.length) {
      await emit('release.refused', { releaseId: id, itemId: release.itemId, findings: holding.map((f) => f.id), summary: `${id} can't go to production: ${holdingText(holding)} is open with no accepted risk` }, person);
      throw new HttpError(422, 'risk_not_accepted', `${id} can't go to production with an open ${threshold} or worse finding and no accepted risk: ${holdingText(holding)}. Fix it, or ask Security for a risk acceptance.`, { findings: holding.map((f) => f.id) });
    }
    // The notes say what the approvers see: drafted again with the fresh evidence (an accepted risk since, say).
    const feature = await featureOf(release.itemId, release.featureId);
    const draft = await notes.draft({ itemId: release.itemId, name: release.name, version: release.version, feature, pack, person });
    await repos.releases.update(id, (cur) => ({ ...cur, notes: draft }));
    const w = svc('workflows');
    const asked = await w.requestAppApproval({
      type: 'deploy', itemId: release.itemId, title: `${release.name} to production`, subject: `${id} · ${release.name} ${release.version}`,
      ref: { app: 'operations', id, version: release.version, kind: 'release' }, link: `${mountPath}/releases/${id}`,
      context: `${release.name} (${release.version}) puts ${versionsText(release.deploys)} in ${release.production}: ${release.rollout.text}. ${pack.text}.`,
      requestedBy: { id: person.id, name: person.name ?? person.id, kind: 'person' },
    });
    const at = iso();
    const updated = await repos.releases.update(id, (cur) => ({
      ...cur, status: 'waiting-approval', approvalId: asked.approvalId, updatedAt: at,
      history: [...(cur.history ?? []), { at, what: `${person.name ?? person.id} asked for the deploy approval: two people with deploy-production` }],
    }));
    await emit('release.approval_requested', { releaseId: id, itemId: release.itemId, approvalId: asked.approvalId, summary: `asked for the deploy approval of ${id} · ${release.name}` }, person);
    return shape(updated);
  }

  /**
   * The lifecycle engine relays each person's decision on the release's deploy approval before it records it (Home ·
   * Approvals or this app): the release must still wait, and nothing above the threshold may have opened since.
   */
  async function decideApproval({ id, decision, person }) {
    // Whoever gives a deploy approval, for themselves or on someone's behalf, holds deploy-production (people only).
    await peopleOnly(host, person, `approve ${id} for production`);
    await needs(host, person, 'deploy-production', `approve ${id} for production`);
    const release = await getOr404(id);
    if (release.status !== 'waiting-approval') throw conflict(`${id} is ${STATUS_TEXT[release.status].toLowerCase()}: there is nothing to approve.`);
    if (decision === 'approve') {
      const { holding } = await blockers(release);
      if (holding.length) throw new HttpError(422, 'risk_not_accepted', `${id} can't go to production: ${holdingText(holding)} is open with no accepted risk.`);
    }
    return { id, text: null, by: person?.id ?? null };
  }

  /** The deploy approval was decided (the lifecycle's event): two approvals deploy the first step; changes go back. */
  async function onApprovalDecided(payload = {}) {
    if (payload.ref?.app !== 'operations' || payload.type !== 'deploy' || !payload.ref?.id) return null;
    const release = await repos.releases.get(payload.ref.id);
    if (!release || release.status !== 'waiting-approval') return null;
    const by = payload.by ? await host.people.get(payload.by).catch(() => null) : null;
    if (payload.outcome === 'changes-requested') {
      const at = iso();
      await repos.releases.update(release.id, (cur) => ({ ...cur, status: 'changes-requested', updatedAt: at, history: [...(cur.history ?? []), { at, what: `${by?.name ?? payload.by} asked for changes: ${payload.reason ?? ''}`.trim() }] }));
      return null;
    }
    if (payload.outcome !== 'approved') return null;
    const at = iso();
    await repos.releases.update(release.id, (cur) => ({ ...cur, status: 'approved', approvedAt: at, history: [...(cur.history ?? []), { at, what: 'Two people gave the deploy approval' }] }));
    await recordWrites(await getOr404(release.id));
    return deployStep(release.id, 0, by);
  }

  /** The release's Jira fix version and a Bitbucket tag per repository, through NooblyJS's write gate. */
  async function recordWrites(release) {
    const devtools = svc('devtools');
    if (typeof devtools?.release?.record !== 'function') return;
    const inputs = await Promise.resolve(svc('product')?.designInputs?.(release.itemId)).catch(() => null);
    const tags = [];
    for (const pr of release.evidence?.pullRequests ?? []) if (pr.merged && pr.sha && !tags.some((t) => t.slug === pr.repo)) tags.push({ slug: pr.repo, sha: pr.sha, name: `${release.product}-${release.version}` });
    const writes = await devtools.release.record({ releaseId: release.id, itemId: release.itemId, name: `${release.name} (${release.version})`, project: inputs?.jiraProject ?? null, tags }).catch((err) => {
      log.warn(`release ${release.id}: its Jira and Bitbucket writes were not asked for: ${err.message}`);
      return [];
    });
    await repos.releases.update(release.id, (cur) => ({ ...cur, writes }));
  }

  /** Deploys one step of the rollout through the deployer, and says so. */
  async function deployStep(id, index, person) {
    const release = await getOr404(id);
    const step = release.rollout.steps[index];
    const done = await deployer.deploy(release, { percent: step.percent, by: who(person) });
    const at = iso();
    const last = index >= release.rollout.steps.length - 1;
    const updated = await repos.releases.update(id, (cur) => ({
      ...cur, status: last ? 'complete' : 'piloting', step: index, updatedAt: at,
      deployments: [...(cur.deployments ?? []), { at, step: index, label: step.label, percent: done.percent, environment: done.environment, deployed: done.deployed, by: who(person), deployer: deployer.name }],
      history: [...(cur.history ?? []), { at, what: `Deployed to ${done.environment}: ${step.label} (${done.percent}%), ${versionsText(done.deployed)}, by the ${deployer.name} deployer` }],
    }));
    await emit('release.deployed', { releaseId: id, itemId: release.itemId, featureId: release.featureId, percent: done.percent, environment: done.environment, environmentKind: done.kind ?? 'production', summary: `deployed ${id} · ${release.name} to ${done.environment}: ${step.label}` }, person);
    // The feature is in production: its stories go to Operate (the lifecycle), once.
    if (index === 0) {
      await svc('workflows')?.featureDeployed?.({ itemId: release.itemId, featureId: release.featureId, releaseId: id }).catch((err) => log.warn(`release ${id}: ${err.message}`));
      // Phase 23: in production, the item's SLOs are watched and its outcome review is scheduled.
      await onFirstDeploy(await getOr404(id)).catch((err) => log.warn(`release ${id}: ${err.message}`));
    }
    return shape(updated);
  }

  /** The next step of the rollout (the pilot went well): a person with deploy-production. */
  async function advance(id, person) {
    await peopleOnly(host, person, `take ${id} to its next step`);
    await needs(host, person, 'deploy-production', `take ${id} to its next step`);
    const release = await getOr404(id);
    if (release.status !== 'piloting') throw conflict(`${id} is ${STATUS_TEXT[release.status].toLowerCase()}: there is no next step.`);
    return deployStep(id, (release.step ?? 0) + 1, person);
  }

  /** Rollback in one action, with a reason: Production returns to what it ran before. */
  async function rollback(id, body = {}, person) {
    await peopleOnly(host, person, `roll ${id} back`);
    await needs(host, person, 'deploy-production', `roll ${id} back`);
    const release = await getOr404(id);
    if (!IN_PRODUCTION.has(release.status)) throw conflict(`${id} is ${STATUS_TEXT[release.status].toLowerCase()}: it isn't in production.`);
    const reason = clean(body.reason, 500);
    if (!reason) throw badRequest('Say why it is rolled back.', { reason: 'required' });
    const done = await deployer.rollback(release, { reason, by: who(person) });
    const at = iso();
    const updated = await repos.releases.update(id, (cur) => ({
      ...cur, status: 'rolled-back', updatedAt: at, rolledBack: { at, by: who(person), reason, to: done.deployed },
      deployments: [...(cur.deployments ?? []), { at, rolledBack: true, environment: done.environment, deployed: done.deployed, by: who(person), reason }],
      history: [...(cur.history ?? []), { at, what: `${person.name ?? person.id} rolled it back: ${reason}. ${done.environment} runs ${versionsText(done.deployed)} again` }],
    }));
    await emit('release.rolled_back', { releaseId: id, itemId: release.itemId, reason, environment: done.environment, summary: `rolled ${id} · ${release.name} back: ${reason}` }, person);
    return shape(updated);
  }

  const list = async () => (await repos.releases.list()).map(shape);
  const get = async (id) => shape(await getOr404(id));
  /** Every deployment and rollback, newest first (the Deployments page). */
  async function deployments() {
    const out = [];
    for (const r of await repos.releases.list()) for (const d of r.deployments ?? []) out.push({ ...d, releaseId: r.id, release: r.name, version: r.version, href: `${mountPath}/releases/${r.id}` });
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }
  /**
   * What the write gate asks: is this a release two people approved? Product (Phase 25a) also reads what it is and its
   * notes, to tell the people who asked for it.
   */
  async function releaseFor(id) {
    const r = await repos.releases.get(id);
    return r ? { id: r.id, status: r.status, approved: Boolean(r.approvedAt), name: r.name ?? null, version: r.version ?? null, itemId: r.itemId ?? null, featureId: r.featureId ?? null, notes: r.notes?.text ?? null, href: `${mountPath}/releases/${r.id}` } : null;
  }

  return { create, requestApproval, decideApproval, onApprovalDecided, advance, rollback, list, get, deployments, releaseFor };
}
