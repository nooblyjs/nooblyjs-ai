// Home · For you (product.md §5.8, mockups noobly-for-you-*): the landing page built for the person's work role.
// The role only chooses the layout; GET /api/v1/home/for-you does the counting, scoped to the profile's teams, and
// every decision made here (Accept, Nudge) goes through the same server rules as Approvals.
// Roles without a layout yet (Designer, Engineering lead, Platform engineer) see the Overview.
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { createApi } from '/ui/js/api.js';
import { pageHead, button, notice } from '/ui/js/components/index.js';
import { workflowsApi, onChange } from './lib.js';

const LAYOUTS = {
  'product-manager': () => import('./for-you-pm.js'),
  architect: () => import('./for-you-architect.js'),
  developer: () => import('./for-you-developer.js'),
  // Phase 16c: the Design homes, over the Factory's Design section.
  'solution-architect': () => import('./for-you-design.js'),
  'functional-analyst': () => import('./for-you-design.js'),
  // Phase 16d: the Engineering homes, over the Software Factory's Engineering pages.
  'application-architect': () => import('./for-you-design.js'),
  'test-analyst': () => import('./for-you-design.js'),
  // Phase 17: the Business owner's home, the same lists.
  'business-owner': () => import('./for-you-design.js'),
};

function greeting(name) {
  const hour = new Date().getHours();
  return `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${name}`;
}

const filterRow = (data) => html`<div class="showing" aria-label="What this page shows">
    <span>Showing</span>
    ${data.scope === 'all'
    ? html`<span class="showing__chip showing__chip--on">Everything</span><a href="/">Only ${data.filters.what.toLowerCase()}</a>`
    : html`<span class="showing__chip showing__chip--on">${data.filters.what}</span>${data.teams.map((t) => html`<span class="showing__chip">${t.name}</span>`)}<a href="/?scope=all">Show everything</a>`}
  </div>`;

const tiles = (list) => html`<section class="tiles" aria-label="Your numbers">${list.map((t) => html`<div class="tile" data-tile="${t.key}">
    <span class="tile__label">${t.label}</span>
    <span class="tile__value">${t.value ?? '—'}</span>
    <span class="tile__note${t.tone === 'warning' ? ' tile__note--warning' : ''}">${t.note ?? ''}</span>
  </div>`)}</section>`;

/** Your first week: ticked by events only. Hide puts it away (and the Getting started card with it). */
export function firstWeek(fw) {
  if (!fw || fw.hidden || fw.done === fw.total) return '';
  let nextSeen = false;
  return html`<section class="first-week" aria-label="Your first week">
    <div class="first-week__head"><h2 class="card__title card__title--small">Your first week</h2><button type="button" class="link-button" data-action="hide-first-week">Hide</button></div>
    <ul class="first-week__list">${fw.tasks.map((t) => {
    const next = !t.done && !nextSeen;
    if (next) nextSeen = true;
    return html`<li class="first-week__task${t.done ? ' first-week__task--done' : next ? ' first-week__task--next' : ''}"><span class="first-week__mark" aria-hidden="true">${t.done ? icon('check', { size: 14, stroke: 2.6 }) : ''}</span><span>${t.text}<span class="visually-hidden">${t.done ? ' (done)' : ' (to do)'}</span></span></li>`;
  })}</ul>
    <span class="row__meta">${fw.done} of ${fw.total} · tasks tick themselves when you do them</span>
  </section>`;
}

/** A panel whose source isn't built yet: it says what will be there and which phase brings it. */
export const comingPanel = (title, { phase, text }) => html`<section class="card card--side" aria-label="${title}">
    <h2 class="card__title card__title--small">${title}</h2>
    <p class="row__meta">${text}</p><span class="pill">Arrives in Phase ${phase}</span>
  </section>`;

