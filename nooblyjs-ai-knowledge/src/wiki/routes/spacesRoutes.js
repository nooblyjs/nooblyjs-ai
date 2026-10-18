/**
 * @fileoverview Spaces API routes for Wiki application
 * Handles space management, folder trees, and templates
 *
 * @author noobly Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const userStore = require('../components/userStore');
const { isSpaceAdmin } = require('../components/spacePermissions');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const { templateDirsFor, pickClosest } = require('../../shared/utils/filePolicy');

/**
 * Read every `.md` file in a template directory into list entries. Missing
 * directory → empty list. `relPrefix` is prepended to each filename to form the
 * in-space `path` (e.g. '.system/templates/' or '.system/useractivity/<prefix>/templates/').
 */
async function readTemplateDir(absDir, relPrefix) {
  let files;
  try {
    files = await fs.readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.md')) continue;
    const filePath = path.join(absDir, file.name);
    const stats = await fs.stat(filePath);
    let title = file.name.replace(/\.md$/, '');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const firstLine = content.split('\n')[0];
      if (firstLine.startsWith('# ')) title = firstLine.substring(2).trim();
    } catch (_) { /* keep filename-derived title */ }
    out.push({
      name: file.name.replace(/\.md$/, ''),
      title,
      path: `${relPrefix}${file.name}`,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      type: 'template'
    });
  }
  return out;
}

/**
 * Resolve the template CASCADE for a folder: the folder's own `.system/templates/`,
 * then each ancestor's, ending at the space root. Closest-first, with a nearer
 * template of the same name hiding the ones above it (`pickClosest`).
 *
 * Each entry is stamped with where it came from so the UI can say so:
 *   scope       'folder' for any folder below the root, 'space' for the root tier
 *   folderPath  the owning folder ('' at the root)
 *   distance    0 = the target folder itself, 1 = its parent, … (root = depth)
 *
 * Cost is one directory listing per ancestor — four or five for a realistically
 * deep path, and a missing directory is a cheap ENOENT. This deliberately does NOT
 * scan the tree for template folders: the content roots are directories of
 * symlinked git repositories where an exhaustive walk runs to thousands of
 * sequential readdirs (see the folder-tree notes in CLAUDE.md).
 *
 * EVERY TIER IS CHECKED AGAINST THE SPACE'S VISIBILITY. The walk crosses folders
 * the caller never named — that is the whole point of a cascade — so on a shared
 * content root it will happily reach an ancestor the space curates away. A
 * pass-through container is the sharp case: `Solution Design` is kept in the nav
 * only so you can drill into `Solution Design/Distribution`, and its own
 * contents are hidden, yet the cascade walks straight through it. Per
 * `fileOwnerFolder`, `Solution Design/.system/templates/x.md` is judged on
 * `Solution Design` — hidden — so listing it leaked the template's name, path and
 * title line out of a subtree the space does not show.
 *
 * @param {string} spaceDir - Absolute content directory of the space.
 * @param {string} folderPath - Space-relative target folder ('' for the root).
 * @param {boolean} canEditSpace - Whether the caller may write the ROOT tier.
 * @param {Object} visibility - compiled matcher for the space
 * @returns {Promise<Array>} Template entries, closest first.
 */
async function resolveTemplateCascade(spaceDir, folderPath, canEditSpace, visibility) {
  const dirs = templateDirsFor(folderPath);
  const collected = [];

  for (let distance = 0; distance < dirs.length; distance++) {
    const relDir = dirs[distance];
    const isRoot = distance === dirs.length - 1;
    const owner = isRoot ? '' : relDir.slice(0, relDir.lastIndexOf('/.system/templates'));

    // Skip a tier the space does not expose. The root tier is always kept: its
    // owner folder is '', which `isFileVisible` treats as a root-level file —
    // the same exemption that keeps the space landing page reachable.
    if (!isRoot && visibility.restricted && !visibility.isFileVisible(`${relDir}/probe.md`)) {
      continue;
    }

    const entries = await readTemplateDir(path.resolve(spaceDir, relDir), `${relDir}/`);
    for (const entry of entries) {
      collected.push({
        ...entry,
        // The root tier keeps reporting scope 'space' so existing consumers — the
        // profile screen, the hub's Space tab — keep working unchanged.
        scope: isRoot ? 'space' : 'folder',
        folderPath: owner,
        folderName: owner ? owner.slice(owner.lastIndexOf('/') + 1) : '',
        distance,
        // A folder template is folder content: writable by anyone who can write
        // the folder. Only the root tier needs space-admin rights.
        canEdit: isRoot ? canEditSpace : true
      });
    }
  }

  return pickClosest(collected);
}

