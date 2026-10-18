// Shared by the Platform pages: the header, flash messages, the words for an API refusal, money, and the dialog
// that asks why before a governed change (guardrails, members, Stop all).
import { html } from '/ui/js/html.js';
import { pageHead } from '/ui/js/components/index.js';
export { onChange } from '../home/lib.js';

export const EYEBROW = 'NooblyJS · Platform';

export const head = (title, lead, actions) => pageHead({ eyebrow: EYEBROW, title, lead, actions });

/** A message after a change: { tone: 'ok' | 'error', text }. Errors are announced at once. */
export const flash = (message) => (message
  ? html`<p class="flash${message.tone === 'error' ? ' flash--error' : ''}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>`
  : '');

/** An API refusal in words: the server's message, which says what is missing and why. */
export const errorText = (err) => (err?.message ? String(err.message) : 'Something went wrong. Try again.');

/** $1,500, or $414.50 when there are cents. */
export function money(n) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-US', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A switch: a real checkbox with its state in words (On / Off) beside it. */
export const toggle = ({ name, checked, label, disabled = false, attrs = '' }) => html`<label class="switch"><input type="checkbox" role="switch" name="${name}"${checked ? html` checked` : ''}${disabled ? html` disabled` : ''}${attrs ? html` ${attrs}` : ''} aria-label="${label}"><span class="switch__state" aria-hidden="true">${checked ? 'On' : 'Off'}</span></label>`;

/** Keeps a switch's words in step with its box. */
export function syncToggle(input) {
  const state = input.closest('.switch')?.querySelector('.switch__state');
  if (state) state.textContent = input.checked ? 'On' : 'Off';
}

/** A form asking why, before a change the audit log keeps the reason for. */
export const reasonForm = ({ id, title, text, confirm, cancel = 'Cancel', danger = false }) => html`<form class="reason" data-form="${id}" aria-label="${title}">
  <strong class="strong">${title}</strong>
  ${text ? html`<p class="note">${text}</p>` : ''}
  <label class="field">Why? (kept in the audit log)<textarea name="reason" required minlength="3" maxlength="500" rows="2"></textarea></label>
  <div class="actions"><button class="btn btn--${danger ? 'danger' : 'primary'}" type="submit">${confirm}</button><button class="btn btn--secondary" type="button" data-action="cancel">${cancel}</button></div>
</form>`;
