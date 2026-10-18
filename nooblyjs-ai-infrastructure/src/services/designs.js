// Infrastructure designs (product.md §3): a versioned description of what an item needs, drafted from its
// architecture. This file reads them for the screens and takes a person's decision on one.
//
// The decision is recorded on the design here. It moves to the NooblyJS lifecycle engine (targets, escalation, Home · Approvals)
// when that app has an approval type for infrastructure (roadmap I3).
import { KINDS, KIND_LABEL, isKind } from '../util/ids.js';
import { HttpError, badRequest, conflict, notFound, unprocessable } from '../util/errors.js';
import { checkIfMatch, etagOf, peopleOnly, needs } from '../util/http.js';
import { checkPolicies, blocking } from './policy-checks.js';
import { codeFor } from './code.js';
import { designStatus, approvalView, resourcesByLayer, money, ago } from './views.js';
import { who } from './runs.js';

export function createDesigns({ repos, host, provisioner, cost, runs, approvals = null, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();

  async function load(id) {
    const design = await repos.designs.get(id);
    if (!design) throw notFound(`No design ${id}.`);
    return design;
  }

  /** The design as it was at a version: the current one, or a kept earlier one. */
  async function at(id, version) {
    const design = await load(id);
    if (design.version === version) return design;
    return (await repos.designs.versions(id)).find((v) => v.version === version) ?? null;
  }

  /** Everything the policy checks need, so every caller checks the same way. */
  async function policyChecks(design, kind) {
    const [policies, blueprints, spend, estimatePerDay] = await Promise.all([
      repos.config.policies(), repos.config.blueprints(), cost.month(), provisioner.estimateCost(design, kind),
    ]);
    return checkPolicies({ design, kind, policies, blueprints, estimatePerDay, spentUsd: spend.spentUsd, budgetUsd: spend.budgetUsd });
  }

  function summary(design, person) {
    const status = designStatus(design);
    return {
      id: design.id,
      title: design.title,
      product: design.product,
      itemId: design.itemId ?? null,
      version: design.version,
      status: design.status,
      statusText: status.text,
      tone: status.tone,
      approvedVersion: design.approvedVersion ?? null,
      draftedBy: design.draftedBy ?? null,
      draftedText: design.draftedBy ? `Drafted by ${design.draftedBy.name} from the architecture · ${ago(design.draftedAt, now())}` : '',
      href: `${mountPath}/designs/${design.id}`,
    };
  }

  /** One design for one kind of environment: resources, code, plan, cost, policy checks and approvals. */
  async function detail(id, kind, person) {
    const design = await load(id);
    const rules = await repos.config.applyRules();
    const [plan, checks, estimates] = await Promise.all([
      provisioner.plan(design, kind),
      policyChecks(design, kind),
      Promise.all(KINDS.map(async (k) => [k, await provisioner.estimateCost(design, k)])),
    ]);
    const rule = rules.kinds?.[kind] ?? 'approval';
    const alreadyApproved = design.approvedVersion === design.version && (design.approvedKinds ?? []).includes(kind);
    const canDecide = Boolean(person) && person.kind !== 'agent' && await host.can(person.accessRole, rules.approval?.permission);
    const decidable = rule === 'approval' && !alreadyApproved && ['waiting-approval', 'approved'].includes(design.status);
    return {
      ...summary(design, person),
      etag: etagOf(design),
      kind,
      kindLabel: KIND_LABEL[kind],
      kinds: KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], rule: rules.kinds?.[k] ?? 'approval' })),
      blueprint: design.blueprint ?? null,
      builtFrom: design.builtFrom ?? [],
      layers: resourcesByLayer(design),
      code: codeFor(design, kind),
      plan,
      costEstimate: estimates.map(([k, usd]) => ({ kind: k, label: k === 'preview' ? 'Preview (each PR)' : KIND_LABEL[k], usd, text: `${k === 'production' ? '~' : ''}${money(usd)}`, current: k === kind })),
      policyChecks: checks,
      approvals: (design.approvals ?? []).map((a) => approvalView(a, person, { canDecide })),
      applyRule: rule,
      applyNote: 'Preview and Dev apply automatically. Test and Staging need one approval; Production only changes through a release.',
      decision: {
        allowed: decidable && canDecide && blocking(checks).length === 0,
        canRequestChanges: canDecide && design.status === 'waiting-approval',
        label: `Approve & provision ${KIND_LABEL[kind]}`,
        // Why the button is off, in words. The API enforces the same rules whatever the page shows.
        reason: !decidable
          ? rule === 'release' ? 'Production only changes through a release.'
            : rule === 'automatic' ? `${KIND_LABEL[kind]} applies automatically; there is nothing to approve.`
              : alreadyApproved ? `Version ${design.version} is already approved for ${KIND_LABEL[kind]}.` : 'This design is not waiting for a decision.'
          : !canDecide ? `Only the ${(rules.approval?.role ?? 'approver').toLowerCase()} can decide.`
            : blocking(checks).length ? 'A policy check is failing.' : '',
      },
    };
  }

  /**
   * A person's decision on the current version: approve it for one kind of environment (which starts the run),
   * or ask for changes. Agents are always refused.
   */
  /**
   * `via: 'workflows'`: the decision was taken on Home · Approvals, and the lifecycle engine records it itself once
   * this returns; otherwise the engine's open approval is closed here.
   */
  async function decide(id, { decision, kind, comment } = {}, person, ifMatch, { via = null } = {}) {
    const action = `${decision === 'approve' ? 'approve' : 'decide on'} infrastructure design ${id}`;
    await peopleOnly(host, person, action);
    const rules = await repos.config.applyRules();
    await needs(host, person, rules.approval?.permission ?? 'change-repo-access', action);
    if (!['approve', 'request-changes'].includes(decision)) throw badRequest('decision must be "approve" or "request-changes".');
    if (decision === 'request-changes' && !String(comment ?? '').trim()) throw badRequest('Say what should change.');

    let design = await load(id);
    checkIfMatch(ifMatch, design);

    if (decision === 'request-changes') {
      if (design.status !== 'waiting-approval') throw conflict('This design is not waiting for a decision.');
      design = await repos.designs.update(id, (d) => ({
        ...d,
        status: 'changes-requested',
        updatedAt: iso(),
        approvals: (d.approvals ?? []).map((a) => (a.state === 'waiting' && !a.via ? { ...a, personId: person.id, name: person.name, state: 'changes-requested', comment: String(comment).trim(), at: iso() } : a)),
      }));
      await host.events.emit('infra_design.changes_requested', { designId: id, version: design.version, itemId: design.itemId ?? null, comment: String(comment).trim() }, { actor: person.id });
      await afterDecision(design, { kind, decision, person, comment, via });
      return { design: summary(design, person), runs: [], text: 'Changes requested. The design goes back to its author.' };
    }

    if (!isKind(kind)) throw badRequest('Say which kind of environment to provision: test or staging.');
    const rule = rules.kinds?.[kind];
    if (rule === 'release') throw new HttpError(422, 'release_only', 'Production only changes through a release, with two approvers.');
    if (rule === 'automatic') throw unprocessable(`${KIND_LABEL[kind]} applies automatically; there is nothing to approve.`);
    const alreadyApproved = design.approvedVersion === design.version && (design.approvedKinds ?? []).includes(kind);
    if (alreadyApproved || !['waiting-approval', 'approved'].includes(design.status)) throw conflict('This design is not waiting for a decision.');

    // A paused budget is the reason before any policy check (the budget policy would fail too, less clearly).
    await runs.gate(person);
    const failed = blocking(await policyChecks(design, kind));
    if (failed.length) throw new HttpError(422, 'policy_failed', `A policy check is failing: ${failed.map((c) => c.text).join('; ')}.`, { failed });

    design = await repos.designs.update(id, (d) => ({
      ...d,
      status: 'approved',
      updatedAt: iso(),
      approvedKinds: d.approvedVersion === d.version ? [...new Set([...(d.approvedKinds ?? []), kind])] : [kind],
      approvedVersion: d.version,
      approvals: (d.approvals ?? []).map((a) => (a.state !== 'approved' ? { role: a.role, personId: person.id, name: person.name, state: 'approved', at: iso() } : a)),
    }));
    // The approved version is kept as a file of its own and never rewritten.
    await repos.designs.keepVersion(design);
    await host.events.emit('infra_design.approved', { designId: id, version: design.version, kind, itemId: design.itemId ?? null }, { actor: person.id });

    // Provision what was approved, then bring the automatic kinds up to this version.
    const started = [];
    const environments = (await repos.environments.list()).filter((env) => env.designId === id);
    for (const env of environments.filter((e) => e.kind === kind && e.status !== 'provisioning')) {
      started.push(await runs.start({ environment: env, design, reason: `Design ${id} v${design.version} approved for ${KIND_LABEL[kind]}`, actor: person, approvedBy: person }));
    }
    started.push(...await syncAutomatic(design, person));
    await afterDecision(design, { kind, decision, person, via });
    const names = [...new Set(started.map((r) => r.environment))];
    return {
      design: summary(design, person),
      runs: started.map(runs.view),
      text: `Approved for ${KIND_LABEL[kind]}.${names.length ? ` Provisioning ${names.join(', ')}.` : ''}`,
    };
  }

  /** Keeps the lifecycle engine approvals in step with the decision (approvals.js). Never fails the decision. */
  async function afterDecision(design, { kind, decision, person, comment = null, via }) {
    if (!approvals) return;
    if (via !== 'workflows') await approvals.decidedHere(design, { kind, decision, person, comment });
    await approvals.sync(design.id, { keep: via === 'workflows' ? kind : null });
  }

  /**
   * Preview and Dev apply automatically: environments of those kinds that are behind this version get a run, as
   * long as the version's policy checks pass and nobody is waiting to resolve drift on them.
   */
  async function syncAutomatic(design, actor) {
    const rules = await repos.config.applyRules();
    const [environments, drifts] = await Promise.all([repos.environments.list(), repos.drift.list()]);
    const drifted = new Set(drifts.filter((d) => d.status === 'open' || d.status === 'restoring').map((d) => d.environment));
    const started = [];
    const passes = new Map();
    for (const env of environments) {
      if (env.designId !== design.id || rules.kinds?.[env.kind] !== 'automatic') continue;
      if (env.status === 'provisioning' || env.designVersion === design.version || drifted.has(env.name)) continue;
      if (!passes.has(env.kind)) passes.set(env.kind, blocking(await policyChecks(design, env.kind)).length === 0);
      if (!passes.get(env.kind)) continue;
      try {
        started.push(await runs.start({ environment: env, design, reason: `Design ${design.id} v${design.version} applies automatically to ${KIND_LABEL[env.kind]}`, actor: who(actor) }));
      } catch (err) {
        // At the cloud budget the automatic kinds wait too; they catch up when it is raised.
        if (err.code !== 'budget_reached') throw err;
        break;
      }
    }
    return started;
  }

  return {
    load,
    at,
    detail,
    decide,
    syncAutomatic,
    policyChecks,
    summary,
    estimate: (design, kind) => provisioner.estimateCost(design, kind),
    async list(person) {
      return (await repos.designs.list()).sort((a, b) => a.id.localeCompare(b.id)).map((d) => summary(d, person));
    },
    async versions(id) {
      const design = await load(id);
      const kept = await repos.designs.versions(id);
      const all = kept.some((v) => v.version === design.version) ? kept : [...kept, design];
      return all.map((v) => ({ version: v.version, status: v.version === design.version ? design.status : v.status, draftedBy: v.draftedBy ?? null, updatedAt: v.updatedAt ?? null, current: v.version === design.version }));
    },
  };
}
