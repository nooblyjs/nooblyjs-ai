// Drift (product.md §3.11): an environment that no longer matches its design, because someone changed it by hand.
// It is found, recorded and shown; it is never repaired automatically. A person either restores the environment
// from the design (a run) or keeps the change, which makes a new design version that needs approval.
import { KIND_LABEL, newId } from '../util/ids.js';
import { HttpError, conflict, notFound } from '../util/errors.js';
import { peopleOnly, needs } from '../util/http.js';
import { ago } from './views.js';

export function createDrift({ repos, host, provisioner, designs, runs, approvals = null, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const isOpen = (d) => d.status === 'open' || d.status === 'restoring';

  const view = (d) => ({
    id: d.id,
    environment: d.environment,
    designId: d.designId,
    resource: d.resource,
    setting: d.setting,
    expected: d.expected,
    actual: d.actual,
    summary: d.summary,
    detail: d.detail,
    status: d.status,
    statusText: { open: 'Waiting for a decision', restoring: 'Restoring from the design', restored: 'Restored from the design', accepted: 'Kept, and the design was updated' }[d.status] ?? d.status,
    found: ago(d.foundAt, now()),
    href: `${mountPath}/environments/${d.environment}`,
  });

  async function open(id, action, person) {
    await peopleOnly(host, person, action);
    const drift = await repos.drift.get(id);
    if (!drift) throw notFound(`No drift ${id}.`);
    if (drift.status !== 'open') throw conflict('This drift has already been dealt with.');
    const env = await repos.environments.get(drift.environment);
    if (!env) throw notFound(`The environment ${drift.environment} is gone.`);
    return { drift, env };
  }

  /** Puts the environment back to its design: a run, under the same apply rule as any other change to that kind. */
  async function restore(id, person) {
    const action = 'restore an environment from its design';
    const { drift, env } = await open(id, action, person);
    const rules = await repos.config.applyRules();
    const rule = rules.kinds?.[env.kind] ?? 'approval';
    if (rule === 'release') throw new HttpError(422, 'release_only', 'Production only changes through a release, with two approvers.');
    await needs(host, person, rule === 'approval' ? rules.approval?.permission ?? 'change-repo-access' : 'draft', action);
    const design = await designs.at(drift.designId, env.designVersion);
    if (!design) throw notFound(`Design ${drift.designId} v${env.designVersion} is missing.`);
    if (env.status === 'provisioning') throw conflict(`${env.name} is being provisioned. Try again when that run has finished.`);
    await runs.gate(person);

    await repos.drift.update(id, (d) => ({ ...d, status: 'restoring', decidedBy: person.id, decidedAt: iso() }));
    const run = await runs.start({ environment: env, design, reason: `Restore ${env.name} from design ${design.id} v${design.version}`, actor: person, approvedBy: person, driftId: id });
    return { drift: view(await repos.drift.get(id)), run: runs.view(run) };
  }

  /** Keeps what was changed by hand: the design gets a new version with that value, and waits for approval again. */
  async function keep(id, person) {
    const action = 'keep a change made by hand and update the design';
    const { drift, env } = await open(id, action, person);
    await needs(host, person, 'draft', action);
    const current = await designs.load(drift.designId);
    await repos.designs.keepVersion(current);
    const design = await repos.designs.update(drift.designId, (d) => ({
      ...d,
      version: d.version + 1,
      status: 'waiting-approval',
      updatedAt: iso(),
      draftedBy: { id: person.id, name: person.name },
      draftedAt: iso(),
      resources: d.resources.map((r) => (r.key === drift.resource ? { ...r, settings: { ...r.settings, [drift.setting]: drift.actual } } : r)),
      // Sign-offs that came with an architecture decision still stand; a person's approval is asked for again.
      approvals: (d.approvals ?? []).map((a) => (a.via ? a : { role: a.role, state: 'waiting' })),
      body: `${d.body.trim()}\n\nVersion ${d.version + 1} keeps ${drift.setting} = ${drift.actual} on ${drift.resourceName ?? drift.resource}, changed by hand on ${env.name}.\n`,
    }));
    await repos.environments.update(env.name, (e) => {
      const next = { ...e, designVersion: design.version };
      delete next.observed;
      return next;
    });
    await repos.drift.update(id, (d) => ({ ...d, status: 'accepted', decidedBy: person.id, decidedAt: iso(), resolvedAt: iso(), designVersion: design.version }));
    await host.events.emit('drift.accepted', { driftId: id, environment: env.name, designId: design.id, version: design.version }, { actor: person.id });
    await host.events.emit('infra_design.updated', { designId: design.id, version: design.version, itemId: design.itemId ?? null, reason: 'drift kept' }, { actor: person.id });
    const started = await designs.syncAutomatic(design, person);
    // The new version waits for approval again: on Home · Approvals too.
    await approvals?.sync(design.id);
    return { drift: view(await repos.drift.get(id)), design: designs.summary(design, person), runs: started.map(runs.view) };
  }

  /** Compares one environment with its design and records anything new. */
  async function check(name, actor) {
    const env = await repos.environments.get(name);
    if (!env) throw notFound(`No environment called ${name}.`);
    const design = env.designId ? await designs.at(env.designId, env.designVersion) : null;
    const known = (await repos.drift.list()).filter((d) => d.environment === name && isOpen(d));
    const found = [];
    for (const f of await provisioner.detectDrift(env, design)) {
      if (known.some((d) => d.resource === f.resource && d.setting === f.setting)) continue;
      const record = {
        id: newId('drf'),
        environment: name,
        designId: env.designId,
        ...f,
        summary: `${f.resourceName} ${f.setting} changed by hand`,
        short: `Drift on ${f.resourceName} config`,
        detail: `${f.resourceName} ${f.setting} was changed by hand and no longer matches design ${env.designId}.`,
        status: 'open',
        foundAt: iso(),
      };
      await repos.drift.write(record);
      await host.events.emit('drift.detected', { driftId: record.id, environment: name, kind: env.kind, designId: env.designId, summary: record.summary }, { actor: actor?.id ?? null });
      found.push(view(record));
    }
    return { environment: name, kindLabel: KIND_LABEL[env.kind], found, open: known.length + found.length };
  }

  return {
    restore,
    keep,
    check,
    view,
    async list({ status = 'open' } = {}) {
      return (await repos.drift.list())
        .filter((d) => (status === 'all' ? true : status === 'open' ? isOpen(d) : d.status === status))
        .sort((a, b) => String(b.foundAt).localeCompare(String(a.foundAt)))
        .map(view);
    },
  };
}
