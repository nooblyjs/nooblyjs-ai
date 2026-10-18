/**
 * @fileoverview Socket.IO Client Service
 * Handles real-time communication with the server for file changes
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-10
 */

import { navigationController } from '../modules/navigationcontroller.js';
import { initializeEventBusListener } from '../modules/eventBusListener.js';

class SocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.navigationController = null;
  }

  /**
   * Set navigation controller reference for event bus integration
   * @param {Object} navController - The navigationController instance
   */
  setNavigationController(navController) {
    this.navigationController = navController;
    console.log('[SocketService] Navigation controller reference set');
  }

  /**
   * Set notification controller reference
   * @param {Object} notifController - The notificationController instance
   */
  setNotificationController(notifController) {
    this.notificationController = notifController;
    console.log('[SocketService] Notification controller reference set');
  }

  /**
   * Initialize Socket.IO connection
   */
  init() {
    console.log('Initializing Socket.IO connection...');

    // Connect to the server
    this.socket = io({
      // Poll first (always survives HTTP proxies), then upgrade to websocket
      // when the proxy supports it. Avoids hard failures behind reverse proxies.
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts
    });

    // Bind event listeners
    this.bindEvents();
  }

  /**
   * Bind Socket.IO event listeners
   */
  bindEvents() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ Socket.IO connected:', this.socket.id);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.showNotification('Connected to server', 'success', false);

      // Initialize Event Bus listener for detailed event logging
      initializeEventBusListener(this.socket, this.navigationController);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Socket.IO disconnected:', reason);
      this.isConnected = false;

      if (reason === 'io server disconnect') {
        // Server disconnected, manually reconnect
        this.socket.connect();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.showNotification('Failed to connect to server. Real-time updates disabled.', 'warning');
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('✅ Socket.IO reconnected after', attemptNumber, 'attempts');
      this.showNotification('Reconnected to server', 'success', false);
    });

    // File system events
    this.socket.on('file:added', (data) => {
      console.log('📄 File added:', data);
      this.handleFileAdded(data);
    });

    this.socket.on('folder:added', (data) => {
      console.log('📁 Folder added:', data);
      this.handleFolderAdded(data);
    });

    this.socket.on('file:changed', (data) => {
      console.log('📝 File changed:', data);
      this.handleFileChanged(data);
    });

    this.socket.on('file:deleted', (data) => {
      console.log('🗑️ File deleted:', data);
      this.handleFileDeleted(data);
    });

    this.socket.on('folder:deleted', (data) => {
      console.log('🗑️ Folder deleted:', data);
      this.handleFolderDeleted(data);
    });

    // User notification events
    this.socket.on('wiki:user-notification', (notification) => {
      console.log('🔔 User notification received:', notification);
      this.handleUserNotification(notification);
    });
  }

  /**
   * Handle file added event
   */
  async handleFileAdded(data) {
    const { space, file } = data;

    // Show notification
    this.showNotification(`File added: ${file.name}`, 'info');

    // Update navigation tree - refresh the parent folder
    if (navigationController && navigationController.updateTreeNode) {
      await navigationController.updateTreeNode(file.parentPath || '');
    }

    // Update current view if showing this folder
    this.updateCurrentView(space, file, 'added');
  }

  /**
   * Handle folder added event
   */
  async handleFolderAdded(data) {
    const { space, folder } = data;

    // Show notification
    this.showNotification(`Folder added: ${folder.name}`, 'info');

    // Update navigation tree - refresh the parent folder
    if (navigationController && navigationController.updateTreeNode) {
      await navigationController.updateTreeNode(folder.parentPath || '');
    }

    // Update current view if showing this folder
    this.updateCurrentView(space, folder, 'added');
  }

  /**
   * Handle file changed event
   */
  async handleFileChanged(data) {
    const { space, file } = data;

    // Show notification (optional - could be too noisy)
    // this.showNotification(`File updated: ${file.name}`, 'info');

    // No need to update tree for file changes, just metadata
    // But we could refresh the folder view if the user is viewing it
    this.updateCurrentView(space, file, 'changed');
  }

  /**
   * Handle file deleted event
   */
  async handleFileDeleted(data) {
    const { space, file } = data;

    // Show notification
    this.showNotification(`File deleted: ${file.name}`, 'warning');

    // Update navigation tree - refresh the parent folder
    const parentPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
    if (navigationController && navigationController.updateTreeNode) {
      await navigationController.updateTreeNode(parentPath);
    }

    // Update current view if showing this file
    this.updateCurrentView(space, file, 'deleted');
  }

  /**
   * Handle folder deleted event
   */
  async handleFolderDeleted(data) {
    const { space, folder } = data;

    // Show notification
    this.showNotification(`Folder deleted: ${folder.name}`, 'warning');

    // Update navigation tree - refresh the parent folder
    const parentPath = folder.path.includes('/') ? folder.path.substring(0, folder.path.lastIndexOf('/')) : '';
    if (navigationController && navigationController.updateTreeNode) {
      await navigationController.updateTreeNode(parentPath);
    }

    // Update current view if showing this folder
    this.updateCurrentView(space, folder, 'deleted');
  }

  /**
   * Update current view if affected by the change
   */
  updateCurrentView(space, item, action) {
    // This will be implemented based on the current view
    // For now, we'll just log it
    console.log(`Current view update needed: ${space.name} - ${item.name} (${action})`);
  }

  /**
   * Handle user notification from subscription
   */
  handleUserNotification(notification) {
    const { name, path, type, operation } = notification;
    const operationText = operation || type.split(':')[1] || 'modified';

    // Show toast notification
    this.showNotification(`"${name}" was ${operationText}`, 'info');

    // Pass to notification controller for history update
    if (this.notificationController) {
      this.notificationController.handleIncomingNotification(notification);
    }
  }

  /**
   * Show notification toast
   */
  showNotification(message, type = 'info', persist = false) {
    // Create Bootstrap alert element
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${this.getBootstrapAlertClass(type)} alert-dismissible fade show`;
    alertDiv.setAttribute('role', 'alert');
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    alertDiv.style.maxWidth = '400px';
    alertDiv.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';

    // Add icon based on type
    const icon = this.getIcon(type);

    alertDiv.innerHTML = `
      <div class="d-flex align-items-center">
        <i class="bi ${icon} me-2"></i>
        <div>${message}</div>
      </div>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    document.body.appendChild(alertDiv);

    // Auto-dismiss after 3 seconds unless persist is true
    if (!persist) {
      setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => {
          if (alertDiv.parentNode) {
            alertDiv.parentNode.removeChild(alertDiv);
          }
        }, 150);
      }, 3000);
    }
  }

  /**
   * Get Bootstrap alert class for notification type
   */
  getBootstrapAlertClass(type) {
    const typeMap = {
      'success': 'success',
      'info': 'info',
      'warning': 'warning',
      'error': 'danger'
    };
    return typeMap[type] || 'info';
  }

  /**
   * Get icon for notification type
   */
  getIcon(type) {
    const iconMap = {
      'success': 'bi-check-circle-fill',
      'info': 'bi-info-circle-fill',
      'warning': 'bi-exclamation-triangle-fill',
      'error': 'bi-x-circle-fill'
    };
    return iconMap[type] || 'bi-info-circle-fill';
  }

  /**
   * Disconnect from Socket.IO server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.isConnected = false;
    }
  }

  /**
   * Check if connected
   */
  connected() {
    return this.isConnected;
  }
}

// Create and export singleton instance
const socketService = new SocketService();

export default socketService;
