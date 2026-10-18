/**
 * @fileoverview AI Instance Bootstrap
 * On datasources startup, reads the configured agents (settings-agents.json)
 * and creates a named aiservice instance for each one via the core service
 * registry. Instances are kept in a registry exposed both on `app` and as
 * `global.aiInstances`, so any module can resolve a shared AI client.
 *
 * The registry can be rebuilt at runtime via reloadAIInstances() — the agent
 * routes call this after any create/update/delete so changes take effect on
 * the very next request, with no restart.
 *
 * Each agent in the file looks like:
 *   { id, name, description, provider, enabled, usage, options }
 * and becomes a registry instance:
 *   serviceRegistry.aiservice(provider, { instanceName, ...options, ... })
 *
 * @author noobly Team
 * @version 1.1.0
 */

'use strict';

const path = require('node:path');
const fsPromises = require('node:fs/promises');

// Last context passed to initializeAIInstances — lets reloadAIInstances()
// rebuild the registry without the caller re-supplying dependencies.
let lastContext = null;

/** Turn an agent name into a route/key-safe slug, e.g. "RAG OpenAI" -> "rag-openai". */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

/**
 * Holds the AI service instances created from the agents file and provides
 * lookup by agent name/slug or by provider.
 */
class AIInstanceRegistry {
  constructor() {
    /** @type {Array<{name:string, slug:string, provider:string, usage:string[], optionsKey:string, instance:Object}>} */
    this.entries = [];
  }

  /** Add an instance with its agent metadata. */
  register(entry) {
    this.entries.push(entry);
  }

  /** Resolve an instance by agent name or slug (case-insensitive). */
  get(nameOrSlug) {
    const key = slugify(nameOrSlug);
    const entry = this.entries.find((e) => e.slug === key);
    return entry ? entry.instance : null;
  }

  /** Resolve the first instance for a given provider ('openai', 'ollama', ...). */
  getByProvider(provider) {
    const entry = this.entries.find((e) => e.provider === provider);
    return entry ? entry.instance : null;
  }

  /**
   * All registered entries that declare the given usage tag (e.g. 'Chat Processing').
   * Only enabled agents are ever registered, so every result is active.
   * @param {string} usageTag
   * @returns {Array<{name:string, slug:string, provider:string, usage:string[], optionsKey:string, instance:Object}>}
   */
  findByUsage(usageTag) {
    return this.entries.filter((e) => Array.isArray(e.usage) && e.usage.includes(usageTag));
  }

  /** All registered instances with their metadata. */
  list() {
    return this.entries.slice();
  }
}

/**
 * Builds the AI instance registry from the agents file. Safe to call
 * repeatedly (see reloadAIInstances()).
 *
 * On a rebuild:
 *  - Unchanged agents keep their existing instance (no re-creation).
 *  - Agents whose provider or options changed are evicted from the core
 *    registry and re-created, so new connection settings take effect.
 *  - Agents removed or disabled since the last load are evicted.
 *
 * Failures for a single agent are logged and skipped — they never abort the
 * rebuild or the other instances.
 *
 * @param {Object} context
 * @param {Object} context.serviceRegistry - Core service registry.
 * @param {Object} context.app - Express app (passed to aiservice as 'express-app').
 * @param {Object} context.log - Logger.
 * @param {string} context.appBaseDir - Base data directory for token stores.
 * @returns {Promise<AIInstanceRegistry>}
 */
