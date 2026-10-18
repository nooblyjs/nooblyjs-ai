/**
 * @fileoverview Document Viewer State Manager
 * Manages the state of the currently displayed document in the content viewer
 * Enables tracking which file is open for updates from the event bus
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

'use strict';

class DocumentViewerState {
  constructor() {
    this.currentFilePath = null;
    this.currentFileViewMode = null; // 'markdown', 'code', 'image', 'pdf', 'text', etc.
    this.isEditMode = false;
  }

  /**
   * Set the currently viewed file
   * @param {string} filePath - The file path being viewed
   * @param {string} viewMode - The view mode ('markdown', 'code', 'image', 'pdf', 'text', etc.)
   * @param {boolean} editMode - Whether in edit mode (default: false)
   * @return {void}
   */
  setCurrentFile(filePath, viewMode = 'markdown', editMode = false) {
    this.currentFilePath = filePath;
    this.currentFileViewMode = viewMode;
    this.isEditMode = editMode;
  }

  /**
   * Get the currently viewed file path
   * @return {string|null} The current file path or null
   */
  getCurrentFilePath() {
    return this.currentFilePath;
  }

  /**
   * Get the current view mode
   * @return {string|null} The current view mode or null
   */
  getCurrentViewMode() {
    return this.currentFileViewMode;
  }

  /**
   * Check if currently in edit mode
   * @return {boolean} Whether in edit mode
   */
  isInEditMode() {
    return this.isEditMode;
  }

  /**
   * Check if a given path is currently being viewed
   * @param {string} filePath - The file path to check
   * @return {boolean} Whether the file is currently being viewed
   */
  isFileCurrentlyViewed(filePath) {
    return this.currentFilePath === filePath;
  }

  /**
   * Clear the current file state
   * @return {void}
   */
  clearCurrentFile() {
    this.currentFilePath = null;
    this.currentFileViewMode = null;
    this.isEditMode = false;
    console.log('[DocumentViewerState] Cleared current file');
  }

  /**
   * Log current tracking state for debugging
   * @return {void}
   */
  debugState() {
    console.group('%c📋 DocumentViewerState Debug Info', 'color: #2196F3; font-weight: bold;');
    console.log(`Current File Path: "${this.currentFilePath || 'none'}"`);
    console.log(`View Mode: "${this.currentFileViewMode || 'none'}"`);
    console.log(`Edit Mode: ${this.isEditMode ? 'YES' : 'NO'}`);
    console.groupEnd();
    return {
      currentFilePath: this.currentFilePath,
      currentFileViewMode: this.currentFileViewMode,
      isEditMode: this.isEditMode
    };
  }
}

// Export singleton instance
const documentViewerState = new DocumentViewerState();

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.documentViewerState = documentViewerState;
}

export default documentViewerState;
