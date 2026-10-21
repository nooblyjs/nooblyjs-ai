// Releases: each one feature, newest first, with where it is (waiting for approvers, in a pilot, everyone, rolled back).
// Data: GET /releases. A person with draft makes one from a feature whose stories have all passed Test: POST /releases.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, button } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, statusOf, mockNote, hrefFor, say, messageRegion } from '../lib.js';

export async function render(view, { ctx }) {
  const redraw = await reloadable(view, ctx, async () => {
    let releases;
    try {
      ({ releases } = await ctx.api.get('releases'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the releases'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const waiting = releases.filter((r) => r.status === 'waiting-approval').length;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations', title: 'Releases', lead: `A release is one feature, released on its own once all its stories have passed Test, with its evidence, a rollout and a rollback. Two people give the deploy approval.${waiting ? ` ${waiting} waiting for approvers.` : ''}` })}
      ${mockNote()}
      ${messageRegion()}
      ${ctx.can('draft') ? html`<form class="ops-form" data-form="new" aria-label="Make a release"><label>Item <input name="itemId" placeholder="PRD-031" required maxlength="40"></label><label>Feature <input name="featureId" placeholder="FEAT-031-1" required maxlength="40"></label><label>Version <input name="version" placeholder="1.0.0" maxlength="40"></label>${button({ label: 'Make the release', type: 'submit', kind: 'secondary' })}</form>` : ''}
      <section class="card" aria-label="Releases">${dataTable({
        caption: 'Releases', empty: 'No releases yet. A feature can be released once all its stories have passed Test.', rows: [...releases].reverse(),
        columns: [
          { key: 'id', label: 'Release', render: (r) => html`<a href="${hrefFor(ctx, `/releases/${r.id}`)}">${r.id} · ${r.name}</a><span class="ops-sub">${r.version} · ${r.featureId} ${r.featureTitle}</span>` },
          { key: 'item', label: 'Item', render: (r) => r.itemId },
          { key: 'evidence', label: 'Evidence', render: (r) => r.evidence?.text ?? '' },
          { key: 'status', label: 'Where it is', render: (r) => html`${statusOf(r)}${r.inProduction ? html`<span class="ops-sub">${r.percent}% of ${r.production}</span>` : ''}` },
        ],
      })}</section>`);
    return 0;
  });
  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="new"]');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      const r = await ctx.api.post('releases', data);
      await redraw();
      say(view, `${r.id} · ${r.name} is made: ${r.evidence.text}.`, 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
