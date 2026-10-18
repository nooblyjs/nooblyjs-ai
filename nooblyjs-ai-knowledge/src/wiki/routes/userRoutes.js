/**
 * @fileoverview User API routes for Wiki application
 * Handles authentication, user profiles, and user activity tracking
 *
 * @author noobly Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs').promises;

const userStore = require('../components/userStore');
const spaceUserStore = require('../components/spaceUserStore');
const userArtifacts = require('../components/userArtifacts');
const visitTally = require('../components/visitTally');
const avatarStore = require('../../shared/auth/avatarStore');
const { containedPath, handlePathError } = require('../../shared/utils/pathSafety');

/**
 * Identity used to key a user's activity folder: their email when logged in,
 * or the literal 'anonymous' when not.
 *
 * Storage split:
 *  - Profile preferences are GLOBAL — <appBaseDir>/.system/useractivity/<prefix>/preferences.json (userStore).
 *  - Activity + dashboard are PER-SPACE — <space>/.system/useractivity/<prefix>/{activity.json,dashboard.md}
 *    (spaceUserStore, keyed by spaceUserStore.spaceOf(req)).
 */
const identityOf = (req) => (req.isAuthenticated() && req.user ? req.user.email : 'anonymous');

/**
 * Configures and registers user routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  
  const app = options.app;
  const { filing, cache, log, queue, search, appBaseDir } = services;
  const logger = log; // Alias for backward compatibility

  // Profile pictures live in <appBaseDir>/data/auth/images, keyed by a
  // filesystem-safe form of the user's email so any client can resolve an
  // avatar from an email alone (header badge, comment avatars). The folder
  // location, email→key reduction, save (with stale-extension cleanup) and
  // provenance marker are all owned by shared/auth/avatarStore — the same module
  // the Entra sign-in photo sync writes through, so uploads and Entra photos land
  // in exactly one place.

  // Configure multer for avatar uploads
  const storage = multer.memoryStorage();
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|gif/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    }
  });

  // User profile endpoints
  app.get('/applications/wiki/api/profile', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        logger.warn('Profile request but user not authenticated');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      // Get current user from Passport session (from users.json)
      const currentUser = req.user;
      logger.info(`Loading profile for user: ${currentUser.email}, name: ${currentUser.name}`);

      // Load user preferences from userPreferences.json
      let userPreferences;
      try {
        userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');
        if (!userPreferences) {
          // Create default preferences
          userPreferences = {
            userId: currentUser.id,
            bio: '',
            location: '',
            timezone: 'UTC',
            emailNotifications: true,
            darkMode: false,
            defaultLanguage: 'en',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await userStore.writeJson(appBaseDir, identityOf(req), 'preferences.json', userPreferences);
          logger.info(`Created default preferences for user ${currentUser.id}`);
        }
      } catch (error) {
        logger.error('Error loading user preferences:', error);
        // Use defaults
        userPreferences = {
          userId: currentUser.id,
          bio: '',
          location: '',
          timezone: 'UTC',
          emailNotifications: true,
          darkMode: false,
          defaultLanguage: 'en',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      // Combine user data from users.json with preferences from userPreferences.json
      const userProfile = {
        id: currentUser.id,
        name: currentUser.name || '',
        email: currentUser.email,
        role: 'administrator',
        bio: userPreferences.bio || '',
        location: userPreferences.location || '',
        timezone: userPreferences.timezone || 'UTC',
        preferences: {
          emailNotifications: userPreferences.emailNotifications ?? true,
          darkMode: userPreferences.darkMode ?? false,
          defaultLanguage: userPreferences.defaultLanguage || 'en'
        },
        avatar: currentUser.avatar || null,
        createdAt: currentUser.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      res.json(userProfile);
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Failed to fetch user profile' });
    }
  });

  app.put('/applications/wiki/api/profile', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const {
        name,
        email,
        bio,
        location,
        timezone,
        preferences
      } = req.body;

      // Validate required fields
      if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
      }

      const currentUser = req.user;
      const authService = app.get('authservice');

      // Update user via authservice
      try {
        await authService.updateUser(currentUser.username, {
          email: email.trim().toLowerCase()
        });
        logger.info(`Updated user data for ${email}`);
      } catch (error) {
        logger.warn(`Could not update user via authservice: ${error.message}`);
      }

      // Update preferences in userPreferences.json
      let userPreferences;
      try {
        userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');
      } catch (error) {
        logger.info('No existing preferences, creating new');
      }

      const updatedPreferences = {
        ...(userPreferences || {}),
        userId: currentUser.id,
        bio: bio || '',
        location: location || '',
        timezone: timezone || 'UTC',
        emailNotifications: preferences?.emailNotifications ?? true,
        darkMode: preferences?.darkMode ?? false,
        defaultLanguage: preferences?.defaultLanguage || 'en',
        updatedAt: new Date().toISOString(),
        createdAt: userPreferences?.createdAt || new Date().toISOString()
      };

      await userStore.writeJson(appBaseDir, identityOf(req), 'preferences.json', updatedPreferences);

      logger.info(`Updated user preferences for user ${currentUser.id}`);

      // Return combined profile
      const updatedProfile = {
        id: currentUser.id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'administrator',
        bio: updatedPreferences.bio,
        location: updatedPreferences.location,
        timezone: updatedPreferences.timezone,
        preferences: {
          emailNotifications: updatedPreferences.emailNotifications,
          darkMode: updatedPreferences.darkMode,
          defaultLanguage: updatedPreferences.defaultLanguage
        },
        avatar: currentUser.avatar || null,
        createdAt: currentUser.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: updatedProfile
      });
    } catch (error) {
      logger.error('Error updating user profile:', error);
      res.status(500).json({ error: 'Failed to update user profile' });
    }
  });

  // Password change endpoint
  app.post('/applications/wiki/api/profile/change-password', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated'
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password and new password are required'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters'
        });
      }

      // Verify current password via authservice
      const user = req.user;
      const authService = app.get('authservice');

      try {
        await authService.authenticateUser(user.username, currentPassword);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      // Update password via authservice
      try {
        await authService.updateUser(user.username, {
          password: newPassword
        });
        logger.info(`Password changed successfully for user ${user.email}`);
      } catch (error) {
        logger.error(`Failed to update password for user ${user.username}:`, error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update password'
        });
      }

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Display-name update endpoint. Used by the onboarding wizard when a user
  // arrives with no real name (or only a name derived from their email, e.g.
  // auto-provisioned Teams/Chrome identities). The core auth store is keyed by
  // email; we persist both `fullName` (canonical) and `name` (legacy field some
  // call sites read) so every surface — header, profile, comments — agrees.
  app.post('/applications/wiki/api/profile/display-name', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ success: false, error: 'Name is required' });
      }
      if (name.length > 100) {
        return res.status(400).json({ success: false, error: 'Name must be 100 characters or fewer' });
      }

      const user = req.user;
      const authService = app.get('authservice');
      if (!authService || typeof authService.updateUser !== 'function') {
        return res.status(500).json({ success: false, error: 'Authentication service unavailable' });
      }

      try {
        await authService.updateUser(user.email, { fullName: name, name });
        logger.info(`Display name updated for ${user.email}`);
      } catch (error) {
        logger.error(`Could not update display name for ${user.email}: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to update name' });
      }

      res.json({ success: true, name });
    } catch (error) {
      logger.error('Display name update error:', error);
      res.status(500).json({ success: false, error: 'Failed to update name' });
    }
  });

  // Avatar upload endpoint
  app.post('/applications/wiki/api/profile/avatar', upload.single('avatar'), async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      const user = req.user;
      const fileExtension = (path.extname(req.file.originalname) || '.png').toLowerCase();

      // Persist through the shared store: writes the image, clears any stale copy
      // under another extension, and marks the picture as user-uploaded so an
      // Entra sign-in never overwrites the one the user chose.
      const savedExt = await avatarStore.saveAvatar(appBaseDir, user.email, fileExtension, req.file.buffer, 'upload');

      logger.info(`Avatar uploaded for user ${user.email}: ${avatarStore.keyOf(user.email)}${savedExt}`);

      // Update user avatar via authservice
      const authService = app.get('authservice');
      const avatarUrl = `/applications/wiki/avatars/${encodeURIComponent(user.email)}`;
      try {
        await authService.updateUser(user.username, {
          avatar: avatarUrl
        });
      } catch (error) {
        logger.warn(`Could not update avatar in authservice: ${error.message}`);
      }

      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        avatarUrl: avatarUrl
      });
    } catch (error) {
      logger.error('Avatar upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload avatar'
      });
    }
  });

  // Serve avatar images
  app.get('/applications/wiki/media/:filename', async (req, res) => {
    try {
      const fileName = req.params.filename;
      const mediaDir = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'media');

      // Contain the client-supplied name inside mediaDir: rejects '..', absolute
      // paths and drive letters before anything touches the filesystem.
      let filePath;
      try {
        filePath = containedPath(mediaDir, fileName);
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      // Check if file exists
      try {
        await fs.access(filePath);
        res.sendFile(filePath);
      } catch (err) {
        res.status(404).json({ error: 'Avatar not found' });
      }
    } catch (error) {
      logger.error('Error serving avatar:', error);
      res.status(500).json({ error: 'Failed to serve avatar' });
    }
  });

  // Serve profile pictures by email — the email is reduced to the same safe
  // key used at upload time, so no user-supplied path segments reach the
  // filesystem. 404s when the user has not uploaded a picture.
  app.get('/applications/wiki/avatars/:email', async (req, res) => {
    try {
      const filePath = await avatarStore.resolveAvatarPath(appBaseDir, req.params.email);
      if (filePath) {
        return res.sendFile(filePath, { headers: { 'Cache-Control': 'no-cache' } });
      }
      res.status(404).json({ error: 'Avatar not found' });
    } catch (error) {
      logger.error('Error serving avatar:', error);
      res.status(500).json({ error: 'Failed to serve avatar' });
    }
  });

  // Personal dashboard — the logged-in user's `dashboard.md` from their activity
  // folder (<appBaseDir>/.system/useractivity/<prefix>/dashboard.md). Returns
  // { exists, content }; the frontend falls back to the per-space
  // `.system/dashboards/<prefix>.md` when no per-user copy exists.
  app.get('/applications/wiki/api/user/dashboard', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const content = await spaceUserStore.readText(appBaseDir, spaceUserStore.spaceOf(req), req.user.email, 'dashboard.md');
      res.json({ exists: content != null, content: content || '' });
    } catch (error) {
      logger.error('Error loading user dashboard:', error);
      res.status(500).json({ error: 'Failed to load dashboard' });
    }
  });

  /**
   * Read the user's activity record for the request's space, creating an empty
   * one if there is nothing usable on disk. Both lists come back NORMALISED —
   * the legacy `spaceName` stamp dropped and the duplicates it caused collapsed
   * (see components/userArtifacts.js).
   */
  async function readActivity(req) {
    const userId = req.isAuthenticated() ? req.user.id : 'anonymous';
    let stored = null;
    try {
      stored = await spaceUserStore.readJson(
        appBaseDir, spaceUserStore.spaceOf(req), identityOf(req), 'activity.json'
      );
    } catch (_) {
      stored = null; // treat a read failure as "nothing stored yet"
    }

    const usable = stored && typeof stored === 'object' && !Array.isArray(stored);
    return {
      userId: (usable && stored.userId) || userId,
      starred: userArtifacts.normalise(usable ? stored.starred : []),
      recent: userArtifacts.normalise(usable ? stored.recent : []),
      createdAt: (usable && stored.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /** Persist an activity record (already normalised). */
  async function writeActivity(req, activity) {
    await spaceUserStore.writeJson(
      appBaseDir, spaceUserStore.spaceOf(req), identityOf(req), 'activity.json', activity
    );
  }

  // User activity tracking endpoints
  //
  // Scoped by the space's REAL visibility, not by a name stamp on each record:
  // several spaces are views of one content root and share one activity.json,
  // so a recent/starred entry belongs to the PATH and shows up in every view
  // that can see it. Renaming a space no longer hides anything.
  app.get('/applications/wiki/api/user/activity', async (req, res) => {
    try {
      const activity = await readActivity(req);
      const space = await spaceUserStore.resolveSpace(appBaseDir, spaceUserStore.spaceOf(req));

      res.json({
        ...activity,
        starred: userArtifacts.filterVisible(space, activity.starred),
        recent: userArtifacts.filterVisible(space, activity.recent)
      });
    } catch (error) {
      logger.error('Error fetching user activity:', error);
      res.status(500).json({ error: 'Failed to fetch user activity' });
    }
  });

  app.post('/applications/wiki/api/user/star', async (req, res) => {
    try {
      const { path, spaceName, title, action } = req.body;

      // `spaceName` still selects WHICH STORE (content root) to write to; it is
      // no longer recorded on the entry, so it is optional.
      if (!path || !title) {
        return res.status(400).json({ error: 'Path and title are required' });
      }

      const userActivity = await readActivity(req);
      const key = userArtifacts.recordKey({ path });

      if (action === 'star') {
        if (!userActivity.starred.some(item => userArtifacts.recordKey(item) === key)) {
          userActivity.starred.unshift({
            path: String(path).replace(/\\/g, '/'),
            title,
            starredAt: new Date().toISOString()
          });
        }
      } else if (action === 'unstar') {
        userActivity.starred = userActivity.starred.filter(
          item => userArtifacts.recordKey(item) !== key
        );
      }

      await writeActivity(req, userActivity);

      const space = await spaceUserStore.resolveSpace(appBaseDir, spaceName || spaceUserStore.spaceOf(req));
      logger.info(`Document ${action}red: ${title} by user ${userActivity.userId}`);

      res.json({
        success: true,
        message: `Document ${action}red successfully`,
        starred: userArtifacts.filterVisible(space, userActivity.starred)
      });
    } catch (error) {
      logger.error('Error updating star status:', error);
      res.status(500).json({ error: 'Failed to update star status' });
    }
  });

  app.post('/applications/wiki/api/user/visit', async (req, res) => {
    try {
      const { path, spaceName, title, action } = req.body;

      // `spaceName` still selects WHICH STORE (content root) to write to; it is
      // no longer recorded on the entry, so it is optional.
      if (!path || !title) {
        return res.status(400).json({ error: 'Path and title are required' });
      }

      const userActivity = await readActivity(req);
      const userId = userActivity.userId;
      const key = userArtifacts.recordKey({ path });

      // Replace any existing entry for this document, then put it on top.
      userActivity.recent = userActivity.recent.filter(
        item => userArtifacts.recordKey(item) !== key
      );
      userActivity.recent.unshift({
        path: String(path).replace(/\\/g, '/'),
        title,
        action, // 'viewed' or 'edited'
        visitedAt: new Date().toISOString()
      });

      // The cap is per CONTENT ROOT, and every space sharing that root draws
      // from the same list — so it has to be generous enough that a busy day in
      // one view does not evict another view's history entirely. (The UI shows
      // the first handful AFTER filtering to what the current space exposes.)
      userActivity.recent = userActivity.recent.slice(0, userArtifacts.RECENT_LIMIT);

      try {
        await writeActivity(req, userActivity);
      } catch (writeError) {
        logger.error(`[Visit] Failed to write activity for user ${userId}:`, writeError.message);
        throw writeError; // Re-throw to be caught by outer catch
      }

      const space = await spaceUserStore.resolveSpace(appBaseDir, spaceName || spaceUserStore.spaceOf(req));

      // Count the visit in the per-day tally as well. `recent` above is deduped
      // by path and capped at RECENT_LIMIT, so it can say WHAT was read but
      // never HOW MUCH — see components/visitTally.js. Best effort by design:
      // a counter that cannot be written must not fail the visit that was
      // actually made, so this warns and moves on. It reuses the space record
      // just resolved, so it costs no extra read of spaces.json.
      try {
        const rootDir = spaceUserStore.spaceContentDir(space);
        if (rootDir) await visitTally.record(rootDir, identityOf(req), action);
      } catch (tallyError) {
        logger.warn(`[Visit] Could not update the usage tally: ${tallyError.message}`);
      }

      logger.info(`[Visit] Document visit tracked: ${title} (${action}) by user ${userId}`);

      res.json({
        success: true,
        message: 'Visit tracked successfully',
        recent: userArtifacts.filterVisible(space, userActivity.recent)
      });
    } catch (error) {
      logger.error('Error tracking visit:', error.message || error);
      res.status(500).json({ error: 'Failed to track visit' });
    }
  });

  // Remove one viewed/recent entry, or clear the whole viewed history.
  // Body: { path } for a single item, or { clearAll: true }.
  app.delete('/applications/wiki/api/user/visit', async (req, res) => {
    try {
      const { path: docPath, spaceName, clearAll } = req.body || {};

      if (!clearAll && !docPath) {
        return res.status(400).json({ error: 'path is required (or clearAll: true)' });
      }

      const userActivity = await readActivity(req);

      if (clearAll) {
        // Clears the history for the whole CONTENT ROOT, which is what the user
        // is looking at: every space on that root shares one list.
        userActivity.recent = [];
      } else {
        const key = userArtifacts.recordKey({ path: docPath });
        userActivity.recent = userActivity.recent.filter(
          item => userArtifacts.recordKey(item) !== key
        );
      }

      await writeActivity(req, userActivity);

      const space = await spaceUserStore.resolveSpace(appBaseDir, spaceName || spaceUserStore.spaceOf(req));
      logger.info(`[Visit] ${clearAll ? 'Cleared viewed history' : 'Removed viewed item'} for user ${userActivity.userId}`);
      res.json({ success: true, recent: userArtifacts.filterVisible(space, userActivity.recent) });
    } catch (error) {
      logger.error('Error deleting visit:', error.message || error);
      res.status(500).json({ error: 'Failed to delete visit' });
    }
  });

  // Folder view preferences endpoints
  app.get('/applications/wiki/api/user/folder-view-preferences', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.id;

      // Try to get user preferences from dataServe
      let userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');

      // If no preferences exist or folderViewPreferences is not set, return empty object
      if (!userPreferences || !userPreferences.folderViewPreferences) {
        return res.json({ folderViewPreferences: {} });
      }

      res.json({ folderViewPreferences: userPreferences.folderViewPreferences });
    } catch (error) {
      logger.error('Error fetching folder view preferences:', error);
      res.status(500).json({ error: 'Failed to fetch folder view preferences' });
    }
  });

  app.post('/applications/wiki/api/user/folder-view-preference', async (req, res) => {
    try {
      // Check if user is authenticated with Passport
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { spaceId, folderPath, viewMode } = req.body;

      if (!spaceId || viewMode === undefined || viewMode === null) {
        return res.status(400).json({ error: 'spaceId and viewMode are required' });
      }

      // Validate viewMode
      const validViewModes = ['grid', 'details', 'cards'];
      if (!validViewModes.includes(viewMode)) {
        return res.status(400).json({ error: 'Invalid view mode' });
      }

      const userId = req.user.id;

      // Get current user preferences
      let userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');

      // If no preferences exist, create default structure
      if (!userPreferences) {
        userPreferences = {
          userId: userId,
          bio: '',
          location: '',
          timezone: 'UTC',
          emailNotifications: true,
          darkMode: false,
          defaultLanguage: 'en',
          folderViewPreferences: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      // Ensure folderViewPreferences exists
      if (!userPreferences.folderViewPreferences) {
        userPreferences.folderViewPreferences = {};
      }

      // Ensure space-specific preferences exist
      if (!userPreferences.folderViewPreferences[spaceId]) {
        userPreferences.folderViewPreferences[spaceId] = {};
      }

      // Use empty string for root folder, otherwise use the provided path
      const key = folderPath || '';
      userPreferences.folderViewPreferences[spaceId][key] = viewMode;
      userPreferences.updatedAt = new Date().toISOString();

      // Save updated preferences
      await userStore.writeJson(appBaseDir, identityOf(req), 'preferences.json', userPreferences);

      logger.info(`Folder view preference saved: ${viewMode} for space ${spaceId}, folder '${key}' by user ${userId}`);

      res.json({
        success: true,
        message: 'Folder view preference saved successfully',
        folderViewPreferences: userPreferences.folderViewPreferences
      });
    } catch (error) {
      logger.error('Error saving folder view preference:', error);
      res.status(500).json({ error: 'Failed to save folder view preference' });
    }
  });

  // Selected spaces preferences endpoints
  app.get('/applications/wiki/api/user/selected-spaces', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const userId = req.user.id;
      let userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');

      if (!userPreferences || !userPreferences.selectedSpaces) {
        return res.json({ selectedSpaces: [] });
      }

      res.json({ selectedSpaces: userPreferences.selectedSpaces });
    } catch (error) {
      logger.error('Error fetching selected spaces:', error);
      res.status(500).json({ error: 'Failed to fetch selected spaces' });
    }
  });

  app.put('/applications/wiki/api/user/selected-spaces', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const { spaceIds } = req.body;

      if (!Array.isArray(spaceIds)) {
        return res.status(400).json({ error: 'spaceIds must be an array' });
      }

      const userId = req.user.id;
      let userPreferences = await userStore.readJson(appBaseDir, identityOf(req), 'preferences.json');

      if (!userPreferences) {
        userPreferences = {
          userId: userId,
          bio: '',
          location: '',
          timezone: 'UTC',
          emailNotifications: true,
          darkMode: false,
          defaultLanguage: 'en',
          selectedSpaces: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }

      userPreferences.selectedSpaces = spaceIds;
      userPreferences.updatedAt = new Date().toISOString();

      await userStore.writeJson(appBaseDir, identityOf(req), 'preferences.json', userPreferences);

      logger.info(`Selected spaces updated for user ${userId}: ${spaceIds.length} spaces`);

      res.json({
        success: true,
        message: 'Selected spaces saved successfully',
        selectedSpaces: userPreferences.selectedSpaces
      });
    } catch (error) {
      logger.error('Error saving selected spaces:', error);
      res.status(500).json({ error: 'Failed to save selected spaces' });
    }
  });

  // Per-user activity (recent + starred) is served by the /user/activity,
  // /user/star and /user/visit endpoints above, backed by
  // .system/useractivity/<prefix>/activity.json. The old global /api/activity
  // endpoints and .application/activity.json have been retired.
};
