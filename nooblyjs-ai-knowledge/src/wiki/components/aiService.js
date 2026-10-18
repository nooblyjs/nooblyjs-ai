/**
 * @fileoverview AI Service Helper
 * Integrates with the noobly service registry for AI providers.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-03
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

/**
 * AI Service Helper Class
 * Provides context-aware AI assistance for wiki operations
 */
class AIService {
  /**
   * @param {Object} serviceRegistry - noobly service registry
   * @param {Object} dataManager - Data manager instance
   * @param {Object} logger - Logger service
   */
  constructor(serviceRegistry, dataManager, logger) {
    this.serviceRegistry = serviceRegistry;
    this.dataManager = dataManager;
    this.logger = logger;
    this.aiClient = null;
    this.userSettings = null;
    this.providerClients = new Map();
  }

  /**
   * Initialize AI service with user-specific settings
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async initialize(userId) {
    try {
      const settings = await this.dataManager.read(`aiSettings_${userId}`);

      if (!settings || !settings.enabled || !settings.provider || !settings.apiKey) {
        this.logger.info(`AI not configured for user ${userId}`);
        return false;
      }

      this.aiClient = await this.createClient(settings, userId);
      this.userSettings = settings;

      this.logger.info(`AI service initialized for user ${userId} with provider ${settings.provider}`);
      return true;
    } catch (error) {
      this.logger.error('Error initializing AI service:', error);
      return false;
    }
  }

  /**
   * Create AI client for specific provider
   * @param {Object} settings - AI settings
   * @returns {Object} AI client instance
   */
  async createClient(settings, userId, options = {}) {
    const provider = settings?.provider;

    if (!provider) {
      throw new Error('AI provider not specified');
    }

    const cacheKey = userId || 'default';
    const temporary = options.temporary === true;
    const providerClientKey = `${provider}:${cacheKey}`;

    if (!temporary && this.providerClients.has(providerClientKey)) {
      return this.providerClients.get(providerClientKey);
    }

    const client = await this.getProviderService(provider, settings);

    if (!temporary) {
      this.providerClients.set(providerClientKey, client);
      this.providerClients.set(`${provider}:latest`, client);
    }

    return client;
  }

  /**
   * Get default model for provider
   * @param {string} provider - AI provider name
   * @returns {string} Default model name
   */
  getDefaultModel(provider) {
    const defaults = {
      claude: 'claude-3-5-sonnet-20241022',
      chatgpt: 'gpt-4',
      ollama: 'llama2'
    };
    return defaults[provider] || 'claude-3-5-sonnet-20241022';
  }

  /**
   * Send a prompt to the AI service
   * @param {string} userMessage - User's message
   * @param {Object} context - Optional context (document, space, etc.)
   * @returns {Promise<Object>} AI response
   */
  async prompt(userMessage, context = {}) {
    if (!this.aiClient || !this.userSettings) {
      throw new Error('AI service not initialized. Please configure AI settings first.');
    }

    try {
      let fullPrompt = userMessage;

      if (context.includeDocumentContext && context.documentContent) {
        fullPrompt = `Context: I'm working on a document titled "${context.documentTitle || 'Untitled'}".\n\nDocument content:\n${context.documentContent}\n\nQuestion: ${userMessage}`;
      } else if (context.includeSpaceContext && context.spaceName) {
        fullPrompt = `Context: I'm working in a wiki space called "${context.spaceName}".\n\nQuestion: ${userMessage}`;
      }

      const model = this.userSettings.model || this.getDefaultModel(this.userSettings.provider);
      const maxTokens = this.userSettings.maxTokens || 4096;
      const temperature = this.userSettings.temperature || 0.7;

      const result = await this.aiClient.prompt(fullPrompt, {
        maxTokens,
        temperature
      });

      const usage = this.normalizeUsage(result.usage);

      return {
        success: true,
        content: result.content,
        usage,
        model: result.model || model,
        provider: result.provider || this.userSettings.provider
      };
    } catch (error) {
      this.logger.error('Error calling AI service:', error);
      throw error;
    }
  }

  async getProviderService(provider, settings) {
    const serviceOptions = await this.buildServiceOptions(provider, settings);
    return this.serviceRegistry.aiservice(provider, serviceOptions);
  }

  async buildServiceOptions(provider, settings) {
    const model = settings.model || this.getDefaultModel(provider);
    const tokensStorePath = this.getTokensStorePath(provider);

    await this.ensureDirectory(tokensStorePath);

    const dependencies = { logging: this.logger };
    const options = {
      model,
      tokensStorePath,
      dependencies
    };

    if (settings.apiKey) {
      options.apiKey = settings.apiKey;
    }

    if (provider === 'ollama') {
      options.baseUrl = settings.endpoint || settings.baseUrl || 'http://localhost:11434';
    } else if (settings.endpoint) {
      options.endpoint = settings.endpoint;
    }

    if (settings.organization) {
      options.organization = settings.organization;
    }

    if (settings.additionalOptions && typeof settings.additionalOptions === 'object') {
      options.additionalOptions = { ...settings.additionalOptions };
    }

    return options;
  }

  getTokensStorePath(provider) {
    const dataDir = this.dataManager?.dataDir || path.join(process.cwd(), '.application');
    return path.resolve(dataDir, 'ai-tokens', `${provider}-service.json`);
  }

  async ensureDirectory(filePath) {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  normalizeUsage(usage = {}) {
    const promptTokens =
      usage.promptTokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const completionTokens =
      usage.completionTokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.output_tokens ?? 0;
    const totalTokens =
      usage.totalTokens ?? usage.total_tokens ?? promptTokens + completionTokens;

    return {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
      promptTokens,
      completionTokens
    };
  }

  /**
   * Test AI connection
   */
  async testConnection(provider, apiKey, model, endpoint) {
    try {
      const testSettings = {
        provider,
        apiKey,
        model: model || this.getDefaultModel(provider),
        endpoint,
        maxTokens: 50,
        temperature: 0.1
      };

      const testClient = await this.createClient(testSettings, 'test', { temporary: true });

      const result = await testClient.prompt('Reply with: Connection successful', {
        maxTokens: 50,
        temperature: 0.1
      });

      const usage = this.normalizeUsage(result.usage);

      return {
        success: true,
        message: 'Connection test successful',
        provider: result.provider || provider,
        model: result.model || testSettings.model,
        tokensUsed: usage.totalTokens
      };
    } catch (error) {
      this.logger.error('AI connection test failed:', error);
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  /**
   * Check if AI service is available
   */
  isAvailable() {
    return this.aiClient !== null;
  }

  /**
   * Retrieve analytics from the active AI client, if supported.
   */
  getAnalytics() {
    if (this.aiClient && typeof this.aiClient.getAnalytics === 'function') {
      try {
        return this.aiClient.getAnalytics();
      } catch (error) {
        this.logger.error('Error retrieving AI analytics:', error);
      }
    }
    return null;
  }
}

module.exports = AIService;
