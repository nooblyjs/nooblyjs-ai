/**
 * @fileoverview Security Manager
 * Manages role-based access control (RBAC) with two roles: User and Administrator
 * Stores and retrieves security configuration for the application
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

/**
 * SecurityManager handles user roles and permissions
 * Stores data in ./.application/data/security/ directory
 */
class SecurityManager {
  /**
   * Create a new SecurityManager instance
   * @param {Object} filing - Filing service for file operations
   * @param {Object} log - Logger instance
   */
  constructor(filing, log, appBaseDir) {
    this.filing = filing;
    this.log = log;
    const baseDir = appBaseDir || path.join(process.cwd(), '.application');
    this.securityDir = path.join(baseDir, 'data', 'security');
    this.usersFile = path.join(this.securityDir, 'users.json');
    this.adminsFile = path.join(this.securityDir, 'admins.json');
    this.users = [];
    this.admins = [];
  }

  /**
   * Initialize the SecurityManager
   * Creates necessary directories and loads existing data
   */
  async initialize() {
    try {
      this.log.info('🔐 [SecurityManager] Starting initialization...');
      this.log.info(`🔐 [SecurityManager] Security dir: ${this.securityDir}`);
      this.log.info(`🔐 [SecurityManager] Users file: ${this.usersFile}`);
      this.log.info(`🔐 [SecurityManager] Admins file: ${this.adminsFile}`);

      // Ensure security directory exists
      try {
        await fs.mkdir(this.securityDir, { recursive: true });
        this.log.info('🔐 [SecurityManager] Security directory ensured');
      } catch (error) {
        // Directory might already exist or other error - continue anyway
        this.log.warn('🔐 [SecurityManager] Directory creation result:', error.message);
      }

      // Load or initialize users list
      try {
        this.log.info('🔐 [SecurityManager] Attempting to read users file...');
        const usersData = await fs.readFile(this.usersFile, 'utf8');
        this.log.info(`🔐 [SecurityManager] Users file content: ${usersData}`);
        this.users = JSON.parse(usersData);
        this.log.info(`🔐 [SecurityManager] ✅ Loaded ${this.users.length} authorized users: ${JSON.stringify(this.users)}`);
      } catch (error) {
        // File doesn't exist, initialize empty
        this.log.warn(`🔐 [SecurityManager] Users file error: ${error.message}`);
        this.users = [];
        await this.saveUsers();
        this.log.info('🔐 [SecurityManager] Initialized empty users list');
      }

      // Load or initialize admins list
      try {
        this.log.info('🔐 [SecurityManager] Attempting to read admins file...');
        const adminsData = await fs.readFile(this.adminsFile, 'utf8');
        this.log.info(`🔐 [SecurityManager] Admins file content: ${adminsData}`);
        this.admins = JSON.parse(adminsData);
        this.log.info(`🔐 [SecurityManager] ✅ Loaded ${this.admins.length} administrators: ${JSON.stringify(this.admins)}`);
      } catch (error) {
        // File doesn't exist, initialize empty
        this.log.warn(`🔐 [SecurityManager] Admins file error: ${error.message}`);
        this.admins = [];
        await this.saveAdmins();
        this.log.info('🔐 [SecurityManager] Initialized empty admins list');
      }

      this.log.info('🔐 [SecurityManager] ✓ Initialization complete');
      this.log.info(`🔐 [SecurityManager] Final state - Users: ${JSON.stringify(this.users)} | Admins: ${JSON.stringify(this.admins)}`);
      return true;
    } catch (error) {
      this.log.error('🔐 [SecurityManager] ✗ Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Save users list to file
   */
  async saveUsers() {
    try {
      await fs.writeFile(this.usersFile, JSON.stringify(this.users, null, 2), 'utf8');
    } catch (error) {
      this.log.error('Failed to save users:', error);
      throw error;
    }
  }

  /**
   * Save admins list to file
   */
  async saveAdmins() {
    try {
      await fs.writeFile(this.adminsFile, JSON.stringify(this.admins, null, 2), 'utf8');
    } catch (error) {
      this.log.error('Failed to save admins:', error);
      throw error;
    }
  }

  /**
   * Add a user to the authorized users list
   * @param {string} email - User email address
   * @returns {Object} Result object with success flag
   */
  async addUser(email) {
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email address');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already a user
    if (this.users.includes(normalizedEmail)) {
      return { success: false, message: 'User already exists' };
    }

    // Check if they're an admin
    if (this.admins.includes(normalizedEmail)) {
      return { success: false, message: 'User is already an administrator' };
    }

    this.users.push(normalizedEmail);
    await this.saveUsers();

    this.log.info(`Added user: ${normalizedEmail}`);
    return { success: true, message: 'User added successfully' };
  }

  /**
   * Remove a user from the authorized users list
   * @param {string} email - User email address
   * @returns {Object} Result object with success flag
   */
  async removeUser(email) {
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email address');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const index = this.users.indexOf(normalizedEmail);

    if (index === -1) {
      return { success: false, message: 'User not found' };
    }

    this.users.splice(index, 1);
    await this.saveUsers();

    this.log.info(`Removed user: ${normalizedEmail}`);
    return { success: true, message: 'User removed successfully' };
  }

  /**
   * Add a user as an administrator
   * @param {string} email - User email address
   * @returns {Object} Result object with success flag
   */
  async addAdmin(email) {
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email address');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already an admin
    if (this.admins.includes(normalizedEmail)) {
      return { success: false, message: 'User is already an administrator' };
    }

    // Remove from regular users if present
    const userIndex = this.users.indexOf(normalizedEmail);
    if (userIndex !== -1) {
      this.users.splice(userIndex, 1);
      await this.saveUsers();
    }

    this.admins.push(normalizedEmail);
    await this.saveAdmins();

    this.log.info(`Added administrator: ${normalizedEmail}`);
    return { success: true, message: 'Administrator added successfully' };
  }

  /**
   * Remove a user as an administrator
   * @param {string} email - User email address
   * @returns {Object} Result object with success flag
   */
  async removeAdmin(email) {
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email address');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const index = this.admins.indexOf(normalizedEmail);

    if (index === -1) {
      return { success: false, message: 'Administrator not found' };
    }

    this.admins.splice(index, 1);
    await this.saveAdmins();

    this.log.info(`Removed administrator: ${normalizedEmail}`);
    return { success: true, message: 'Administrator removed successfully' };
  }

  /**
   * Get user role (user, admin, or null if not found)
   * @param {string} email - User email address
   * @returns {string|null} Role: 'admin', 'user', or null
   */
  getUserRole(email) {
    if (!email || typeof email !== 'string') {
      return null;
    }

    const normalizedEmail = email.toLowerCase().trim();

    if (this.admins.includes(normalizedEmail)) {
      return 'admin';
    }

    if (this.users.includes(normalizedEmail)) {
      return 'user';
    }

    return null;
  }

  /**
   * Get all authorized users
   * @returns {Array<string>} Array of user emails
   */
  getUsers() {
    this.log.debug(`🔐 [SecurityManager.getUsers()] Returning ${this.users.length} users:`, this.users);
    return [...this.users];
  }

  /**
   * Get all administrators
   * @returns {Array<string>} Array of admin emails
   */
  getAdmins() {
    this.log.debug(`🔐 [SecurityManager.getAdmins()] Returning ${this.admins.length} admins:`, this.admins);
    return [...this.admins];
  }

  /**
   * Get security summary
   * @returns {Object} Security configuration summary
   */
  getSummary() {
    return {
      userCount: this.users.length,
      adminCount: this.admins.length,
      users: this.users,
      admins: this.admins
    };
  }
}

module.exports = SecurityManager;
