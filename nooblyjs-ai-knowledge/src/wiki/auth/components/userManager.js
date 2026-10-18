/**
 * @fileoverview Blog User Manager
 * Manages blog authors and user-related operations.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-09-16
 */

'use strict';

/**
 * Blog user manager class
 * Handles user management operations specific to the blog application.
 */
class UserManager {
  /**
   * Initialize the user manager
   * @param {Object} authProvider - noobly Core auth provider
   * @param {Object} dataManager - Blog data manager
   * @param {Object} logger - Logger instance
   */
  constructor(authProvider, dataManager, logger) {
    this.authProvider = authProvider;
    this.dataManager = dataManager;
    this.logger = logger;
  }

  /**
   * Initialize default blog authors
   * Creates default author entries in the blog data
   */
  async initializeDefaultAuthors() {
    try {
      // Check if authors already exist
      const existingAuthors = await this.dataManager.read('authors').catch(() => []);

      if (existingAuthors.length === 0) {
        // Create default admin author
        const defaultAuthor = {
          id: 1,
          username: 'admin',
          displayName: 'Blog Administrator',
          email: 'admin@blog.local',
          bio: 'The blog administrator and primary author.',
          avatar: null,
          role: 'admin',
          socialLinks: {
            twitter: '',
            linkedin: '',
            github: '',
            website: ''
          },
          joinedAt: new Date().toISOString(),
          postsCount: 0,
          isActive: true
        };

        await this.dataManager.create('authors', defaultAuthor);
        this.logger.info('Default blog author created');
      }

      // Initialize user activity tracking
      await this.initializeUserActivity();

    } catch (error) {
      this.logger.error('Error initializing default authors:', error);
      throw error;
    }
  }

  /**
   * Initialize user activity tracking
   * Sets up activity tracking for blog users
   */
  async initializeUserActivity() {
    try {
      const existingActivity = await this.dataManager.read('userActivity_admin').catch(() => null);

      if (!existingActivity) {
        const defaultActivity = {
          userId: 1,
          username: 'admin',
          lastLogin: new Date().toISOString(),
          totalLogins: 0,
          postsCreated: 0,
          postsPublished: 0,
          lastActivity: new Date().toISOString(),
          sessionsToday: 0,
          activityLog: []
        };

        await this.dataManager.create('userActivity_admin', defaultActivity);
        this.logger.info('User activity tracking initialized');
      }
    } catch (error) {
      this.logger.error('Error initializing user activity:', error);
    }
  }

  /**
   * Get author by username
   * @param {string} username - Username to look up
   * @return {Promise<Object|null>} Author object or null if not found
   */
  async getAuthorByUsername(username) {
    try {
      const authors = await this.dataManager.read('authors');
      return authors.find(author => author.username === username) || null;
    } catch (error) {
      this.logger.error('Error getting author by username:', error);
      return null;
    }
  }

