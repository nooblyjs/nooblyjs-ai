// Bootstrap's Modal gives focus trapping, Escape and the backdrop; this only
// wires the triggers. Closing is declarative, via data-bs-dismiss="modal".
export function wireModals(root = document) {
  for (const trigger of root.querySelectorAll('[data-open-modal]')) {
    trigger.addEventListener('click', () => open(trigger.dataset.openModal));
  }
}

export function open(id) {
  const element = typeof id === 'string' ? document.getElementById(id) : id;
  if (!element) return null;
  const error = element.querySelector('[data-form-error]');
  if (error) error.hidden = true;
  element.addEventListener(
    'shown.bs.modal',
    () => element.querySelector('input, textarea, select')?.focus(),
    { once: true }
  );
  window.bootstrap.Modal.getOrCreateInstance(element).show();
  return element;
}

export function isAnyOpen() {
  return Boolean(document.querySelector('.modal.show'));
}

export function confirmAction(message) {
  return window.confirm(message);
}
