// "Ask the agent to draft" (docs/roadmap-history.md P3), one pipeline for every stage. A person asks; the engine checks the
// budget, records drafts/<id>.md and queues the job on nooblyjs-core's queue; the worker gets context from Knowledge,
// runs the task as the stage's teammate (or a scripted mock when Teammates isn't running), and hands the result
// to the stage, which saves it as a new version. Every job is attributed and costed (agent.action).
//
// Agents never approve, accept or send anything: a draft only ever proposes content, and it never lands on top of
// a newer human edit or an approved version (the stage's apply() checks the version the job started from).
import { newId } from '../util/ids.js';
import { validator } from '../util/validate.js';
import { HttpError, conflict } from '../util/errors.js';
import { monthSpend } from './views.js';
import { redact } from '../util/redact.js';

const QUEUE = 'product-drafts';
const MAX_CONTEXT = 12000;

/** What the teammate is asked, in words. */
function taskFor(kind, draft) {
  const about = draft.title ? `${draft.itemId} (${draft.title})` : draft.itemId;
  return [`Draft ${kind.label} for ${about}.`, draft.brief ? `The brief: ${draft.brief}` : null].filter(Boolean).join('\n');
}

/** The shape the draft must come back in (this stage's scripted draft), and what Knowledge has on the item. */
function contextFor(shape, knowledge) {
  const known = knowledge ? `\n\nWhat Knowledge has on this item:\n${(typeof knowledge === 'string' ? knowledge : JSON.stringify(knowledge, null, 2)).slice(0, MAX_CONTEXT)}` : '';
  return [
    'Answer with one JSON object in a ```json block and nothing after it. Use exactly the keys of this example, with the same types.',
    'Its values show the content as it is now, or placeholders where there is none. Write real content from the brief and what you know.',
    'Where you do not know a fact, keep a "[PLACEHOLDER: what is missing]" marker. Never invent evidence, numbers or dates.',
    '```json',
    JSON.stringify(shape, null, 2).slice(0, MAX_CONTEXT),
    '```',
  ].join('\n') + known;
}

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SOURCE_KINDS = ['runbook', 'adr', 'customer-insight', 'doc'];

/**
 * The documents Knowledge gave for a draft, as the draft's sources: [{ id, title, kind, detail?, href? }], at most
 * five. Anything that is not a well-formed document (an older Knowledge answering with passages only) gives none.
 */
export function sourcesOf(context) {
  if (!Array.isArray(context)) return [];
  const out = [];
  for (const doc of context) {
    if (!doc || !SOURCE_ID.test(doc.id ?? '') || typeof doc.title !== 'string' || !doc.title.trim() || out.some((s) => s.id === doc.id)) continue;
    out.push({
      id: doc.id, title: doc.title.trim().slice(0, 200), kind: SOURCE_KINDS.includes(doc.kind) ? doc.kind : 'doc',
      ...(typeof doc.detail === 'string' && doc.detail.trim() ? { detail: doc.detail.trim().slice(0, 200) } : {}),
      ...(typeof doc.href === 'string' && doc.href.startsWith('/') ? { href: doc.href.slice(0, 500) } : {}),
    });
    if (out.length === 5) break;
  }
  return out;
}

/**
 * Reads a model's draft: the last JSON object in its answer, with only the keys this kind of draft has. Anything
 * else is refused, and nothing is saved. The stage's own write path validates the values after this.
 */
