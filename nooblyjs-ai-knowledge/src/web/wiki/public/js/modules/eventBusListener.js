/**
 * @fileoverview Frontend Event Bus Listener
 * Listens for file/folder change events from the server via Socket.IO
 * and logs them to the browser console with detailed information
 * Also triggers navigation and file viewer updates
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

'use strict';

import { updateNavigation, updatefolderViewer, updateFileviewer, setNavigationController } from './navigationUpdater.js';

/**
 * Initialize and setup event bus listener for Socket.IO events
 * @param {Object} socket - Socket.IO client socket instance
 * @param {Object} navigationController - Reference to navigation controller (optional, can be set later)
 */
function initializeEventBusListener(socket, navigationController = null) {
  if (!socket) {
    console.warn('[EventBusListener] Socket.IO not available');
    return;
  }

  // Set navigation controller reference if provided
  if (navigationController) {
    setNavigationController(navigationController);
  }

  // Listen for file/folder change events
  socket.on('wiki:file-change', (event) => {
    logFileChangeEvent(event);
  });

  console.info('[EventBusListener] Wiki Event Bus listener initialized');
}

/**
 * Format and log file change events to console
 * Also triggers navigation and file viewer updates
 * @param {Object} event - Event object from server
 */
function logFileChangeEvent(event) {
  if (!event) return;

  const {
    event: eventMeta,
    space,
    item,
    context
  } = event;

  // Color coding based on operation
  const colors = {
    create: '#4CAF50', // Green
    update: '#2196F3', // Blue
    delete: '#F44336', // Red
    rename: '#FF9800', // Orange
    move:   '#9C27B0'  // Purple
  };

  const operationColor = colors[eventMeta.operation] || '#999';

  // Format the console output
  const timestamp = new Date(eventMeta.timestamp).toLocaleTimeString();
  const operationLabel = eventMeta.operation.toUpperCase();
  const itemTypeLabel = eventMeta.itemType.toUpperCase();
  const sourceLabel = `[${eventMeta.source.toUpperCase()}]`;

  // Main event log with styling
  console.group(
    `%c[WIKI-EVENT] ${operationLabel} ${itemTypeLabel} ${sourceLabel} @ ${timestamp}`,
    `color: white; background-color: ${operationColor}; padding: 4px 8px; border-radius: 3px; font-weight: bold;`
  );

  // Trigger navigation and viewer updates
  triggerNavigationUpdates(event);

  // Event metadata
  console.log(
    `%c📋 Event ID:`,
    'color: #666; font-weight: bold;',
    eventMeta.id
  );

  // Space information
  console.log(
    `%c🗂️  Space:`,
    'color: #9C27B0; font-weight: bold;',
    `${space.name} (ID: ${space.id})`
  );

  // Item information
  console.group(
    `%c📄 Item Details:`,
    'color: #FF9800; font-weight: bold;'
  );
  console.log(`Name: ${item.name}`);
  console.log(`Type: ${item.type}`);
  console.log(`Relative Path: ${item.path}`);
  console.log(
    `Full Path: ${context.fullPath}`
  );

  if (item.parentPath) {
    console.log(`Parent Path: ${item.parentPath}`);
  }

  if (item.size !== undefined) {
    const sizeKB = (item.size / 1024).toFixed(2);
    console.log(`Size: ${sizeKB} KB (${item.size} bytes)`);
  }

  console.groupEnd();

  // Timestamps
  if (item.created || item.modified || item.timestamp) {
    console.group(
      `%c⏰ Timestamps:`,
      'color: #607D8B; font-weight: bold;'
    );
    if (item.created) {
      console.log(`Created: ${new Date(item.created).toLocaleString()}`);
    }
    if (item.modified) {
      console.log(`Modified: ${new Date(item.modified).toLocaleString()}`);
    }
    if (item.timestamp) {
      console.log(`Changed: ${new Date(item.timestamp).toLocaleString()}`);
    }
    console.groupEnd();
  }

  // Complete event object for inspection
  console.log(
    `%c📦 Complete Event Object:`,
    'color: #1976D2; font-weight: bold;'
  );
  console.log(event);

  console.groupEnd();

  // Also log to a summary table if multiple events
  updateEventSummary(event);
}