export async function render(view, { ctx, query }) {
  const scope = query.get('scope') === 'all' ? 'all' : 'mine';
  const workflows = workflowsApi(ctx);
  let message = null;

  async function draw() {
    const data = await ctx.hostApi.get('home/for-you', { query: { scope: scope === 'all' ? 'all' : undefined } });
    if (!ctx.isCurrent()) return;
    const setUp = data.onboarding.completed ? '' : notice({
      title: 'Finish setting up NooblyJS', tone: 'info', iconName: 'spark',
      text: 'You skipped onboarding. Pick your role and teams, and this page becomes your own home.',
      actions: html`<a class="btn btn--primary" href="/onboarding" data-reload>Pick your role and teams</a>`,
    });

    if (data.layout === 'none') {
      const overview = await import('./overview.js');
      if (!ctx.isCurrent()) return;
      const why = data.role
        ? html`<p class="for-you-note">${icon('info', { size: 16 })}<span>A For you page for the ${data.role.name.toLowerCase()} role isn't designed yet, so this is the Overview. <a href="/onboarding" data-reload>Change role</a></span></p>`
        : '';
      return overview.render(view, { ctx, note: html`${setUp}${why}` });
    }

    const head = pageHead({
      eyebrow: data.eyebrow, title: greeting(data.firstName), lead: data.summary ?? 'The lifecycle engine is not running, so your work is not shown.',
      actions: html`<a href="/onboarding" data-reload>Change role</a>${data.action ? button({ label: data.action.label, href: data.action.href, icon: data.action.icon }) : ''}`,
    });
    if (!data.engine) {
      view.innerHTML = String(html`${head}${setUp}${notice({ title: 'The lifecycle engine is not running', text: 'Your items and approvals come from the lifecycle engine, which is part of NooblyJS. It did not start: check the NooblyJS log.', tone: 'error' })}`);
      return;
    }
    const layout = await LAYOUTS[data.layout]();
    if (!ctx.isCurrent()) return;
    const { main, side } = layout.panels(data);
    // A redraw (something happened in NooblyJS) must not throw away what the person is typing.
    const typed = new Map([...view.querySelectorAll('textarea[id]')].map((t) => [t.id, t.value]));
    const focused = document.activeElement?.id;
    view.innerHTML = String(html`${head}${setUp}${filterRow(data)}
      ${message ? html`<p class="flash flash--${message.tone}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>` : ''}
      ${tiles(data.tiles)}
      <div class="for-you"><div class="for-you__main">${main}</div><div class="for-you__side">${firstWeek(data.firstWeek)}${side}</div></div>`);
    for (const [id, value] of typed) { const t = view.querySelector(`#${CSS.escape(id)}`); if (t) t.value = value; }
    if (focused && typed.has(focused)) view.querySelector(`#${CSS.escape(focused)}`)?.focus();
    await layout.after?.(view, { ctx, data });
  }

  view.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    try {
      if (action === 'hide-first-week') await ctx.hostApi.put('me/profile', { firstWeek: { hidden: true } });
      else if (action === 'nudge') message = { tone: 'ok', text: (await workflows.post(`items/${encodeURIComponent(id)}/nudge`, {})).text };
      else if (action === 'accept') message = { tone: 'ok', text: (await workflows.post(`approvals/${encodeURIComponent(id)}/decision`, { decision: 'approve' })).text };
      else if (action === 'answer-run') {
        // A stuck run's question (Developer home). The Factory checks the permission and records who answered.
        const answer = view.querySelector(`#answer-${CSS.escape(id)}`)?.value.trim() ?? '';
        if (!answer) message = { tone: 'error', text: 'Write an answer first: the run carries on from what you say.' };
        else {
          const { resumed } = await createApi('/factory/api/v1', { signal: ctx.signal }).post(`inbox/${encodeURIComponent(id)}`, { decision: 'answered', answer });
          message = { tone: 'ok', text: resumed ? 'Answer sent. The run is back in the queue.' : 'Answer sent.' };
        }
      }
      else return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
    }
    await draw();
    view.querySelector('.flash')?.scrollIntoView({ block: 'nearest' });
  }, { signal: ctx.signal });

  await draw();
  onChange(ctx, draw, { types: ['item.', 'approval.', 'handoff.', 'profile.', 'clock.', 'run.', 'pr.', 'design.', 'engineering.', 'quality.'] });
}
