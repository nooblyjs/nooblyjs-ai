import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';

const STATUS = {
  task: 'On a task',
  available: 'Available',
  paused: 'Paused',
  off: 'Off shift',
};
/** Render markup into a fresh element and return it. */
export function fragment(markup, tag = 'div', className = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.innerHTML = String(markup);
  return el;
}

export const statusLabel = (s) => STATUS[s] ?? s;

export const statusPill = (status, label = statusLabel(status)) =>
  html`<span class="status-pill status-${status}"><span class="status-dot status-dot-${status}" aria-hidden="true"></span>${label}</span>`;

export const meter = (pct, { label = '' } = {}) => {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return html`<div class="meter" role="img" aria-label="${label || `${Math.round(v)}%`}"><div class="meter-fill" style="width:${v}%"></div></div>`;
};

export const LEVELS = { 1: 'Learning', 2: 'Proficient', 3: 'Expert' };

/**
 * Toasts and dialogs live outside the page's view, in one element at the end of <body> that carries
 * data-module="teammates", so the app's scoped CSS still reaches them (noobly structure.md §2a).
 */
export function portal() {
  let el = document.getElementById('teammates-portal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'teammates-portal';
    el.dataset.module = 'teammates';
    el.innerHTML = '<div class="tm-root"><div class="toasts" id="teammates-toasts" aria-live="polite"></div></div>';
    document.body.append(el);
  }
  return el.firstElementChild;
}

export function toast(message, { error = false } = {}) {
  const host = portal().querySelector('#teammates-toasts');
  const el = fragment(html`${message}`, 'div', `toast${error ? ' error' : ''}`);
  el.setAttribute('role', error ? 'alert' : 'status');
  host.append(el);
  setTimeout(() => el.remove(), error ? 6000 : 3500);
}

/**
 * Open a modal <dialog>. `body` is markup; `setup(dialog)` wires behaviour and may return a cleanup.
 * Resolves with the dialog's returnValue when it closes.
 */
export function openDialog({ title, body, footer = '', setup, wide = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  if (wide) dialog.style.width = 'min(760px, calc(100vw - 32px))';
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = String(html`
    <div class="modal-head">
      <h2 id="${titleId}">${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? html`<div class="modal-foot">${footer}</div>` : ''}`);
  portal().append(dialog);
  const cleanup = setup?.(dialog);
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === dialog) dialog.close('cancel');
  });
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      cleanup?.();
      dialog.remove();
      resolve(dialog.returnValue);
    });
    dialog.showModal();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const result = await openDialog({
    title,
    body: html`<p>${message}</p>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" data-confirm>${confirmLabel}</button>`,
    setup: (d) => d.querySelector('[data-confirm]').addEventListener('click', () => d.close('confirm')),
  });
  return result === 'confirm';
}

export const loadingView = () => html`<div class="loading" role="status"><span class="spinner"></span> Loading…</div>`;

export const errorView = (err) => html`<div class="error-state card" role="alert">
  <h2>That didn't load</h2>
  <p>${err?.message ?? 'Something went wrong.'}</p>
  <button type="button" class="btn btn-secondary" data-action="retry">Try again</button>
</div>`;
