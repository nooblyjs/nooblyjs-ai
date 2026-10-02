// Memory rows shared by the profile's memory review and the Team memory screen.
import { html } from './html.js';
import { icons } from './icons.js';

export const KIND_LABEL = { fact: 'Fact', preference: 'Preference', source: 'Source' };

/** Pinned items first, then newest. */
export const byPinnedThenNewest = (a, b) => Number(b.pinned) - Number(a.pinned) || (b.learnedAt ?? '').localeCompare(a.learnedAt ?? '');

export const memoryRow = (m, { contributor } = {}) => html`
  <div class="recent-item memory-row${m.pinned ? ' is-pinned' : ''}" data-row="${m.id}">
    <div>
      <p>${m.pinned ? html`<span class="pin-mark" title="Pinned">${icons.pin}<span class="visually-hidden">Pinned:</span></span>` : ''}${m.text}</p>
      <div class="meta">
        ${KIND_LABEL[m.kind] ?? m.kind} · learned ${m.learned}${contributor ? ` · by ${contributor}` : ''}
        ${m.project ? html` · <span class="project-chip">${m.project}</span>` : ''}
        ${m.mergedFrom?.length ? ` · merged from ${m.mergedFrom.length} notes` : ''}
        ${/^wk_/.test(m.source ?? '') ? html` · <button type="button" class="text-link" data-work="${m.source}" data-teammate="${m.teammateId}">View work item</button>` : ''}
      </div>
    </div>
    <div class="row-actions">
      <button type="button" class="icon-btn" data-pin="${m.id}" aria-pressed="${Boolean(m.pinned)}" aria-label="${m.pinned ? 'Unpin' : 'Pin'}: ${m.text.slice(0, 60)}" title="${m.pinned ? 'Unpin' : 'Pin: always used and never merged'}">${icons.pin}</button>
      <button type="button" class="icon-btn" data-delete="${m.id}" aria-label="Delete memory: ${m.text.slice(0, 60)}" title="Delete">${icons.trash}</button>
    </div>
  </div>`;