/** Absolute content directory for a space record (with the legacy fallback). */
function spaceDirOf(space) {
  if (space.path || space.configuration?.filing?.baseDir) {
    return space.path || space.configuration.filing.baseDir;
  }
  return path.resolve(__dirname, '../../../documents', space.name);
}

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
 * Create folder structure and sample files for a space based on template
 */
async function initializeSpaceFromTemplate(spaceTemplate, basePath, filing, logger, author) {
  // Normalize the space path to ensure consistency
  const spacePath = path.resolve(process.cwd(), basePath);
  const documents = [];

  // Check if folder already has content
  const hasContent = await folderHasContent(spacePath);

  if (hasContent) {
    logger.info(`Folder ${spacePath} already has content, skipping sample data creation`);
    return documents;
  }

  // Create .gitkeep in base directory
  const gitkeepPath = path.join(spacePath, '.gitkeep');
  await filing.create(gitkeepPath, '# Keep this directory in git\n');

  let documentId = Date.now();

  // Create folders and files from template
  for (const folder of spaceTemplate.folders) {
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

      // Store relative path from space directory for consistency
      const relativePath = path.relative(spacePath, filePath);

      documents.push({
        id: documentId++,
        title: file.title,
        spaceName: spaceTemplate.name,
        spaceId: null, // Will be set by caller
        tags: file.tags || [],
        excerpt: excerpt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: author,
        filePath: relativePath
      });
    }
  }

  logger.info(`Created ${documents.length} sample documents for space at ${spacePath}`);
  return documents;
}

