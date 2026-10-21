// Deployments: every step of every release into production, and every rollback, newest first. Data: GET /deployments.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, mockNote, hrefFor, versions } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let deployments;
    try {
      ({ deployments } = await ctx.api.get('deployments'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the deployments'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations', title: 'Deployments', lead: 'Each step of a release into production (a pilot, then everyone) and each rollback. Production changes only through a release.' })}
      ${mockNote()}
      <section class="card" aria-label="Deployments">${dataTable({
        caption: 'Deployments', empty: 'Nothing has been deployed through a release yet.', rows: deployments,
        columns: [
          { key: 'at', label: 'When', render: (d) => String(d.at).slice(0, 16).replace('T', ' ') },
          { key: 'release', label: 'Release', render: (d) => html`<a href="${hrefFor(ctx, `/releases/${d.releaseId}`)}">${d.releaseId} · ${d.release}</a><span class="ops-sub">${d.version}</span>` },
          { key: 'what', label: 'What', render: (d) => (d.rolledBack ? `Rolled back: ${d.reason}` : `${d.label}: ${d.percent}%`) },
          { key: 'where', label: 'Where', render: (d) => html`${d.environment}<span class="ops-sub">${versions(d.deployed)}</span>` },
          { key: 'by', label: 'By', render: (d) => d.by?.name ?? '' },
        ],
      })}</section>`);
    return 0;
  });
}
