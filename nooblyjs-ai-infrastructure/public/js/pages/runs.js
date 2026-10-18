// Provisioning runs, newest first: what is being applied where, the plan, and who approved it. No mockup yet.
// Data: GET /runs?status=.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, statusPill, chips } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, progressBar, REFRESH_MS } from '../lib.js';

const FILTERS = [{ value: 'all', label: 'All' }, { value: 'active', label: 'In progress' }, { value: 'done', label: 'Provisioned' }, { value: 'failed', label: 'Failed' }];

export async function render(view, { ctx }) {
  let filter = 'all';
  const redraw = await reloadable(view, ctx, async () => {
    let runs;
    try {
      ({ runs } = await ctx.api.get('runs', { query: filter === 'all' ? undefined : { status: filter } }));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the provisioning runs'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const pressed = view.querySelector('[data-status]:focus')?.dataset.status;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'NooblyJS · Infrastructure', title: 'Provisioning runs', lead: 'Each run applies one design version to one environment. Preview and Dev runs start by themselves; Test and Staging runs start when a person approves.' })}
      ${chips({ label: 'Show', name: 'status', items: FILTERS, current: filter, small: true })}
      <section class="card" aria-label="Provisioning runs">${dataTable({
        caption: 'Provisioning runs',
        empty: filter === 'all' ? 'No runs yet. One starts when a design is approved.' : 'No runs match this filter.',
        rows: runs,
        columns: [
          { key: 'environment', label: 'Environment', render: (r) => html`<a class="inf-mono inf-env" href="${r.href}">${r.environment}</a><span class="inf-sub">${r.reason}</span>` },
          { key: 'design', label: 'Design', render: (r) => html`<span class="inf-mono">${r.designId} v${r.designVersion}</span>` },
          { key: 'plan', label: 'Plan', render: (r) => r.planText || '—' },
          { key: 'status', label: 'Status', render: (r) => (r.status === 'running' ? progressBar(r.statusText, r.progress) : statusPill({ text: r.statusText, tone: r.tone })) },
          { key: 'by', label: 'Started by', render: (r) => html`${r.requestedBy?.name ?? 'NooblyJS'}${r.requestedBy?.kind === 'agent' ? ' (agent)' : ''}${r.approvedBy ? html`<span class="inf-sub">Approved by ${r.approvedBy.name}</span>` : ''}` },
          { key: 'when', label: 'When', render: (r) => r.when },
          { key: 'open', label: 'Run', render: (r) => html`<a href="${r.runHref}">Plan and log<span class="visually-hidden"> of the run on ${r.environment}, ${r.when}</span></a>` },
        ],
      })}</section>`);
    if (pressed) view.querySelector(`[data-status="${pressed}"]`)?.focus();
    return runs.some((r) => r.status === 'running' || r.status === 'queued') ? REFRESH_MS : 0;
  });

  view.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-status]');
    if (!chip) return;
    filter = chip.dataset.status;
    redraw().then(() => view.querySelector(`[data-status="${filter}"]`)?.focus());
  }, { signal: ctx.signal });
}
