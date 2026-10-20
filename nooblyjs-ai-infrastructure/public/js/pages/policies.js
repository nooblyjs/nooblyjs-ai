// Policies: the rules checked on every design version and before every apply. An Owner switches them on and off.
// No mockup yet. Data: GET /policies, PUT /policies/:id.
import { html } from '/ui/js/html.js';
import { pageHead, dataTable, statusPill, button } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion } from '../lib.js';

export async function render(view, { ctx }) {
  const canChange = ctx.can('change-guardrails');
  const redraw = await reloadable(view, ctx, async () => {
    let policies;
    try {
      ({ policies } = await ctx.api.get('policies'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the policies'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Infrastructure · Govern', title: 'Policies', lead: 'Checked on every design version and before every apply. A policy that blocks refuses the approval; one that warns says so and lets the decision go ahead.' })}
      ${messageRegion()}
      <section class="card" aria-label="Policies">${dataTable({
        caption: 'Infrastructure policies',
        empty: 'No policies yet.',
        rows: policies,
        columns: [
          { key: 'label', label: 'Policy', render: (p) => p.label },
          { key: 'severity', label: 'When it fails', render: (p) => p.severityText },
          { key: 'state', label: 'State', render: (p) => statusPill({ text: p.stateText, tone: p.enabled ? 'success' : 'warning' }) },
          ...(canChange ? [{ key: 'change', label: 'Change', render: (p) => button({ label: p.enabled ? 'Switch off' : 'Switch on', kind: 'secondary', small: true, attrs: { 'data-id': p.id, 'data-enabled': String(!p.enabled), 'aria-label': `${p.enabled ? 'Switch off' : 'Switch on'}: ${p.label}` } }) }] : []),
        ],
      })}</section>
      ${canChange ? '' : html`<p class="inf-muted">Only an Owner can switch a policy on or off.</p>`}`);
    return 0;
  });

  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-enabled]');
    if (!el) return;
    const { id, enabled } = el.dataset;
    try {
      const policy = await ctx.api.put(`policies/${id}`, { enabled: enabled === 'true' });
      await redraw();
      say(view, `"${policy.label}" is now ${policy.stateText.toLowerCase()}.`, 'success');
      view.querySelector(`[data-id="${id}"]`)?.focus();
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
