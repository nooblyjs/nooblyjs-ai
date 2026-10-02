// Renders the document tree and wires HTML5 drag-and-drop. Move requests are
// delegated upward so this module stays free of network concerns.

const COLLAPSED_KEY = 'docTree.collapsed';

function loadCollapsed(projectId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${COLLAPSED_KEY}.${projectId}`) || '[]'));
  } catch {
    return new Set();
  }
}

function saveCollapsed(projectId, collapsed) {
  try {
    localStorage.setItem(`${COLLAPSED_KEY}.${projectId}`, JSON.stringify([...collapsed]));
  } catch {
    // Private windows and blocked storage are fine; collapse state is a convenience.
  }
}

export function createDocTree(container, { projectId, onOpen, onMove, onDelete, onRename, actions = true }) {
  const collapsed = loadCollapsed(projectId);
  let tree = [];
  let activePath = null;
  let dragPath = null;

  function parentOf(path) {
    const i = path.lastIndexOf('/');
    return i === -1 ? '' : path.slice(0, i);
  }

  function nameOf(path) {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /** A folder cannot be dropped into itself or any of its own descendants. */
  function isLegalDrop(from, toFolder) {
    if (from === null) return false;
    if (parentOf(from) === toFolder) return false;
    return !(toFolder === from || toFolder.startsWith(`${from}/`));
  }

  function icon(name) {
    const el = document.createElement('i');
    el.className = `bi ${name}`;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function renderNode(node, depth) {
    const row = document.createElement('div');
    row.className = `doc-node doc-node-${node.type}`;
    row.style.setProperty('--depth', depth);
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    row.draggable = true;
    row.setAttribute('role', 'treeitem');
    row.tabIndex = -1;

    if (node.type === 'folder') {
      const isCollapsed = collapsed.has(node.path);
      row.setAttribute('aria-expanded', String(!isCollapsed));

      const twisty = document.createElement('button');
      twisty.className = 'doc-twisty';
      twisty.type = 'button';
      twisty.append(icon(isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'));
      twisty.setAttribute('aria-label', isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`);
      twisty.addEventListener('click', (event) => {
        event.stopPropagation();
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        saveCollapsed(projectId, collapsed);
        render();
      });
      row.append(twisty, icon(`doc-icon ${isCollapsed ? 'bi-folder2' : 'bi-folder2-open'}`));
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'doc-twisty doc-twisty-empty';
      row.append(spacer, icon('doc-icon bi-file-earmark-text'));
    }

    const label = document.createElement('span');
    label.className = 'doc-label';
    label.textContent = node.type === 'folder' ? node.name : node.title;
    row.append(label);

    if (actions) {
      const actionBar = document.createElement('span');
      actionBar.className = 'doc-actions';
      for (const [text, iconName, handler] of [
        ['Rename', 'bi-pencil', () => onRename(node)],
        ['Delete', 'bi-trash3', () => onDelete(node)]
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = text === 'Delete' ? 'icon-btn icon-btn-danger' : 'icon-btn';
        button.title = text;
        button.append(icon(iconName));
        button.setAttribute('aria-label', `${text} ${node.name}`);
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          handler();
        });
        actionBar.append(button);
      }
      row.append(actionBar);
    }

    if (node.type === 'document') {
      if (node.path === activePath) row.classList.add('is-active');
      row.addEventListener('click', () => onOpen(node));
    } else {
      row.addEventListener('click', () => {
        if (collapsed.has(node.path)) collapsed.delete(node.path);
        else collapsed.add(node.path);
        saveCollapsed(projectId, collapsed);
        render();
      });
    }

    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      }
    });

    // --- drag and drop ---
    row.addEventListener('dragstart', (event) => {
      dragPath = node.path;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.path);
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => {
      dragPath = null;
      row.classList.remove('is-dragging');
      container.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
    });

    if (node.type === 'folder') {
      row.addEventListener('dragover', (event) => {
        if (!isLegalDrop(dragPath, node.path)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('is-drop-target');
        const from = event.dataTransfer.getData('text/plain') || dragPath;
        if (!isLegalDrop(from, node.path)) return;
        onMove(from, `${node.path}/${nameOf(from)}`);
      });
    }

    return row;
  }

  function renderLevel(nodes, depth, into) {
    for (const node of nodes) {
      into.append(renderNode(node, depth));
      if (node.type === 'folder' && !collapsed.has(node.path)) {
        renderLevel(node.children, depth + 1, into);
      }
    }
  }

  function render() {
    container.replaceChildren();
    if (tree.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'text-muted fst-italic small py-3 mb-0';
      empty.textContent = 'No documents yet.';
      container.append(empty);
      return;
    }
    renderLevel(tree, 0, container);
  }

  function setTree(next) {
    tree = next;
    render();
  }

  function setActive(path) {
    activePath = path;
    render();
  }

  /** Wires the root drop zone so items can be moved back to the top level. */
  function wireRootDrop(element) {
    element.addEventListener('dragover', (event) => {
      if (!dragPath || parentOf(dragPath) === '') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      element.classList.add('is-drop-target');
    });
    element.addEventListener('dragleave', () => element.classList.remove('is-drop-target'));
    element.addEventListener('drop', (event) => {
      event.preventDefault();
      element.classList.remove('is-drop-target');
      const from = event.dataTransfer.getData('text/plain') || dragPath;
      if (!from || parentOf(from) === '') return;
      onMove(from, nameOf(from));
    });
  }

  return { setTree, setActive, render, wireRootDrop, nameOf, parentOf };
}
