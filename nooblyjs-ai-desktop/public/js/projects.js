import { api, toast, showFormError, renderRelativeTimes } from './lib/api.js';
import { wireModals, open, isAnyOpen } from './lib/modal.js';

wireModals();
renderRelativeTimes();

const form = document.getElementById('new-project-form');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;

  try {
    const { project } = await api('POST', '/api/projects', {
      name: data.get('name'),
      description: data.get('description')
    });
    window.location.href = `/projects/${project.id}`;
  } catch (err) {
    showFormError(form, err.message);
    submit.disabled = false;
  }
});

document.getElementById('project-grid')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete-project]');
  if (!button) return;

  const { deleteProject: id, name } = button.dataset;
  if (!window.confirm(`Delete "${name}" and all of its chats? This cannot be undone.`)) return;

  try {
    await api('DELETE', `/api/projects/${id}`);
    document.querySelector(`[data-project-id="${id}"]`)?.remove();
    toast(`Deleted "${name}"`);
    if (!document.querySelector('#project-grid li')) window.location.reload();
  } catch (err) {
    toast(err.message);
  }
});

// Keyboard shortcut: N opens the new-project dialog.
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (document.activeElement?.matches('input, textarea, select')) return;
  if (isAnyOpen()) return;
  event.preventDefault();
  open('new-project');
});
