/**
 * @fileoverview Prompt Library API Routes for the Datasources Module.
 *
 * CRUD over the shared prompt store (`shared/prompts/promptStore.js`) plus a
 * test-bench endpoint that runs a prompt as the SYSTEM prompt against a
 * configured agent with a user-supplied input, so an author can see what a
 * prompt actually produces before anything depends on it.
 *
 * Prompts are read back by key elsewhere in the platform:
 *   const { prompts } = require('.../shared/prompts/promptStore');
 *   prompts.get('document-processing-pdf');
 *
 * Endpoints:
 * - GET    /api/prompts                 List (filters: category, status, search)
 * - GET    /api/prompts/categories      Distinct categories in use
 * - GET    /api/prompts/:id             One prompt (by id or key)
 * - POST   /api/prompts                 Create
 * - PUT    /api/prompts/:id             Update
 * - DELETE /api/prompts/:id             Delete
 * - POST   /api/prompts/test            Run ad-hoc content (unsaved editor text)
 * - POST   /api/prompts/:id/test        Run a saved prompt
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const { configure, applyVariables } = require('../../shared/prompts/promptStore');
const { resolveExpert } = require('../../shared/ai/expertResolver');

/** Usage tag used to pick an agent when the tester does not name one. */
const DEFAULT_TEST_USAGE = 'Chat Processing';

/** Hard cap on test input so the bench can't be used to push huge payloads. */
const MAX_TEST_INPUT_CHARS = 100000;

/**
 * Register prompt library routes.
 * @param {string} type - Instance name (registry convention, unused here)
 * @param {Object} options - { 'express-app', dependencies }
 * @param {Object} eventEmitter - Global event emitter
 */
