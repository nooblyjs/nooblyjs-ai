import { api, toast, renderRelativeTimes } from './lib/api.js';
import { renderMarkdown } from './lib/markdown.js';
import { wireModelPicker } from './lib/modelPicker.js';
import { createDocTree } from './lib/docTree.js';

const root = document.querySelector('[data-project-id]');
const projectId = root.dataset.projectId;

const nameInput = document.querySelector('[data-project-name]');
const descriptionInput = document.querySelector('[data-project-description]');
const saveStatus = document.querySelector('[data-save-status]');

renderRelativeTimes();

/* ---- in-place project editing ---------------------------------------- */

let statusTimer = null;

function setStatus(text, { transient = false } = {}) {
  saveStatus.textContent = text;
  clearTimeout(statusTimer);
  if (transient) statusTimer = setTimeout(() => { saveStatus.textContent = ''; }, 1800);
}

/**
 * Debounced field saver. Each field keeps its own timer so typing in the
 * description does not cancel a pending name save.
 */
function autosave(field, element, { delay = 700, onSaved } = {}) {
  let timer = null;
  let lastSaved = element.value;

  async function commit() {
    const value = element.value;
    if (value === lastSaved) return;
    setStatus('Saving…');
    try {
      const { project } = await api('PATCH', `/api/projects/${projectId}`, { [field]: value });
      lastSaved = project[field];
      // The server trims and validates; reflect what it actually stored.
      if (element.value === value && project[field] !== value) element.value = project[field];
      setStatus('Saved', { transient: true });
      onSaved?.(project);
    } catch (err) {
      setStatus('');
      toast(err.message);
      element.focus();
    }
  }

  element.addEventListener('input', () => {
    setStatus('Unsaved changes');
    clearTimeout(timer);
    timer = setTimeout(commit, delay);
  });

  element.addEventListener('blur', () => {
    clearTimeout(timer);
    commit();
  });

  return { commit: () => { clearTimeout(timer); return commit(); } };
}

autosave('name', nameInput, {
  onSaved: (project) => {
    document.title = `${project.name} · LLM Projects`;
    const crumb = document.querySelector('.breadcrumb span:last-child');
    if (crumb) crumb.textContent = project.name;
  }
});

// Enter commits the name rather than inserting a newline into a one-line field.
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    nameInput.blur();
  }
});

const description = autosave('description', descriptionInput);

// CSS supplies the floor via min-height; this only grows it to fit the content.
function growDescription() {
  descriptionInput.style.height = 'auto';
  descriptionInput.style.height = `${Math.min(descriptionInput.scrollHeight, 420)}px`;
}
descriptionInput.addEventListener('input', growDescription);
growDescription();

/* ---- default model --------------------------------------------------- */

const defaultsStatus = document.getElementById('defaults-status');
let defaultsTimer = null;

wireModelPicker(document.querySelector('[data-model-picker]'), {
  onChange: ({ provider, model }) => {
    clearTimeout(defaultsTimer);
    defaultsStatus.textContent = 'Saving…';
    defaultsTimer = setTimeout(async () => {
      try {
        await api('PATCH', `/api/projects/${projectId}`, { defaults: { provider, model } });
        defaultsStatus.textContent = 'Default model saved';
      } catch (err) {
        defaultsStatus.textContent = err.message;
      }
    }, 250);
  }
});

/* ---- documents: tree ------------------------------------------------- */

const documentsBase = `/api/projects/${projectId}/documents`;
const treeContainer = document.querySelector('[data-tree]');

const tree = createDocTree(treeContainer, {
  projectId,
  onOpen: (node) => openDocument(node.path),
  onMove: moveEntry,
  onDelete: deleteEntry,
  onRename: renameEntry
});

tree.wireRootDrop(document.querySelector('[data-drop-root]'));

async function refreshTree() {
  try {
    const { tree: nodes } = await api('GET', documentsBase);
    tree.setTree(nodes);
    if (openPath) tree.setActive(openPath);
  } catch (err) {
    treeContainer.textContent = err.message;
  }
}

/** New items land beside the open document, else at the top level. */
function currentFolder() {
  return openPath ? tree.parentOf(openPath) : '';
}

