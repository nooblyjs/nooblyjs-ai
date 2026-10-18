/**
 * @fileoverview First-time setup wizard routes for Wiki application.
 * Handles user onboarding, profile setup, and space initialization
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

/**
 * Load the spaces template configuration
 */
async function loadSpacesTemplate() {
  const templatePath = path.join(__dirname, '../initialisation/spaces-template.json');
  const data = await fs.readFile(templatePath, 'utf8');
  return JSON.parse(data);
}

/**
 * Check if a folder has existing content (non-hidden files/folders)
 */
async function folderHasContent(folderPath) {
  try {
    const files = await fs.readdir(folderPath);
    // Filter out hidden files (starting with .) and check if there's any content
    const visibleFiles = files.filter(file => !file.startsWith('.'));
    return visibleFiles.length > 0;
  } catch (err) {
    // Folder doesn't exist, so it has no content
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Helper to require authentication
 */
function requireAuthenticated(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

/**
 * Create folder structure and sample files for a space
 */
async function initializeSpace(space, basePath, filing, dataManager, author, logger) {
  const spacePath = path.join(process.cwd(), basePath);
  const documents = [];

  // Check if folder already has content
  const hasContent = await folderHasContent(spacePath);

  if (hasContent) {
    if (logger) {
      logger.info(`Folder ${spacePath} already has content, skipping sample data creation`);
    }
    return documents;
  }

  // Create space directory by creating .gitkeep file
  const gitkeepPath = path.join(spacePath, '.gitkeep');
  await filing.create(gitkeepPath, '# Keep this directory in git\n');

  let documentId = Date.now();

  // Create folders and files
  for (const folder of space.folders) {
    const folderPath = path.join(spacePath, folder.name);

    for (const file of folder.files) {
      const filePath = path.join(folderPath, file.filename);
      // Create file - this will also create the folder if it doesn't exist
      await filing.create(filePath, file.content);

      // Create document metadata
      const excerpt = file.content
        .replace(/[#*`>\[\]]/g, '')
        .substring(0, 150)
        .trim();

      // Store relative path from space directory for consistency with API expectations
      const relativePath = path.relative(spacePath, filePath);

      documents.push({
        id: documentId++,
        title: file.title,
        spaceName: space.name,
        spaceId: space.id,
        tags: file.tags || [],
        excerpt: excerpt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: author,
        filePath: relativePath
      });
    }
  }

  return documents;
}

/**
 * Initialize user's wiki with spaces and sample content
 */
async function initializeUserWiki(userId, spaceConfigs, filing, dataManager, search, logger, author) {
  try {
    // Spaces are a small JSON registry; documents live on disk (created via the
    // filing service below) and are not tracked in a JSON index.
    let existingSpaces = await dataManager.read('spaces').catch(() => []);

    const allDocuments = [];
    const allSpaces = [...existingSpaces];

    // Process each space configuration
    for (const spaceConfig of spaceConfigs) {
      const template = spaceConfig.template;
      const customPath = spaceConfig.customPath || template.defaultPath;

      // Create space metadata
      const space = {
        id: template.id,
        name: template.name,
        description: template.description,
        icon: template.icon,
        visibility: template.visibility,
        documentCount: 0,
        path: path.resolve(process.cwd(), customPath),
        type: template.type,
        permissions: template.permissions,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: author
      };

      // Initialize space folders and files
      const documents = await initializeSpace(template, customPath, filing, dataManager, author, logger);

      // Update space document count
      space.documentCount = documents.length;

      // Add to collections
      allSpaces.push(space);
      allDocuments.push(...documents);

      // Index documents in search
      for (const doc of documents) {
        search.add(doc.id.toString(), {
          id: doc.id,
          title: doc.title,
          content: '',
          tags: doc.tags || [],
          excerpt: doc.excerpt,
          spaceName: doc.spaceName
        });
      }

      logger.info(`Initialized space: ${space.name} at ${customPath}`);
    }

    // Persist the spaces registry only — documents are on disk.
    await dataManager.write('spaces', allSpaces);

    return { success: true, spaces: allSpaces, documentCount: allDocuments.length };
  } catch (error) {
    logger.error('Error initializing user wiki:', error);
    throw error;
  }
}

/**
 * Configure wizard routes
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { dataManager, filing, cache, log, queue, search } = services;
  const logger = log; // Alias for backward compatibility

  // Check if user needs wizard
  // A user needs the wizard if they have no allowed spaces
  app.get('/applications/wiki/api/wizard/check', requireAuthenticated, async (req, res) => {
    try {
      logger.info('[Wizard] /check endpoint hit for user:', req.user.email);

      const userEmail = req.user.email;
      const spaceManager = app.get('spaceManager');

      let needsWizard = true;

      if (spaceManager) {
        // Check if user has access to any spaces
        const allSpaces = spaceManager.getAllSpaces();
        logger.info('[Wizard] Total spaces:', allSpaces.length);

        // User has access to a space if:
        // - Space is public, OR
        // - Space is team (and user is authenticated), OR
        // - User is in the space's allowedUsers list
        const userSpaces = allSpaces.filter(space => {
          if (space.visibility === 'public') return true;
          if (space.visibility === 'team') return true;
          if (space.allowedUsers && space.allowedUsers.includes(userEmail)) return true;
          return false;
        });

        logger.info('[Wizard] User has access to', userSpaces.length, 'spaces');
        needsWizard = userSpaces.length === 0;
      }

      res.json({
        needsWizard,
        user: {
          username: req.user.username,
          email: req.user.email,
          role: req.user.role || 'user'
        }
      });
    } catch (error) {
      logger.error('Error checking wizard status:', error);
      res.status(500).json({ error: 'Failed to check wizard status' });
    }
  });

  // Get wizard configuration (spaces template)
  app.get('/applications/wiki/api/wizard/config', async (req, res) => {
    try {
      const template = await loadSpacesTemplate();
      res.json(template);
    } catch (error) {
      logger.error('Error loading wizard config:', error);
      res.status(500).json({ error: 'Failed to load wizard configuration' });
    }
  });

  // NEW: Get available spaces (public and team) that user can join
  app.get('/applications/wiki/api/wizard/available-spaces', requireAuthenticated, async (req, res) => {
    try {
      logger.info('[Wizard] /available-spaces endpoint hit');
      logger.info('[Wizard] req.isAuthenticated():', req.isAuthenticated());
      logger.info('[Wizard] req.user:', req.user);

      const spaceManager = app.get('spaceManager');

      if (!spaceManager) {
        logger.warn('[Wizard] SpaceManager not available for available-spaces endpoint');
        return res.json({ success: true, spaces: [] });
      }

      // Get all spaces and filter public and team spaces
      const allSpaces = spaceManager.getAllSpaces();
      logger.info('[Wizard] Total spaces:', allSpaces.length);

      const availableSpaces = allSpaces.filter(space =>
        space.visibility === 'public' || space.visibility === 'team'
      );

      logger.info('[Wizard] Available spaces (public+team):', availableSpaces.length);

      res.json({ success: true, spaces: availableSpaces });
    } catch (error) {
      logger.error('Error fetching available spaces:', error);
      res.status(500).json({ error: 'Failed to fetch available spaces' });
    }
  });

  // NEW: Add user to selected spaces (updates allowedUsers)
  app.post('/applications/wiki/api/wizard/select-spaces', requireAuthenticated, async (req, res) => {
    try {
      const { spaceIds } = req.body;
      const userEmail = req.user.email;

      logger.info('[Wizard] /select-spaces endpoint - adding user to', spaceIds?.length || 0, 'spaces');

      if (!spaceIds || !Array.isArray(spaceIds)) {
        return res.status(400).json({ error: 'Invalid space IDs' });
      }

      const spaceManager = app.get('spaceManager');
      if (!spaceManager) {
        return res.status(500).json({ error: 'SpaceManager not available' });
      }

      // Add user to each selected space's allowedUsers
      const updatedSpaces = [];
      for (const spaceId of spaceIds) {
        try {
          const space = await spaceManager.addUserToSpace(spaceId, userEmail);
          updatedSpaces.push(space);
        } catch (error) {
          logger.warn(`Failed to add user to space ${spaceId}:`, error.message);
          // Continue with next space
        }
      }

      logger.info('[Wizard] User', userEmail, 'now has access to', updatedSpaces.length, 'spaces');
      res.json({ success: true, spaces: updatedSpaces });
    } catch (error) {
      logger.error('[Wizard] Error selecting spaces:', error);
      res.status(500).json({ error: 'Failed to select spaces' });
    }
  });

  // NEW: Create a private space for the user
  app.post('/applications/wiki/api/wizard/create-private', requireAuthenticated, async (req, res) => {
    try {
      const { name, description, useTemplate, templateId } = req.body;
      const userEmail = req.user.email;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Space name is required' });
      }

      const spaceManager = app.get('spaceManager');
      if (!spaceManager) {
        return res.status(500).json({ error: 'SpaceManager not available' });
      }

      // Create space data for private space
      const spaceData = {
        name: name.trim(),
        description: description || '',
        visibility: 'private',
        permissions: 'read-write',
        allowedUsers: [userEmail],
        type: 'personal',
        configuration: {
          useTemplate: useTemplate || false,
          templateId: templateId || 'personal'
        },
        metadata: {
          tags: [],
          archived: false
        }
      };

      // Create the space
      const space = await spaceManager.createSpace(spaceData, userEmail);
      logger.info(`Private space created: ${space.id} for user ${userEmail}`);

      // If template requested, initialize space with folders and files
      if (useTemplate && templateId) {
        try {
          const template = await loadSpacesTemplate();
          const spaceTemplate = template.spaces.find(t => t.id === templateId || t.name === templateId);

          if (spaceTemplate) {
            // Use the space's default path or configured path
            const spacePath = spaceTemplate.defaultPath;
            const documents = await initializeSpace(
              spaceTemplate,
              spacePath,
              filing,
              dataManager,
              userEmail,
              logger
            );

            logger.info(`Space ${space.id} initialized with ${documents.length} documents`);

            // Update space with initialization flag
            const updates = {
              configuration: {
                ...space.configuration,
                initialized: true
              }
            };
            await spaceManager.updateSpace(space.id, updates, userEmail);
          }
        } catch (templateError) {
          logger.warn(`Failed to initialize space template: ${templateError.message}`);
          // Don't fail the entire request, space is still created
        }
      }

      res.json({ success: true, space });
    } catch (error) {
      logger.error('Error creating private space:', error);
      res.status(500).json({ error: error.message || 'Failed to create private space' });
    }
  });

  // Initialize spaces
  app.post('/applications/wiki/api/wizard/initialize', requireAuthenticated, async (req, res) => {
    try {
      const { spaces } = req.body;

      if (!spaces || !Array.isArray(spaces)) {
        return res.status(400).json({ error: 'Invalid spaces configuration' });
      }

      // Load template
      const template = await loadSpacesTemplate();

      // Prepare space configurations
      const spaceConfigs = spaces.map(spaceData => {
        const spaceTemplate = template.spaces.find(t => t.id === spaceData.id);
        if (!spaceTemplate) {
          throw new Error(`Invalid space ID: ${spaceData.id}`);
        }

        return {
          template: spaceTemplate,
          customPath: spaceData.path || spaceTemplate.defaultPath
        };
      });

      // Initialize wiki
      const result = await initializeUserWiki(
        req.user.username,
        spaceConfigs,
        filing,
        dataManager,
        search,
        logger,
        req.user.email
      );

      logger.info(`Wiki initialized for user ${req.user.email}: ${result.spaces.length} spaces, ${result.documentCount} documents`);

      // Mark user as initialized
      if (userInitializer && req.user.username) {
        await userInitializer.markInitialized(req.user.username);
        logger.info(`User marked as initialized: ${req.user.username}`);
      }

      res.json({
        success: true,
        message: 'Wiki initialized successfully',
        spaces: result.spaces,
        documentCount: result.documentCount
      });
    } catch (error) {
      logger.error('Error initializing wiki:', error);
      res.status(500).json({ error: error.message || 'Failed to initialize wiki' });
    }
  });

  // Skip wizard (no longer needed since we check spaces instead of tracking initialization)
  // But keeping endpoint for backward compatibility
  app.post('/applications/wiki/api/wizard/skip', requireAuthenticated, async (req, res) => {
    try {
      logger.info('[Wizard] /skip endpoint called by user:', req.user.email);
      // No action needed - next check will see if user has any spaces
      res.json({ success: true });
    } catch (error) {
      logger.error('[Wizard] Error in skip:', error);
      res.status(500).json({ error: 'Failed to skip wizard' });
    }
  });
};
