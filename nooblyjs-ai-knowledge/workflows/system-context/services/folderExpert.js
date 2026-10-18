/**
 * @fileoverview Worker-safe AI expert for the "Folder Processing" usage.
 *
 * The wiki chat and the engineering-code step resolve their AI agent from
 * `global.aiInstances`, the registry the datasources module builds at startup.
 * That registry does NOT exist inside a workflow worker thread (the worker only
 * runs `serviceRegistry.initialize()`, never the datasources bootstrap). So this
 * expert resolves an agent the same way the bootstrap does, but self-contained:
 * it reads the Agents file (`settings-agents.json`), picks the enabled agent
 * that declares the requested usage (default "Folder Processing") — or an
 * explicit agent by name — and builds the AI client directly via
 * `serviceRegistry.aiservice(provider, options)`, which IS available in the
 * worker. If the live registry happens to be present (in-process execution) it
 * is used as a fast path.
 *
 * Every prompt is wrapped in a timeout + retry, because the core AI providers
 * expose no client-side timeout of their own and a local model can stall.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const serviceRegistry = require('nooblyjs-core');
const { retry } = require('../utilities/retry');

/** Turn an agent name into a key-safe slug — matches aiInstances.js. */
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

/**
 * Minimal prompt sanitiser: strip null bytes and C0/C1 control characters that
 * break JSON transport to AI providers, keep tabs/newlines. Mirrors the intent
 * of the backend's AIPrompt.sanitizePrompt without the cross-repo coupling.
 * @param {*} text
 * @returns {string}
 */
function sanitize(text) {
  if (text == null) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\x80-\x9F]/g, '');
}

/**
 * Describe a provider response's token usage for an error message.
 *
 * When a completion comes back empty, the completion-token count is the whole
 * diagnosis: a value sitting exactly on the configured cap means the model spent
 * its entire budget on hidden reasoning and never emitted text — raise the
 * agent's `maxtokens`. Anything else points at a content filter or a bad prompt.
 *
 * @param {*} response - Whatever the provider returned.
 * @returns {string} A parenthesised suffix, or '' when usage is unavailable.
 */
function describeUsage(response) {
  const usage = response && typeof response === 'object' ? response.usage : null;
  if (!usage) return '';
  const completion = usage.completionTokens != null ? usage.completionTokens : usage.completion_tokens;
  const prompt = usage.promptTokens != null ? usage.promptTokens : usage.prompt_tokens;
  if (completion == null) return '';
  return ` (${prompt != null ? `${prompt} prompt / ` : ''}${completion} completion tokens`
    + ' — a completion count sitting on the model\'s cap means the token budget was'
    + ' spent on reasoning before any text was produced; raise the agent\'s maxtokens)';
}

class FolderExpert {

  /**
   * @param {Object} options
   * @param {string} options.appBaseDir - Application base dir (holds configuration/settings).
   * @param {string} [options.usage='Folder Processing'] - Usage tag to select the default agent.
   * @param {string} [options.agentName] - Explicit agent name/slug (takes precedence over usage).
   * @param {Object} [options.logger=console]
   * @param {number} [options.maxTokens] - Optional completion-token cap.
   * @param {number} [options.timeoutMs=0] - Per-prompt wall-clock timeout in ms;
   *   0 = no timeout (a slow local model can run as long as it needs).
   * @param {number} [options.retries=3] - Attempts per prompt.
   * @param {number} [options.retryDelayMs=2000] - Base backoff between attempts.
   */
  constructor(options = {}) {
    this.appBaseDir = options.appBaseDir;
    this.usage = options.usage || 'Folder Processing';
    this.agentName = options.agentName || null;
    this.logger = options.logger || console;
    this.maxTokens = options.maxTokens || null;
    // 0 = no timeout. Default to no timeout so Ollama (a local model that can be
    // slow) is never aborted mid-generation; the retry only fires on real errors.
    // Pass a positive timeoutMs to re-impose a wall-clock cap per prompt.
    this.timeoutMs = options.timeoutMs != null ? options.timeoutMs : 0;
    this.retries = options.retries || 3;
    this.retryDelayMs = options.retryDelayMs || 2000;

    this._instance = null;
    this._agentMeta = null;
  }

  /** @returns {?{name:string, provider:string, source:string}} Resolved-agent info, once a prompt has run. */
  get agentMeta() {
    return this._agentMeta;
  }

