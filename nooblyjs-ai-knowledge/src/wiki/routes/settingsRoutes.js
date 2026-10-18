/**
 * @fileoverview Settings API routes for Wiki application
 * Handles AI/LLM configuration and other application settings
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2025-10-03
 */

'use strict';

/**
 * Configures and registers settings routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { dataManager, filing, cache, log, queue, search, aiService } = services;
  const logger = log; // Alias for backward compatibility

  // Get AI settings
  app.get('/applications/wiki/api/settings/ai', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.id;
      const cacheKey = `wiki:settings:ai:${userId}`;

      // Try cache first
      let aiSettings = await cache.get(cacheKey);

      if (!aiSettings) {
        // Load from dataManager
        try {
          aiSettings = await dataManager.read(`aiSettings_${userId}`);

          if (!aiSettings) {
            // Return default settings
            aiSettings = {
              provider: '',
              apiKey: '',
              model: '',
              temperature: 0.7,
              maxTokens: 4096,
              endpoint: '',
              enabled: false
            };
          }

          // Cache for 30 minutes
          await cache.put(cacheKey, aiSettings, 1800);
        } catch (error) {
          logger.error('Error loading AI settings:', error);
          // Return defaults
          aiSettings = {
            provider: '',
            apiKey: '',
            model: '',
            temperature: 0.7,
            maxTokens: 4096,
            endpoint: '',
            enabled: false
          };
        }
      }

      // Don't send the full API key to the client for security
      const safeSettings = {
        ...aiSettings,
        apiKey: aiSettings.apiKey ? '••••••••' + aiSettings.apiKey.slice(-4) : ''
      };

      res.json(safeSettings);
    } catch (error) {
      logger.error('Error fetching AI settings:', error);
      res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
  });

  // Save AI settings
  app.post('/applications/wiki/api/settings/ai', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.id;
      const {
        provider,
        apiKey,
        model,
        temperature,
        maxTokens,
        endpoint,
        enabled
      } = req.body;

      // Load existing settings to preserve API key if not changed
      let existingSettings;
      try {
        existingSettings = await dataManager.read(`aiSettings_${userId}`);
      } catch (error) {
        logger.info('No existing AI settings found, creating new');
      }

      // Determine final API key (preserve existing if masked)
      let finalApiKey = apiKey;
      if (apiKey && apiKey.startsWith('••••••••') && existingSettings?.apiKey) {
        // User didn't change the API key, use existing
        finalApiKey = existingSettings.apiKey;
      }

      const aiSettings = {
        provider: provider || '',
        apiKey: finalApiKey || '',
        model: model || '',
        temperature: parseFloat(temperature) || 0.7,
        maxTokens: parseInt(maxTokens) || 4096,
        endpoint: endpoint || '',
        enabled: enabled || false,
        updatedAt: new Date().toISOString()
      };

      // Save settings
      await dataManager.write(`aiSettings_${userId}`, aiSettings);

      // Clear cache
      const cacheKey = `wiki:settings:ai:${userId}`;
      await cache.delete(cacheKey);

      logger.info(`AI settings saved for user ${userId}`);

      res.json({
        success: true,
        message: 'AI settings saved successfully'
      });
    } catch (error) {
      logger.error('Error saving AI settings:', error);
      res.status(500).json({ error: 'Failed to save AI settings' });
    }
  });

  // Test AI connection
  app.post('/applications/wiki/api/settings/ai/test', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { provider, apiKey, model, endpoint } = req.body;

      if (!provider || !apiKey) {
        return res.status(400).json({ error: 'Provider and API key are required' });
      }

      logger.info(`Testing ${provider} connection for user ${req.user.id}`);

      // Use AI service to test the connection
      const result = await aiService.testConnection(provider, apiKey, model, endpoint);

      res.json(result);
    } catch (error) {
      logger.error('Error testing AI connection:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to test AI connection'
      });
    }
  });
};
