// For you · Architect (mockup noobly-for-you-architect): decisions awaiting sign-off, the Architecture queue, and
// the standards and models panels that the Software Factory and Knowledge fill later. Accept shows only where the
// engine says this person may decide; the API refuses anyone else whatever the page shows.
import { html } from '/ui/js/html.js';
import { button } from '/ui/js/components/index.js';
import { comingPanel } from './for-you.js';

function decisions(rows, scope) {
  const card = (d) => html`<li class="decision${d.canDecide ? ' decision--yours' : ''}">
      <div class="decision__top"><span class="decision__ref">${d.eyebrow}</span><span class="decision__age${d.overdue ? ' decision__age--late' : ''}">${d.age}${d.context ? ` · ${d.context.split(' · ')[0].toLowerCase()}` : ''}</span></div>
      <h3 class="decision__title">${d.title}</h3>
      ${d.summary ? html`<p class="decision__summary">${d.summary}</p>` : ''}
      <div class="actions">
        ${d.canDecide ? button({ label: 'Accept', small: true, attrs: { 'data-action': 'accept', 'data-id': d.id, 'aria-label': `Accept ${d.eyebrow.split(' · ')[0]}` } }) : html`<span class="row__meta">Waiting on ${d.waitingOn.join(', ')}</span>`}
        ${button({ label: 'Discuss', kind: 'secondary', small: true, href: d.discussHref, attrs: { 'aria-label': `Discuss ${d.eyebrow.split(' · ')[0]}` } })}
        <a href="${d.discussHref}">Open diagram</a>
      </div>
    </li>`;
  return html`<section class="card" aria-label="Decisions">
    <div class="card__head"><h2 class="card__title">${scope === 'all' ? 'Decisions awaiting sign-off' : 'Decisions awaiting your sign-off'}</h2><a href="/home/approvals">All approvals</a></div>
    ${rows.length ? html`<ul class="decisions" role="list">${rows.map(card)}</ul>` : html`<p class="row__meta">No decisions are waiting on you. Show everything to see the ones waiting on other architects.</p>`}
  </section>`;
}

const queue = (rows) => html`<section class="card" aria-label="Arriving in Architecture">
    <div class="card__head"><h2 class="card__title">Your Architecture queue</h2><a href="/home/lifecycle">Lifecycle</a></div>
    ${rows.length ? html`<ul class="waits" role="list">${rows.map((q) => html`<li class="wait"><div class="wait__main"><span class="wait__title">${q.title}</span><span class="row__meta${q.late ? ' row__meta--late' : ''}">${q.text}</span></div>${button({ label: q.action.label, kind: 'secondary', small: true, href: q.action.href, attrs: { 'aria-label': `${q.action.label}: ${q.title}` } })}</li>`)}</ul>` : html`<p class="row__meta">Nothing is in Architecture or on its way.</p>`}
  </section>`;

export function panels(data) {
  return {
    main: html`${decisions(data.panels.decisions, data.scope)}${queue(data.panels.queue)}`,
    side: html`${comingPanel('Standards broken on PRs', data.panels.standards.unavailable)}${comingPanel('Models to review', data.panels.models.unavailable)}`,
  };
}