  /**
   * Find the agent record to use from the Agents file.
   * @private
   * @returns {Object} The agent record.
   */
  _findAgentInFile() {
    const agentsFile = path.join(this.appBaseDir, 'configuration', 'settings', 'settings-agents.json');
    const raw = fs.readFileSync(agentsFile, 'utf8');
    const parsed = JSON.parse(raw);
    const agents = Array.isArray(parsed) ? parsed : [];
    const enabled = agents.filter((a) => a && a.name && a.provider && a.enabled !== false);

    if (this.agentName) {
      const key = slugify(this.agentName);
      const agent = enabled.find((a) => slugify(a.name) === key);
      if (!agent) {
        throw new Error(`No enabled AI agent named "${this.agentName}" in ${agentsFile}`);
      }
      return agent;
    }

    const matches = enabled.filter((a) => Array.isArray(a.usage) && a.usage.includes(this.usage));
    if (matches.length === 0) {
      throw new Error(
        `No enabled AI agent declares the "${this.usage}" usage in ${agentsFile} — `
        + 'tick it on an agent in the Agents screen, or pass an explicit agent name'
      );
    }
    if (matches.length > 1 && this.logger.warn) {
      this.logger.warn(
        `Folder Processing: ${matches.length} agents declare "${this.usage}" `
        + `(${matches.map((m) => m.name).join(', ')}) — using "${matches[0].name}"`
      );
    }
    return matches[0];
  }

  /**
   * Resolve (and cache) the underlying AI client instance.
   * @returns {Object} An object exposing prompt(text, options).
   */
  resolveInstance() {
    if (this._instance) return this._instance;

    // Fast path: live registry (only present when a step runs in-process).
    const registry = global.aiInstances;
    if (registry && typeof registry.findByUsage === 'function') {
      let entry = null;
      if (this.agentName) {
        const inst = registry.get(this.agentName);
        entry = inst ? registry.list().find((e) => e.instance === inst) : null;
      } else {
        entry = registry.findByUsage(this.usage)[0] || null;
      }
      if (entry) {
        this._instance = entry.instance;
        this._agentMeta = { name: entry.name, provider: entry.provider, source: 'global.aiInstances' };
        this.logger.info && this.logger.info(`Folder Processing: using agent "${entry.name}" [${entry.provider}] (live registry)`);
        return this._instance;
      }
    }

    // Worker-safe path: build the client from the Agents file, exactly the way
    // the datasources bootstrap (aiInstances.js) does.
    const agent = this._findAgentInFile();
    const slug = slugify(agent.name);
    let expressApp;
    try { expressApp = require('express')(); } catch (_) { expressApp = undefined; }
    const tokensStorePath = path.join(this.appBaseDir, 'data', 'ai-tokens', `${slug}.json`);

    const instance = serviceRegistry.aiservice(agent.provider, {
      instanceName: slug,
      ...(agent.options || {}),
      ...(expressApp ? { 'express-app': expressApp } : {}),
      tokensStorePath,
    });

    this._instance = instance;
    this._agentMeta = { name: agent.name, provider: agent.provider, source: 'settings-agents.json' };
    this.logger.info && this.logger.info(`Folder Processing: using agent "${agent.name}" [${agent.provider}] (settings-agents.json)`);
    return instance;
  }

  /**
   * Send a system + user prompt and return the model's text, with timeout+retry.
   *
   * An EMPTY completion is treated as a failed attempt, not as an answer. It is
   * the characteristic failure of a reasoning model whose completion budget is
   * consumed by hidden reasoning tokens: the provider returns HTTP 200 with
   * `content: ''` and no error at all. Returning that empty string let callers
   * persist a "(summary unavailable)" placeholder and report the run as a
   * success — on one deployment that silently degraded 1,018 of 5,710 context
   * sidecars before anyone noticed. Raising it inside the retry means a genuinely
   * transient empty gets another attempt, and a persistent one fails loudly with
   * the token counts that explain why.
   *
   * @param {string} systemContent
   * @param {string} userContent
   * @returns {Promise<string>} Non-empty model text.
   * @throws {Error} When every attempt fails or returns empty content.
   */
  async prompt(systemContent, userContent) {
    const instance = this.resolveInstance();
    const safeSystem = sanitize(systemContent);
    const safeUser = sanitize(userContent);
    // Core providers take a single combined prompt; prepend the system text.
    const combined = safeSystem ? `${safeSystem}\n\n${safeUser}` : safeUser;
    const options = {};
    if (this.maxTokens) options.maxTokens = this.maxTokens;

    return retry(
      async () => {
        const response = await instance.prompt(combined, options);
        const raw = (response && typeof response === 'object') ? response.content : response;
        const text = raw == null ? '' : String(raw);
        if (!text.trim()) {
          throw new Error(`empty completion from the model${describeUsage(response)}`);
        }
        return text;
      },
      {
        retries: this.retries,
        delayMs: this.retryDelayMs,
        timeoutMs: this.timeoutMs,
        label: 'AI prompt',
        logger: this.logger,
      }
    );
  }
}

module.exports = FolderExpert;
module.exports.slugify = slugify;
