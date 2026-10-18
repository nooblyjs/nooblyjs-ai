/**
 * @fileoverview Navigation UI Updater for Event Bus Integration
 * Handles real-time updates to navigation components when file/folder events occur
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

'use strict';

import navigationState from './navigationState.js';
import folderViewerState from './folderViewerState.js';
import documentViewerState from './documentViewerState.js';

// Reference to navigation controller will be set by initialization
let navController = null;

/**
 * Set reference to navigation controller
 * Must be called during initialization
 * @param {Object} controller - The navigationController instance
 */
export function setNavigationController(controller) {
  navController = controller;
  console.log('[NavigationUpdater] Navigation controller reference set');
}

/**
 * Find a node in the tree by path
 * @private
 */
function findNodeInTree(nodes, targetPath) {
  if (!nodes) return null;

  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findNodeInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find parent node in tree by path
 * @private
 */
function findParentNodeInTree(nodes, targetPath) {
  if (!nodes || !targetPath) return null;

  const lastSlash = targetPath.lastIndexOf('/');
  const parentPath = lastSlash === -1 ? null : targetPath.substring(0, lastSlash);

  if (!parentPath) return null;

  return findNodeInTree(nodes, parentPath);
}

/**
 * Add a file/folder node to the tree
 * Updates the fullFileTree in navigationController
 * @private
 */
function addNodeToTree(path, name, type) {
  if (!navController || !navController.fullFileTree) {
    console.warn('[NavigationUpdater] Navigation controller or fullFileTree not available');
    return false;
  }

  const tree = navController.fullFileTree;
  const lastSlash = path.lastIndexOf('/');
  const parentPath = lastSlash === -1 ? null : path.substring(0, lastSlash);

  // Find parent node
  let parentNode = null;
  if (parentPath) {
    parentNode = findNodeInTree(tree, parentPath);
    if (!parentNode) {
      // The parent folder isn't in the client tree yet — its own create event
      // may not have arrived, or arrived out of order during a bulk workflow
      // build. Falling back to `tree` here would push this node onto the ROOT,
      // which is exactly the "items spilling into the root" symptom. Skip the
      // in-memory insert instead; writeCachedTree (below) + the server ETag
      // revalidation on the next loadFileTree reconcile the node into place.
      console.warn(`[NavigationUpdater] Parent "${parentPath}" not in tree yet; skipping insert (will sync on next load): ${path}`);
      return false;
    }
  }

  // The same logical create can arrive multiple times (optimistic UI push,
  // [API] event, [FILE-WATCHER] event). Bail if a node with this path is
  // already in the destination collection — pushing duplicates poisons
  // folder.children, which loadFolderContent reads to render the grid.
  const collection = parentNode
    ? (parentNode.children = parentNode.children || [])
    : tree;
  if (collection.some(n => n.path === path)) {
    console.log(`[NavigationUpdater] Node already in fullFileTree, skipping: ${path}`);
    return false;
  }

  const newNode = {
    name: name,
    path: path,
    type: type,
    ...(type === 'folder' && { children: [] })
  };
  collection.push(newNode);
  console.log(`[NavigationUpdater] Added ${type} to fullFileTree ${parentNode ? 'parent' : 'root'}: ${path}`);
  return true;
}

/**
 * Remove a file/folder node from the tree
 * Updates the fullFileTree in navigationController
 * @private
 */
function removeNodeFromTree(path) {
  if (!navController || !navController.fullFileTree) {
    console.warn('[NavigationUpdater] Navigation controller or fullFileTree not available');
    return false;
  }

  const tree = navController.fullFileTree;
  const lastSlash = path.lastIndexOf('/');
  const parentPath = lastSlash === -1 ? null : path.substring(0, lastSlash);

  let removed = false;

  if (!parentPath) {
    // Remove from root level
    const index = tree.findIndex(n => n.path === path);
    if (index !== -1) {
      tree.splice(index, 1);
      removed = true;
    }
  } else {
    // Find parent and remove from its children
    const parentNode = findNodeInTree(tree, parentPath);
    if (parentNode && parentNode.children) {
      const index = parentNode.children.findIndex(n => n.path === path);
      if (index !== -1) {
        parentNode.children.splice(index, 1);
        removed = true;
      }
    }
  }

  if (removed) {
    console.log(`[NavigationUpdater] Removed node from tree: ${path}`);
  } else {
    console.warn(`[NavigationUpdater] Node not found in tree: ${path}`);
  }

  return removed;
}

/**
 * Rename a node in the fullFileTree data structure
 * @private
 */
function renameNodeInFullTree(oldPath, newPath, newName) {
  if (!navController || !navController.fullFileTree) return false;

  const node = findNodeInTree(navController.fullFileTree, oldPath);
  if (node) {
    node.path = newPath;
    node.name = newName;

    // For folders, recursively update child paths
    if (node.children) {
      updateChildPaths(node.children, oldPath, newPath);
    }
    return true;
  }
  return false;
}

/**
 * Move a node in the fullFileTree data structure
 * @private
 */
function moveNodeInFullTree(oldPath, newPath) {
  if (!navController || !navController.fullFileTree) return false;

  const tree = navController.fullFileTree;

  // Find and remove from old location
  const node = findNodeInTree(tree, oldPath);
  if (!node) return false;

  removeNodeFromTree(oldPath);

  // Update node path and name
  const newName = newPath.split('/').pop();
  node.path = newPath;
  node.name = newName;

  // For folders, recursively update child paths
  if (node.children) {
    updateChildPaths(node.children, oldPath, newPath);
  }

  // Add to new location
  const lastSlash = newPath.lastIndexOf('/');
  const newParentPath = lastSlash === -1 ? null : newPath.substring(0, lastSlash);

  if (!newParentPath) {
    tree.push(node);
  } else {
    const parentNode = findNodeInTree(tree, newParentPath);
    if (parentNode) {
      if (!parentNode.children) parentNode.children = [];
      parentNode.children.push(node);
    }
  }

  return true;
}

/**
 * Recursively update child paths when parent path changes
 * @private
 */
function updateChildPaths(children, oldBasePath, newBasePath) {
  if (!children) return;
  for (const child of children) {
    if (child.path && child.path.startsWith(oldBasePath + '/')) {
      child.path = newBasePath + child.path.substring(oldBasePath.length);
    }
    if (child.children) {
      updateChildPaths(child.children, oldBasePath, newBasePath);
    }
  }
}

/**
 * Handle rename operation for navigation tree (both DOM and data)
 * @private
 */
function renameNodeInTree(file, space) {
  const oldPath = file.oldPath;
  const newPath = file.newPath || file.path;
  const newName = file.name;

  if (!oldPath || !newPath) {
    console.warn('[NavigationUpdater] Rename event missing oldPath/newPath:', file);
    return;
  }

  if (file.type === 'file') {
    const iconOverride = navController?.getFileIcon?.(newPath) || null;
    const success = navigationState.renameFileInTree(oldPath, newPath, newName, iconOverride);
    if (success) {
      console.log(`✓ Renamed file in navigation tree: ${oldPath} -> ${newPath}`);
      if (navController && navController.bindFileItemEvents_Single) {
        const fileEl = document.querySelector(`[data-document-path="${newPath}"]`);
        if (fileEl) navController.bindFileItemEvents_Single(fileEl);
      }
    }
    renameNodeInFullTree(oldPath, newPath, newName);
  } else if (file.type === 'folder') {
    const success = navigationState.renameFolderInTree(oldPath, newPath, newName);
    if (success) {
      console.log(`✓ Renamed folder in navigation tree: ${oldPath} -> ${newPath}`);
      if (navController && navController.bindFolderItemEvents_Single) {
        const folderEl = document.querySelector(`[data-folder-id="${navigationState.getFolderId(newPath)}"]`);
        if (folderEl) navController.bindFolderItemEvents_Single(folderEl);
      }
    }
    renameNodeInFullTree(oldPath, newPath, newName);
  }
}

/**
 * Handle move operation for navigation tree (both DOM and data)
 * @private
 */
function moveNodeInTree(file, space) {
  const oldPath = file.oldPath;
  const newPath = file.newPath || file.path;

  if (!oldPath || !newPath) {
    console.warn('[NavigationUpdater] Move event missing oldPath/newPath:', file);
    return;
  }

  if (file.type === 'file') {
    const success = navigationState.moveFileInTree(oldPath, newPath, space.name);
    if (success) {
      console.log(`✓ Moved file in navigation tree: ${oldPath} -> ${newPath}`);
      if (navController && navController.bindFileItemEvents_Single) {
        const fileEl = document.querySelector(`[data-document-path="${newPath}"]`);
        if (fileEl) navController.bindFileItemEvents_Single(fileEl);
      }
    }
    moveNodeInFullTree(oldPath, newPath);
  } else if (file.type === 'folder') {
    const success = navigationState.moveFolderInTree(oldPath, newPath);
    if (success) {
      console.log(`✓ Moved folder in navigation tree: ${oldPath} -> ${newPath}`);
      if (navController && navController.bindFolderItemEvents_Single) {
        const folderEl = document.querySelector(`[data-folder-id="${navigationState.getFolderId(newPath)}"]`);
        if (folderEl) navController.bindFolderItemEvents_Single(folderEl);
      }
    }
    moveNodeInFullTree(oldPath, newPath);
  }
}

/**
 * Check if a file change event came from the current user via API
 * Returns true if the event should be ignored (self-inflicted change)
 * @private
 */
function isChangeFromCurrentUser(event) {
  // Only apply this logic to API changes
  if (event.event.source !== 'api') {
    return false;
  }

  // Get current user information from the app
  // Try multiple ways to get current user
  const currentUser = window.currentUser ||
                      window.app?.currentUser ||
                      (typeof userController !== 'undefined' && userController.app?.data?.currentUser);

  if (!currentUser) {
    // Can't determine current user, assume it's external
    return false;
  }

  // Get user ID from event (stored in context by event bus normalizeEvent)
  const eventUserId = event.context?.userId;

  if (!eventUserId || eventUserId === 'unknown') {
    // No user info in event, assume it's external
    return false;
  }

  // Compare user IDs (event stores user ID as either user.id or user.username)
  const currentUserId = currentUser.id || currentUser.username;
  const isSameUser = eventUserId === currentUserId ||
                     eventUserId === currentUser.username;

  return isSameUser;
}

/**
 * Update the main navigation sidebar/file tree
 * Called whenever files or folders change to refresh the navigation view
 * Adds/removes items dynamically without full tree refresh
 * Also updates the fullFileTree so folder reloads show correct data
 *
 * @param {Object} space - Space information { id, name }
 * @param {Object} file - File/folder information { name, path, parentPath, type, ... }
 * @param {string} operation - The operation: 'create', 'update', or 'delete'
 * @return {void}
 */
function updateNavigation(space, file, operation = 'update') {
  console.log('%c[Navigation Update]', 'color: #FF6B6B; font-weight: bold;', {
    space: space,
    file: file,
    operation: operation
  });

  // Handle create/delete/rename/move operations for tree structure changes
  if (operation === 'create') {
    if (file.type === 'file') {
      // Resolve the icon via the controller so the new <i> matches the
      // initial-render output (navigationState has its own legacy icon
      // table that diverged — `.md` was rendering as filled+text-info blue).
      const iconOverride = navController?.getFileIcon?.(file.path) || null;
      const fileElement = navigationState.addFileToTree(
        file.name,
        file.path,
        space.name,
        iconOverride
      );
      if (fileElement) {
        console.log(`✓ Added file to navigation tree: ${file.path}`);

        // Bind events to the newly created element
        if (navController && navController.bindFileItemEvents_Single) {
          navController.bindFileItemEvents_Single(fileElement);
          console.log(`✓ Bound events to file element: ${file.path}`);
        }
      }

      // Also update the fullFileTree so clicking on folder shows updated data
      addNodeToTree(file.path, file.name, 'document');
    } else if (file.type === 'folder') {
      // Add folder to tree at correct location
      const folderElement = navigationState.addFolderToTree(
        file.name,
        file.path
      );
      if (folderElement) {
        console.log(`✓ Added folder to navigation tree: ${file.path}`);

        // Bind events to the newly created element
        if (navController && navController.bindFolderItemEvents_Single) {
          navController.bindFolderItemEvents_Single(folderElement);
          console.log(`✓ Bound events to folder element: ${file.path}`);
        }
      }

      // Also update the fullFileTree so clicking on folder shows updated data
      addNodeToTree(file.path, file.name, 'folder');
    }
  } else if (operation === 'delete') {
    if (file.type === 'file') {
      // Remove file from tree
      const success = navigationState.removeFileFromTree(file.path);
      if (success) {
        console.log(`✓ Removed file from navigation tree: ${file.path}`);
      }

      // Also update the fullFileTree so clicking on folder shows updated data
      removeNodeFromTree(file.path);
    } else if (file.type === 'folder') {
      // Remove folder from tree
      const success = navigationState.removeFolderFromTree(file.path);
      if (success) {
        console.log(`✓ Removed folder from navigation tree: ${file.path}`);
      }

      // Also update the fullFileTree so clicking on folder shows updated data
      removeNodeFromTree(file.path);
    }
  } else if (operation === 'rename') {
    renameNodeInTree(file, space);
  } else if (operation === 'move') {
    moveNodeInTree(file, space);
  } else if (operation === 'update' && file.type === 'folder') {
    // Folder-level update (e.g. children-order changed). Re-fetch the tree so
    // the side-nav reflects the new ordering, since incremental patching has no
    // semantics for "same items, new order".
    if (navController && typeof navController.loadFileTree === 'function') {
      navController.loadFileTree().catch(err => {
        console.warn('[NavigationUpdater] loadFileTree after folder update failed:', err);
      });
    }
  }

  // Persist the just-patched tree back to localStorage so a page reload
  // renders the new structure instantly. Etag is cleared so the next request
  // re-validates against the server (backend cache was also invalidated by
  // the same event bus message).
  try {
    if (navController && typeof navController.writeCachedTree === 'function'
        && navController.fullFileTree && space && space.id != null) {
      navController.writeCachedTree(space.id, navController.fullFileTree, null);
    }
  } catch (err) {
    console.warn('[NavigationUpdater] Failed to refresh tree cache after patch:', err);
  }

  // The drill-down nav renders only the current level from fullFileTree, so the
  // incremental DOM patches above (which target the old fully-expanded tree)
  // mostly no-op. Re-render the current level from the now-updated data so the
  // change is reflected. This runs in the same tick, so any stray nodes the
  // incremental path appended are replaced before paint.
  if (navController && typeof navController.refreshDrillView === 'function') {
    navController.refreshDrillView();
  }

  // Log current tree state
  console.log(`[Navigation] Expanded folders: ${navigationState.getExpandedFolderPaths().join(', ') || 'none'}`);
}

/**
 * Update the folder viewer when folder contents change
 * Called when displaying folder contents and the folder is modified
 *
 * @param {Object} space - Space information { id, name }
 * @param {Object} file - File/folder information { name, path, parentPath, type, ... }
 * @param {string} operation - The operation: 'create', 'update', or 'delete'
 * @return {void}
 */
function updatefolderViewer(space, file, operation = 'update') {
  console.log('%c[Folder Viewer Update]', 'color: #4ECDC4; font-weight: bold;', {
    space: space,
    file: file,
    operation: operation
  });

  // Handle create/delete/rename/move operations for structure changes
  if (operation === 'create' || operation === 'delete') {
    // Re-render the current folder rather than mutating the DOM incrementally.
    // The incremental addFolderTo*View paths drift from the renderer's class names
    // (e.g. cards view uses .items-preview-cards, not .items-cards), so a clean
    // reload is the reliable path that works across every view mode.
    // Guard on currentView === 'folder' so we don't yank the user out of a doc view.
    const onFolderView = navController?.app?.currentView === 'folder';
    if (file.type === 'folder' && onFolderView && folderViewerState.isItemInCurrentFolder(file.path) && navController.loadFolderContent) {
      console.log(`[FolderViewer] Reloading current folder after ${operation}: ${file.path}`);
      navController.loadFolderContent(folderViewerState.currentFolderPath || '');
    }
  } else if (operation === 'rename') {
    if (file.type === 'folder' && file.oldPath) {
      folderViewerState.renameFolderInFolderView(file.oldPath, file.newPath || file.path, file.name);
    }
  } else if (operation === 'move') {
    if (file.type === 'folder' && file.oldPath) {
      folderViewerState.moveFolderInFolderView(file.oldPath, file.newPath || file.path, file.name);
    }
  } else if (operation === 'update' && file.type === 'folder') {
    // Folder children-order changed. If we're currently viewing the affected
    // folder (or it's an ancestor that contains the current folder), reload.
    const onFolderView = navController?.app?.currentView === 'folder';
    const currentPath = folderViewerState.currentFolderPath || '';
    const affectedPath = file.path || '';
    const isCurrent = currentPath === affectedPath;
    if (onFolderView && isCurrent && navController.loadFolderContent) {
      navController.loadFolderContent(currentPath);
    }
  }
}

/**
 * Update the file viewer when file content or metadata changes
 * Called when viewing a file and that file is modified
 *
 * @param {Object} space - Space information { id, name }
 * @param {Object} file - File/folder information { name, path, parentPath, type, ... }
 * @param {string} operation - The operation: 'create', 'update', or 'delete'
 * @return {void}
 */
function updateFileviewer(space, file, operation = 'update') {
  console.log('%c[File Viewer Update]', 'color: #95E1D3; font-weight: bold;', {
    space: space,
    file: file,
    operation: operation
  });

  // Handle create/delete/rename/move operations for structure changes
  if (operation === 'create' || operation === 'delete') {
    // The incremental addFileToFolderView / removeFileFromFolderView paths drift
    // from the renderer's DOM (grid renders into .items-cards, cards view renders
    // into .items-preview-cards, but the updater queries .items-grid / .items-cards).
    // A targeted re-render of the current folder is correct for every view mode and
    // picks up server-side metadata (size, dates, previews) the incremental path fakes.
    // Guard on currentView === 'folder' so we don't yank the user out of a doc view.
    const onFolderView = navController?.app?.currentView === 'folder';
    if (onFolderView && folderViewerState.isItemInCurrentFolder(file.path) && navController.loadFolderContent) {
      console.log(`[FileViewer] Reloading current folder after ${operation}: ${file.path}`);
      navController.loadFolderContent(folderViewerState.currentFolderPath || '');
    }
  } else if (operation === 'rename') {
    if (file.oldPath) {
      folderViewerState.renameFileInFolderView(file.oldPath, file.newPath || file.path, file.name, space.name);
      // Update document viewer if renamed file is currently viewed
      if (documentViewerState.isFileCurrentlyViewed(file.oldPath)) {
        documentViewerState.setCurrentFile(file.newPath || file.path, documentViewerState.getCurrentViewMode(), documentViewerState.isInEditMode());
        console.log(`✓ Updated document viewer path: ${file.oldPath} -> ${file.newPath || file.path}`);
      }
    }
  } else if (operation === 'move') {
    if (file.oldPath) {
      // Remove from old folder view location
      folderViewerState.removeFileFromFolderView(file.oldPath);
      // Add to new folder view location if visible
      const fileElement = folderViewerState.addFileToFolderView(file.name, file.newPath || file.path, space.name);
      if (fileElement && navController && navController.bindFolderViewFileItem_Single) {
        navController.bindFolderViewFileItem_Single(fileElement);
      }
      // Update document viewer if moved file is currently viewed
      if (documentViewerState.isFileCurrentlyViewed(file.oldPath)) {
        documentViewerState.setCurrentFile(file.newPath || file.path, documentViewerState.getCurrentViewMode(), documentViewerState.isInEditMode());
        console.log(`✓ Updated document viewer path: ${file.oldPath} -> ${file.newPath || file.path}`);
      }
    }
  } else if (operation === 'update') {
    // File was updated - handle based on whether user is editing or viewing
    if (documentViewerState.isFileCurrentlyViewed(file.path)) {
      // Check if this change came from the current user via API
      const isUserOwnChange = isChangeFromCurrentUser(event);

      if (documentViewerState.isInEditMode()) {
        // File is in edit mode
        if (isUserOwnChange) {
          // User saved the file themselves - don't show dialog
          console.log('[NavigationUpdater] Ignoring self-inflicted API change while editing');
        } else {
          // Someone else or external change detected - show conflict dialog
          if (navController && navController.handleEditModeConflict) {
            navController.handleEditModeConflict();
          }
        }
      } else {
        // File is in view mode - reload content silently
        if (navController && navController.reloadCurrentFileContent) {
          navController.reloadCurrentFileContent();
        }
      }
    }
  }
}

// Export functions for use by event bus
export {
  updateNavigation,
  updatefolderViewer,
  updateFileviewer
};
