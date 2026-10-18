/**
 * @fileoverview Expert resolver.
 *
 * Resolves a configured AI agent from the Agents registry (global.aiInstances)
 * and returns it wrapped as an AIPrompt "expert" exposing
 * prompt(systemContent, userContent).
 *
 * This is the single implementation of "configured agent -> expert", used by
 * both the wiki chat routes and the workflow steps.
 *
 * @author noobly Team
 * @version 1.0.0
 */
'use strict';

const AIPrompt = require('./aiPrompt');

/**
 * Find a registered agent entry by agent name or slug.
 * @param {Object} registry - The AIInstanceRegistry (global.aiInstances)
 * @param {string} name - Agent name or slug
 * @returns {Object|null} The registry entry, or null if not found
 */
function findEntryByName(registry, name) {
  const instance = registry.get(name);
  if (!instance) {
    return null;
  }
  return registry.list().find((e) => e.instance === instance) || null;
}

/**
 * Resolve a configured AI agent and wrap it as an expert exposing
 * prompt(systemContent, userContent).
 *
 * Selection order:
 *  1. An explicit `agentName` (agent name or slug).
 *  2. Otherwise, the agent that declares the given `usage` tag.
 *
 * Always throws on failure — callers that want to degrade gracefully (e.g.
 * wiki chat) should catch and treat the error as "not configured".
 *
 * @param {Object} options
 * @param {string} [options.usage] - Usage tag identifying the default agent
 * @param {string} [options.agentName] - Explicit agent name/slug (takes precedence)
 * @param {Object} [options.logger] - Logger for info/warn messages
 * @param {string} [options.label='AI'] - Human-readable label for log messages
 * @param {number} [options.maxTokens] - Optional max completion tokens cap
 * @returns {AIPrompt} An expert exposing prompt(systemContent, userContent)
 * @throws {Error} When the registry or a matching agent is unavailable
 */
function resolveExpert(options = {}) {
  const { usage, agentName, logger, label = 'AI', maxTokens } = options;

  const registry = global.aiInstances;
  if (!registry) {
    throw new Error(
      'AI agent registry is not available — initialize the datasources AI '
      + 'instances (global.aiInstances) before resolving an expert'
    );
  }

  let entry;

  // 1. Explicit agent name wins.
  if (agentName) {
    entry = findEntryByName(registry, agentName);
    if (!entry) {
      throw new Error(`No AI agent named "${agentName}" — check the Agents configuration`);
    }
    logger?.info(`${label}: using agent "${entry.name}" [${entry.provider}] (by name)`);
  } else {
    // 2. Otherwise pick the agent tagged with the given usage.
    if (!usage) {
      throw new Error('resolveExpert requires either a usage tag or an agentName');
    }
    const matches = registry.findByUsage(usage);
    if (matches.length === 0) {
      throw new Error(
        `No AI agent declares the "${usage}" usage — tick it on an agent `
        + 'in the Agents screen, or supply an explicit agent name'
      );
    }
    if (matches.length > 1) {
      logger?.warn(
        `${label}: ${matches.length} agents declare "${usage}" `
        + `(${matches.map((m) => m.name).join(', ')}) — using the first: "${matches[0].name}"`
      );
    }
    entry = matches[0];
    logger?.info(`${label}: using agent "${entry.name}" [${entry.provider}]`);
  }

  const expert = new AIPrompt({ instanceName: entry.slug, provider: entry.provider });
  // Model name is reported in response metadata; taken from the instance.
  expert.modelName = entry.instance.model_ || entry.provider;
  if (maxTokens) {
    expert.max_completion_tokens = maxTokens;
  }
  return expert;
}

module.exports = { resolveExpert };