/**
 * Configures and registers spaces routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { dataManager, filing, cache, log, queue, search, documentService, appBaseDir } = services;
  const logger = log; // Alias for backward compatibility

  // Get all spaces
  app.get('/applications/wiki/api/spaces', async (req, res) => {
    try {
      const fs = require('node:fs').promises;
      const path = require('node:path');

      // Direct file read to bypass potentially problematic dataManager
      const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
      logger.info(`[Wiki Spaces] Loading spaces from: ${spacesPath}`);

      try {
        const spacesData = await fs.readFile(spacesPath, 'utf8');
        const allSpaces = JSON.parse(spacesData);
        logger.info(`[Wiki Spaces] Loaded ${allSpaces.length} total spaces`);

        // Filter based on user access
        let filteredSpaces = [];

        if (req.isAuthenticated()) {
          const userEmail = req.user.email;
          logger.info(`[Wiki Spaces] Filtering spaces for authenticated user: ${userEmail}`);

          // User can access:
          // - Public spaces
          // - Team spaces (authenticated users)
          // - Private spaces where they're in allowedUsers
          filteredSpaces = allSpaces.filter(space => {
            if (space.visibility === 'public') return true;
            if (space.visibility === 'team') return true;
            if (space.visibility === 'private' && space.allowedUsers && space.allowedUsers.includes(userEmail)) return true;
            return false;
          });
          logger.info(`[Wiki Spaces] User has access to ${filteredSpaces.length} spaces`);
        } else {
          // Unauthenticated users only see public spaces
          filteredSpaces = allSpaces.filter(space => space.visibility === 'public');
          logger.info(`[Wiki Spaces] Public user has access to ${filteredSpaces.length} spaces`);
        }

        // Stamp whether the current user may manage this space's space-level
        // templates, so the UI can offer/hide the "Space" template scope.
        const user = req.isAuthenticated() ? req.user : null;
        const stamped = filteredSpaces.map(space => ({
          ...space,
          canAdminSpace: isSpaceAdmin(user, space)
        }));

        res.json(stamped);
      } catch (fsError) {
        logger.warn(`Could not load spaces from file: ${fsError.message}. Returning empty array.`);
        res.json([]);
      }
    } catch (error) {
      logger.error('[Wiki Spaces] Error in spaces endpoint:', error.message);
      res.status(500).json({ error: 'Failed to fetch spaces', details: error.message });
    }
  });

  // Get single space by ID
  app.get('/applications/wiki/api/spaces/:id', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      res.json(space);
    } catch (error) {
      logger.error('Error fetching space:', error);
      res.status(500).json({ error: 'Failed to fetch space' });
    }
  });

  // Create a new space
  app.post('/applications/wiki/api/spaces', async (req, res) => {
    try {
      // Require authentication to create spaces
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to create spaces'
        });
      }

      const { name, description, visibility, type, path } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, message: 'Space name is required' });
      }

      if (!path) {
        return res.status(400).json({ success: false, message: 'Folder path is required' });
      }

      if (!type) {
        return res.status(400).json({ success: false, message: 'Space type is required' });
      }

      // Load space templates
      const templatesConfig = await loadSpacesTemplate();
      const spaceTemplate = templatesConfig.spaces.find(t => t.type === type);

      if (!spaceTemplate) {
        return res.status(400).json({ success: false, message: `Invalid space type: ${type}` });
      }

      // Get next space ID
      const spaces = await dataManager.read('spaces');
      let nextId = spaces.length > 0 ? Math.max(...spaces.map(s => s.id)) + 1 : 1;

      // Normalize the path to remove any ./ and ensure consistency
      const fullPath = require('node:path').resolve(process.cwd(), path);

      // Determine permissions based on type
      const permissions = spaceTemplate.permissions;

      // Author of the SAMPLE DOCUMENTS below — not stored on the space record.
      // `createdBy` is the space's own ownership field, and it is read as an
      // access grant (spacePermissions.isSpaceAdmin, spaceFilingRoutes), so it
      // must carry the user's EMAIL rather than their display name.
      const author = req.user ? req.user.name : 'System';

      const newSpace = {
        id: nextId,
        name,
        description: description || spaceTemplate.description,
        visibility: visibility || spaceTemplate.visibility,
        permissions: permissions,
        type: type,
        path: fullPath,
        documentCount: 0,
        createdAt: new Date().toISOString(),
        createdBy: req.user ? req.user.email : 'system',
        updatedAt: new Date().toISOString(),
        updatedBy: req.user ? req.user.email : 'system',
        metadata: { archived: false }
      };

      // Create folder structure and sample files from template
      try {
        const sampleDocuments = await initializeSpaceFromTemplate(
          spaceTemplate,
          path,
          filing,
          logger,
          author
        );

        // Update space ID in documents
        sampleDocuments.forEach(doc => {
          doc.spaceId = nextId;
          doc.spaceName = name;
        });

        // Update document count
        newSpace.documentCount = sampleDocuments.length;

        // The template initializer wrote the sample files to disk; the filing
        // service is the document index now (no documents.json). The search
        // index picks them up from disk via the file watcher / rebuild.
        logger.info(`Created ${sampleDocuments.length} sample documents for space: ${name}`);
      } catch (createError) {
        logger.error(`Failed to create directory structure for space ${name}:`, createError);
        return res.status(500).json({ success: false, message: 'Failed to create space structure' });
      }

      // Add to spaces list
      spaces.push(newSpace);
      await dataManager.write('spaces', spaces);

      // Clear relevant caches
      await cache.delete('wiki:spaces:list');
      await cache.delete('wiki:recent:activity');

      logger.info(`Created new space: ${name} (ID: ${nextId}, Type: ${type}) at ${fullPath} with ${newSpace.documentCount} documents`);

      res.json({ success: true, space: newSpace });
    } catch (error) {
      logger.error('Error creating space:', error);
      res.status(500).json({ success: false, message: 'Failed to create space' });
    }
  });

  // Update space
  app.put('/applications/wiki/api/spaces/:id', async (req, res) => {
    try {
      // Require authentication to update spaces
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to update spaces'
        });
      }

      const spaceId = parseInt(req.params.id);
      const { name, description, visibility, type, path } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, error: 'Space name is required' });
      }

      if (!path) {
        return res.status(400).json({ success: false, error: 'Folder path is required' });
      }

      if (!type) {
        return res.status(400).json({ success: false, error: 'Space type is required' });
      }

      // Load current spaces
      const spaces = await dataManager.read('spaces');
      const spaceIndex = spaces.findIndex(s => s.id === spaceId);

      if (spaceIndex === -1) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      const currentSpace = spaces[spaceIndex];
      const fullPath = require('node:path').resolve(process.cwd(), path);
      const pathChanged = currentSpace.path !== fullPath;

      // Load space templates
      const templatesConfig = await loadSpacesTemplate();
      const spaceTemplate = templatesConfig.spaces.find(t => t.type === type);

      if (!spaceTemplate) {
        return res.status(400).json({ success: false, error: `Invalid space type: ${type}` });
      }

      // If path changed, check if new folder has content and initialize if needed
      if (pathChanged) {
        try {
          // Check if new folder has existing content
          const hasContent = await folderHasContent(fullPath);

          if (!hasContent) {
            logger.info(`Initializing new folder for space ${name}: ${fullPath}`);
            const sampleDocuments = await initializeSpaceFromTemplate(
              spaceTemplate,
              path,
              filing,
              logger,
              req.user ? req.user.name : 'System'
            );

            // Update document count
            currentSpace.documentCount = sampleDocuments.length;
            logger.info(`Initialized ${sampleDocuments.length} sample documents in new folder`);
          } else {
            logger.info(`Folder ${fullPath} already has content, skipping sample data creation`);
          }
        } catch (initError) {
          logger.error(`Error initializing new folder for space ${name}:`, initError);
          // Continue anyway, just log the error
        }
      }

      // Update space properties
      currentSpace.name = name;
      currentSpace.description = description || currentSpace.description;
      currentSpace.visibility = visibility || currentSpace.visibility;
      currentSpace.type = type;
      currentSpace.path = fullPath;
      currentSpace.permissions = spaceTemplate.permissions;
      currentSpace.updatedAt = new Date().toISOString();

      // Save updated spaces
      spaces[spaceIndex] = currentSpace;
      await dataManager.write('spaces', spaces);

      // Clear relevant caches
      await cache.delete('wiki:spaces:list');
      await cache.delete(`wiki:space:${spaceId}:documents`);

      logger.info(`Updated space: ${name} (ID: ${spaceId})`);

      res.json({ success: true, space: currentSpace });
    } catch (error) {
      logger.error('Error updating space:', error);
      res.status(500).json({ success: false, error: 'Failed to update space' });
    }
  });

  // Delete a space (only removes from spaces.json, leaves content intact)
  app.delete('/applications/wiki/api/spaces/:id', async (req, res) => {
    try {
      // Require authentication to delete spaces
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to delete spaces'
        });
      }

      const spaceId = parseInt(req.params.id);

      // Load current spaces
      const spaces = await dataManager.read('spaces');
      const spaceIndex = spaces.findIndex(s => s.id === spaceId);

      if (spaceIndex === -1) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      const deletedSpace = spaces[spaceIndex];

      // Remove the space from the array
      spaces.splice(spaceIndex, 1);

      // Save updated spaces
      await dataManager.write('spaces', spaces);

      // Clear relevant caches
      await cache.delete('wiki:spaces:list');
      await cache.delete(`wiki:space:${spaceId}:documents`);

      logger.info(`Deleted space: ${deletedSpace.name} (ID: ${spaceId}). Content folder preserved at: ${deletedSpace.path}`);

      res.json({ success: true, message: 'Space deleted successfully' });
    } catch (error) {
      logger.error('Error deleting space:', error);
      res.status(500).json({ success: false, error: 'Failed to delete space' });
    }
  });

  // Get documents for a specific space
  app.get('/applications/wiki/api/spaces/:id/documents', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.id);
      const cacheKey = `wiki:space:${spaceId}:documents`;

      let spaceDocuments = await cache.get(cacheKey);

      if (!spaceDocuments) {
        spaceDocuments = await documentService.listBySpaceId(spaceId);

        await cache.put(cacheKey, spaceDocuments, 300); // 5 minutes
        logger.info(`Loaded documents for space ${spaceId}`);
      }

      res.json(spaceDocuments);
    } catch (error) {
      logger.error('Error fetching space documents:', error);
      res.status(500).json({ error: 'Failed to fetch space documents' });
    }
  });

  // Get folder tree for a space
  app.get('/applications/wiki/api/spaces/:spaceId/folders', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.spaceId);
      logger.info(`Fetching folder tree for space ${spaceId}`);

      const tree = await dataManager.getFolderTree(spaceId);

      // Older sibling of /folder-tree, still used by the space home's root
      // items. It bypasses filingRoutes entirely, so it needs the space's
      // allowedPaths/excludedPaths filter applied here too.
      const spaces = await dataManager.read('spaces');
      const space = (spaces || []).find(s => s.id === spaceId);
      const visible = space ? compileVisibility(space).filterTree(tree) : tree;

      res.json(visible);
    } catch (error) {
      logger.error('Error fetching folder tree:', error);
      res.status(500).json({ error: 'Failed to fetch folder tree' });
    }
  });

  /**
   * Templates offered for a space, optionally resolved for a target FOLDER.
   *
   *   ?folderPath=Solution%20Design/Entreprise%20Technology/Buy
   *
   * With a folderPath the space tier is replaced by the full cascade for that
   * folder (closest first, nearer names shadowing further ones) — that is what
   * makes "create a file in Buy" offer Buy's templates ahead of the space-wide
   * ones. Without it the behaviour is unchanged: the space root tier only.
   *
   * Personal templates are space-wide and orthogonal to distance, so they are
   * returned alongside either way and never take part in shadowing.
   */
  app.get('/applications/wiki/api/spaces/:spaceId/templates', async (req, res) => {
    try {
      const spaceId = parseInt(req.params.spaceId);
      const folderPath = typeof req.query.folderPath === 'string' ? req.query.folderPath : null;

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      // Read-only spaces should not have templates
      if (space.permissions === 'read-only') {
        logger.info(`Space ${space.name} is read-only, returning empty templates`);
        return res.json([]);
      }

      const spaceDir = spaceDirOf(space);
      const user = req.isAuthenticated() ? req.user : null;
      const canEditSpace = isSpaceAdmin(user, space);

      // A folderPath is a client-supplied path used to build directory names, so
      // it gets the same traversal treatment as any other: reject anything that
      // climbs out of the space rather than silently listing a parent's templates.
      const targetFolder = (folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (targetFolder.split('/').includes('..')) {
        return res.status(400).json({ error: 'Invalid folderPath' });
      }

      // …and the same VISIBILITY treatment. Staying inside the content root is
      // not enough when several spaces share one: an unchecked folderPath let a
      // caller enumerate `.system/templates` anywhere in the root, which returns
      // each template's name, path and title line. 404 rather than 403, matching
      // every other hidden-path answer.
      const visibility = compileVisibility(space);
      if (targetFolder && visibility.restricted && !visibility.isFolderAccessible(targetFolder)) {
        logger.warn(`[Templates] folderPath hidden by space filter: space=${spaceId}, path=${targetFolder}`);
        return res.status(404).json({ error: 'Not found' });
      }

      // Space + folder tiers. Without a folderPath the cascade is just the root.
      const cascade = await resolveTemplateCascade(spaceDir, targetFolder, canEditSpace, visibility);

      // Personal templates (.system/useractivity/<prefix>/templates/) — owner only.
      let personalTemplates = [];
      if (user && user.email) {
        const ud = userStore.userDir(user.email);
        personalTemplates = (await readTemplateDir(
          path.resolve(spaceDir, '.system', 'useractivity', ud, 'templates'),
          `.system/useractivity/${ud}/templates/`
        )).map(t => ({ ...t, scope: 'personal', owner: ud, canEdit: true }));
      }

      const templates = [...cascade, ...personalTemplates];
      const folderCount = cascade.filter(t => t.scope === 'folder').length;
      logger.info(
        `Found ${templates.length} templates for space ${spaceId}` +
        `${targetFolder ? ` at "${targetFolder}"` : ''} ` +
        `(${folderCount} folder, ${cascade.length - folderCount} space, ${personalTemplates.length} personal)`
      );
      res.json(templates);
    } catch (error) {
      logger.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  // Get all templates across spaces the user can access (space-level + personal)
  app.get('/applications/wiki/api/templates', async (req, res) => {
    try {
      const spaces = await dataManager.read('spaces').catch(() => []);

      const user = req.isAuthenticated() ? req.user : null;
      const userEmail = user ? user.email : null;
      const visibleSpaces = spaces.filter(space => {
        if (space.permissions === 'read-only') return false;
        if (space.visibility === 'public') return true;
        if (!userEmail) return false;
        if (space.visibility === 'team') return true;
        if (space.visibility === 'private' &&
            Array.isArray(space.allowedUsers) &&
            space.allowedUsers.includes(userEmail)) return true;
        return false;
      });

      const all = [];

      for (const space of visibleSpaces) {
        const spaceDir = spaceDirOf(space);
        const stamp = { spaceId: space.id, spaceName: space.name };

        // Space-level templates — everyone may use, space admins may edit.
        const canEditSpace = isSpaceAdmin(user, space);
        for (const t of await readTemplateDir(path.resolve(spaceDir, '.system', 'templates'), '.system/templates/')) {
          all.push({ ...t, ...stamp, scope: 'space', canEdit: canEditSpace });
        }

        // Personal templates — owner only.
        if (userEmail) {
          const ud = userStore.userDir(userEmail);
          for (const t of await readTemplateDir(
            path.resolve(spaceDir, '.system', 'useractivity', ud, 'templates'),
            `.system/useractivity/${ud}/templates/`
          )) {
            all.push({ ...t, ...stamp, scope: 'personal', owner: ud, canEdit: true });
          }
        }
      }

      logger.info(`Returning ${all.length} templates across ${visibleSpaces.length} spaces`);
      res.json(all);
    } catch (error) {
      logger.error('Error fetching all templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });
};
