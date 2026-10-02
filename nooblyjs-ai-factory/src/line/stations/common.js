// @ts-check
// Phase F07: what every station gets, and helpers they share.
//
// A station is one function:  run(ctx) → result
//
//   result          plain data, saved in step.finished, visible to later stations and `when` conditions
//   result.costUsd  what this station spent (the budgets add these up)
//   result.stop     { status, reason }: "the run ends here, and this is how" (a considered no, not a failure)
//   throw           something BROKE: step.failed, and the line's retry policy applies
import { runStep } from '../../exec/step-runner.js';
import { remoteRunStep } from '../../remote/remote-step.js';
import { policyFor, routeTier, signalsFor } from '../../routing/policy.js';
import { loadScriptedProvider } from '../../exec/harness/script.js';
import { readSteering } from '../../knowledge/steering.js';
import { agentOptionsFor } from '../../roles/loader.js';
import { rolePrompt } from '../../roles/prompts.js';
import { openEntry } from '../../humans/inbox.js';

/**
 * @typedef {Object} StationContext
 * @property {import('../../store/events.js').Store} store
 * @property {string} runId
 * @property {any} run                 the run's projection row (its steps so far)
 * @property {import('../line.js').Station} station
 * @property {any} issue
 * @property {string} itemKey          'issue-3'
 * @property {string} slug             the repo's slug (the forge's name for it)
 * @property {any} request             the saved job request
 * @property {any} live                signal, guard, provider(s), budgetUsd, onEvent
 * @property {any} forge
 * @property {(line: string) => void} log
 * @property {Record<string, any>} results   done stations' results, by id
 * @property {Record<string, import('../../roles/loader.js').Role>} [roles]   Phase F09: the run's roles
 * @property {any} [config]           Phase F09: the operator's config (models per tier…)
 * @property {any[]} [specTasks]      Phase F10: the spec's tasks (more than one → fan-out)
 * @property {string} [specDir]
 * @property {{ sha: string, configSha: string, baseRef?: string }} [buildBase]
 * @property {string} [prSections]
 * @property {import('../line.js').Station[]} [lineStations]   Phase F13: the whole line (e.g. to rewind to verify)
 */

/**
 * Which model does this station's agent use?
 *   a provider object given live (tests)  →  per station, or `provider` for the builder
 *   a script file                         →  that station's part of it
 *   otherwise                             →  the saved provider id (a real model)
 */
export function providerFor(kind, request, live, attempt = 1) {
  if (live.providers?.[kind]) return live.providers[kind];
  if (live.provider && kind === 'build') return live.provider;
  if (request.agent?.script) return loadScriptedProvider(request.agent.script, kind, attempt);
  // Scripted/test mode (any provider objects given live) must NEVER fall through to a real
  // model for a station someone forgot: that would quietly spend money (or, without a key,
  // fail in a confusing way). Say which station has no model instead.
  if (live.provider || live.providers) throw new Error(`No model for the "${kind}" station: scripted providers were given for ${Object.keys(live.providers ?? {}).concat(live.provider ? ['build'] : []).join(', ')}, but not this one. Give live.providers["${kind}"], or use a line without it.`);
  return request.agent?.provider;
}

/**
 * Phase F09: everything runStep needs to run a ROLE's agent:
 *   the role's model, permissions and limits (roles/loader.js), capped by the scheduler's budget,
 *   the model/provider to use for this station (providerFor), the live wiring, and the prompt,
 *   assembled from the role file (roles/prompts.js) once the workspace exists (steering is
 *   read at its pinned base).
 * @param {StationContext} ctx
 * @param {string} roleName            e.g. 'builder'
 * @param {{ providerKey: string, vars?: object, context?: string[] | ((ws: any) => Promise<string[]>), onEvent?: (e: any) => void, steeringSha?: string }} options
 */
/** Phase F16: questions this station's agent asked (ask_human), and a person's answers. */
function answersFor(ctx) {
  if (!ctx.store || !ctx.station) return [];
  const answered = ctx.store.list('inbox').filter((e) => e.runId === ctx.runId && e.gate === `ask:${ctx.station.id}` && e.status === 'answered');
  if (!answered.length) return [];
  return [`# Answers to your questions\n\nYou asked a person, and they answered. Use these answers; don't ask again.\n\n${answered.map((e) => `- Q: ${e.title}\n  A (${e.by}): ${e.answer}`).join('\n')}`];
}

/**
 * Phase F22: cost-aware routing. Pick this step's tier from the run's policy and its signals,
 * and record the decision (route.decided) so metrics can say what each tier cost and achieved.
 * An explicit model (the run's --model, or the role's own `model:`) is never overridden.
 */
function routeModel(ctx, role, options, { attempt, providerKey }) {
  if (!ctx.station) return;
  const asked = ctx.request?.agent ?? {};
  const { name, policy } = policyFor(ctx.request, ctx.config);
  const signals = signalsFor({ station: ctx.station.id, run: ctx.run, triage: ctx.results?.triage, attempt, lowConfidence: ctx.config?.routing?.lowConfidence });
  const decision = routeTier({ station: ctx.station.id, roleTier: role.tier, policy, signals });
  const pinned = asked.model ?? role.model;
  const otherProvider = typeof asked.provider === 'string' && asked.provider !== 'anthropic';
  if (!pinned && !otherProvider) options.model = ctx.config?.models?.[decision.tier] ?? options.model;
  ctx.store?.append(`run:${ctx.runId}`, 'route.decided', { runId: ctx.runId, step: ctx.station.id, key: providerKey ?? null, role: role.name, policy: name, tier: pinned ? null : decision.tier, model: options.model ?? null, reason: pinned ? `pinned (${pinned})` : decision.reason, signals: decision.climbed });
}