export function readDraft(text, shape) {
  const unreadable = () => new HttpError(502, 'unreadable_draft', "The teammate's draft could not be read, so nothing was saved. Ask again.");
  if (text && typeof text === 'object') return text;
  const raw = String(text ?? '');
  const fenced = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  let parsed = null;
  for (const candidate of [...fenced.reverse(), raw]) {
    try {
      parsed = JSON.parse(candidate.trim());
      break;
    } catch { /* try the next one */ }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unreadable();
  const allowed = new Set(Object.keys(shape ?? {}));
  const keys = Object.keys(parsed);
  if (!keys.length || keys.some((k) => !allowed.has(k))) throw unreadable();
  return parsed;
}

const ACTIVE = ['queued', 'running'];
const money = (usd) => `$${usd.toFixed(2)}`;

/**
 * @param {object} o
 * @param {object} o.repos
 * @param {object} o.host
 * @param {object} o.log
 * @param {object} o.queue          nooblyjs-core queue (enqueue/dequeue)
 * @param {Record<string, object>} o.kinds   what can be drafted: { key: { stage, label, workType, agent, estimateUsd,
 *   check(itemId, input) → { baseVersion }, mock(draft) → { output, costUsd }, apply(draft, output) → { version, text } } }
 * @param {number} [o.stepMs]      the mock's pause between progress steps
 * @param {Function} [o.linkSources]  (itemId, links, actor) → { added }: puts a draft's sources on the item's spec
 */
export function createDrafting({ repos, host, log, queue, kinds, stepMs = 400, now = () => new Date(), linkSources = null, stageAgents = null }) {
  let draining = null;
  let closed = false;
  /** The unredacted briefs of queued jobs, in memory only, for the teammate (and the mock). */
  const briefs = new Map();
  const iso = () => now().toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor ?? null });
  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  /** The monthly budget: the platform's when it shares one, else data/product/budget.yaml (development). */
  async function budget() {
    try {
      const shared = await host.service('platform')?.budgetFor?.('product');
      if (typeof shared === 'number') return { monthlyUsd: shared, source: 'platform' };
    } catch (err) {
      log.warn(`platform budget unavailable: ${err.message}`);
    }
    const local = await repos.budget.get();
    return { monthlyUsd: typeof local?.monthlyUsd === 'number' ? local.monthlyUsd : null, source: local ? 'budget.yaml' : null };
  }

  /**
   * Refuses a job that would take this month's agent spend past the budget, and says so (budget.reached). Hosted in
   * NooblyJS, Platform decides (budgets, and whether agents are paused) and records its own refusal; the reason is
   * Platform's, word for word.
   */
  async function checkBudget(kind, actor, itemId, teammate = kind.agent) {
    const platform = host.service('platform');
    if (typeof platform?.checkAgentWork === 'function') {
      const check = await platform.checkAgentWork({ system: 'product', workType: kind.workType, teammateId: teammate?.id ?? null, itemId });
      if (!check.ok) throw new HttpError(check.code === 'budget_reached' ? 402 : 403, check.code, check.message);
      return;
    }
    const estimateUsd = kind.estimateUsd;
    const { monthlyUsd } = await budget();
    if (monthlyUsd == null) return;
    const month = iso().slice(0, 7);
    const usedUsd = monthSpend({ drafts: await repos.drafts.list() }, month);
    if (usedUsd + estimateUsd <= monthlyUsd) return;
    await emit('budget.reached', { system: 'product', month, usedUsd, budgetUsd: monthlyUsd }, actor);
    throw new HttpError(403, 'budget_reached',
      `The Product Factory has spent ${money(usedUsd)} of its ${money(monthlyUsd)} budget this month, so agent work is paused. An Owner can raise the budget.`,
      { usedUsd, budgetUsd: monthlyUsd, estimateUsd });
  }

  const active = async (itemId) => (await repos.drafts.list()).find((d) => d.itemId === itemId && ACTIVE.includes(d.status));

  /**
   * A person (or agent) asks for a draft. Returns the recorded job (202): the work happens in the background.
   * @param {string} itemId
   * @param {object} body     { kind, brief?, questionId? }
   * @param {string[]} allowed   the kinds this route offers (each stage has its own route)
   */
  async function request(itemId, body, actor, allowed) {
    const fields = validator(body)
      .only(['kind', 'brief', 'questionId', 'teammateId'])
      .oneOf('kind', allowed, { required: true })
      .string('brief', { max: 4000 })
      .string('questionId', { max: 40 })
      .string('teammateId', { max: 63 })
      .result();
    const kind = kinds[fields.kind];
    const { baseVersion = null, title = null } = await kind.check(itemId, fields);
    const running = await active(itemId);
    if (running) {
      throw conflict(`${running.teammate?.name ?? 'An agent'} is already drafting for ${itemId} (${running.progress ?? 0}%). Wait for it to finish.`, { draftId: running.id });
    }
    // Who drafts: a teammate actually hired (stage-agents.js), the one picked in the request or assigned to the stage.
    const teammate = stageAgents ? await stageAgents.resolve(kind.stage, { teammateId: fields.teammateId ?? null, actor }) : kind.agent;
    await checkBudget(kind, actor.id, itemId, teammate);
    // In production a draft is real work by a teammate, or nothing: the scripted mock is for development and tests.
    if (process.env.NODE_ENV === 'production' && typeof host.service('teammates')?.runTask !== 'function') {
      throw new HttpError(503, 'teammates_unavailable', 'The Digital Teammates service is not running, so no agent can draft right now. Nothing was queued.');
    }

    const draft = {
      id: newId('drf'),
      itemId,
      stage: kind.stage,
      kind: fields.kind,
      label: kind.label,
      status: 'queued',
      progress: 0,
      teammate,
      requestedBy: actor.id,
      // What is kept on disk is redacted (nooblyjs-ai.md); the teammate gets the brief as written (briefs map below).
      brief: redact(fields.brief) ?? null,
      questionId: fields.questionId ?? null,
      baseVersion,
      title,
      workType: kind.workType,
      costUsd: 0,
      createdAt: iso(),
      body: redact(fields.brief) ?? '',
    };
    if (fields.brief) briefs.set(draft.id, fields.brief);
    await repos.drafts.write(draft);
    await emit('draft.requested', { draftId: draft.id, itemId, kind: draft.kind, teammateId: teammate.id }, actor.id);
    await queue.enqueue(QUEUE, { draftId: draft.id });
    kick();
    return draft;
  }

  async function update(id, patch) {
    return repos.drafts.update(id, (d) => (d ? { ...d, ...patch } : null));
  }

  /** Who asked, for the teammate's timesheet. */
  async function requester(personId) {
    const person = personId ? await host.people?.get?.(personId).catch(() => null) : null;
    return person ? { type: 'user', id: person.id, name: person.name } : null;
  }

  /** The NooblyJS team the item belongs to, which pays for the work. Null bills the teammate's own cost centre. */
  async function billedTeam(itemId) {
    try {
      const item = await host.service('workflows')?.item?.({ itemId });
      const team = item?.team ? await host.service('teams')?.get?.(item.team) : null;
      return team ? { teamId: team.id, teamName: team.name } : null;
    } catch {
      return null;
    }
  }

  async function progress(draft, value, text) {
    await update(draft.id, { status: 'running', progress: value });
    await emit('draft.progressed', { draftId: draft.id, itemId: draft.itemId, progress: value, text: `${draft.teammate.name} drafting · ${value}%`, step: text }, draft.teammate.id);
  }

  /** Runs one job: context → the teammate's task (or the mock) → the stage saves it → cost and attribution. */
  async function run(draftId) {
    const draft = await repos.drafts.get(draftId);
    if (!draft || draft.status !== 'queued') return;
    const kind = kinds[draft.kind];
    const started = iso();
    try {
      // Agent work pauses at the budget: a job queued before the limit was reached doesn't start after it.
      await checkBudget(kind, draft.teammate.id, draft.itemId);
      await update(draftId, { status: 'running', startedAt: started });
      await progress(draft, 10, 'reading the item');

      const knowledge = host.service('knowledge');
      const context = typeof knowledge?.contextFor === 'function' ? await knowledge.contextFor({ itemId: draft.itemId, query: draft.title || undefined }) : null;
      // What Knowledge gave is what the draft rests on: its sources, kept on the draft and shown on the spec.
      const sources = sourcesOf(context);
      await sleep(stepMs);
      await progress(draft, 40, context ? 'reading Knowledge' : 'no Knowledge available here');

      // Every draft is a task run as the stage's teammate (NooblyJS Phase 6), so it is checked, billed and attributed
      // like any other agent work. With no model configured the teammate plays this stage's scripted draft; with
      // one, the model drafts and its answer is read against the same shape. An agent nobody has hired yet (and an
      // NooblyJS with Teammates switched off, in development) falls back to the scripted draft alone.
      const withBrief = { ...draft, brief: briefs.get(draftId) ?? draft.brief };
      const script = await kind.mock(withBrief);
      const teammates = host.service('teammates');
      const hired = typeof teammates?.runTask === 'function' && (typeof teammates.get !== 'function' || Boolean(await teammates.get(draft.teammate.id)));
      let result;
      if (hired) {
        const task = await teammates.runTask({
          slug: draft.teammate.id, workType: draft.workType, itemId: draft.itemId, system: 'product',
          caller: await requester(draft.requestedBy), billTo: await billedTeam(draft.itemId),
          input: { task: taskFor(kind, withBrief), context: contextFor(script.output, context) },
          scripted: async () => script,
        });
        result = { output: task.scripted ? task.output : readDraft(task.output, script.output), costUsd: Number(task.costUsd) || 0, modelRoute: task.modelRoute ?? draft.workType };
      } else {
        await sleep(stepMs);
        result = { ...script, modelRoute: 'mock' };
      }
      await progress(draft, 80, 'writing the draft');
      await sleep(stepMs);

      const saved = await kind.apply(withBrief, result.output);
      // The draft's sources go on the item's spec as Linked knowledge (those it does not have yet), for the person
      // who reviews the draft. A stage with no spec for the item yet keeps them on the draft only.
      let linked = 0;
      if (sources.length && linkSources) {
        try {
          linked = (await linkSources(draft.itemId, sources.map(({ href, ...link }) => link), draft.teammate)).added;
        } catch (err) {
          log.debug?.(`draft ${draftId}: its sources were not linked to ${draft.itemId}: ${err.message}`);
        }
      }
      const finishedAt = iso();
      const cites = sources.length ? `Sources: ${sources.map((s, i) => `[${i + 1}] ${s.title}`).join(' · ')}` : null;
      const done = await update(draftId, {
        status: 'done', progress: 100, costUsd: Math.round(result.costUsd * 100) / 100, modelRoute: result.modelRoute,
        finishedAt, resultVersion: saved?.version ?? null, result: redact([saved?.text, cites].filter(Boolean).join(' ')) ?? null,
        ...(sources.length ? { sources, sourcesLinked: linked } : {}),
      });
      await emit(kind.doneEvent ?? 'draft.finished', { draftId, itemId: draft.itemId, kind: draft.kind, version: saved?.version ?? null, ...(saved?.ref ?? {}) }, draft.teammate.id);
      briefs.delete(draftId);
      await emit('agent.action', {
        actor: draft.teammate.id, teammateId: draft.teammate.id, itemId: draft.itemId, system: 'product',
        modelRoute: result.modelRoute, costUsd: done.costUsd, at: finishedAt, action: draft.kind, draftId,
      }, draft.teammate.id);
    } catch (err) {
      briefs.delete(draftId);
      // A refusal with a reason a person can read: this engine's own, or the teammate's ("Sable Reyes is paused…").
      const refusal = err instanceof HttpError || (Number.isInteger(err?.status) && typeof err?.code === 'string');
      const reason = refusal ? err.message : `The draft failed: ${err.message}`;
      if (!refusal) log.error(`draft ${draftId} (${draft.kind} for ${draft.itemId}): ${err.stack ?? err.message}`);
      await update(draftId, { status: 'failed', finishedAt: iso(), error: reason, ...(refusal && err.code ? { errorCode: err.code } : {}) });
      await emit('draft.failed', { draftId, itemId: draft.itemId, kind: draft.kind, reason }, draft.teammate.id);
    }
  }

  /** Works through the queue one job at a time. One drain at a time; a new job while draining joins it. */
  function kick() {
    if (draining || closed) return draining;
    draining = (async () => {
      try {
        for (let job = await queue.dequeue(QUEUE); job && !closed; job = await queue.dequeue(QUEUE)) await run(job.draftId);
      } catch (err) {
        log.error(`drafting queue: ${err.message}`);
      } finally {
        draining = null;
      }
    })();
    return draining;
  }

  /**
   * At start: queue again what was waiting, and fail what was running when the process stopped (it can't resume).
   * Seeded sample jobs are left as they are.
   */
  async function recover() {
    for (const d of await repos.drafts.list()) {
      if (d.sampleData) continue;
      if (d.status === 'queued') await queue.enqueue(QUEUE, { draftId: d.id });
      if (d.status === 'running') await update(d.id, { status: 'failed', finishedAt: iso(), error: 'Stopped when the engine restarted. Ask again.' });
    }
    kick();
  }

  return {
    request,
    recover,
    budget,
    get: (id) => repos.drafts.get(id),
    /** Resolves when the queue is empty (tests, and close()). */
    idle: async () => {
      while (draining) await draining;
    },
    async close() {
      closed = true;
      while (draining) await draining;
    },
  };
}

