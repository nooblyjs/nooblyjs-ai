/**
 * @fileoverview Dashboard Routes - All dashboard API endpoints
 * Provides endpoints for workflow, sources, prompts, and settings data
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const { promises: fsPromises } = require('node:fs');
const path = require('node:path');
const { reloadAIInstances } = require('../lib/aiInstances');

/**
 * noobly Wiki Datasources
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - noobly Core services (dataServe, filing, cache, logger, queue, search)
 * @returns {void}
 */
module.exports = (type, options, eventEmitter) => {

  const app = options.app || options['express-app'];
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;
  const filing = dependencies.filing;
  const serviceRegistry = dependencies.serviceRegistry;
  const appBaseDir = dependencies.appBaseDir;

  // Persisted settings live under <APP_BASE_DIR>/configuration/settings/.
  const settingsDir = path.join(appBaseDir, 'configuration', 'settings');

  const apiDir = path.join(__dirname, '../routes/sample');

  /**
   * Helper function: Suppress console output for production
   */
  const logError = (message, error) => {
    // Errors are only logged if a logger service is available
    // In production, errors should be handled by proper error handling middleware
    if (logger && typeof logger.error === 'function') {
      logger.error(message, error);
    }
  };

  // Helper function to load JSON data
  function loadData(filename) {
    try {
      const filePath = path.join(apiDir, filename);
      const rawData = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      return null;
    }
  }

  // ============================================
  // MARKDOWN SOURCES ROUTES
  // ============================================

  /**
   * GET /api/sources
   * Retrieve all markdown sources
   */
  app.get('/api/sources', (req, res) => {
    const data = loadData('markdown-sources.json');
    if (!data) {
      return res.status(500).json({ success: false, error: 'Failed to load data' });
    }
    res.status(200).json({
      success: true,
      data: data.sources,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /api/sources/:sourceId
   * Retrieve specific source details
   */
  app.get('/api/sources/:sourceId', (req, res) => {
    const data = loadData('markdown-sources.json');
    if (!data) {
      return res.status(500).json({ success: false, error: 'Failed to load data' });
    }
    const source = data.sources.find(s => s.id === req.params.sourceId);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }
    res.status(200).json({
      success: true,
      data: source,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * POST /api/sources/:sourceId/browse
   * Browse source files
   */
  app.post('/api/sources/:sourceId/browse', (req, res) => {
    const data = loadData('markdown-sources.json');
    if (!data) {
      return res.status(500).json({ success: false, error: 'Failed to load data' });
    }
    const source = data.sources.find(s => s.id === req.params.sourceId);
    if (!source) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }
    res.status(200).json({
      success: true,
      message: `Browsing source: ${source.name}`,
      sourceId: source.id,
      path: source.path,
      timestamp: new Date().toISOString()
    });
  });

  // PROMPT LIBRARY ROUTES — moved to routes/promptRoutes.js.
  // The read-only endpoints that used to live here served a static, empty
  // sample file. They are replaced by the file-backed prompt store
  // (shared/prompts/promptStore.js) with full CRUD and a test bench.

  // ============================================
  // SETTINGS ROUTES
  // ============================================

  // Helper function to get settings file path
  function getSettingsPath() {
    return path.join(settingsDir, 'settings-general.json');
  }

  // Helper function to get default settings
  function getDefaultSettings() {
    return {
      general: {
        workingDirectory: 'data-temp',
        autoRecovery: false,
        autoRecoveryDescription: 'Automatically recover workflow execution state on application restart'
      },
      dataConnections: [],
      agentConfiguration: [],
      notifications: [],
      apiKeys: []
    };
  }

  // Helper function to load settings from file
  async function loadSettingsFile() {
    try {
      const filePath = getSettingsPath();
      const rawData = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      // Return default settings if file doesn't exist or is invalid
      if (error.code === 'ENOENT') {
        return getDefaultSettings();
      }
      logError('Error loading settings:', error);
      return getDefaultSettings();
    }
  }

  // Helper function to save settings to file
  async function saveSettingsFile(data) {
    try {
      const filePath = getSettingsPath();
      const dir = path.dirname(filePath);

      // Ensure directory exists
      await fsPromises.mkdir(dir, { recursive: true });

      // Write settings file
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logError('Error saving settings:', error);
      throw error;
    }
  }

  /**
   * GET /api/settings
   * Retrieve all settings
   */
  app.get('/api/settings', async (req, res) => {
    try {
      const data = await loadSettingsFile();
      res.status(200).json({
        success: true,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to load settings' });
    }
  });

  /**
   * GET /api/settings/:section
   * Retrieve specific settings section
   */
  app.get('/api/settings/:section', async (req, res) => {
    try {
      const data = await loadSettingsFile();
      const section = data[req.params.section];
      if (!section) {
        return res.status(404).json({ success: false, error: 'Settings section not found' });
      }
      res.status(200).json({
        success: true,
        data: section,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to load settings' });
    }
  });

  /**
   * PUT /api/settings
   * Update all settings
   */
  app.put('/api/settings', async (req, res) => {
    try {
      const updatedSettings = req.body;

      // Validate that required sections exist
      if (!updatedSettings.general) {
        return res.status(400).json({
          success: false,
          error: 'Settings must include a general section'
        });
      }

      // Ensure all required sections exist (use defaults for missing ones)
      const defaultSettings = {
        general: {},
        dataConnections: [],
        agentConfiguration: [],
        notifications: [],
        apiKeys: []
      };

      const mergedSettings = {
        ...defaultSettings,
        ...updatedSettings
      };

      // Save settings to file
      await saveSettingsFile(mergedSettings);

      res.status(200).json({
        success: true,
        message: 'Settings updated successfully',
        data: mergedSettings,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating settings:', error);
      res.status(500).json({ success: false, error: 'Failed to save settings' });
    }
  });

  /**
   * PUT /api/settings/:section
   * Update specific settings section
   */
  app.put('/api/settings/:section', async (req, res) => {
    try {
      const data = await loadSettingsFile();
      if (!data[req.params.section]) {
        return res.status(404).json({ success: false, error: 'Settings section not found' });
      }

      // Update the specific section
      data[req.params.section] = req.body;

      // Save updated settings
      await saveSettingsFile(data);

      res.status(200).json({
        success: true,
        message: `${req.params.section} settings updated successfully`,
        data: data[req.params.section],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating settings section:', error);
      res.status(500).json({ success: false, error: 'Failed to save settings' });
    }
  });

  // ============================================
  // DATA CONNECTIONS ROUTES
  // ============================================

  // Helper function to get connections file path
  function getConnectionsPath() {
    return path.join(settingsDir, 'settings-connections.json');
  }

  // Helper function to load connections from file
  async function loadConnectionsFile() {
    try {
      const filePath = getConnectionsPath();
      const rawData = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      logError('Error loading connections:', error);
      return [];
    }
  }

  // Helper function to save connections to file
  async function saveConnectionsFile(data) {
    try {
      const filePath = getConnectionsPath();
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logError('Error saving connections:', error);
      throw error;
    }
  }

  // Helper function to generate unique ID
  function generateId() {
    return 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * GET /api/connections
   * Retrieve all data connections
   */
  app.get('/api/connections', async (req, res) => {
    try {
      const connections = await loadConnectionsFile();
      res.status(200).json({
        success: true,
        data: connections,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading connections:', error);
      res.status(500).json({ success: false, error: 'Failed to load connections' });
    }
  });

  /**
   * GET /api/connections/:id
   * Retrieve specific connection by ID
   */
  app.get('/api/connections/:id', async (req, res) => {
    try {
      const connections = await loadConnectionsFile();
      const connection = connections.find(c => c.id === req.params.id);
      if (!connection) {
        return res.status(404).json({ success: false, error: 'Connection not found' });
      }
      res.status(200).json({
        success: true,
        data: connection,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading connection:', error);
      res.status(500).json({ success: false, error: 'Failed to load connection' });
    }
  });

  /**
   * POST /api/connections
   * Create a new data connection
   */
  app.post('/api/connections', async (req, res) => {
    try {
      const { name, type, config } = req.body;

      if (!name || !type || !config) {
        return res.status(400).json({
          success: false,
          error: 'Name, type, and config are required'
        });
      }

      const connections = await loadConnectionsFile();
      const newConnection = {
        id: generateId(),
        name,
        type,
        config
      };

      connections.push(newConnection);
      await saveConnectionsFile(connections);

      res.status(201).json({
        success: true,
        data: newConnection,
        message: 'Connection created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating connection:', error);
      res.status(500).json({ success: false, error: 'Failed to create connection' });
    }
  });

  /**
   * PUT /api/connections/:id
   * Update a data connection
   */
  app.put('/api/connections/:id', async (req, res) => {
    try {
      const { name, type, config } = req.body;
      const connections = await loadConnectionsFile();
      const connectionIndex = connections.findIndex(c => c.id === req.params.id);

      if (connectionIndex === -1) {
        return res.status(404).json({ success: false, error: 'Connection not found' });
      }

      // Update connection while preserving ID
      connections[connectionIndex] = {
        id: connections[connectionIndex].id,
        name: name || connections[connectionIndex].name,
        type: type || connections[connectionIndex].type,
        config: config || connections[connectionIndex].config
      };

      await saveConnectionsFile(connections);

      res.status(200).json({
        success: true,
        data: connections[connectionIndex],
        message: 'Connection updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating connection:', error);
      res.status(500).json({ success: false, error: 'Failed to update connection' });
    }
  });

  /**
   * DELETE /api/connections/:id
   * Delete a data connection
   */
  app.delete('/api/connections/:id', async (req, res) => {
    try {
      const connections = await loadConnectionsFile();
      const connectionIndex = connections.findIndex(c => c.id === req.params.id);

      if (connectionIndex === -1) {
        return res.status(404).json({ success: false, error: 'Connection not found' });
      }

      const deletedConnection = connections.splice(connectionIndex, 1)[0];
      await saveConnectionsFile(connections);

      res.status(200).json({
        success: true,
        data: deletedConnection,
        message: 'Connection deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting connection:', error);
      res.status(500).json({ success: false, error: 'Failed to delete connection' });
    }
  });

  // ============================================
  // AGENTS ROUTES
  // ============================================

  // Helper function to get agents file path
  function getAgentsPath() {
    return path.join(settingsDir, 'settings-agents.json');
  }

  // Helper function to load agents from file
  async function loadAgentsFile() {
    try {
      const filePath = getAgentsPath();
      const rawData = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      logError('Error loading agents:', error);
      return [];
    }
  }

  // Helper function to save agents to file
  async function saveAgentsFile(data) {
    try {
      const filePath = getAgentsPath();
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logError('Error saving agents:', error);
      throw error;
    }
  }

  // Rebuild the AI instance registry so agent changes take effect on the next
  // request. Non-throwing: a reload failure must not fail a create/update/
  // delete that already persisted successfully.
  async function reloadAgentInstances() {
    try {
      await reloadAIInstances();
    } catch (error) {
      logError('Failed to reload AI instances after agent change:', error);
    }
  }

  /**
   * GET /api/agents
   * Retrieve all agents
   */
  app.get('/api/agents', async (req, res) => {
    try {
      const agents = await loadAgentsFile();
      res.status(200).json({
        success: true,
        data: agents,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading agents:', error);
      res.status(500).json({ success: false, error: 'Failed to load agents' });
    }
  });

  /**
   * GET /api/agents/:id
   * Retrieve specific agent by ID
   */
  app.get('/api/agents/:id', async (req, res) => {
    try {
      const agents = await loadAgentsFile();
      const agent = agents.find(a => a.id === req.params.id);
      if (!agent) {
        return res.status(404).json({ success: false, error: 'Agent not found' });
      }
      res.status(200).json({
        success: true,
        data: agent,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading agent:', error);
      res.status(500).json({ success: false, error: 'Failed to load agent' });
    }
  });

  /**
   * POST /api/agents
   * Create a new agent
   */
  app.post('/api/agents', async (req, res) => {
    try {
      const { name, description, provider, options, usage, enabled } = req.body;

      if (!name || !provider) {
        return res.status(400).json({
          success: false,
          error: 'Name and provider are required'
        });
      }

      const agents = await loadAgentsFile();
      const newAgent = {
        id: 'agent-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        name,
        description: description || '',
        provider,
        enabled: enabled !== false,
        usage: Array.isArray(usage) ? usage : [],
        options: options || {}
      };

      agents.push(newAgent);
      await saveAgentsFile(agents);
      await reloadAgentInstances();

      res.status(201).json({
        success: true,
        data: newAgent,
        message: 'Agent created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating agent:', error);
      res.status(500).json({ success: false, error: 'Failed to create agent' });
    }
  });

  /**
   * PUT /api/agents/:id
   * Update an agent
   */
  app.put('/api/agents/:id', async (req, res) => {
    try {
      const { name, description, provider, options, usage, enabled } = req.body;
      const agents = await loadAgentsFile();
      const agentIndex = agents.findIndex(a => a.id === req.params.id);

      if (agentIndex === -1) {
        return res.status(404).json({ success: false, error: 'Agent not found' });
      }

      const current = agents[agentIndex];

      // Update agent while preserving ID
      agents[agentIndex] = {
        id: current.id,
        name: name || current.name,
        description: description !== undefined ? description : current.description,
        provider: provider || current.provider,
        enabled: enabled !== undefined ? enabled !== false : current.enabled !== false,
        usage: usage !== undefined ? (Array.isArray(usage) ? usage : []) : (current.usage || []),
        options: options !== undefined ? options : current.options
      };

      await saveAgentsFile(agents);
      await reloadAgentInstances();

      res.status(200).json({
        success: true,
        data: agents[agentIndex],
        message: 'Agent updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating agent:', error);
      res.status(500).json({ success: false, error: 'Failed to update agent' });
    }
  });

  /**
   * DELETE /api/agents/:id
   * Delete an agent
   */
  app.delete('/api/agents/:id', async (req, res) => {
    try {
      const agents = await loadAgentsFile();
      const agentIndex = agents.findIndex(a => a.id === req.params.id);

      if (agentIndex === -1) {
        return res.status(404).json({ success: false, error: 'Agent not found' });
      }

      const deletedAgent = agents.splice(agentIndex, 1)[0];
      await saveAgentsFile(agents);
      await reloadAgentInstances();

      res.status(200).json({
        success: true,
        data: deletedAgent,
        message: 'Agent deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting agent:', error);
      res.status(500).json({ success: false, error: 'Failed to delete agent' });
    }
  });

  // ============================================
  // SECURITY SETTINGS ROUTES
  // ============================================

  // REMOVED: Old security helper functions (getSecurityPath, loadSecurityFile, saveSecurityFile, isValidEmail)
  // These have been replaced by SecurityManager in securityRoutes.js for proper RBAC

  /**
   * GET /api/security
   * Retrieve all authorized emails
   */
  // REMOVED: Old /api/security endpoints (lines 789-877)
  // These have been replaced by new endpoints in securityRoutes.js that use SecurityManager
  // for proper role-based access control (RBAC)

  // ============================================
  // NOTIFICATIONS SETTINGS ROUTES
  // ============================================

  // Helper function to get notifications file path
  function getNotificationsPath() {
    return path.join(settingsDir, 'settings-notifications.json');
  }

  // Helper function to load notifications from file
  async function loadNotificationsFile() {
    try {
      const filePath = getNotificationsPath();
      const rawData = await fsPromises.readFile(filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      logError('Error loading notifications:', error);
      return [];
    }
  }

  // Helper function to save notifications to file
  async function saveNotificationsFile(data) {
    try {
      const filePath = getNotificationsPath();
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (error) {
      logError('Error saving notifications:', error);
      throw error;
    }
  }

  /**
   * GET /api/notifications
   * Retrieve all notification settings
   */
  app.get('/api/notifications', async (req, res) => {
    try {
      const notifications = await loadNotificationsFile();
      res.status(200).json({
        success: true,
        data: notifications,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading notifications:', error);
      res.status(500).json({ success: false, error: 'Failed to load notifications' });
    }
  });

  /**
   * GET /api/notifications/:id
   * Retrieve specific notification setting by ID
   */
  app.get('/api/notifications/:id', async (req, res) => {
    try {
      const notifications = await loadNotificationsFile();
      const notification = notifications.find(n => n.id === req.params.id);
      if (!notification) {
        return res.status(404).json({ success: false, error: 'Notification setting not found' });
      }
      res.status(200).json({
        success: true,
        data: notification,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error loading notification:', error);
      res.status(500).json({ success: false, error: 'Failed to load notification' });
    }
  });

  /**
   * POST /api/notifications
   * Create a new notification setting
   */
  app.post('/api/notifications', async (req, res) => {
    try {
      const { username, connection, path: notifPath } = req.body;

      if (!username || !connection || !notifPath) {
        return res.status(400).json({
          success: false,
          error: 'Username, connection, and path are required'
        });
      }

      const notifications = await loadNotificationsFile();
      const newNotification = {
        id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        username,
        connection,
        path: notifPath
      };

      notifications.push(newNotification);
      await saveNotificationsFile(notifications);

      res.status(201).json({
        success: true,
        data: newNotification,
        message: 'Notification setting created successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating notification:', error);
      res.status(500).json({ success: false, error: 'Failed to create notification' });
    }
  });

  /**
   * PUT /api/notifications/:id
   * Update a notification setting
   */
  app.put('/api/notifications/:id', async (req, res) => {
    try {
      const { username, connection, path: notifPath } = req.body;
      const notifications = await loadNotificationsFile();
      const notificationIndex = notifications.findIndex(n => n.id === req.params.id);

      if (notificationIndex === -1) {
        return res.status(404).json({ success: false, error: 'Notification setting not found' });
      }

      // Update notification while preserving ID
      notifications[notificationIndex] = {
        id: notifications[notificationIndex].id,
        username: username || notifications[notificationIndex].username,
        connection: connection || notifications[notificationIndex].connection,
        path: notifPath || notifications[notificationIndex].path
      };

      await saveNotificationsFile(notifications);

      res.status(200).json({
        success: true,
        data: notifications[notificationIndex],
        message: 'Notification setting updated successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating notification:', error);
      res.status(500).json({ success: false, error: 'Failed to update notification' });
    }
  });

  /**
   * DELETE /api/notifications/:id
   * Delete a notification setting
   */
  app.delete('/api/notifications/:id', async (req, res) => {
    try {
      const notifications = await loadNotificationsFile();
      const notificationIndex = notifications.findIndex(n => n.id === req.params.id);

      if (notificationIndex === -1) {
        return res.status(404).json({ success: false, error: 'Notification setting not found' });
      }

      const deletedNotification = notifications.splice(notificationIndex, 1)[0];
      await saveNotificationsFile(notifications);

      res.status(200).json({
        success: true,
        data: deletedNotification,
        message: 'Notification setting deleted successfully',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting notification:', error);
      res.status(500).json({ success: false, error: 'Failed to delete notification' });
    }
  });

  // ============================================
  // FILING SERVICE MANAGEMENT
  // ============================================

  // Map to store filing service instances (keyed by connection ID)
  const filingInstances = new Map();

  /**
   * POST /api/connections/:id/initialize
   * Initialize a filing service instance for a connection
   */
  app.post('/api/connections/:id/initialize', async (req, res) => {
    try {
      const connectionId = req.params.id;

      // Check if instance already exists
      if (filingInstances.has(connectionId)) {
        return res.status(200).json({
          success: true,
          message: 'Filing service already initialized',
          connectionId,
          timestamp: new Date().toISOString()
        });
      }

      // Load the connection configuration
      const connections = await loadConnectionsFile();
      const connection = connections.find(c => c.id === connectionId);

      if (!connection) {
        return res.status(404).json({
          success: false,
          error: 'Connection not found'
        });
      }

      // Prepare options for filing service
      const filingOptions = {
        ...connection.config,
        'express-app': app,
        dependencies: {
          logging: logger
        }
      };

      // Create filing service instance based on connection type
      // Map connection.type to filing service provider type
      let providerType = connection.type.toLowerCase();

      // Map common connection types to filing provider types
      const typeMapping = {
        'local': 'local',
        'ftp': 'ftp',
        's3': 's3',
        'aws s3': 's3',
        'amazon s3': 's3',
        'git': 'git',
        'github': 'git',
        'gcp': 'gcp',
        'google cloud': 'gcp',
        'api': 'api',
        'rest api': 'api',
        'sync': 'sync'
      };

      providerType = typeMapping[providerType] || 'local';

      // Create the filing service (this auto-registers routes, views, and scripts)
      const filingService = serviceRegistry.filing(providerType, filingOptions);

      // Store the instance
      filingInstances.set(connectionId, {
        service: filingService,
        connection: connection,
        createdAt: new Date()
      });

      res.status(200).json({
        success: true,
        message: 'Filing service initialized successfully',
        connectionId,
        connectionName: connection.name,
        providerType,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error initializing filing service:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to initialize filing service',
        message: error.message
      });
    }
  });

  /**
   * GET /api/connections/:id/status
   * Check if a filing service is initialized for a connection
   */
  app.get('/api/connections/:id/status', async (req, res) => {
    try {
      const connectionId = req.params.id;
      const instance = filingInstances.get(connectionId);

      if (!instance) {
        return res.status(200).json({
          success: true,
          initialized: false,
          connectionId
        });
      }

      res.status(200).json({
        success: true,
        initialized: true,
        connectionId,
        connectionName: instance.connection.name,
        createdAt: instance.createdAt,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error checking filing service status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check filing service status'
      });
    }
  });

}