/**
 * Trigger navigation and viewer updates based on event
 * @param {Object} event - Event object from server
 */
function triggerNavigationUpdates(event) {
  const {
    event: eventMeta,
    space,
    item
  } = event;

  try {
    // Extract the operation from the event
    const operation = eventMeta.operation; // 'create', 'update', or 'delete'

    // Always update the navigation tree when files/folders change
    updateNavigation(space, item, operation);

    // Update folder viewer if a folder is affected
    if (item.type === 'folder') {
      updatefolderViewer(space, item, operation);
    }

    // Update file viewer if a file is affected
    // For rename/move, both file and folder types need file viewer updates
    if (item.type === 'file' || operation === 'rename' || operation === 'move') {
      updateFileviewer(space, item, operation);
    }
  } catch (error) {
    console.warn('[EventBusListener] Error triggering navigation updates:', error);
  }
}

/**
 * Update and display event summary statistics
 * @param {Object} event - Event object
 */
function updateEventSummary(event) {
  // Initialize summary stats if not exists
  if (!window._wikiEventStats) {
    window._wikiEventStats = {
      total: 0,
      byOperation: { create: 0, update: 0, delete: 0, rename: 0, move: 0 },
      byItemType: { file: 0, folder: 0 },
      bySpace: {},
      bySource: { 'file-watcher': 0, api: 0 },
      recentEvents: []
    };
  }

  const stats = window._wikiEventStats;

  // Update counters
  stats.total++;
  stats.byOperation[event.event.operation] = (stats.byOperation[event.event.operation] || 0) + 1;
  stats.byItemType[event.event.itemType]++;
  stats.bySource[event.event.source]++;

  if (!stats.bySpace[event.space.name]) {
    stats.bySpace[event.space.name] = 0;
  }
  stats.bySpace[event.space.name]++;

  // Keep last 50 events
  stats.recentEvents.push({
    timestamp: event.event.timestamp,
    operation: event.event.operation,
    itemType: event.event.itemType,
    name: event.item.name,
    space: event.space.name,
    source: event.event.source
  });

  if (stats.recentEvents.length > 50) {
    stats.recentEvents.shift();
  }

  // Log stats summary every 10 events
  if (stats.total % 10 === 0) {
    console.log(
      `%c📊 Wiki Event Statistics (Total: ${stats.total})`,
      'color: white; background-color: #3F51B5; padding: 4px 8px; border-radius: 3px; font-weight: bold;'
    );
    console.table({
      'Total Events': stats.total,
      'Creates': stats.byOperation.create,
      'Updates': stats.byOperation.update,
      'Deletes': stats.byOperation.delete,
      'Files': stats.byItemType.file,
      'Folders': stats.byItemType.folder,
      'File Watcher': stats.bySource['file-watcher'],
      'API Calls': stats.bySource.api
    });

    console.log('By Space:', stats.bySpace);
  }
}

/**
 * Get current event statistics (accessible from console)
 * @return {Object} Event statistics
 */
function getEventStats() {
  if (!window._wikiEventStats) {
    return { message: 'No events recorded yet' };
  }
  return window._wikiEventStats;
}

/**
 * Clear event history and statistics
 * @return {void}
 */
function clearEventHistory() {
  window._wikiEventStats = {
    total: 0,
    byOperation: { create: 0, update: 0, delete: 0, rename: 0, move: 0 },
    byItemType: { file: 0, folder: 0 },
    bySpace: {},
    bySource: { 'file-watcher': 0, api: 0 },
    recentEvents: []
  };
  console.info('[EventBusListener] Event history cleared');
}

/**
 * Display recent events table
 * @param {number} count - Number of recent events to show
 * @return {void}
 */
function showRecentEvents(count = 20) {
  if (!window._wikiEventStats || window._wikiEventStats.recentEvents.length === 0) {
    console.log('No events recorded yet');
    return;
  }

  const recent = window._wikiEventStats.recentEvents.slice(-count);
  console.table(recent);
}

// Export functions for use in browser console
window.WikiEventBus = {
  initializeEventBusListener,
  getEventStats,
  clearEventHistory,
  showRecentEvents
};

// ES6 Module export
export {
  initializeEventBusListener,
  getEventStats,
  clearEventHistory,
  showRecentEvents
};
