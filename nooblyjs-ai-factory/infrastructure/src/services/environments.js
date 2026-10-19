// Environments (product.md §3.8–3.10): where the Software Factory deploys and where tests run. Each one is built
// from a design version. This file reads them for the screens and creates new ones under the apply rules.
import { KIND_LABEL, isEnvName, isKind } from '../util/ids.js';
import { HttpError, badRequest, conflict, notFound, unprocessable } from '../util/errors.js';
import { peopleOnly, needs } from '../util/http.js';
import { blocking } from './policy-checks.js';
import { envView, testsView } from './views.js';

export function createEnvironments({ repos, host, designs, runs, now, mountPath }) {
  const openDrift = (d) => d.status === 'open' || d.status === 'restoring';

  async function context() {
    const [drifts, allRuns] = await Promise.all([repos.drift.list(), repos.runs.list()]);
    return {
      driftOf: (name) => drifts.find((d) => d.environment === name && openDrift(d)) ?? null,
      runOf: (name) => allRuns.find((r) => r.environment === name && runs.inProgress(r)) ?? null,
    };
  }
  const view = (env, ctx) => envView(env, { drift: ctx.driftOf(env.name), run: ctx.runOf(env.name), now: now(), mountPath });
  const ORDER = ['preview', 'dev', 'test', 'staging', 'production'];
  const byKind = (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name);

  async function list({ kind, product } = {}) {
    const ctx = await context();
    return (await repos.environments.list())
      .filter((env) => (!kind || env.kind === kind) && (!product || env.product === product))
      .sort(byKind)
      .map((env) => view(env, ctx));
  }

  async function get(name) {
    const env = await repos.environments.get(name);
    if (!env) throw notFound(`No environment called ${name}.`);
    const ctx = await context();
    const design = env.designId ? await repos.designs.get(env.designId) : null;
    return {
      ...view(env, ctx),
      deployedServices: env.deployed ?? [],
      lifetime: env.lifetime ?? null,
      repo: env.repo ?? null,
      pr: env.pr ?? null,
      design: design && { id: design.id, title: design.title, version: env.designVersion, latestVersion: design.version, behind: design.version > env.designVersion, href: `${mountPath}/designs/${design.id}` },
      runs: await runs.list({ environment: name }),
    };
  }

  /**
   * Destroys an environment (product.md §3.10). Preview and Dev with `draft`; Test and Staging need the apply rule's
   * permission and a reason; Production only through a release. Refused while a run is going. The record is kept
   * (status destroyed) for its history; it leaves every list, and its cost stops.
   */
  async function destroy(name, { reason } = {}, person) {
    const env = await repos.environments.get(name);
    if (!env || env.status === 'destroyed') throw notFound(`No environment called ${name}.`);
    const action = `destroy ${name}`;
    await peopleOnly(host, person, action);
    const rules = await repos.config.applyRules();
    const rule = rules.kinds?.[env.kind] ?? 'approval';
    if (rule === 'release') throw new HttpError(422, 'release_only', 'Production only changes through a release, with two approvers.');
    const why = String(reason ?? '').trim();
    if (rule === 'approval') {
      await needs(host, person, rules.approval?.permission ?? 'change-repo-access', action);
      if (why.length < 3) throw badRequest(`Say why ${name} is being destroyed (it is a ${KIND_LABEL[env.kind]} environment).`, { reason: 'required' });
    } else {
      await needs(host, person, 'draft', action);
    }
    if (env.status === 'provisioning') throw conflict(`${name} is being provisioned. Cancel that run first.`);
    const at = new Date(now()).toISOString();
    await repos.environments.update(name, (e) => e && { ...e, status: 'destroyed', destroyedAt: at, destroyedBy: { id: person.id, name: person.name }, ...(why ? { destroyedReason: why } : {}) });
    await host.events.emit('environment.destroyed', {
      system: 'infrastructure', environment: name, kind: env.kind, designId: env.designId ?? null, reason: why || null,
      summary: `destroyed ${KIND_LABEL[env.kind]} environment ${name}${why ? `: ${why}` : ''}`,
    }, { actor: person.id });
    return { environment: name, status: 'destroyed', text: `${name} is destroyed. Its cost stops today.` };
  }

  /** The promotion path of one product: a tile per kind, with what is there and the one thing to know about it. */
  async function promotionPath(product) {
    const path = (await repos.config.promotionPaths())[product];
    if (!path) throw notFound(`No promotion path for ${product}.`);
    const ctx = await context();
    const environments = await repos.environments.list();
    const previews = environments.filter((env) => env.kind === 'preview' && env.product === product);
    const tiles = [{ kind: 'preview', label: 'Preview', value: `${previews.length} per-PR`, line: { text: 'Created per PR, destroyed on merge', tone: 'neutral' }, href: null }];
    for (const [kind, name] of Object.entries(path.environments ?? {})) {
      const env = environments.find((e) => e.name === name);
      if (!env) continue;
      const version = (env.deployed ?? []).find((d) => d.service === path.service)?.version;
      const drift = ctx.driftOf(name);
      const tests = testsView(env);
      const failing = tests.suites.filter((s) => !s.ok);
      let line = { text: env.next ?? tests.text, tone: 'neutral' };
      if (kind === 'production' && !version && path.release) line = { text: `Release ${path.release.name} · ${path.release.approvers} approvers`, tone: 'neutral' };
      if (failing.length) line = { text: failing.map((s) => `${s.passed} of ${s.total} ${s.suite} · ${s.total - s.passed} failing`).join(' · '), tone: 'warning' };
      if (drift) line = { text: drift.short ?? `Drift: ${drift.summary}`, tone: 'warning' };
      if (env.status === 'provisioning') line = { text: `Provisioning · ${ctx.runOf(name)?.progress ?? 0}%`, tone: 'info' };
      tiles.push({ kind, label: KIND_LABEL[kind], name, value: version ?? 'Not yet', line, href: `${mountPath}/environments/${name}` });
    }
    return { product, label: path.label ?? product, note: "A build moves right only when that environment's tests pass", tiles };
  }

  /**
   * A new environment from a design. Preview and Dev apply automatically (the latest version, if its policy checks
   * pass); Test and Staging need a person and a version approved for that kind; Production is never created here.
   */
  async function create({ name, kind, designId, repo, pr, note } = {}, person) {
    const action = `create a ${KIND_LABEL[kind] ?? ''} environment`.replace('  ', ' ');
    if (!isKind(kind)) throw badRequest('kind must be one of preview, dev, test or staging.');
    if (!isEnvName(name)) throw badRequest('Give the environment a name in lower case with dashes, like test-slots.');
    const rules = await repos.config.applyRules();
    const rule = rules.kinds?.[kind] ?? 'approval';
    if (rule === 'release') throw new HttpError(422, 'release_only', 'Production only changes through a release, with two approvers.');
    if (rule === 'approval') {
      await peopleOnly(host, person, action);
      await needs(host, person, rules.approval?.permission ?? 'change-repo-access', action);
    } else {
      await needs(host, person, 'draft', action);
    }

    const current = await designs.load(designId);
    let design = current;
    if (rule === 'approval') {
      // Every Test and Staging environment is built from a version a person approved for that kind.
      if (!current.approvedVersion || !(current.approvedKinds ?? []).includes(kind)) {
        throw new HttpError(422, 'no_approved_design', `Design ${designId} has no version approved for ${KIND_LABEL[kind]}. Approve it first.`);
      }
      design = await designs.at(designId, current.approvedVersion);
      if (!design) throw unprocessable(`The approved version v${current.approvedVersion} of ${designId} is missing.`);
    }
    // A paused budget is the reason before any policy check (the budget policy would fail too, less clearly).
    await runs.gate(person);
    const failed = blocking(await designs.policyChecks(design, kind));
    if (failed.length) throw new HttpError(422, 'policy_failed', `A policy check is failing: ${failed.map((c) => c.text).join('; ')}.`, { failed });
    if (await repos.environments.get(name)) throw conflict(`There is already an environment called ${name}.`);

    const env = {
      name,
      kind,
      product: design.product,
      ...(repo ? { repo: String(repo) } : {}),
      ...(Number.isInteger(pr) ? { pr } : {}),
      ...(note ? { note: String(note) } : {}),
      ...(kind === 'preview' ? { lifetime: 'destroys on merge' } : {}),
      designId,
      designVersion: design.version,
      status: 'provisioning',
      tests: [],
      costPerDay: await designs.estimate(design, kind),
    };
    await repos.environments.write(env);
    const run = await runs.start({ environment: env, design, reason: `New ${KIND_LABEL[kind]} environment`, actor: person, approvedBy: rule === 'approval' ? person : undefined });
    return { environment: await get(name), run: runs.view(run) };
  }

  return { list, get, promotionPath, create, destroy };
}
