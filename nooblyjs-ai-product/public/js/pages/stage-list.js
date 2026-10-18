// The items in a stage (Architecture or UX design), each with what it needs in words. With one item, the stage
// opens straight on it, as the mockups do. Data: GET /architecture or GET /ux.
import { html } from '/ui/js/html.js';
import { pageHead, card, listRow } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable } from '../lib.js';

const STAGES = {
  architecture: { api: 'architecture', eyebrow: 'Product Factory · Stage 2', title: 'Architecture', lead: 'Solution design for approved specs: container view, decisions, standards and quality attributes.', empty: 'Nothing is in Architecture yet. Specs arrive here when they are approved.' },
  ux: { api: 'ux', eyebrow: 'Product Factory · Stage 3', title: 'UX Design', lead: 'Journeys, flows and research for each item.', empty: 'No UX work yet. Ask the design agent for a journey from an item\'s page.' },
  ui: { api: 'ui', eyebrow: 'Product Factory · Stage 4', title: 'UI Design', lead: 'Screens, design-system reuse and accessibility, then the handoff to the Software Factory.', empty: 'No UI design work yet.' },
};

export async function render(view, { route, ctx }) {
  const stage = STAGES[route.meta.stage];
  await reloadable(view, ctx, async () => {
    let items;
    try {
      ({ items } = await ctx.api.get(stage.api));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, stage.title));
      return;
    }
    if (!ctx.isCurrent()) return;
    if (items.length === 1) {
      ctx.navigate(`/${stage.api}/${items[0].itemId}`, { replace: true });
      return;
    }
    view.innerHTML = String(html`${pageHead({ eyebrow: stage.eyebrow, title: stage.title, lead: stage.lead })}
      ${card({
        title: `${items.length} item${items.length === 1 ? '' : 's'}`,
        body: items.length
          ? html`<div class="rows">${items.map((i) => listRow({ title: `${i.itemId} · ${i.title}`, meta: i.text, href: hrefFor(ctx, `/${stage.api}/${i.itemId}`) }))}</div>`
          : html`<p class="muted">${stage.empty}</p>`,
      })}`);
  });
}
