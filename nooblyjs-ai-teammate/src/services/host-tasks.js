// What other NooblyJS apps may ask of Teammates (register()'s `services`, reached with host.service('teammates')):
// who is on the team, whether a teammate can take work, and one task run as that teammate. NooblyJS's team chat, the
// Product Factory's drafting and the Teams bot all come through runTask(), so every agent action is checked,
// logged to a timesheet and attributed the same way (NooblyJS tech.md §2.1).
//
// A task run from here can only return text. It has no tools, so it can't fetch, notify or delegate, and nothing
// it returns changes anything by itself: what happens with the answer is the caller's decision.
import { HttpError, badRequest } from '../utils/errors.js';

const STATUS_TEXT = { task: 'On a task', available: 'Available', paused: 'Paused', off: 'Off shift' };
const MAX_CONTEXT = 24000;
const clip = (text, max) => { const s = String(text ?? ''); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

export class HostTaskService {
  /**
   * `platform` returns the host's Platform service (NooblyJS host.service('platform')) or null: the check every agent
   * action passes first (repository access, budgets, allowed providers), the model route for a work type, and the
   * container runtime a running task shows in.
   */
  constructor({ repos, team, invocation, providers, hostEvents = null, hostAudit = null, platform = () => null, log = console }) {
    Object.assign(this, { repos, team, invocation, providers, hostEvents, hostAudit, platform, log });
  }

  /** 'mock' when no model is configured (answers are scripted), otherwise the provider's name. */
  provider() {
    return this.providers.describe();
  }

  /** Whether a teammate can take work right now, and if not, why, in words a person can read. */
  async availability(slug) {
    try {
      await this.invocation.preflight(String(slug ?? ''));
      return { ok: true };
    } catch (err) {
      if (err instanceof HttpError) return { ok: false, code: err.code, message: err.message };
      throw err;
    }
  }

  /** The team as other apps show it: who they are, what they do, their status, model and rate. */
  async roster() {
    const { teammates } = await this.team.roster();
    return Promise.all(teammates.map(async (t) => {
      const can = await this.availability(t.id);
      return {
        id: t.id, name: t.name, role: t.role, avatar: t.avatar, skills: t.skills,
        status: t.status, statusText: STATUS_TEXT[t.status] ?? t.status, currentTask: t.currentTask,
        canWork: can.ok, ...(can.ok ? {} : { unavailable: can.message }),
        model: { key: t.model.id, name: t.model.name, tier: t.model.symbol },
        rate: t.rate,
      };
    }));
  }

  async get(slug) {
    return (await this.roster()).find((t) => t.id === slug) ?? null;
  }

  /**
   * Runs one task as a teammate, for another app.
   *
   * @param {object} request
   * @param {string} request.slug       the teammate
   * @param {string} request.workType   what kind of work this is ('chat.reply', 'spec-drafting', …); recorded
   * @param {string} [request.itemId]   the lifecycle item the work is for
   * @param {string} [request.system]   the NooblyJS system asking ('home', 'product', 'teams', …)
   * @param {{ task: string, context?: string, history?: Array<{ author: string, text: string }> }} request.input
   * @param {{ teamId?: string, teamName: string }} [request.billTo]  the NooblyJS team that pays; the teammate's own
   *   cost centre when left out
   * @param {{ type?: string, id: string, name: string }} [request.caller]  who asked
   * @param {() => Promise<{ output: any, costUsd?: number }>} [request.scripted]  the answer to play when no
   *   model is configured. Ignored with a real provider.
   * @param {string} [request.repo]  the repository the task reads (owner/repo or its short name); the host's Platform
   *   refuses the task when agents have no access to it
   * @param {AbortSignal} [request.signal]  cancels the task (so does Stop on NooblyJS Platform · Containers)
   * @returns {Promise<{ output: any, costUsd: number, modelRoute: string, hours: number, amount: number, workId: string, team: string, scripted: boolean }>}
   *   `costUsd` is the model cost of this task; `hours` and `amount` are what went on the timesheet.
   */
  async runTask({ slug, workType, itemId = null, system = null, input, billTo = null, caller = null, scripted = null, repo = null, signal } = {}) {
    const task = typeof input?.task === 'string' ? input.task.trim() : '';
    if (!task) throw badRequest('A task needs input.task: what the teammate is asked, in words');
    if (typeof workType !== 'string' || !/^[a-z][a-z0-9.-]{1,40}$/.test(workType)) throw badRequest('A task needs a workType such as "chat.reply"');
    const who = caller?.id ? { type: caller.type ?? 'user', id: caller.id, name: caller.name ?? caller.id } : { type: 'system', id: 'noobly', name: 'NooblyJS' };
    const context = { teammateId: String(slug ?? ''), itemId, system, workType };

    let teammate;
    try {
      teammate = await this.invocation.preflight(context.teammateId);
    } catch (err) {
      if (err instanceof HttpError) await this.emit('teammate.task_refused', { ...context, reason: err.message, code: err.code, costUsd: 0, modelRoute: null });
      throw err;
    }

    // The host's Platform decides before anything starts or costs: repository access, budgets, allowed providers.
    // It also names the model route for this work type.
    const platform = this.platform?.() ?? null;
    let route = null;
    if (platform?.checkAgentWork) {
      const check = await platform.checkAgentWork({ system, workType, repo, teammateId: teammate.id, itemId });
      if (!check.ok) {
        await this.emit('teammate.task_refused', { ...context, reason: check.message, code: check.code, costUsd: 0, modelRoute: null, ...(repo ? { repo } : {}) });
        throw new HttpError(check.code === 'budget_reached' ? 402 : 403, check.code, check.message);
      }
      route = check.route ?? null;
    }

    const asked = String(billTo?.teamName ?? '').trim().slice(0, 40);
    const team = asked ? await this.ensureCostCentre(asked) : '';

    // With no model configured, the caller's script is the answer. An object (a chat reply with cards, a draft's
    // sections) is handed back as it was given; the mock only needs its text to estimate the time.
    let played = null;
    if (typeof scripted === 'function' && (await this.answersOffline(teammate, route))) {
      const script = await scripted();
      if (script?.output != null) played = { output: script.output, text: typeof script.output === 'string' ? script.output : JSON.stringify(script.output), costUsd: Number(script.costUsd) || 0 };
    }

    // While it runs, the task is a workload on Platform · Containers, where Stop cancels it.
    const stop = new AbortController();
    const onAbort = () => stop.abort(signal.reason);
    if (signal?.aborted) stop.abort(signal.reason);
    else signal?.addEventListener('abort', onAbort, { once: true });
    const unregister = platform?.containers?.register?.({
      kind: 'teammate', title: `${teammate.name} · ${task.split('\n')[0].slice(0, 60)}`, repo, teammateId: teammate.id, itemId, system,
      stop: () => stop.abort(new Error('Stopped on Platform · Containers')),
    }) ?? (() => {});

    await this.emit('teammate.task_started', { ...context, teammateName: teammate.name, costUsd: 0, modelRoute: null }, teammate.id);
    const assign = (r) => this.invocation.assign(teammate.id, {
      task,
      costCentre: team || undefined,
      caller: who,
      signal: stop.signal,
      // The person who asked is the one who would approve it, as when work is assigned from the profile.
      preApproved: true,
      useTools: false,
      extraContext: HostTaskService.contextBlock(input),
      meta: { itemId, system, workType, ...(billTo?.teamId ? { teamId: billTo.teamId } : {}), ...(r ? { route: r.id } : {}), ...(repo ? { repo } : {}) },
      scripted: played && { text: played.text, costUsd: played.costUsd },
      route: r,
    });
    let result;
    let used = route;
    try {
      result = await assign(route);
    } catch (err) {
      // The route's fallback model answers once when its own model's provider fails.
      if (!(err instanceof HttpError && err.code === 'provider_error' && route?.fallback && !stop.signal.aborted)) throw err;
      this.log.warn?.(`[host-tasks] ${route.model} failed for ${teammate.id} (${err.message}); trying the fallback ${route.fallback}`);
      used = { ...route, model: route.fallback, modelLabel: route.fallbackLabel ?? route.fallback, fallback: null };
      result = await assign(used);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      unregister();
    }

    const modelRoute = played ? (used ? `mock/${used.model}` : 'mock/scripted') : `${result.provider}/${result.modelId}`;
    const done = {
      ...context, teammateName: teammate.name, workId: result.workId, team: result.costCentre,
      modelRoute, costUsd: result.apiCost, hours: result.hours, amount: result.amount, scripted: Boolean(played),
    };
    await this.emit('teammate.task_finished', done, teammate.id);
    try {
      await this.hostAudit?.record?.({ actor: teammate.id, action: `agent.${workType}`, target: result.workId, ...done, requestedBy: who.id });
    } catch (err) {
      this.log.warn?.(`[host-tasks] the host did not take the audit record for ${result.workId}: ${err.message}`);
    }
    return {
      output: played ? played.output : result.output,
      costUsd: result.apiCost, modelRoute, hours: result.hours, amount: result.amount, workId: result.workId, team: result.costCentre, scripted: Boolean(played),
    };
  }

  /** Whether this task would be answered by the offline mock (no model configured for its model or route). */
  async answersOffline(teammate, route) {
    const own = (await this.repos.config.getModels())[teammate.model];
    if (!own) return this.provider() === 'mock';
    return this.providers.get(route ? { ...own, provider: route.provider, modelId: route.model } : own).name === 'mock';
  }

  /** The caller's context and the conversation so far, as one labelled block after the teammate's memory. */
  static contextBlock(input) {
    const parts = [];
    if (typeof input?.context === 'string' && input.context.trim()) parts.push(`# What NooblyJS knows about this work\n${clip(input.context.trim(), MAX_CONTEXT)}`);
    const history = (Array.isArray(input?.history) ? input.history : []).filter((m) => m?.text);
    if (history.length) {
      const lines = history.map((m) => `- ${String(m.author ?? 'Someone').slice(0, 80)}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 1500)}`);
      parts.push(`# The conversation so far (oldest first)\n${clip(lines.join('\n'), MAX_CONTEXT)}`);
    }
    return parts.join('\n\n');
  }

  /** A NooblyJS team becomes a cost centre the first time work is billed to it. Resolves with the centre's name. */
  async ensureCostCentre(name) {
    const centres = (await this.repos.config.getSettings()).costCentres ?? [];
    const known = centres.find((c) => c.toLowerCase() === name.toLowerCase());
    if (known) return known;
    await this.repos.config.updateSettings({ costCentres: [...centres, name] });
    return name;
  }

  /** Tells NooblyJS what happened. A host that can't take the event never fails the task. */
  async emit(type, payload, actor = null) {
    try {
      await this.hostEvents?.emit?.(type, payload, { actor });
    } catch (err) {
      this.log.warn?.(`[host-tasks] the host did not take ${type}: ${err.message}`);
    }
  }
}
