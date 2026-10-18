// For you · Developer (mockup noobly-for-you-developer): pull requests waiting for you, the Software Factory's runs
// on your repos, the question a stuck run is asking you, and the engineering teammate who opens the PRs.
// Runs and questions come from the Factory (host.service('factory')); when it isn't running here, the panels say so.
import { html } from '/ui/js/html.js';
import { button, statusPill } from '/ui/js/components/index.js';
import { initials, money } from '/ui/js/format.js';
import { comingPanel } from './for-you.js';

const prs = (rows) => html`<section class="card" aria-label="Pull requests to review">
    <div class="card__head"><h2 class="card__title">Pull requests waiting for you</h2><a href="/home/lifecycle">Lifecycle</a></div>
    ${rows.length ? html`<ul class="waits" role="list">${rows.map((p) => html`<li class="wait"><div class="wait__main"><a class="wait__title" href="${p.href}"><span class="mono">${p.ref}</span> · ${p.title}</a><span class="row__meta">${p.context}</span></div><span class="pill">${p.stage} · ${p.age}</span>${button({ label: 'Review', small: true, href: p.href, attrs: { 'aria-label': `Review ${p.ref}` } })}</li>`)}</ul>` : html`<p class="row__meta">No pull requests are in flight on your repos.</p>`}
  </section>`;

const teammate = (t) => (t ? html`<section class="card card--side" aria-label="Your teammate">
    <div class="teammate"><span class="avatar avatar--agent" aria-hidden="true">${initials(t.name)}</span><div><span class="teammate__name">${t.name}</span><span class="row__meta">Engineering teammate</span></div></div>
    <p class="row__meta">${t.text}</p><a href="${t.href}">Open the roster</a>
  </section>` : '');

/** A panel that has nothing to show yet, with the reason: a later phase, or an app that isn't running here. */
const without = (title, why) => (why.phase ? comingPanel(title, why) : html`<section class="card card--side" aria-label="${title}">
    <h2 class="card__title card__title--small">${title}</h2><p class="row__meta">${why.text}</p>
  </section>`);

const TONES = { running: 'info', queued: 'neutral', parked: 'warning', delivered: 'success', merged: 'success', gate_failed: 'danger', error: 'danger', agent_failed: 'danger' };

function runs(panel) {
  if (panel.unavailable) return without('Runs on your repos', panel.unavailable);
  return html`<section class="card" aria-label="Runs on your repos">
    <div class="card__head"><h2 class="card__title">Runs on your repos</h2><a href="/factory/line">Open the Line</a></div>
    ${panel.rows.length ? html`<ul class="waits" role="list">${panel.rows.map((r) => html`<li class="wait">
      <div class="wait__main"><a class="wait__title" href="${r.href}">${r.title}</a>
        <span class="row__meta"><span class="mono">${r.repo}</span>${r.itemId ? html` · for <a href="/home/lifecycle/${r.itemId}">${r.itemId}</a>` : ''}${r.station ? ` · ${r.station}` : ''}${r.costUsd ? ` · ${money(r.costUsd)}` : ''}</span></div>
      ${statusPill({ text: r.statusText, tone: TONES[r.status] ?? 'neutral' })}
    </li>`)}</ul>` : html`<p class="row__meta">No runs yet. A handoff from UI design starts one for each work item whose repository the Factory knows.</p>`}
    ${panel.waiting?.length ? html`<p class="row__meta">${panel.waiting.length} work item${panel.waiting.length === 1 ? ' is' : 's are'} waiting: ${panel.waiting.map((w) => `${w.title} (${w.reason})`).join('; ')}.</p>` : ''}
  </section>`;
}

function questions(panel) {
  if (panel.unavailable) return without('A run is asking you', panel.unavailable);
  if (!panel.rows.length) return html`<section class="card card--side" aria-label="A run is asking you">
    <h2 class="card__title card__title--small">A run is asking you</h2><p class="row__meta">No run is stuck. When one is, it asks here.</p>
  </section>`;
  return panel.rows.map((q) => html`<section class="card card--side run-ask" aria-label="A run is asking you: ${q.title}">
    <h2 class="card__title card__title--small">A run is asking you</h2>
    <p class="run-ask__title">${q.title}</p>
    ${q.body ? html`<p class="row__meta run-ask__body" tabindex="0" role="region" aria-label="What the run says: ${q.title}">${q.body}</p>` : ''}
    <p class="row__meta"><a href="${q.href}">Open the run</a>${q.itemId ? html` · for <a href="/home/lifecycle/${q.itemId}">${q.itemId}</a>` : ''}</p>
    ${q.canAnswer ? html`<label class="visually-hidden" for="answer-${q.id}">Your answer to: ${q.title}</label>
    <textarea class="run-ask__answer" id="answer-${q.id}" rows="3" maxlength="4000" placeholder="Tell the run what to do. It carries on from your answer."></textarea>
    ${button({ label: 'Send answer', small: true, attrs: { 'data-action': 'answer-run', 'data-id': q.id } })}`
    : html`<p class="row__meta">${q.needs}</p>${button({ label: 'Open the Factory inbox', kind: 'secondary', small: true, href: '/factory/inbox' })}`}
  </section>`);
}

export function panels(data) {
  return {
    main: html`${prs(data.panels.prs)}${runs(data.panels.runs)}`,
    side: html`${questions(data.panels.question)}${teammate(data.panels.teammate)}`,
  };
}
