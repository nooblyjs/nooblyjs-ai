// Findings, by age against their fix-by date: open ones first, the most overdue at the top. Data: GET /findings.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, severityPill, statePill, mockNote, hrefFor } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let findings;
    try {
      ({ findings } = await ctx.api.get('findings'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the findings'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const open = findings.filter((f) => f.state === 'open' || f.state === 'fixing');
    const late = open.filter((f) => f.late);
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Security', title: 'Findings', lead: `${open.length} open${late.length ? `, ${late.length} past its fix-by date` : ''}. Each has an owner and a fix-by date from the policy; it closes only when a scan of its fix no longer finds it.` })}
      ${mockNote()}
      <section class="card" aria-label="Findings">${dataTable({
        caption: 'Findings',
        empty: 'No findings.',
        rows: findings,
        columns: [
          { key: 'id', label: 'Finding', render: (f) => html`<a href="${hrefFor(ctx, `/findings/${f.id}`)}">${f.id}</a><span class="sec-sub">${f.title}</span>` },
          { key: 'severity', label: 'Severity', render: (f) => severityPill(f) },
          { key: 'where', label: 'Where', render: (f) => html`${f.subject?.repo ?? ''}<span class="sec-sub">${f.kindLabel}${f.subject?.itemId ? ` · ${f.subject.itemId}` : ''}</span>` },
          { key: 'owner', label: 'Owner', render: (f) => f.ownerName ?? 'Nobody yet' },
          { key: 'fixBy', label: 'Fix by', render: (f) => html`<span class="${f.late ? 'sec-late' : ''}">${f.fixByText}</span>` },
          { key: 'state', label: 'State', render: (f) => statePill(f) },
        ],
      })}</section>`);
    return 0;
  });
}
