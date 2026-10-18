/**
 * @fileoverview Space Manager for Datasources Module
 * Handles creation, maintenance, and management of Spaces
 * Spaces are shared organizational containers that can be used across the platform
 *
 * Space Structure:
 * - id: Unique identifier
 * - name: Space name
 * - description: Space description
 * - type: Type of space (project, team, workflow, archive, etc.)
 * - visibility: 'public' | 'private' | 'team'
 * - permissions: 'read-only' | 'read-write'
 * - allowedUsers: Array of user IDs with access
 * - theme: Brand applied while the space is open (see public/js/theme.js and
 *   SPACES.md). Either an object — { title, subtitle, image, color,
 *   color-highlight, home } — or a String naming a preset. It also carries
 *   `home`, the space's landing document, which is what lets two spaces share
 *   one content root and still open on different pages.
 * - configuration: Custom JSON configuration
 *     - filing: { provider, baseDir, maxFileSize, allowedExtensions } — passed
 *       straight to the space's filing instance by SpaceFilingManager
 *     - allowedPaths / excludedPaths: curate a subset of the content root
 *       (see shared/spaces/spaceVisibility.js)
 * - createdAt: Creation timestamp
 * - createdBy: User who created the space. NOT just an audit field — it is
 *   read as an ACCESS grant (spacePermissions.isSpaceAdmin, spaceFilingRoutes)
 * - updatedAt: Last update timestamp
 * - updatedBy: User who last updated
 * - metadata: { archived } — archived drives archiveSpace/restoreSpace and the
 *   listSpaces filter
 *
 * Deliberately NOT part of the record: `configuration.features`,
 * `configuration.maxSize`, `configuration.retentionDays` and `metadata.tags`
 * were seeded on every space but never read by anything, so they were dropped
 * (2026-07-25) rather than left looking meaningful.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

class SpaceManager {
  constructor(filing, logger, appBaseDir) {
    this.filing = filing;
    this.logger = logger;
    this.baseDir = appBaseDir || path.join(process.cwd(), '.application');
    this.spacesFile = path.join(this.baseDir, 'spaces', 'spaces.json');
    this.spaces = [];
  }

  /**
   * Initialize spaces from file (synchronous)
   */
  initialize() {
    try {
      const spacesDir = path.dirname(this.spacesFile);
      const fsSync = require('node:fs');
      fsSync.mkdirSync(spacesDir, { recursive: true });

      const data = fsSync.readFileSync(this.spacesFile, 'utf8');
      this.spaces = JSON.parse(data);
      this.logger.info(`Loaded ${this.spaces.length} spaces`);
      return Promise.resolve();
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.info('No existing spaces file, initializing with defaults');
        this.spaces = this.getDefaultSpaces();
        this.saveSpaces();
        this.seedDefaultSpaceContent();
        return Promise.resolve();
      }
      this.logger.error('Error loading spaces:', error.message);
      return Promise.reject(error);
    }
  }

  /**
   * Seed each default space's files directory with a Home.md welcome file.
   * Only writes when the file does not already exist, so user edits are preserved
   * across restarts.
   */
  seedDefaultSpaceContent() {
    const fsSync = require('node:fs');
    for (const space of this.spaces) {
      const filesDir = space.configuration?.filing?.baseDir
        || path.join(this.baseDir, 'spaces', String(space.id), 'files');
      const homePath = path.join(filesDir, 'Home.md');
      try {
        fsSync.mkdirSync(filesDir, { recursive: true });
        if (!fsSync.existsSync(homePath)) {
          fsSync.writeFileSync(homePath, this.getDefaultHomeMarkdown(space), 'utf8');
          this.logger.info(`Created Home.md for space "${space.name}" at ${homePath}`);
        }
      } catch (err) {
        this.logger.warn(`Could not seed Home.md for space "${space.name}": ${err.message}`);
      }
    }
  }

  /**
   * Build the welcome Home.md content for a newly created space.
   */
  getDefaultHomeMarkdown(space) {
    return `# Welcome to ${space.name}

This is your space's home page. It was created automatically the first time the
platform started up — feel free to edit it, rename it, or delete it once you've
made the space your own.

## What is a Space?

A **Space** is a shared container for the files, documents, and workflows that
belong to a project or team. Everything you upload or create here lives inside
this space and respects its visibility and permission settings.

## Next steps

Here are a few things you can try to get going:

### 1. Create a folder
Use the **New Folder** action to organise your content into sections — for
example \`docs/\`, \`notes/\`, or \`assets/\`.

### 2. Create a file
Add a Markdown document, a meeting note, or a README using **New File**. Markdown
(\`.md\`) files are rendered with formatting, links, and code blocks.

### 3. Upload existing files
Drag and drop files into the space, or use the **Upload** action. PDFs, Office
documents, images, and source files are all supported.

### 4. Invite collaborators
Open the space settings to adjust **visibility** (public, team, private) and add
users or roles that should have access.

### 5. Connect a workflow
Spaces can be the source or target for workflow steps — head over to the
Workflows section to automate work against the files stored here.

## Tips

- Edits made on disk are picked up automatically — the file watcher debounces
  changes and broadcasts them over Socket.IO.
- You can change the storage location for this space in its configuration if
  you want to point it at a different folder or provider.
- Looking for the API? See \`docs/API-Reference.md\` for the full list of space
  and file endpoints.

Happy building!
`;
  }

  /**
   * Get default spaces
   */
  getDefaultSpaces() {
    return [
      {
        id: 1,
        name: 'Default Project Space',
        description: 'Default space for projects and workflows',
        type: 'project',
        visibility: 'team',
        permissions: 'read-write',
        allowedUsers: [],
        configuration: {
          filing: {
            provider: 'local',
            baseDir: path.join(this.baseDir, 'spaces', '1', 'files'),
            maxFileSize: 10485760,
            allowedExtensions: ['*']
          }
        },
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
        metadata: {
          archived: false
        }
      }
    ];
  }

  /**
   * Save spaces to file
   */
  async saveSpaces() {
    try {
      // Ensure spaces directory exists
      const spacesDir = path.dirname(this.spacesFile);
      const fsSync = require('node:fs');
      fsSync.mkdirSync(spacesDir, { recursive: true });

      fsSync.writeFileSync(this.spacesFile, JSON.stringify(this.spaces, null, 2), 'utf8');
      this.logger.info('Spaces saved successfully');
    } catch (error) {
      this.logger.error('Error saving spaces:', error.message);
      throw error;
    }
  }

  /**
   * Get all spaces with optional filtering
   */
  getAllSpaces(filters = {}) {
    let filtered = [...this.spaces];

    if (filters.visibility) {
      filtered = filtered.filter(s => s.visibility === filters.visibility);
    }

    if (filters.type) {
      filtered = filtered.filter(s => s.type === filters.type);
    }

    if (filters.archived === true) {
      filtered = filtered.filter(s => s.metadata?.archived === true);
    } else if (filters.archived === false) {
      filtered = filtered.filter(s => s.metadata?.archived !== true);
    }

    return filtered;
  }

  /**
   * Get space by ID
   */
  getSpaceById(id) {
    return this.spaces.find(s => s.id === id);
  }

  /**
   * Get space by name
   */
  getSpaceByName(name) {
    return this.spaces.find(s => s.name === name);
  }

  /**
   * Create new space
   */
  async createSpace(spaceData, userId) {
    const newSpace = {
      id: this.generateId(),
      name: spaceData.name,
      description: spaceData.description || '',
      type: spaceData.type || 'project',
      visibility: spaceData.visibility || 'team',
      permissions: spaceData.permissions || 'read-write',
      allowedUsers: spaceData.allowedUsers || [userId],
      theme: spaceData.theme || undefined,
      configuration: spaceData.configuration || {},
      createdAt: new Date().toISOString(),
      createdBy: userId,
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
      metadata: spaceData.metadata || {
        archived: false
      }
    };

    // `theme` is optional — omit the key entirely rather than storing an
    // explicit undefined, which JSON.stringify would drop anyway but which
    // shows up as a phantom field to anything inspecting the object first.
    if (!newSpace.theme) delete newSpace.theme;

    // Validate required fields
    if (!newSpace.name) {
      throw new Error('Space name is required');
    }

    // Check for duplicate name
    if (this.getSpaceByName(newSpace.name)) {
      throw new Error(`Space with name "${newSpace.name}" already exists`);
    }

    this.spaces.push(newSpace);
    await this.saveSpaces();

    this.logger.info(`Created space: ${newSpace.name} (ID: ${newSpace.id})`);
    return newSpace;
  }

  /**
   * Update space
   */
  async updateSpace(id, updates, userId) {
    const space = this.getSpaceById(id);
    if (!space) {
      throw new Error(`Space with ID ${id} not found`);
    }

    // Check if name is being changed and ensure it's unique
    if (updates.name && updates.name !== space.name) {
      if (this.getSpaceByName(updates.name)) {
        throw new Error(`Space with name "${updates.name}" already exists`);
      }
    }

    // Update allowed fields
    const allowedUpdates = [
      'name', 'description', 'type', 'visibility', 'permissions',
      'allowedUsers', 'configuration', 'metadata', 'theme'
    ];

    for (const field of allowedUpdates) {
      if (field in updates) {
        space[field] = updates[field];
      }
    }

    // Clearing the brand REMOVES the key rather than storing `null`. createSpace
    // already does this; without the same rule here, a space that has had its
    // theme cleared reads back as `"theme": null`, and every consumer has to
    // guard for a third state that means exactly what "absent" means.
    if ('theme' in updates && !space.theme) delete space.theme;

    space.updatedAt = new Date().toISOString();
    space.updatedBy = userId;

    await this.saveSpaces();

    this.logger.info(`Updated space: ${space.name} (ID: ${id})`);
    return space;
  }

  /**
   * Delete space
   */
  async deleteSpace(id) {
    const index = this.spaces.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error(`Space with ID ${id} not found`);
    }

    const deleted = this.spaces.splice(index, 1)[0];
    await this.saveSpaces();

    this.logger.info(`Deleted space: ${deleted.name} (ID: ${id})`);
    return deleted;
  }

  /**
   * Archive space (soft delete)
   */
  async archiveSpace(id, userId) {
    const space = this.getSpaceById(id);
    if (!space) {
      throw new Error(`Space with ID ${id} not found`);
    }

    return this.updateSpace(id, {
      metadata: {
        ...space.metadata,
        archived: true,
        archivedAt: new Date().toISOString(),
        archivedBy: userId
      }
    }, userId);
  }

  /**
   * Restore archived space
   */
  async restoreSpace(id, userId) {
    const space = this.getSpaceById(id);
    if (!space) {
      throw new Error(`Space with ID ${id} not found`);
    }

    return this.updateSpace(id, {
      metadata: {
        ...space.metadata,
        archived: false
      }
    }, userId);
  }

  /**
   * Add user to space
   */
  async addUserToSpace(spaceId, userId) {
    const space = this.getSpaceById(spaceId);
    if (!space) {
      throw new Error(`Space with ID ${spaceId} not found`);
    }

    if (!space.allowedUsers.includes(userId)) {
      space.allowedUsers.push(userId);
      await this.saveSpaces();
      this.logger.info(`Added user ${userId} to space ${spaceId}`);
    }

    return space;
  }

  /**
   * Remove user from space
   */
  async removeUserFromSpace(spaceId, userId) {
    const space = this.getSpaceById(spaceId);
    if (!space) {
      throw new Error(`Space with ID ${spaceId} not found`);
    }

    const index = space.allowedUsers.indexOf(userId);
    if (index !== -1) {
      space.allowedUsers.splice(index, 1);
      await this.saveSpaces();
      this.logger.info(`Removed user ${userId} from space ${spaceId}`);
    }

    return space;
  }

  /**
   * Check if user has access to space
   */
  hasUserAccess(spaceId, userId) {
    const space = this.getSpaceById(spaceId);
    if (!space) {
      return false;
    }

    // Public spaces allow all users
    if (space.visibility === 'public') {
      return true;
    }

    // Check if user is in allowed users list
    return space.allowedUsers.includes(userId);
  }

  /**
   * Get spaces accessible by user
   */
  getSpacesForUser(userId, includeArchived = false) {
    const filtered = this.spaces.filter(space => {
      // Exclude archived spaces unless requested
      if (space.metadata?.archived && !includeArchived) {
        return false;
      }

      // Public spaces
      if (space.visibility === 'public') {
        return true;
      }

      // User's spaces
      return space.allowedUsers.includes(userId);
    });

    return filtered;
  }

  /**
   * Generate unique space ID
   */
  generateId() {
    return Math.max(0, ...this.spaces.map(s => s.id)) + 1;
  }
}

module.exports = SpaceManager;
