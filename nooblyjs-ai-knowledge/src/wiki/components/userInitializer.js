/**
 * @fileoverview User Initialization Tracker
 * Tracks which users have completed the setup wizard.
 * Stores initialization status in a separate JSON file since the core auth service
 * doesn't have an 'initialized' field.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-06
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

/**
 * Manages user initialization status
 */
class UserInitializer {
  /**
   * Initialize the user initializer
   * @param {string} dataDirectory - Path to the data directory
   */
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.initFile = path.join(dataDirectory, 'user-initialized.json');
    this.cache = new Map();
  }

  /**
   * Ensure the data directory and files exist
   */
  async ensureFiles() {
    try {
      await fs.mkdir(this.dataDirectory, { recursive: true });

      // Check if init file exists
      try {
        await fs.access(this.initFile);
      } catch {
        // File doesn't exist, create it
        await fs.writeFile(this.initFile, JSON.stringify({}, null, 2));
      }
    } catch (error) {
      console.error('Error ensuring user initializer files:', error);
      throw error;
    }
  }

  /**
   * Load initialization data from file
   */
  async loadData() {
    try {
      await this.ensureFiles();
      const data = await fs.readFile(this.initFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading user initialization data:', error);
      return {};
    }
  }

  /**
   * Save initialization data to file
   */
  async saveData(data) {
    try {
      await fs.writeFile(this.initFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving user initialization data:', error);
      throw error;
    }
  }

  /**
   * Check if a user has initialized (completed wizard)
   * @param {string} username - The username or email to check
   * @returns {Promise<boolean>} True if user has initialized
   */
  async isInitialized(username) {
    try {
      const data = await this.loadData();
      return data[username] === true;
    } catch (error) {
      console.error(`Error checking initialization for ${username}:`, error);
      return false;
    }
  }

  /**
   * Mark a user as initialized
   * @param {string} username - The username or email to mark as initialized
   * @returns {Promise<void>}
   */
  async markInitialized(username) {
    try {
      const data = await this.loadData();
      data[username] = true;
      await this.saveData(data);
    } catch (error) {
      console.error(`Error marking ${username} as initialized:`, error);
      throw error;
    }
  }

  /**
   * Get initialization status for multiple users
   * @param {string[]} usernames - List of usernames to check
   * @returns {Promise<Object>} Map of username to initialized status
   */
  async getMultipleStatus(usernames) {
    try {
      const data = await this.loadData();
      const status = {};
      for (const username of usernames) {
        status[username] = data[username] === true;
      }
      return status;
    } catch (error) {
      console.error('Error getting multiple initialization status:', error);
      return {};
    }
  }
}

module.exports = UserInitializer;