/** A draft as the screens show it. */
export function draftView(draft) {
  const text = {
    queued: `${draft.teammate?.name ?? 'The agent'} will start shortly`,
    running: `${draft.teammate?.name ?? 'The agent'} drafting · ${draft.progress ?? 0}%`,
    done: `${draft.teammate?.name ?? 'The agent'} drafted ${draft.label ?? draft.kind}${draft.resultVersion ? ` (v${draft.resultVersion})` : ''} · ${money(Number(draft.costUsd) || 0)}${draft.sources?.length ? ` · from ${draft.sources.length} Knowledge source${draft.sources.length === 1 ? '' : 's'}` : ''}`,
    failed: draft.error ?? 'The draft failed',
  }[draft.status] ?? draft.status;
  return {
    id: draft.id, itemId: draft.itemId, stage: draft.stage, kind: draft.kind, label: draft.label ?? draft.kind,
    status: draft.status, progress: draft.progress ?? 0, text,
    teammate: draft.teammate ?? null, requestedBy: draft.requestedBy ?? null, brief: draft.brief ?? null,
    costUsd: Number(draft.costUsd) || 0, modelRoute: draft.modelRoute ?? null,
    resultVersion: draft.resultVersion ?? null, error: draft.error ?? null,
    createdAt: draft.createdAt ?? null, finishedAt: draft.finishedAt ?? null,
    // What Knowledge gave the agent for this draft, and how many of them were new to the spec's Linked knowledge.
    sources: draft.sources ?? [], sourcesLinked: draft.sourcesLinked ?? 0,
    sample: Boolean(draft.sampleData),
  };
}

