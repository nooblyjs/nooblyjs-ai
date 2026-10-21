// For you · Solution Architect and Functional Analyst (Phase 16c), Application Architect and Test analyst (Phase 16d):
// lists of the work in the Factory's Design and Engineering pages (stories ready for their Design handoff, interfaces
// with a side missing, architectures to accept, criteria without a ready test case…), each row with what it needs in
// words and a link to where it is done. The server shapes both homes as lists
// (src/services/for-you.js); this draws them. Every decision is made on the Design and Approvals pages.
import { html } from '/ui/js/html.js';
import { button } from '/ui/js/components/index.js';

const list = (l, side = false) => html`<section class="card${side ? ' card--side' : ''}" aria-label="${l.title}">
    <div class="card__head"><h2 class="card__title${side ? ' card__title--small' : ''}">${l.title}</h2>${l.link ? html`<a href="${l.link.href}">${l.link.label}</a>` : ''}</div>
    ${l.rows.length ? html`<ul class="waits" role="list">${l.rows.map((r) => html`<li class="wait"><div class="wait__main"><span class="wait__title">${r.title}</span><span class="row__meta${r.late ? ' row__meta--late' : ''}">${r.text}</span></div>${r.action ? button({ label: r.action.label, kind: 'secondary', small: true, href: r.action.href, attrs: { 'aria-label': `${r.action.label}: ${r.title}` } }) : ''}</li>`)}</ul>`
    : html`<p class="row__meta">${l.empty}</p>`}
  </section>`;

export function panels(data) {
  return {
    main: html`${data.panels.lists.map((l) => list(l))}`,
    side: html`${data.panels.side.map((l) => list(l, true))}`,
  };
}