async function initializeAIInstances(context) {
  // Remember the context so reloadAIInstances() can rebuild without it.
  lastContext = context;
  const { serviceRegistry, app, log, appBaseDir } = context;

  const previous = global.aiInstances instanceof AIInstanceRegistry ? global.aiInstances : null;
  const registry = new AIInstanceRegistry();

  // Where the datasources Agents screen persists its agents.
  // Must match getAgentsPath() in routes/dashboardRoutes.js.
  const agentsFile = path.join(appBaseDir, 'configuration', 'settings', 'settings-agents.json');

  // Per-instance token store path: <appBaseDir>/data/ai-tokens/<slug>.json
  const tokensStore = (slug) => path.join(appBaseDir, 'data', 'ai-tokens', `${slug}.json`);

  let agents = [];
  try {
    const raw = await fsPromises.readFile(agentsFile, 'utf-8');
    const parsed = JSON.parse(raw);
    agents = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      log.info('No agents file found — no AI instances created');
    } else {
      log.error('Failed to read agents file for AI instance creation:', error.message);
    }
    agents = [];
  }

  // Core registry keys retained by this rebuild — anything from the previous
  // load not listed here is evicted afterwards.
  const keptKeys = new Set();

  for (const agent of agents) {
    if (!agent || !agent.name || !agent.provider) {
      log.warn('Skipping agent with missing name/provider:', JSON.stringify(agent));
      continue;
    }

    // Disabled agents are not instantiated — every registered entry is active.
    if (agent.enabled === false) {
      log.info(`• AI agent "${agent.name}" is disabled — skipping instance creation`);
      continue;
    }

    const slug = slugify(agent.name);
    const usage = Array.isArray(agent.usage) ? agent.usage : [];
    const optionsKey = JSON.stringify(agent.options || {});

    // Reuse the existing instance when nothing that affects the client changed
    // (usage-only changes don't need a new instance).
    const prior = previous && previous.entries.find((e) => e.slug === slug);
    if (prior && prior.provider === agent.provider && prior.optionsKey === optionsKey) {
      registry.register({ name: agent.name, slug, provider: agent.provider, usage, optionsKey, instance: prior.instance });
      keptKeys.add(`aiservice:${agent.provider}:${slug}`);
      log.info(`• AI instance reused: "${agent.name}" [${agent.provider}] (usage: ${usage.join(', ') || 'none'})`);
      continue;
    }

    // New agent, or provider/options changed: evict any stale cached instance
    // so the core registry rebuilds it with the current settings.
    if (prior) {
      serviceRegistry.resetServiceInstance('aiservice', prior.provider, slug);
    }
    serviceRegistry.resetServiceInstance('aiservice', agent.provider, slug);

    try {
      const instance = serviceRegistry.aiservice(agent.provider, {
        instanceName: slug,
        ...(agent.options || {}),
        'express-app': app,
        tokensStorePath: tokensStore(slug)
      });
      registry.register({ name: agent.name, slug, provider: agent.provider, usage, optionsKey, instance });
      keptKeys.add(`aiservice:${agent.provider}:${slug}`);
      log.info(`✓ AI instance created: "${agent.name}" [${agent.provider}] (slug: ${slug}, usage: ${usage.join(', ') || 'none'})`);
    } catch (error) {
      log.error(`✗ Failed to create AI instance "${agent.name}" [${agent.provider}]:`, error.message);
    }
  }

  // Evict instances for agents removed or disabled since the previous load.
  if (previous) {
    for (const old of previous.entries) {
      const key = `aiservice:${old.provider}:${old.slug}`;
      if (!keptKeys.has(key)) {
        serviceRegistry.resetServiceInstance('aiservice', old.provider, old.slug);
        log.info(`• Evicted stale AI instance "${old.name}" [${old.provider}]`);
      }
    }
  }

  // Expose globally and on the app so any module can resolve a shared client.
  global.aiInstances = registry;
  app.set('aiInstances', registry);

  log.info(`✓ AI instances initialized — ${registry.list().length} instance(s) available`);
  return registry;
}

/**
 * Rebuilds the AI instance registry from the (possibly just-changed) agents
 * file. Call after any create/update/delete of an agent so the new
 * configuration is used by the next request — no restart required.
 * @returns {Promise<AIInstanceRegistry|null>} null if never initialized.
 */
async function reloadAIInstances() {
  if (!lastContext) {
    return null;
  }
  return initializeAIInstances(lastContext);
}

module.exports = { initializeAIInstances, reloadAIInstances, AIInstanceRegistry, slugify };
