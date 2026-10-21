/**
 * @fileoverview Hosted in NooblyJS, the wiki's AI agents are teammate tasks (NooblyJS Phase 24: mocking audit A6,
 * security audit S-08).
 *
 * Every model client the wiki builds passes through routeClient(). Standalone it is handed back as it is. Hosted, the
 * client handed back sends each prompt to the host's Teammates (`host.service('teammates').runTask`), which checks it
 * with Platform first, bills it, attributes it and audits it like every other agent action in NooblyJS. It never calls
 * the agent's own provider: with Teammates not running, the prompt is refused.
 *
 * A workflow step runs in a worker thread with module state of its own, so it cannot see the runner. Hosted, the main
 * process leaves a marker in the workflow bridge's folder, and a worker's client asks the main process through the
 * bridge (`agentPrompt`, src/datasources/lib/workflowBridgeServer.js) instead of the provider.
 *
 * @author NooblyJS Team
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = path.join('workflow', '.bridge', 'agent-tasks.json');
const ROUTED = Symbol.for('nooblyjs.knowledge.agentTask');
// A model call can take minutes; the bridge's own default (30 s) is for scheduling calls.
const BRIDGE_TIMEOUT_MS = 10 * 60 * 1000;

/** The runner the hosted entry set, if any. On `global` so every copy of this module sees the same one. */
const runner = () => (typeof global.nooblyAgentTasks === 'function' ? global.nooblyAgentTasks : null);

/**
 * Hosted: from now on every client the wiki builds runs its prompts through `run`.
 * @param {(ask: { agent: string, text: string, options?: object, via?: string }) => Promise<{ content: string }>} run
 * @param {{ appBaseDir?: string }} [o]  where the bridge folder is, so worker threads follow
 */
function useTeammates(run, { appBaseDir } = {}) {
  global.nooblyAgentTasks = run;
  if (!appBaseDir) return;
  const marker = path.join(appBaseDir, MARKER);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${JSON.stringify({ via: 'teammates', since: new Date().toISOString() })}\n`);
}

/** Undoes useTeammates() (the hosted app is closing). */
function stopTeammates({ appBaseDir } = {}) {
  delete global.nooblyAgentTasks;
  if (appBaseDir) fs.rmSync(path.join(appBaseDir, MARKER), { force: true });
}

/** 'process' in the hosted main process, 'bridge' in a hosted worker thread, null standalone. */
function routed(appBaseDir) {
  if (runner()) return 'process';
  return appBaseDir && fs.existsSync(path.join(appBaseDir, MARKER)) ? 'bridge' : null;
}

/** Whether a hosted prompt would be answered offline (no model configured in Teammates). False standalone. */
async function answersOffline() {
  const run = runner();
  if (!run || typeof run.offline !== 'function') return false;
  try {
    return Boolean(await run.offline());
  } catch {
    return false;
  }
}

function bridgeAsk(appBaseDir) {
  return async (ask) => {
    // Required here, not at the top: only a worker thread needs it.
    const WorkflowBridgeClient = require('../../../workflows/common/bridge/workflowBridgeClient');
    const client = new WorkflowBridgeClient({ appBaseDir, timeoutMs: BRIDGE_TIMEOUT_MS });
    return client.call('agentPrompt', { ...ask, via: 'workflow' });
  };
}

/** A client with the provider's shape (`prompt(text, options)` → `{ content, usage, model, provider }`). */
function teammateClient(agent, ask) {
  return {
    [ROUTED]: true,
    provider: 'teammates',
    model_: 'teammates',
    async prompt(text, options = {}) {
      const answer = await ask({ agent, text: String(text ?? ''), options: options.maxTokens ? { maxTokens: options.maxTokens } : {} });
      return { content: answer?.content ?? '', usage: {}, model: answer?.model ?? null, provider: 'teammates', costUsd: answer?.costUsd ?? 0, workId: answer?.workId ?? null };
    },
  };
}

/**
 * The client the wiki should use for `agent`: `instance` itself standalone, a teammate client hosted.
 * @param {object|null} instance       the provider's client (nooblyjs-core aiservice); not needed hosted
 * @param {{ agent?: string, appBaseDir?: string }} [o]
 */
function routeClient(instance, { agent = 'wiki', appBaseDir } = {}) {
  if (instance?.[ROUTED]) return instance;
  const how = routed(appBaseDir);
  if (how === 'process') return teammateClient(agent, (ask) => runner()(ask));
  if (how === 'bridge') return teammateClient(agent, bridgeAsk(appBaseDir));
  return instance;
}

/**
 * A view of the core service registry whose aiservice() hands back routed clients; everything else is the registry's.
 * Hosted, the wiki's modules are given this instead of the host's registry.
 */
function routedRegistry(registry, { appBaseDir } = {}) {
  return new Proxy(registry, {
    get(target, prop) {
      if (prop === 'aiservice') {
        // Routed, the provider's own client is never built: nothing here can reach it.
        return (provider, options = {}) => (routed(appBaseDir)
          ? routeClient(null, { agent: options.instanceName || provider, appBaseDir })
          : target.aiservice(provider, options));
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

module.exports = { useTeammates, stopTeammates, routed, routeClient, routedRegistry, answersOffline, runner, MARKER };
