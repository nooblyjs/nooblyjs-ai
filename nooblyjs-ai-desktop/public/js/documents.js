import { api, toast } from './lib/api.js';
import { renderMarkdown } from './lib/markdown.js';
import { createDocTree } from './lib/docTree.js';

const shell = document.querySelector('.app-shell[data-project-id]');
const projectId = shell.dataset.projectId;
const base = `/api/projects/${projectId}/documents`;

const treeEl = document.querySelector('[data-tree]');
const editor = document.querySelector('[data-editor]');
const preview = document.querySelector('[data-preview]');
const emptyState = document.querySelector('[data-docs-empty]');
const titleEl = document.querySelector('[data-doc-title]');
const pathEl = document.querySelector('[data-doc-path]');
const saveBtn = document.querySelector('[data-save]');
const saveStatus = document.querySelector('[data-save-status]');

let current = null;
let dirty = false;
let saveTimer = null;

/* ---- tree ------------------------------------------------------------ */

const tree = createDocTree(treeEl, {
  projectId,
  onOpen: (node) => openDocument(node.path),
  onMove: moveEntry,
  onDelete: deleteEntry,
  onRename: renameEntry
});

tree.wireRootDrop(document.querySelector('[data-drop-root]'));

async function refreshTree() {
  try {
    const { tree: nodes } = await api('GET', base);
    tree.setTree(nodes);
    if (current) tree.setActive(current.path);
  } catch (err) {
    toast(err.message);
  }
}

/** The folder a new item should go into: the open document's folder, else root. */
function currentFolder() {
  if (!current) return '';
  return tree.parentOf(current.path);
}

/* ---- editor ---------------------------------------------------------- */

function setDirty(next) {
  dirty = next;
  saveBtn.disabled = !next;
  saveStatus.textContent = next ? 'Unsaved changes' : '';
}

async function openDocument(path) {
  if (dirty && !window.confirm('Discard unsaved changes?')) return;
  try {
    const { document: doc } = await api('GET', `${base}/content?path=${encodeURIComponent(path)}`);
    current = doc;
    editor.value = doc.content;
    preview.innerHTML = renderMarkdown(doc.content);
    titleEl.textContent = doc.title;
    pathEl.textContent = doc.path;
    emptyState.hidden = true;
    editor.hidden = currentMode() !== 'edit';
    preview.hidden = currentMode() !== 'preview';
    setDirty(false);
    tree.setActive(path);
    if (currentMode() === 'edit') editor.focus();
  } catch (err) {
    toast(err.message);
  }
}

async function save() {
  if (!current || !dirty) return;
  saveStatus.textContent = 'Saving…';
  try {
    const { document: doc } = await api('PUT', `${base}/content`, {
      path: current.path,
      content: editor.value
    });
    current = doc;
    setDirty(false);
    saveStatus.textContent = 'Saved';
    setTimeout(() => {
      if (!dirty) saveStatus.textContent = '';
    }, 1800);
    refreshTree();
  } catch (err) {
    saveStatus.textContent = '';
    toast(err.message);
  }
}

editor.addEventListener('input', () => {
  setDirty(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1200); // autosave shortly after typing stops
});

saveBtn.addEventListener('click', save);

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

/* ---- view mode ------------------------------------------------------- */

function currentMode() {
  return document.querySelector('[data-mode].active')?.dataset.mode || 'edit';
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    }
    if (!current) return;
    const mode = button.dataset.mode;
    if (mode === 'preview') preview.innerHTML = renderMarkdown(editor.value);
    editor.hidden = mode !== 'edit';
    preview.hidden = mode !== 'preview';
  });
}

/* ---- create / move / rename / delete --------------------------------- */

document.querySelectorAll('[data-new-document]').forEach((button) =>
  button.addEventListener('click', async () => {
    const name = window.prompt('Document name', 'Untitled');
    if (name === null) return;
    try {
      const { document: doc } = await api('POST', `${base}/documents`, {
        parent: currentFolder(),
        name: name.trim(),
        content: `# ${name.trim().replace(/\.md$/i, '')}\n\n`
      });
      await refreshTree();
      await openDocument(doc.path);
    } catch (err) {
      toast(err.message);
    }
  })
);

document.querySelector('[data-new-folder]').addEventListener('click', async () => {
  const name = window.prompt('Folder name', 'New folder');
  if (name === null) return;
  try {
    await api('POST', `${base}/folders`, { parent: currentFolder(), name: name.trim() });
    refreshTree();
  } catch (err) {
    toast(err.message);
  }
});

async function moveEntry(from, to) {
  try {
    await api('POST', `${base}/move`, { from, to });
    // The open document may be the moved item, or inside a moved folder.
    if (current && (current.path === from || current.path.startsWith(`${from}/`))) {
      current.path = to + current.path.slice(from.length);
      pathEl.textContent = current.path;
    }
    await refreshTree();
    toast('Moved');
  } catch (err) {
    toast(err.message);
  }
}

async function renameEntry(node) {
  const next = window.prompt(`Rename "${node.name}"`, node.name);
  if (next === null) return;
  const trimmed = next.trim();
  if (!trimmed || trimmed === node.name) return;

  const parent = tree.parentOf(node.path);
  const name = node.type === 'document' && !/\.md$/i.test(trimmed) ? `${trimmed}.md` : trimmed;
  await moveEntry(node.path, parent ? `${parent}/${name}` : name);
  if (current && current.path.startsWith(parent ? `${parent}/${name}` : name)) {
    titleEl.textContent = name.replace(/\.md$/i, '');
  }
}

async function deleteEntry(node) {
  const what = node.type === 'folder' ? `"${node.name}" and everything inside it` : `"${node.name}"`;
  if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
  try {
    await api('DELETE', `${base}?path=${encodeURIComponent(node.path)}`);
    if (current && (current.path === node.path || current.path.startsWith(`${node.path}/`))) {
      current = null;
      dirty = false;
      editor.value = '';
      editor.hidden = true;
      preview.hidden = true;
      emptyState.hidden = false;
      titleEl.textContent = 'No document open';
      pathEl.textContent = '';
      setDirty(false);
    }
    refreshTree();
    toast('Deleted');
  } catch (err) {
    toast(err.message);
  }
}

/* ---- initial load ---------------------------------------------------- */

// `?path=` lets the project page deep-link straight to a document.
(async () => {
  await refreshTree();
  const wanted = new URLSearchParams(window.location.search).get('path');
  if (wanted) await openDocument(wanted);
})();