/**
 * Phase F23: where this station's agent step runs. With workers attached (factory serve --workers),
 * on a worker, far away; otherwise here. The station can't tell the difference.
 */
export function stepRunnerFor(ctx) {
  return ctx.live?.remote ? (req, deps) => remoteRunStep(req, ctx.live.remote, deps) : runStep;
}

export function agentFor(ctx, roleName, { providerKey, vars = {}, context = [], onEvent, steeringSha }) {
  const role = ctx.roles?.[roleName];
  if (!role) throw new Error(`No role "${roleName}".`);
  const options = agentOptionsFor(role, { request: ctx.request, config: ctx.config ?? {}, vars, budgetUsd: ctx.live.budgetUsd });
  // ctx.run was read BEFORE this step.started was recorded, so this run of the station is tries + 1.
  const attempt = (ctx.run?.steps?.[ctx.station?.id]?.tries ?? 0) + 1;
  const provider = providerFor(providerKey, ctx.request, ctx.live, attempt);
  routeModel(ctx, role, options, { attempt, providerKey });
  const { stopHook, ...agentOptions } = options;
  return {
    role,
    stopHook,
    // A provider OBJECT (a script, a test) only works in-process.
    driver: typeof provider === 'object' ? 'in-process' : ctx.request.driver,
    agent: {
      ...agentOptions,
      provider,
      signal: ctx.live.signal,
      onEvent: (e) => {
        onEvent?.(e);
        ctx.live.onEvent?.(e);
        recordPolicyGap(ctx, role, e);
      },
      // Phase F16: this step's factory tools (read_spec, ask_human, …), scoped to it by a token.
      factoryTools: { runId: ctx.runId, step: providerKey ?? ctx.station?.id ?? roleName, station: ctx.station?.id ?? roleName },
      prompt: async (ws) => {
        const extra = [...(typeof context === 'function' ? await context(ws) : context), ...answersFor(ctx)];
        return rolePrompt(role, { steering: await readSteering(ws.mirror, steeringSha ?? ws.baseSha), vars, context: extra, issue: ctx.issue });
      },
    },
  };
}

/**
 * Phase F13: the run's CURRENT HEAD: the build, plus any successful repairs on top of it.
 * Verify, review, deliver and merge read this, not the build alone.
 */
export function headOf(ctx) {
  const build = ctx.results.build;
  const repaired = (ctx.run?.repairs ?? []).filter((r) => r.sha);
  const last = repaired.at(-1);
  if (!build || !last) return build;
  return { ...build, sha: last.sha, branch: last.branch, stat: last.stat, repairs: repaired };
}

/**
 * Phase F12: a POLICY GAP. The harness refused the agent something only a person could have
 * allowed ("Bash needs the user's permission… run noobly with --allow \"Bash(npm install:*)\"").
 * Nobody is at a keyboard in a factory run, so the answer was no. But silently no isn't
 * useful either: record it, and put it in the inbox, with the rule that would allow it,
 * so the operator can decide to add it to the role (factory approve <id>).
 * Works with both drivers: it reads the refusal from the event stream.
 */
function recordPolicyGap(ctx, role, e) {
  if (e.type !== 'tool_end' || !e.isError || !/needs the user's permission/.test(String(e.content))) return;
  if (role.readOnly) return; // a read-only role asking to write is not a gap: it's the point
  const rule = String(e.content).match(/--allow "([^"]+)"/)?.[1] ?? null;
  const key = `policy:${ctx.runId}:${role.name}:${rule ?? e.name}`;
  if (!ctx.store.append(`run:${ctx.runId}`, 'policy.gap', { runId: ctx.runId, role: role.name, tool: e.name, summary: e.summary, rule }, { key })) return;
  openEntry(ctx.store, {
    runId: ctx.runId,
    kind: 'policy',
    title: `The ${role.name} was refused ${e.name}(${e.summary ?? ''})`,
    body: rule ? `Allowing it would take the rule ${rule} for the ${role.name} role. Approve to add it to ~/.factory/config.json (roles.${role.name}.allow), or dismiss.` : 'No rule would allow it; dismiss, or change the role.',
    detail: { role: role.name, rule },
  });
}

/** The last ```json … ``` block in a text (or the text itself, if it is JSON). */
export function extractJson(text) {
  const blocks = [...String(text).matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)];
  const candidate = blocks.length ? blocks.at(-1)?.[1] : String(text).trim();
  try {
    return JSON.parse(/** @type {string} */ (candidate));
  } catch {
    const brace = String(text).match(/\{[\s\S]*\}/);
    if (brace) return JSON.parse(brace[0]);
    throw new Error('the reply has no JSON in it');
  }
}
