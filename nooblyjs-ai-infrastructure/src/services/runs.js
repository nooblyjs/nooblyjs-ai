// Provisioning runs (product.md §3.12): applying one design version to one environment. Runs are queued on the
// host's queue and worked through one at a time in this process (stack.md §4). Whether a run may start at all is
// decided before it gets here (apply-rules.js); this file only does the work and says what happened.
import { newId } from '../util/ids.js';
import { HttpError, notFound } from '../util/errors.js';
import { peopleOnly, needs } from '../util/http.js';
import { runStatus, planText, ago } from './views.js';

const QUEUE = 'infrastructure-runs';
export const who = (person) => (person ? { id: person.id, name: person.name ?? person.id, ...(person.kind === 'agent' ? { kind: 'agent' } : {}) } : null);
const defined = (record) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null));

export function createRuns({ repos, host, log, provisioner, queue, cost = null, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const stop = new AbortController();
  /** Runs a person cancelled while they were running: the provisioner stops at its next step. */
  const cancelling = new Set();
  let draining = null;
  let closed = false;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor ?? null });
  /** One line of a run's log (the run detail page): what happened, in business time. */
  const line = (text) => ({ at: iso(), text });
  const logged = (r, text) => ({ ...r, log: [...(r.log ?? []), line(text)] });

  /**
   * New provisioning pauses at the cloud budget (stack.md §3). Hosted in NooblyJS, Platform decides (its cloud budget and
   * Pause on limit) and records the refusal; standalone, this month's spend against budget.yaml. Throws 402.
   */
  async function gate(person) {
    const platform = host.service?.('platform');
    if (typeof platform?.checkAgentWork === 'function') {
      const check = await platform.checkAgentWork({ system: 'cloud', teammateId: person?.id ?? null });
      if (!check.ok) throw new HttpError(402, check.code, check.message);
      return;
    }
    const spend = await cost?.month();
    if (spend?.budgetUsd && spend.spentUsd >= spend.budgetUsd) {
      throw new HttpError(402, 'budget_reached', `New provisioning is paused: this month's cloud spend (${spend.text}) has reached the budget.`);
    }
  }

  /** Queues a run. The environment shows "Provisioning" from now until the run ends. */
  async function start({ environment, design, reason, actor, approvedBy, driftId }) {
    await gate(actor);
    const run = defined({
      id: newId('run'),
      environment: environment.name,
      kind: environment.kind,
      designId: design.id,
      designVersion: design.version,
      reason,
      status: 'queued',
      progress: 0,
      plan: await provisioner.plan(design, environment.kind),
      requestedBy: who(actor),
      approvedBy: who(approvedBy),
      driftId,
      createdAt: iso(),
    });
    run.log = [
      line(`Queued: ${reason}`),
      line(`Plan for ${design.id} v${design.version}: ${planText(run.plan)}`),
      ...(run.approvedBy ? [line(`Approved by ${run.approvedBy.name}`)] : []),
    ];
    await repos.runs.write(run);
    await repos.environments.update(environment.name, (env) => env && { ...env, status: 'provisioning' });
    await emit('environment.plan_ready', { runId: run.id, environment: run.environment, designId: run.designId, designVersion: run.designVersion, plan: run.plan }, actor?.id);
    await queue.enqueue(QUEUE, { runId: run.id });
    kick();
    return run;
  }

  async function execute(runId) {
    let run = await repos.runs.update(runId, (r) => r && ['queued', 'running'].includes(r.status) && logged({ ...r, status: 'running', startedAt: r.startedAt ?? iso() }, r.startedAt ? `Picked up again at ${r.progress ?? 0}% (${provisioner.name} provisioner)` : `Started (${provisioner.name} provisioner)`));
    if (!run) return;
    const facts = { runId, environment: run.environment, kind: run.kind, designId: run.designId, designVersion: run.designVersion };
    await emit('environment.provisioning_started', facts, run.requestedBy?.id);
    try {
      for await (const progress of provisioner.apply({ from: run.progress ?? 0, signal: stop.signal })) {
        if (cancelling.has(runId)) break;
        run = await repos.runs.update(runId, (r) => r && logged({ ...r, progress }, `Applied ${progress}%`));
        await emit('environment.provisioning_progressed', { ...facts, progress }, run.requestedBy?.id);
        if (cancelling.has(runId)) break;
      }
      if (cancelling.delete(runId)) return finishCancelled(runId);
      // Stopped with the process: the run stays "running" on disk and is picked up at the next start.
      if (stop.signal.aborted && (run.progress ?? 0) < 100) return;
      await repos.runs.update(runId, (r) => r && logged({ ...r, status: 'done', progress: 100, finishedAt: iso() }, `Provisioned ${run.environment} from ${run.designId} v${run.designVersion}`));
      await repos.environments.update(run.environment, (env) => {
        if (!env) return null;
        const next = { ...env, status: 'live', designId: run.designId, designVersion: run.designVersion, deployedAt: env.deployedAt ?? iso() };
        // A restore puts the environment back to the design, so what was observed to differ is gone.
        if (run.driftId) delete next.observed;
        return next;
      });
      if (run.driftId) {
        await repos.drift.update(run.driftId, (d) => d && { ...d, status: 'restored', resolvedAt: iso() });
        await emit('drift.restored', { driftId: run.driftId, environment: run.environment, runId }, run.requestedBy?.id);
      }
      await emit('environment.provisioned', facts, run.requestedBy?.id);
    } catch (err) {
      log.error(`run ${runId} on ${run.environment}: ${err.stack ?? err.message}`);
      await repos.runs.update(runId, (r) => r && logged({ ...r, status: 'failed', error: err.message, finishedAt: iso() }, `Failed: ${err.message}`));
      await repos.environments.update(run.environment, (env) => env && { ...env, status: 'live' });
      if (run.driftId) await repos.drift.update(run.driftId, (d) => d && { ...d, status: 'open' });
      await emit('environment.provisioning_failed', { ...facts, reason: err.message }, run.requestedBy?.id);
    }
  }

  /** A cancelled run ends; its environment goes back to how it was (or is left out, if the run was creating it). */
  async function finishCancelled(runId) {
    const run = await repos.runs.update(runId, (r) => r && logged({ ...r, status: 'cancelled', finishedAt: iso() }, `Cancelled${r.cancelledBy ? ` by ${r.cancelledBy.name}` : ''} at ${r.progress ?? 0}%`));
    if (!run) return null;
    await repos.environments.update(run.environment, (env) => {
      if (!env) return null;
      // Never provisioned (a new environment): nothing exists, so it is closed rather than left half made.
      if (!env.deployedAt) return { ...env, status: 'destroyed', destroyedAt: iso(), destroyedReason: 'its first run was cancelled' };
      return { ...env, status: 'live' };
    });
    if (run.driftId) await repos.drift.update(run.driftId, (d) => d && { ...d, status: 'open' });
    await emit('environment.provisioning_cancelled', {
      runId, environment: run.environment, kind: run.kind, designId: run.designId, designVersion: run.designVersion, cancelledBy: run.cancelledBy ?? null,
      summary: `cancelled the run on ${run.environment}`,
    }, run.cancelledBy?.id);
    return run;
  }

  /**
   * Cancels a queued or running run. A queued one ends at once; a running one stops at the provisioner's next step.
   * Who may: the same as who may start it (draft for the kinds that apply automatically, the apply rule's permission
   * otherwise). Agents are refused.
   */
  async function cancel(id, person) {
    const run = await repos.runs.get(id);
    if (!run) throw notFound(`No run ${id}.`);
    const action = `cancel the run on ${run.environment}`;
    await peopleOnly(host, person, action);
    const rules = await repos.config.applyRules();
    await needs(host, person, rules.kinds?.[run.kind] === 'automatic' ? 'draft' : rules.approval?.permission ?? 'change-repo-access', action);
    if (!inProgress(run)) throw new HttpError(409, 'conflict', `This run is already ${run.status}.`);
    const by = who(person);
    if (run.status === 'queued') {
      await repos.runs.update(id, (r) => r && { ...r, cancelledBy: by });
      return view(await finishCancelled(id));
    }
    await repos.runs.update(id, (r) => r && { ...r, cancelledBy: by, cancelRequested: true });
    cancelling.add(id);
    return view(await repos.runs.get(id));
  }

  /** Works through the queue one run at a time. A run queued while draining joins the same drain. */
  function kick() {
    if (draining || closed) return draining;
    draining = (async () => {
      try {
        for (let job = await queue.dequeue(QUEUE); job && !closed; job = await queue.dequeue(QUEUE)) await execute(job.runId);
      } catch (err) {
        log.error(`provisioning queue: ${err.message}`);
      } finally {
        draining = null;
      }
    })();
    return draining;
  }

  function view(run) {
    const status = runStatus(run);
    return {
      id: run.id,
      environment: run.environment,
      kind: run.kind,
      designId: run.designId,
      designVersion: run.designVersion,
      reason: run.reason ?? '',
      status: run.status,
      statusText: status.text,
      tone: status.tone,
      progress: run.progress ?? 0,
      plan: run.plan ?? null,
      planText: planText(run.plan),
      requestedBy: run.requestedBy ?? null,
      approvedBy: run.approvedBy ?? null,
      when: ago(run.finishedAt ?? run.startedAt ?? run.createdAt, now()),
      createdAt: run.createdAt,
      href: `${mountPath}/environments/${run.environment}`,
      runHref: `${mountPath}/runs/${run.id}`,
      cancellable: inProgress(run),
    };
  }

  const inProgress = (run) => run.status === 'queued' || run.status === 'running';

  return {
    start,
    gate,
    inProgress,
    view,
    /** Newest first; `status=active` keeps the ones still going. */
    async list({ status, environment } = {}) {
      const runs = (await repos.runs.list())
        .filter((r) => (status === 'active' ? inProgress(r) : !status || r.status === status))
        .filter((r) => !environment || r.environment === environment)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return runs.map(view);
    },
    /** One run with its log (the run detail page). A run from before logs were kept gets one from its own facts. */
    async get(id) {
      const run = await repos.runs.get(id);
      if (!run) throw notFound(`No run ${id}.`);
      const log = run.log?.length ? run.log : [
        { at: run.createdAt, text: `Queued: ${run.reason ?? 'no reason recorded'}` },
        ...(run.startedAt ? [{ at: run.startedAt, text: `Started; at ${run.progress ?? 0}%` }] : []),
        ...(run.finishedAt ? [{ at: run.finishedAt, text: runStatus(run).text }] : []),
      ];
      return { ...view(run), log, startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null, error: run.error ?? null, cancellable: inProgress(run), runHref: `${mountPath}/runs/${run.id}` };
    },
    /** At start: queue again whatever was waiting or under way when the process stopped. */
    cancel,
    async recover() {
      for (const run of await repos.runs.list()) {
        // A cancel asked for just before a stop still stands.
        if (inProgress(run) && run.cancelRequested) await finishCancelled(run.id);
        else if (inProgress(run)) await queue.enqueue(QUEUE, { runId: run.id });
      }
      kick();
    },
    /** Resolves when nothing is queued or running (tests, and close()). */
    idle: async () => {
      while (draining) await draining;
    },
    async close() {
      closed = true;
      stop.abort();
      while (draining) await draining;
    },
  };
}
