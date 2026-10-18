// Draws the part of Adaptive Cards 1.5 that the NooblyJS Teams bot sends (src/teams/cards/*.yaml), for the Teams
// simulator: TextBlock, ColumnSet, Container, FactSet, ActionSet, Action.Submit and Action.OpenUrl. Everything
// is escaped by the html template; an element it doesn't know is left out rather than guessed at.
//
// A Submit button carries its `data` in data-card-submit, which the page sends back as Teams would. An OpenUrl is
// a plain link: that is where every decision goes (into NooblyJS).
import { html } from '/ui/js/html.js';

/** "**bold** text" → bold spans. The only Markdown the bot's cards use. */
const inline = (text) => String(text ?? '').split('**').map((part, i) => (i % 2 ? html`<strong>${part}</strong>` : part));
const safeUrl = (url) => (/^(https?:\/\/|\/(?!\/))/.test(String(url ?? '')) ? url : '#');

function action(a) {
  if (a.type === 'Action.Submit') return html`<button class="btn btn--secondary btn--small" type="button" data-card-submit="${JSON.stringify(a.data ?? {})}">${a.title}</button>`;
  if (a.type === 'Action.OpenUrl') return html`<a class="btn ${a.style === 'positive' ? 'btn--primary' : 'btn--secondary'} btn--small" href="${safeUrl(a.url)}" data-reload>${a.title}</a>`;
  return '';
}

const actions = (list) => (list?.length ? html`<div class="ac-actions">${list.map(action)}</div>` : '');

function element(el) {
  if (!el || typeof el !== 'object') return '';
  switch (el.type) {
    case 'TextBlock': {
      if (String(el.id ?? '').startsWith('avatar-')) return html`<span class="avatar avatar--small avatar--agent" aria-hidden="true">${el.text}</span>`;
      const cls = ['ac-text', el.weight === 'Bolder' && 'ac-text--bold', el.isSubtle && 'ac-text--subtle', el.size === 'Small' && 'ac-text--small', el.separator && 'ac-separator'].filter(Boolean).join(' ');
      return html`<p class="${cls}">${inline(el.text)}</p>`;
    }
    case 'ColumnSet':
      return html`<div class="ac-columns${el.separator ? ' ac-separator' : ''}">${(el.columns ?? []).map((c) => html`<div class="ac-column ac-column--${c.width === 'stretch' ? 'stretch' : 'auto'}">${(c.items ?? []).map(element)}</div>`)}</div>`;
    case 'Container':
      return html`<div class="ac-container${el.style === 'emphasis' ? ' ac-container--emphasis' : ''}">${(el.items ?? []).map(element)}</div>`;
    case 'FactSet':
      return html`<dl class="ac-facts">${(el.facts ?? []).map((f) => html`<div class="ac-fact"><dt>${f.title}</dt><dd>${f.value}</dd></div>`)}</dl>`;
    case 'ActionSet':
      return actions(el.actions);
    default:
      return '';
  }
}

/** The card as markup, or nothing when it isn't an Adaptive Card. */
export function adaptiveCard(card) {
  if (card?.type !== 'AdaptiveCard') return '';
  return html`<div class="ac-card">${(card.body ?? []).map(element)}${actions(card.actions)}</div>`;
}
