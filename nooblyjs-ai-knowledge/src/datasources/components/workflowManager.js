/**
 * @fileoverview  Manages workflow CRUD operations and persistence
 * Reads workflows from data-workflows/ directory
 * Each workflow is a folder with workflow-definition.json
 *
 * @author noobly Team
 * @version 1.0.0
 */


const fs = require('node:fs').promises;
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { sanitizeDirectoryName, validateWorkflowPath } = require('../utils/pathSanitizer');

class WorkflowManager {

  constructor(deps = {}) {
    this.dataManager = deps.dataManager;
    this.logger = deps.logger;
    // Workflow definitions live in this repo's workflows/ folder
    // (<repo root>/workflows). Override with WORKFLOWS_PATH env let if located elsewhere.
    this.workflowsPath = process.env.WORKFLOWS_PATH
      || path.resolve(__dirname, '../../../workflows');
    const appBaseDir = deps.appBaseDir || path.join(process.cwd(), '.application');
    this.metadataFile = path.join(appBaseDir, 'workflow', 'workflows-metadata.json'); // Store metadata like starred, viewed
    this.workflows = [];
    this.metadata = {}; // Store per-workflow metadata (starred, lastViewed, etc.)
    this.initialized = false;
  }


  /**
   * Initialize manager - load workflows from data-workflows directory
   */
  async initialize() {
    try {
      // Ensure data-workflows directory exists
      await fs.mkdir(this.workflowsPath, { recursive: true });

      // Load workflows from directory
      await this.loadWorkflows();

      // Load metadata
      await this.loadMetadata();

      this.initialized = true;
      this.logger?.info('WorkflowManager initialized', {
        workflowCount: this.workflows.length,
        path: this.workflowsPath
      });
    } catch (error) {
      this.logger?.error('Failed to initialize WorkflowManager', { error: error.message });
      this.workflows = [];
      this.initialized = true;
    }
  }

