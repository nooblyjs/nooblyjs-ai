// One provisioning run (roadmap I5): what it applies where, the plan, who asked and who approved, how far it is,
// and its log. A run in progress can be cancelled by whoever could have started it. No mockup yet.
// Data: GET /runs/:id, POST /runs/:id/cancel.
import { html } from '/ui/js/html.js';
import { pageHead, button, card, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, messageRegion, progressBar, REFRESH_MS } from '../lib.js';

const time = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export async function render(view, { params, ctx }) {
  const redraw = await reloadable(view, ctx, async () => {
    let run;
    try {
      run = await ctx.api.get(`runs/${encodeURIComponent(params.id)}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, `the run ${params.id}`));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    ctx.setTitle?.(`Run on ${run.environment}`);
    const said = view.querySelector('[data-message]')?.textContent ?? '';
    view.innerHTML = String(html`<nav class="inf-crumbs" aria-label="Breadcrumb"><a href="${hrefFor(ctx, '/environments')}">Infrastructure</a><span aria-hidden="true">/</span><a href="${hrefFor(ctx, '/runs')}">Provisioning runs</a><span aria-hidden="true">/</span><span class="inf-mono" aria-current="page">${run.id}</span></nav>
    ${pageHead({
      title: `Run on ${run.environment}`,
      lead: run.reason,
      actions: run.cancellable && ctx.can('draft') ? button({ label: 'Cancel run', kind: 'danger', attrs: { 'data-action': 'cancel' } }) : '',
    })}
    <p class="inf-meta">${run.status === 'running' ? progressBar(run.statusText, run.progress) : statusPill({ text: run.statusText, tone: run.tone })}<span class="inf-muted">${run.when}</span></p>
    ${messageRegion()}
    <div class="inf-split">
      <div class="inf-split__main inf-stack">
        <section class="card" aria-labelledby="run-log">
          <div class="card__head"><h2 class="card__title" id="run-log">Log</h2><span class="card__meta">${run.log.length} line${run.log.length === 1 ? '' : 's'}</span></div>
          <ol class="inf-log" tabindex="0" aria-label="Run log">${run.log.map((l) => html`<li><time class="inf-mono" datetime="${l.at}">${time(l.at)}</time><span>${l.text}</span></li>`)}</ol>
        </section>
      </div>
      <div class="inf-split__side inf-stack">
        ${card({ title: 'What it applies', body: html`<dl class="inf-facts">
          <dt>Environment</dt><dd><a class="inf-mono" href="${run.href}">${run.environment}</a></dd>
          <dt>Design</dt><dd><a class="inf-mono" href="${hrefFor(ctx, `/designs/${run.designId}`)}">${run.designId} v${run.designVersion}</a></dd>
          <dt>Plan</dt><dd>${run.planText || '—'}</dd>
        </dl>` })}
        ${card({ title: 'Who', body: html`<dl class="inf-facts">
          <dt>Started by</dt><dd>${run.requestedBy?.name ?? 'NooblyJS'}${run.requestedBy?.kind === 'agent' ? ' (agent)' : ''}</dd>
          <dt>Approved by</dt><dd>${run.approvedBy?.name ?? 'No approval needed for this kind'}</dd>
        </dl>` })}
      </div>
    </div>`);
    if (said) say(view, said, 'success');
    return run.cancellable ? REFRESH_MS : 0;
  });

  view.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="cancel"]')) return;
    try {
      const { run } = await ctx.api.post(`runs/${encodeURIComponent(params.id)}/cancel`);
      await redraw();
      say(view, run.status === 'cancelled' ? 'The run is cancelled.' : 'Asked to stop. It ends at its next step.', 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