document.querySelector('[data-new-document]').addEventListener('click', async () => {
  const name = window.prompt('Document name', 'Untitled');
  if (name === null) return;
  try {
    const { document: doc } = await api('POST', `${documentsBase}/documents`, {
      parent: currentFolder(),
      name: name.trim(),
      content: `# ${name.trim().replace(/\.md$/i, '')}\n\n`
    });
    await refreshTree();
    await openDocument(doc.path);
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector('[data-new-folder]').addEventListener('click', async () => {
  const name = window.prompt('Folder name', 'New folder');
  if (name === null) return;
  try {
    await api('POST', `${documentsBase}/folders`, { parent: currentFolder(), name: name.trim() });
    await refreshTree();
  } catch (err) {
    toast(err.message);
  }
});

async function moveEntry(from, to) {
  try {
    await api('POST', `${documentsBase}/move`, { from, to });
    // The open document may be the moved item, or inside a moved folder.
    if (openPath && (openPath === from || openPath.startsWith(`${from}/`))) {
      openPath = to + openPath.slice(from.length);
      docPath.textContent = openPath;
      docTitle.textContent = openPath.slice(openPath.lastIndexOf('/') + 1).replace(/\.md$/i, '');
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
}

async function deleteEntry(node) {
  const what = node.type === 'folder' ? `"${node.name}" and everything inside it` : `"${node.name}"`;
  if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
  try {
    await api('DELETE', `${documentsBase}?path=${encodeURIComponent(node.path)}`);
    if (openPath && (openPath === node.path || openPath.startsWith(`${node.path}/`))) closeEditor(true);
    await refreshTree();
    toast('Deleted');
  } catch (err) {
    toast(err.message);
  }
}

/* ---- documents: modal editor ----------------------------------------- */

const dialog = document.getElementById('document-editor');
const editor = document.querySelector('[data-editor]');
const preview = document.querySelector('[data-preview]');
const docTitle = document.querySelector('[data-doc-title]');
const docPath = document.querySelector('[data-doc-path]');
const docStatus = document.querySelector('[data-doc-status]');
const docSave = document.querySelector('[data-doc-save]');

let openPath = null;
let dirty = false;

function editorModal() {
  return window.bootstrap.Modal.getOrCreateInstance(dialog);
}

function isEditorOpen() {
  return dialog.classList.contains('show');
}

function focusEditor() {
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}
let docSaveTimer = null;
let docStatusTimer = null;

function setDirty(next) {
  dirty = next;
  docSave.disabled = !next;
  if (next) {
    clearTimeout(docStatusTimer);
    docStatus.textContent = 'Unsaved changes';
  }
}

function mode() {
  return document.querySelector('[data-mode].active')?.dataset.mode || 'edit';
}

function applyMode(next) {
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.classList.toggle('active', button.dataset.mode === next);
    button.setAttribute('aria-pressed', String(button.dataset.mode === next));
  }
  if (next === 'preview') preview.innerHTML = renderMarkdown(editor.value);
  editor.hidden = next !== 'edit';
  preview.hidden = next !== 'preview';
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => applyMode(button.dataset.mode));
}

async function openDocument(path) {
  try {
    const { document: doc } = await api(
      'GET',
      `${documentsBase}/content?path=${encodeURIComponent(path)}`
    );
    openPath = doc.path;
    editor.value = doc.content;
    docTitle.textContent = doc.title;
    docPath.textContent = doc.path;
    docStatus.textContent = '';
    setDirty(false);
    applyMode('edit');
    tree.setActive(doc.path);

    if (isEditorOpen()) focusEditor();
    else editorModal().show(); // focuses the editor once shown, see below
  } catch (err) {
    toast(err.message);
  }
}

async function saveDocument() {
  if (!openPath || !dirty) return;
  docStatus.textContent = 'Saving…';
  try {
    const { document: doc } = await api('PUT', `${documentsBase}/content`, {
      path: openPath,
      content: editor.value
    });
    openPath = doc.path;
    setDirty(false);
    docStatus.textContent = 'Saved';
    clearTimeout(docStatusTimer);
    docStatusTimer = setTimeout(() => {
      if (!dirty) docStatus.textContent = '';
    }, 1800);
    refreshTree();
  } catch (err) {
    docStatus.textContent = '';
    toast(err.message);
  }
}

editor.addEventListener('input', () => {
  setDirty(true);
  clearTimeout(docSaveTimer);
  docSaveTimer = setTimeout(saveDocument, 1200); // autosave shortly after typing stops
});

docSave.addEventListener('click', async () => {
  await saveDocument();
  // Save disables itself, which drops focus out of the modal and with it
  // Bootstrap's Escape handling; put focus back inside.
  (editor.hidden ? dialog : editor).focus();
});

function closeEditor(force = false) {
  if (!force && dirty && !window.confirm('Discard unsaved changes?')) return false;
  clearTimeout(docSaveTimer);
  openPath = null;
  setDirty(false);
  docStatus.textContent = '';
  editorModal().hide();
  tree.setActive(null);
  return true;
}

for (const button of document.querySelectorAll('[data-doc-close]')) {
  button.addEventListener('click', () => closeEditor());
}

document.querySelector('[data-doc-delete]').addEventListener('click', () => {
  if (!openPath) return;
  const name = openPath.slice(openPath.lastIndexOf('/') + 1);
  deleteEntry({ type: 'document', name, path: openPath });
});

// Escape and backdrop clicks make Bootstrap hide the modal. While a document
// is open, route that through closeEditor so unsaved work can be kept; it
// clears openPath before hiding, so its own hide() passes straight through.
dialog.addEventListener('hide.bs.modal', (event) => {
  if (openPath === null) return;
  event.preventDefault();
  closeEditor();
});

// Bootstrap moves focus to the modal itself once shown; hand it to the editor.
dialog.addEventListener('shown.bs.modal', focusEditor);

document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (isEditorOpen()) saveDocument();
  else description.commit();
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

/* ---- delete project / chats ------------------------------------------ */

document.querySelector('[data-delete-project]')?.addEventListener('click', async (event) => {
  const { name } = event.currentTarget.dataset;
  if (!window.confirm(`Delete "${name}" and all of its chats and documents? This cannot be undone.`)) {
    return;
  }
  try {
    await api('DELETE', `/api/projects/${projectId}`);
    window.location.href = '/';
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector('.chat-list')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-chat]');
  if (!button) return;
  const { deleteChat: id, title } = button.dataset;
  if (!window.confirm(`Delete chat "${title}"?`)) return;
  try {
    await api('DELETE', `/api/projects/${projectId}/chats/${id}`);
    button.closest('.chat-item').remove();
    toast('Chat deleted');
  } catch (err) {
    toast(err.message);
  }
});

document.querySelector('[data-new-chat]')?.addEventListener('click', async () => {
  try {
    const { chat } = await api('POST', `/api/projects/${projectId}/chats`, {});
    window.location.href = `/projects/${projectId}/chats/${chat.id}`;
  } catch (err) {
    toast(err.message);
  }
});

/* ---- initial load ---------------------------------------------------- */

(async () => {
  await refreshTree();
  // `?doc=` opens straight into a document, so a chat can link to one.
  const wanted = new URLSearchParams(window.location.search).get('doc');
  if (wanted) await openDocument(wanted);
})();