  /**
   * Load workflows from data-workflows directory
   * Each workflow is a folder containing workflow-definition.json
   */
  async loadWorkflows() {
    try {
      const entries = await fs.readdir(this.workflowsPath, { withFileTypes: true });
      this.workflows = [];

      // Iterate through subdirectories
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const workflowDir = path.join(this.workflowsPath, entry.name);
        const definitionFile = path.join(workflowDir, 'workflow-definition.json');

        try {
          // Read workflow definition
          const data = await fs.readFile(definitionFile, 'utf8');
          const definition = JSON.parse(data);

          // Create workflow object with directory path
          const workflow = {
            id: entry.name, // Use directory name as ID
            name: definition.name,
            description: definition.description || '',
            steps: definition.steps || [],
            tags: definition.tags || [],
            createdAt: definition.createdAt || new Date().toISOString(),
            updatedAt: definition.updatedAt || new Date().toISOString(),
            path: workflowDir, // Full path to workflow directory
            directoryName: entry.name, // Directory name
            starred: definition.starred || false,
            lastViewed: null // Updated from metadata
          };

          this.workflows.push(workflow);
          this.logger?.info(`Loaded workflow: ${workflow.name} (${workflow.id}, ${workflow.steps.length} steps)`);
        } catch (error) {
          this.logger?.warn(`Failed to load workflow definition from "${entry.name}": ${error.message}`);
        }
      }

      return this.workflows;
    } catch (error) {
      this.logger?.error(`Failed to load workflows: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load metadata (starred, lastViewed, etc.)
   */
  async loadMetadata() {
    try {
      const data = await fs.readFile(this.metadataFile, 'utf8');
      this.metadata = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.metadata = {};
      } else {
        this.logger?.warn('Failed to load metadata', { error: error.message });
      }
    }

    // Apply metadata to workflows
    for (const workflow of this.workflows) {
      const meta = this.metadata[workflow.id];
      if (meta) {
        workflow.starred = meta.starred !== undefined ? meta.starred : workflow.starred;
        workflow.lastViewed = meta.lastViewed || null;
      }
    }
  }

  /**
   * Save metadata to file
   */
  async saveMetadata() {
    try {
      const dir = path.dirname(this.metadataFile);
      await fs.mkdir(dir, { recursive: true });

      // Build metadata object from workflows
      const metadata = {};
      for (const workflow of this.workflows) {
        metadata[workflow.id] = {
          starred: workflow.starred,
          lastViewed: workflow.lastViewed
        };
      }

      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      this.logger?.error('Failed to save metadata', { error: error.message });
      throw error;
    }
  }

  /**
   * Create new workflow by creating directory structure
   * @param {Object} workflowData - Workflow data { name, description, steps, tags }
   * @returns {Object} Created workflow
   */
  async createWorkflow(workflowData) {
    try {
      // Validate workflow
      this.validateWorkflow(workflowData);

      // Sanitize directory name to prevent path traversal
      const directoryName = sanitizeDirectoryName(workflowData.name);

      // Check if directory already exists
      const workflowDir = path.join(this.workflowsPath, directoryName);

      // Validate path to prevent path traversal
      validateWorkflowPath(workflowDir, this.workflowsPath);

      try {
        await fs.stat(workflowDir);
        throw new Error(`Workflow directory already exists: ${directoryName}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      // Create workflow directory
      await fs.mkdir(workflowDir, { recursive: true });

      // Create workflow definition file
      const definition = {
        name: workflowData.name,
        description: workflowData.description || '',
        steps: workflowData.steps || [],
        tags: workflowData.tags || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        starred: false
      };

      const definitionFile = path.join(workflowDir, 'workflow-definition.json');
      await fs.writeFile(definitionFile, JSON.stringify(definition, null, 2));

      // Add to workflows array
      const workflow = {
        id: directoryName,
        ...definition,
        path: workflowDir,
        directoryName: directoryName,
        lastViewed: null
      };

      this.workflows.push(workflow);
      await this.saveMetadata();

      this.logger?.info('Workflow created', {
        id: workflow.id,
        name: workflow.name,
        path: workflowDir
      });

      return workflow;
    } catch (error) {
      this.logger?.error('Failed to create workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Get workflow by ID
   * @param {string} workflowId - Workflow ID (directory name)
   * @returns {Object} Workflow
   */
  getWorkflow(workflowId) {
    const workflow = this.workflows.find(w => w.id === workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    return workflow;
  }

  /**
   * Register a workflow in memory without persisting it to disk.
   * Used for tests and ad-hoc execution where the workflow is supplied
   * directly rather than loaded from the configuration directory.
   * @param {Object} workflow - Workflow object (must include an id)
   * @returns {Object} The registered workflow
   */
  registerWorkflow(workflow) {
    if (!workflow || !workflow.id) {
      throw new Error('registerWorkflow requires a workflow object with an id');
    }
    const index = this.workflows.findIndex(w => w.id === workflow.id);
    if (index !== -1) {
      this.workflows[index] = workflow;
    } else {
      this.workflows.push(workflow);
    }
    this.logger?.info('Workflow registered (in-memory)', {
      id: workflow.id,
      name: workflow.name,
      steps: Array.isArray(workflow.steps) ? workflow.steps.length : 0
    });
    return workflow;
  }

  /**
   * Update workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} updates - Updated fields
   * @returns {Object} Updated workflow
   */
  async updateWorkflow(workflowId, updates) {
    try {
      const workflow = this.getWorkflow(workflowId);

      // Create merged object for validation
      const merged = {
        name: updates.name || workflow.name,
        description: updates.description !== undefined ? updates.description : workflow.description,
        steps: updates.steps || workflow.steps,
        tags: updates.tags || workflow.tags
      };

      // Validate merged workflow
      this.validateWorkflow(merged);

      // Update workflow object
      if (updates.name) workflow.name = updates.name;
      if (updates.description !== undefined) workflow.description = updates.description;
      if (updates.steps) workflow.steps = updates.steps;
      if (updates.tags) workflow.tags = updates.tags;
      if (updates.starred !== undefined) workflow.starred = updates.starred;

      workflow.updatedAt = new Date().toISOString();

      // Update definition file
      const definition = {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
        tags: workflow.tags,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        starred: workflow.starred
      };

      const definitionFile = path.join(workflow.path, 'workflow-definition.json');
      await fs.writeFile(definitionFile, JSON.stringify(definition, null, 2));
      await this.saveMetadata();

      this.logger?.info('Workflow updated', { workflowId, name: workflow.name });
      return workflow;
    } catch (error) {
      this.logger?.error('Failed to update workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete workflow (remove directory)
   * @param {string} workflowId - Workflow ID
   * @returns {boolean} Success
   */
  async deleteWorkflow(workflowId) {
    try {
      const workflow = this.getWorkflow(workflowId);

      // Remove directory
      await this.removeDirectoryRecursive(workflow.path);

      // Remove from array
      const index = this.workflows.findIndex(w => w.id === workflowId);
      if (index !== -1) {
        this.workflows.splice(index, 1);
      }

      // Remove metadata
      delete this.metadata[workflowId];
      await this.saveMetadata();

      this.logger?.info('Workflow deleted', { workflowId });
      return true;
    } catch (error) {
      this.logger?.error('Failed to delete workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Recursively remove directory
   */
  async removeDirectoryRecursive(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.removeDirectoryRecursive(fullPath);
      } else {
        await fs.unlink(fullPath);
      }
    }

    await fs.rmdir(dirPath);
  }

  /**
   * List workflows with filters
   * @param {Object} options - Filter options
   * @returns {Array} Workflows
   */
  listWorkflows(options = {}) {
    let result = [...this.workflows];

    // Filter by starred
    if (options.starred) {
      result = result.filter(w => w.starred);
    }

    // Filter by tags
    if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
      result = result.filter(w =>
        options.tags.some(tag => w.tags.includes(tag))
      );
    }

    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));

    // Pagination
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return result.slice(offset, offset + limit);
  }

  /**
   * Search workflows by name, description, or tags
   * @param {string} query - Search query
   * @returns {Array} Matching workflows
   */
  searchWorkflows(query) {
    const lowerQuery = query.toLowerCase();
    return this.workflows.filter(w =>
      w.name.toLowerCase().includes(lowerQuery) ||
      w.description.toLowerCase().includes(lowerQuery) ||
      w.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get recently viewed workflows
   * @param {number} limit - Number of workflows
   * @returns {Array} Recent workflows
   */
  getRecentlyViewed(limit = 10) {
    return this.workflows
      .filter(w => w.lastViewed)
      .sort((a, b) => new Date(b.lastViewed) - new Date(a.lastViewed))
      .slice(0, limit);
  }

  /**
   * Get starred workflows
   * @param {number} limit - Number of workflows
   * @returns {Array} Starred workflows
   */
  getStarred(limit = 10) {
    return this.workflows
      .filter(w => w.starred)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * Toggle star status
   * @param {string} workflowId - Workflow ID
   * @param {boolean} starred - Star status
   * @returns {Object} Updated workflow
   */
  async toggleStar(workflowId, starred) {
    try {
      const workflow = this.getWorkflow(workflowId);
      workflow.starred = starred;
      await this.saveMetadata();
      this.logger?.info('Workflow star toggled', { workflowId, starred });
      return workflow;
    } catch (error) {
      this.logger?.error('Failed to toggle star', { error: error.message });
      throw error;
    }
  }

  /**
   * Mark workflow as viewed
   * @param {string} workflowId - Workflow ID
   * @returns {Object} Updated workflow
   */
  async markAsViewed(workflowId) {
    try {
      const workflow = this.getWorkflow(workflowId);
      workflow.lastViewed = new Date().toISOString();
      await this.saveMetadata();
      return workflow;
    } catch (error) {
      this.logger?.error('Failed to mark as viewed', { error: error.message });
      throw error;
    }
  }

  /**
   * Export workflow as JSON
   * @param {string} workflowId - Workflow ID
   * @returns {Object} Exported workflow
   */
  exportWorkflow(workflowId) {
    try {
      const workflow = this.getWorkflow(workflowId);
      return {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
        tags: workflow.tags,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt
      };
    } catch (error) {
      this.logger?.error('Failed to export workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Import workflow from JSON
   * @param {Object} workflowData - Exported workflow data
   * @returns {Object} Created workflow
   */
  async importWorkflow(workflowData) {
    try {
      return await this.createWorkflow(workflowData);
    } catch (error) {
      this.logger?.error('Failed to import workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Get total workflow count
   * @returns {number} Count
   */
  getCount() {
    return this.workflows.length;
  }

  /**
   * Validate workflow data before saving
   * @param {Object} workflowData - Workflow data to validate
   * @throws {Error} If validation fails
   */
  validateWorkflow(workflowData) {
    const errors = [];

    // Check required fields
    if (!workflowData.name || typeof workflowData.name !== 'string' || workflowData.name.trim() === '') {
      errors.push('Workflow name is required and must be a non-empty string');
    }

    // Check name length
    if (workflowData.name && workflowData.name.length > 100) {
      errors.push('Workflow name must be 100 characters or less');
    }

    // Check steps
    if (!Array.isArray(workflowData.steps)) {
      errors.push('Workflow steps must be an array');
    } else if (workflowData.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    } else if (workflowData.steps.length > 100) {
      errors.push('Workflow cannot have more than 100 steps');
    }

    // Validate each step
    if (Array.isArray(workflowData.steps)) {
      workflowData.steps.forEach((step, index) => {
        if (!step.name || typeof step.name !== 'string') {
          errors.push(`Step ${index + 1}: name is required and must be a string`);
        }

        const validTypes = ['identity', 'delay', 'transform', 'conditional', 'api', 'parallel'];
        if (step.config && !validTypes.includes(step.config.type)) {
          errors.push(`Step ${index + 1}: invalid step type "${step.config.type}". Valid types: ${validTypes.join(', ')}`);
        }

        // Validate specific step types
        if (step.config?.type === 'api' && !step.config?.endpoint) {
          errors.push(`Step ${index + 1}: API step requires endpoint`);
        }

        if (step.config?.type === 'delay' && (!step.config?.duration || step.config.duration < 0)) {
          errors.push(`Step ${index + 1}: delay step requires positive duration`);
        }

        if (step.config?.type === 'transform' && !step.config?.script) {
          errors.push(`Step ${index + 1}: transform step requires script`);
        }
      });
    }

    // Check description length
    if (workflowData.description && workflowData.description.length > 500) {
      errors.push('Workflow description must be 500 characters or less');
    }

    // Check tags
    if (workflowData.tags && !Array.isArray(workflowData.tags)) {
      errors.push('Workflow tags must be an array');
    }

    if (errors.length > 0) {
      throw new Error(`Workflow validation failed: ${errors.join('; ')}`);
    }
  }
}

module.exports = WorkflowManager;