module.exports = function (type, options, eventEmitter) {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const { log, appBaseDir } = dependencies;

  // Bind the shared default store to the server's base dir, so `prompts.get()`
  // from in-process code resolves the same file the UI writes — regardless of
  // whether APP_BASE_DIR is set in the environment.
  const store = configure({ appBaseDir });

  // Write the store out at boot and add any built-in the file predates. The
  // workflow steps in the sibling workflows repo read prompts by key off this
  // same file, and a missing key throws — so the file must exist and be complete
  // before the first workflow runs, not merely after someone opens this screen.
  const seeded = store.ensureDefaults();
  if (seeded.length) {
    log?.info(`Prompt library: added built-in prompt(s): ${seeded.join(', ')}`);
  }

  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  };

  const ok = (res, data, extra = {}) => res.status(200).json({
    success: true, data, ...extra, timestamp: new Date().toISOString()
  });

  const fail = (res, status, error) => res.status(status).json({ success: false, error });

  /**
   * Map a store error onto an HTTP status: "not found" is 404, everything else
   * a store rejects is a bad payload (duplicate key, missing name, empty body).
   */
  const writeError = (res, error, action) => {
    log?.error(`Failed to ${action} prompt:`, error.message);
    const status = /not found/i.test(error.message) ? 404 : 400;
    return fail(res, status, error.message);
  };

  /** Whitelist of client-settable fields — never let a client set id/executions. */
  const readPayload = (body = {}) => ({
    key: body.key,
    name: body.name,
    description: body.description,
    category: body.category,
    tags: body.tags,
    status: body.status,
    agent: body.agent,
    content: body.content
  });

  // ============================================
  // READ
  // ============================================

  /**
   * GET /api/prompts
   * List prompts with the library stats and categories, so the screen renders
   * from a single request.
   */
  app.get('/api/prompts', requireAuth, (req, res) => {
    try {
      const { category, status, search } = req.query;
      const prompts = store.list({ category, status, search });
      return ok(res, {
        stats: store.stats(),
        categories: store.categories(),
        prompts,
        total: prompts.length
      });
    } catch (error) {
      log?.error('Failed to list prompts:', error.message);
      return fail(res, 500, 'Failed to load prompts');
    }
  });

  /**
   * GET /api/prompts/categories
   * MUST stay above /api/prompts/:id — otherwise 'categories' matches as an id.
   */
  app.get('/api/prompts/categories', requireAuth, (req, res) => {
    try {
      return ok(res, store.categories());
    } catch (error) {
      log?.error('Failed to load prompt categories:', error.message);
      return fail(res, 500, 'Failed to load categories');
    }
  });

  /**
   * GET /api/prompts/:id
   * Accepts either the record id or the lookup key.
   */
  app.get('/api/prompts/:id', requireAuth, (req, res) => {
    try {
      const prompt = store.find(req.params.id);
      if (!prompt) return fail(res, 404, 'Prompt not found');
      return ok(res, prompt);
    } catch (error) {
      log?.error('Failed to load prompt:', error.message);
      return fail(res, 500, 'Failed to load prompt');
    }
  });

  // ============================================
  // WRITE
  // ============================================

  /**
   * POST /api/prompts
   * Create a prompt. The key defaults to a slug of the name and must be unique.
   */
  app.post('/api/prompts', requireAuth, async (req, res) => {
    try {
      const created = await store.create(readPayload(req.body));
      log?.info(`Prompt created: ${created.key}`);
      return res.status(201).json({
        success: true,
        data: created,
        message: 'Prompt created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      return writeError(res, error, 'create');
    }
  });

  /**
   * PUT /api/prompts/:id
   * Update a prompt. Changing the body bumps its version.
   */
  app.put('/api/prompts/:id', requireAuth, async (req, res) => {
    try {
      const updated = await store.update(req.params.id, readPayload(req.body));
      log?.info(`Prompt updated: ${updated.key} (v${updated.version})`);
      return ok(res, updated, { message: 'Prompt updated successfully' });
    } catch (error) {
      return writeError(res, error, 'update');
    }
  });

  /**
   * DELETE /api/prompts/:id
   */
  app.delete('/api/prompts/:id', requireAuth, async (req, res) => {
    try {
      const deleted = await store.remove(req.params.id);
      log?.info(`Prompt deleted: ${deleted.key}`);
      return ok(res, deleted, { message: 'Prompt deleted successfully' });
    } catch (error) {
      return writeError(res, error, 'delete');
    }
  });

  // ============================================
  // TEST BENCH
  // ============================================

  /**
   * Run `system` + `input` against a configured agent and return the reply.
   * @param {Object} params
   * @param {string} params.system - Resolved system prompt text.
   * @param {string} params.input - User input.
   * @param {string} [params.agent] - Agent name/slug; falls back to the usage tag.
   * @param {number} [params.maxTokens]
   * @returns {Promise<Object>} { response, agent, model, durationMs }
   */
  async function runPrompt({ system, input, agent, maxTokens }) {
    const expert = resolveExpert({
      agentName: agent || undefined,
      usage: agent ? undefined : DEFAULT_TEST_USAGE,
      logger: log,
      label: 'Prompt test',
      maxTokens: maxTokens || undefined
    });
    const startedAt = Date.now();
    const response = await expert.prompt(system, input);
    return {
      response: response || '',
      agent: agent || DEFAULT_TEST_USAGE,
      model: expert.modelName || null,
      durationMs: Date.now() - startedAt
    };
  }

  /**
   * Validate the shared test payload.
   * @returns {{input:string, agent:string, maxTokens:number, variables:Object}|null}
   */
  function readTestPayload(body = {}) {
    const input = String(body.input || body.userInput || '');
    if (input.length > MAX_TEST_INPUT_CHARS) return null;
    return {
      input,
      agent: String(body.agent || '').trim(),
      maxTokens: Number(body.maxTokens) || 0,
      variables: (body.variables && typeof body.variables === 'object') ? body.variables : {}
    };
  }

  /** Turn an AI failure into a 502 with the provider's message intact. */
  function testError(res, error) {
    log?.error('Prompt test failed:', error.message);
    return fail(res, 502, error.message);
  }

  /**
   * POST /api/prompts/test
   * Run UNSAVED editor content — lets an author iterate before committing a
   * prompt to the library. Body: { content, input, agent?, variables? }
   */
  app.post('/api/prompts/test', requireAuth, async (req, res) => {
    const payload = readTestPayload(req.body);
    if (!payload) return fail(res, 400, `Input exceeds ${MAX_TEST_INPUT_CHARS} characters`);

    const content = String(req.body.content || '');
    if (!content.trim()) return fail(res, 400, 'Prompt content is required');

    try {
      const result = await runPrompt({
        system: applyVariables(content, payload.variables),
        input: payload.input,
        agent: payload.agent,
        maxTokens: payload.maxTokens
      });
      return ok(res, result);
    } catch (error) {
      return testError(res, error);
    }
  });

  /**
   * POST /api/prompts/:id/test
   * Run a saved prompt as the system prompt with the supplied user input.
   * Body: { input, agent?, variables?, maxTokens? }
   */
  app.post('/api/prompts/:id/test', requireAuth, async (req, res) => {
    const prompt = store.find(req.params.id);
    if (!prompt) return fail(res, 404, 'Prompt not found');

    const payload = readTestPayload(req.body);
    if (!payload) return fail(res, 400, `Input exceeds ${MAX_TEST_INPUT_CHARS} characters`);

    try {
      const result = await runPrompt({
        system: applyVariables(prompt.content, payload.variables),
        // The prompt's own default agent applies when the tester picks none.
        agent: payload.agent || prompt.agent,
        input: payload.input,
        maxTokens: payload.maxTokens
      });
      // Best-effort usage counter — never fails the response.
      await store.recordUsage(prompt.id);
      return ok(res, { ...result, promptKey: prompt.key, version: prompt.version });
    } catch (error) {
      return testError(res, error);
    }
  });

  log?.info(`✓ Prompt library routes registered (store: ${store.filePath})`);
};