  /**
   * Update author profile
   * @param {string} username - Username of author to update
   * @param {Object} updateData - Data to update
   * @return {Promise<Object>} Updated author object
   */
  async updateAuthorProfile(username, updateData) {
    try {
      const authors = await this.dataManager.read('authors');
      const authorIndex = authors.findIndex(author => author.username === username);

      if (authorIndex === -1) {
        throw new Error('Author not found');
      }

      // Update author data
      const updatedAuthor = {
        ...authors[authorIndex],
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      authors[authorIndex] = updatedAuthor;
      await this.dataManager.write('authors', authors);

      this.logger.info(`Author profile updated: ${username}`);
      return updatedAuthor;
    } catch (error) {
      this.logger.error('Error updating author profile:', error);
      throw error;
    }
  }

  /**
   * Record user login activity
   * @param {string} username - Username of user who logged in
   */
  async recordLoginActivity(username) {
    try {
      const activityKey = `userActivity_${username}`;
      let activity = await this.dataManager.read(activityKey).catch(() => null);

      if (!activity) {
        activity = {
          userId: 1,
          username: username,
          lastLogin: new Date().toISOString(),
          totalLogins: 0,
          postsCreated: 0,
          postsPublished: 0,
          lastActivity: new Date().toISOString(),
          sessionsToday: 0,
          activityLog: []
        };
      }

      // Update login activity
      const now = new Date();
      const today = now.toDateString();
      const lastLoginDate = new Date(activity.lastLogin).toDateString();

      activity.lastLogin = now.toISOString();
      activity.totalLogins += 1;
      activity.lastActivity = now.toISOString();

      if (lastLoginDate !== today) {
        activity.sessionsToday = 1;
      } else {
        activity.sessionsToday += 1;
      }

      // Add to activity log
      activity.activityLog.unshift({
        type: 'login',
        timestamp: now.toISOString(),
        details: 'User logged in'
      });

      // Keep only last 100 activity entries
      if (activity.activityLog.length > 100) {
        activity.activityLog = activity.activityLog.slice(0, 100);
      }

      await this.dataManager.write(activityKey, activity);
      this.logger.info(`Login activity recorded for: ${username}`);

    } catch (error) {
      this.logger.error('Error recording login activity:', error);
    }
  }

  /**
   * Record post creation activity
   * @param {string} username - Username of author
   * @param {string} postId - ID of created post
   */
  async recordPostActivity(username, postId, activityType = 'created') {
    try {
      const activityKey = `userActivity_${username}`;
      let activity = await this.dataManager.read(activityKey).catch(() => null);

      if (activity) {
        if (activityType === 'created') {
          activity.postsCreated += 1;
        } else if (activityType === 'published') {
          activity.postsPublished += 1;
        }

        activity.lastActivity = new Date().toISOString();

        // Add to activity log
        activity.activityLog.unshift({
          type: `post_${activityType}`,
          timestamp: new Date().toISOString(),
          details: `Post ${activityType}: ${postId}`,
          postId: postId
        });

        // Keep only last 100 activity entries
        if (activity.activityLog.length > 100) {
          activity.activityLog = activity.activityLog.slice(0, 100);
        }

        await this.dataManager.write(activityKey, activity);
        this.logger.info(`Post ${activityType} activity recorded for: ${username}`);
      }

      // Update author posts count
      await this.updateAuthorPostsCount(username);

    } catch (error) {
      this.logger.error('Error recording post activity:', error);
    }
  }

  /**
   * Update author posts count
   * @param {string} username - Username of author
   */
  async updateAuthorPostsCount(username) {
    try {
      const authors = await this.dataManager.read('authors');
      const authorIndex = authors.findIndex(author => author.username === username);

      if (authorIndex !== -1) {
        // Count published posts for this author
        const posts = await this.dataManager.read('posts').catch(() => []);
        const publishedPosts = posts.filter(post =>
          post.authorId === authors[authorIndex].id &&
          post.status === 'published'
        );

        authors[authorIndex].postsCount = publishedPosts.length;
        authors[authorIndex].updatedAt = new Date().toISOString();

        await this.dataManager.write('authors', authors);
      }
    } catch (error) {
      this.logger.error('Error updating author posts count:', error);
    }
  }

  /**
   * Get user activity
   * @param {string} username - Username to get activity for
   * @return {Promise<Object|null>} User activity object
   */
  async getUserActivity(username) {
    try {
      const activityKey = `userActivity_${username}`;
      return await this.dataManager.read(activityKey).catch(() => null);
    } catch (error) {
      this.logger.error('Error getting user activity:', error);
      return null;
    }
  }

  /**
   * Get all authors
   * @return {Promise<Array>} Array of author objects
   */
  async getAllAuthors() {
    try {
      return await this.dataManager.read('authors').catch(() => []);
    } catch (error) {
      this.logger.error('Error getting all authors:', error);
      return [];
    }
  }
}

module.exports = UserManager;