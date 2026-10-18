/**
 * @fileoverview Space Filing Manager
 * Manages filing service instances for all spaces
 * Provides centralized access to space-specific filing instances
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

class SpaceFilingManager {
  constructor(spaceManager, filing, log, serviceRegistry, appBaseDir) {
    this.spaceManager = spaceManager;
    this.filing = filing;
    this.logger = log;
    this.serviceRegistry = serviceRegistry;
    this.filingInstances = new Map(); // Map<spaceId, filingService>
    this.appBaseDir = appBaseDir || path.join(process.cwd(), '.application');
  }

  /**
   * Initialize filing services for all spaces
   */
  async initialize() {
    try {
      const spaces = this.spaceManager.getAllSpaces();

      this.logger.info('\n═══════════════════════════════════════════════════════════');
      this.logger.info('  INITIALIZING SPACE FILING MANAGER');
      this.logger.info('═══════════════════════════════════════════════════════════');
      this.logger.info(`Total spaces to initialize: ${spaces.length}`);
      this.logger.info('───────────────────────────────────────────────────────────');

      for (const space of spaces) {
        try {
          await this.initializeSpace(space);
        } catch (error) {
          this.logger.warn(`Failed to initialize filing for space ${space.id} (${space.name}): ${error.message}`);
        }
      }

      // Count total files across all spaces using configured baseDirs
      let totalFiles = 0;
      for (const [spaceId] of this.filingInstances) {
        try {
          const space = this.spaceManager.getSpaceById(spaceId);
          if (space && space.configuration?.filing?.baseDir) {
            const baseDir = space.configuration.filing.baseDir;
            const files = await fs.readdir(baseDir);
            totalFiles += files.length;
          }
        } catch (error) {
          // Silently skip if we can't read the directory
        }
      }

      this.logger.info('───────────────────────────────────────────────────────────');
      this.logger.info(`✓ Initialization Complete`);
      this.logger.info(`  Spaces Initialized: ${this.filingInstances.size}`);
      this.logger.info(`  Total Files: ${totalFiles}`);
      this.logger.info('═══════════════════════════════════════════════════════════\n');
    } catch (error) {
      this.logger.error('Failed to initialize SpaceFilingManager:', error.message);
      throw error;
    }
  }

  /**
   * Initialize filing service for a single space
   */
  async initializeSpace(space) {
    if (this.filingInstances.has(space.id)) {
      return; // Already initialized
    }

    try {
      // Get or create filing instance for this space
      // The instance is automatically registered in service registry via serviceRegistry.filing()
      const filingService = await this.createFilingInstance(space);
      this.filingInstances.set(space.id, filingService);

      this.logger.debug(`Initialized filing for space: ${space.name} (ID: ${space.id})`);
    } catch (error) {
      this.logger.warn(`Error initializing filing for space ${space.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get filing instance for a space.
   * Returns the instance created during initialize(); if missing, retrieves it
   * from the registry, and as a last resort lazily creates it from the space
   * config so spaces added (or that failed to init) after startup self-heal.
   */
  async getFilingService(spaceId) {
    // Return existing instance if available (created during initialize())
    if (this.filingInstances.has(spaceId)) {
      return this.filingInstances.get(spaceId);
    }

    const instanceName = `space-${spaceId}`;

    // Not in our map yet — it may already be registered from a prior
    // initialize(). Retrieve it by its exact key WITHOUT creating a new one.
    // Use getServiceInstance(service, provider, instance) — the instance name
    // is not a provider type, so filing(instanceName) would be wrong here.
    if (this.serviceRegistry && typeof this.serviceRegistry.getServiceInstance === 'function') {
      const existing = this.serviceRegistry.getServiceInstance('filing', 'local', instanceName);
      if (existing) {
        this.filingInstances.set(spaceId, existing);
        return existing;
      }
    }

    // Still nothing — lazily initialize from the space's configuration.
    const space = this.spaceManager.getSpaceById(spaceId);
    if (space) {
      this.logger.info(`[SpaceFilingManager] Lazily initializing filing for space ${spaceId} (${space.name})`);
      const filingService = await this.createFilingInstance(space);
      this.filingInstances.set(spaceId, filingService);
      return filingService;
    }

    throw new Error(`Filing service not found for space ${spaceId}: no such space.`);
  }

  /**
   * Create filing instance from space configuration
   */
  async createFilingInstance(space) {
    // Log the raw space object for debugging
    this.logger.info('');
    this.logger.info('  ═══════════════════════════════════════════════════════════');
    this.logger.info(`  SPACE OBJECT DUMP (for debugging):`);
    this.logger.info(`  Complete space object:`, JSON.stringify(space, null, 2));
    this.logger.info('  ───────────────────────────────────────────────────────────');
    this.logger.info(`  SPACE CONFIGURATION DETAILS:`);
    this.logger.info(`  Space ID: ${space.id}`);
    this.logger.info(`  Space Name: ${space.name}`);
    this.logger.info(`  Space Type: ${space.type}`);
    this.logger.info(`  Space.configuration exists: ${space.configuration ? 'YES' : 'NO'}`);
    this.logger.info(`  Space.configuration type: ${typeof space.configuration}`);
    if (space.configuration) {
      this.logger.info(`  Space.configuration keys: ${Object.keys(space.configuration).join(', ')}`);
      this.logger.info(`  Space.configuration.filing exists: ${space.configuration.filing ? 'YES' : 'NO'}`);
      this.logger.info(`  Full configuration object:`, JSON.stringify(space.configuration, null, 2));
    }
    this.logger.info(`  Has Custom Filing Config: ${space.configuration?.filing ? 'YES' : 'NO'}`);
    if (space.configuration?.filing) {
      this.logger.info(`  Custom Filing Config:`);
      this.logger.info(`    - Provider: ${space.configuration.filing.provider}`);
      this.logger.info(`    - Base Dir: ${space.configuration.filing.baseDir}`);
      this.logger.info(`    - Max File Size: ${space.configuration.filing.maxFileSize}`);
      this.logger.info(`    - Allowed Extensions: ${JSON.stringify(space.configuration.filing.allowedExtensions)}`);
    } else {
      this.logger.info(`  ⚠️ No custom filing config found, will use defaults`);
    }
    this.logger.info('  ═══════════════════════════════════════════════════════════');

    // Get full configuration from space
    const spaceConfig = space.configuration || {};

    this.logger.debug(`Space configuration keys: ${Object.keys(spaceConfig).join(', ')}`);

    // Log filing manager creation details with header
    this.logger.info('');
    this.logger.info('  ───────────────────────────────────────');
    this.logger.info(`  ${space.name}`);
    this.logger.info('  ───────────────────────────────────────');
    this.logger.info(`  ID: ${space.id}`);
    this.logger.info(`  Type: ${space.type}`);
    this.logger.info(`  Visibility: ${space.visibility}`);

    // Create filing instance via service registry with unique instance name
    // Use space's baseDir as the filing service baseDir
    if (this.serviceRegistry && this.serviceRegistry.filing) {
      const instanceName = `space-${space.id}`;
      const filingConfig = spaceConfig.filing || {};
      const baseDir = filingConfig.baseDir || path.join(this.appBaseDir, 'spaces', String(space.id), 'files');

      this.logger.info('');
      this.logger.info(`  📋 REGISTERING FILING INSTANCE:`);
      this.logger.info(`  Instance Name: ${instanceName}`);
      this.logger.info(`  BaseDir: ${baseDir}`);
      this.logger.info(`  Space Configuration:`, JSON.stringify(spaceConfig, null, 2));
      this.logger.info('');

      // Create filing service options from space configuration
      const filingOptions = {
        baseDir: baseDir,
        maxFileSize: filingConfig.maxFileSize || 10485760,
        allowedExtensions: filingConfig.allowedExtensions || ['*'],
        instanceName: instanceName
      };

      this.logger.info(`  Filing Options:`, JSON.stringify(filingOptions, null, 2));

      // The service registry caches filing instances by
      // `filing:local:<instanceName>` and returns the existing one on any later
      // call, ignoring the options passed in. Drop any stale instance first so a
      // changed baseDir (e.g. after editing the space's filing config) is
      // actually applied instead of silently reusing the old directory. This is
      // a no-op at boot when nothing is registered yet.
      if (typeof this.serviceRegistry.resetServiceInstance === 'function') {
        const removed = this.serviceRegistry.resetServiceInstance('filing', 'local', instanceName);
        if (removed) {
          this.logger.info(`  ↻ Reset stale filing instance "${instanceName}" so the new baseDir takes effect`);
        }
      }

      // Create filing instance with local provider
      const filingInstance = this.serviceRegistry.filing('local', filingOptions);

      this.logger.info(`  ✓ Created and registered filing instance: ${instanceName}`);
      return filingInstance;
    } else {
      this.logger.warn(`ServiceRegistry or filing method not available, using default filing instance`);
      return this.filing;
    }
  }



  /**
   * Destroy filing instance for a space
   */
  destroyFilingInstance(spaceId) {
    if (this.filingInstances.has(spaceId)) {
      this.filingInstances.delete(spaceId);
      this.logger.debug(`Destroyed filing instance for space ${spaceId}`);
    }
    // Also drop the registry-cached instance so it isn't silently reused with
    // stale options by a later getFilingService()/createFilingInstance() call
    // (e.g. when a space is deleted or its filing config changes).
    if (this.serviceRegistry && typeof this.serviceRegistry.resetServiceInstance === 'function') {
      this.serviceRegistry.resetServiceInstance('filing', 'local', `space-${spaceId}`);
    }
  }

  /**
   * Update space configuration
   */
  async updateSpaceConfig(spaceId, newConfig) {
    const space = this.spaceManager.getSpaceById(spaceId);
    if (!space) {
      throw new Error(`Space with ID ${spaceId} not found`);
    }

    this.logger.info(`[SpaceFilingManager] Updating configuration for space "${space.name}" (ID: ${spaceId})`);
    this.logger.info(`  - New configuration:`, JSON.stringify(newConfig, null, 2));

    // Update space configuration
    space.configuration = newConfig;

    // Reinitialize filing for this space
    this.logger.info(`[SpaceFilingManager] Reinitializing filing instance for space "${space.name}"`);
    this.destroyFilingInstance(spaceId);
    await this.initializeSpace(space);

    this.logger.info(`✓ Configuration updated for space "${space.name}"`);
    return space;
  }

  /**
   * Get space configuration
   */
  getSpaceConfig(spaceId) {
    const space = this.spaceManager.getSpaceById(spaceId);
    if (!space) {
      throw new Error(`Space with ID ${spaceId} not found`);
    }

    return space.configuration;
  }

  /**
   * Get all filing instances
   */
  getAllFilingInstances() {
    return Array.from(this.filingInstances.entries());
  }

  /**
   * Get statistics about filing instances
   */
  getStatistics() {
    return {
      totalSpaces: this.spaceManager.getAllSpaces().length,
      initializedSpaces: this.filingInstances.size,
      instances: Array.from(this.filingInstances.keys())
    };
  }
}

module.exports = SpaceFilingManager;
