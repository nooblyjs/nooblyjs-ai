// One part of the design, across the items in Design (Phase 16c): each item with that part said in words, opening the
// item's page for it. Data: GET /items.
import { html } from '/ui/js/html.js';
import { pageHead, card, listRow, notice, button } from '/ui/js/components/index.js';
import { PARTS } from '../module.js';

const LEADS = {
  requirements: 'What the business must get, from each item\'s spec: drafted by an analyst agent, each accepted by a person.',
  solution: 'Which systems change and how, the NFRs they must meet, and the features each item serves.',
  functional: 'The interfaces between the impacted systems, with both sides named, and what each system must do.',
  stories: 'The stories that build each feature: proposed by an agent, shaped by an analyst.',
  handoff: 'Each story goes to Engineering on its own, with a Design handoff, once Design\'s checks pass.',
};
const href = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel}`;

export async function render(view, { route, ctx }) {
  const part = route.meta?.part ?? 'requirements';
  const title = PARTS.find((p) => p.key === part)?.title ?? 'Design';
  const draw = async () => {
    let items;
    try {
      ({ items } = await ctx.api.get('items'));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      view.innerHTML = String(notice({ title: `Couldn't load ${title.toLowerCase()}`, text: err.message, tone: 'error', actions: button({ label: 'Try again', kind: 'secondary', small: true, attrs: { 'data-action': 'reload' } }) }));
      return;
    }
    if (!ctx.isCurrent()) return;
    const inDesign = items.filter((i) => i.stage === 'design');
    const gone = items.filter((i) => i.stage !== 'design');
    const rows = (list) => html`<div class="rows">${list.map((i) => listRow({
      title: `${i.ref} · ${i.title}`,
      meta: i.parts[part],
      pill: { text: i.stage === 'design' ? (i.started ? 'In Design' : 'Not started') : `In ${i.stageLabel}`, tone: i.stage === 'design' ? (i.started ? 'info' : 'warning') : 'success' },
      href: href(ctx, `/${part}/${encodeURIComponent(i.itemId)}`),
    }))}</div>`;
    view.innerHTML = String(html`<div class="dz">${pageHead({ eyebrow: 'Software Factory · Design', title, lead: LEADS[part] })}
      ${card({
        title: `${inDesign.length} item${inDesign.length === 1 ? '' : 's'} in Design`,
        body: inDesign.length ? rows(inDesign) : html`<p class="muted">Nothing is in Design. An item comes here with its Product handoff.</p>`,
      })}
      ${gone.length ? card({ title: 'Their stories have gone on', body: rows(gone) }) : ''}</div>`);
  };
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reload"]')) draw();
  }, { signal: ctx.signal });
  await draw();
}
