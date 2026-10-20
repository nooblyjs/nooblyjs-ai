// One environment: what is deployed, the tests that ran here, the design it was built from, drift, and its runs.
// There is no mockup for this screen yet (the mockups link it as Infra-EnvDetail); it follows the other two.
// Data: GET /environments/:name, POST /environments/:name/drift-check, POST /drift/:id/restore|keep.
import { html } from '/ui/js/html.js';
import { pageHead, button, card, dataTable, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, messageRegion, kindPill, toned, progressBar, REFRESH_MS } from '../lib.js';

const suite = (s) => html`<li><span class="inf-suite__name">${s.suite}</span>${toned(s.total > 1 ? `${s.passed} of ${s.total} passed` : s.ok ? 'Passed' : 'Failed', s.ok ? 'success' : 'warning')}
  ${s.failing.length ? html`<ul class="inf-suite__failing">${s.failing.map((name) => html`<li>Failing: ${name}</li>`)}</ul>` : ''}</li>`;

export async function render(view, { params, ctx }) {
  const redraw = await reloadable(view, ctx, async () => {
    // A live refresh would close the Destroy form and lose what was typed: wait until it is closed.
    if (view.querySelector('[data-form="destroy"]:not([hidden])')) return REFRESH_MS;
    let env;
    try {
      env = await ctx.api.get(`environments/${encodeURIComponent(params.name)}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, `the environment ${params.name}`));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    ctx.setTitle?.(`${env.name} · Environment`);
    const provisioning = env.status === 'provisioning';

    view.innerHTML = String(html`<nav class="inf-crumbs" aria-label="Breadcrumb"><a href="${hrefFor(ctx, '/environments')}">Infrastructure</a><span aria-hidden="true">/</span><a href="${hrefFor(ctx, '/environments')}">Environments</a><span aria-hidden="true">/</span><span class="inf-mono" aria-current="page">${env.name}</span></nav>
    ${pageHead({
      title: env.name,
      lead: env.note.text,
      actions: ctx.can('draft') && !provisioning ? html`${button({ label: 'Check for drift', kind: 'secondary', icon: 'refresh', attrs: { 'data-action': 'check' } })}${env.kind === 'production' ? '' : button({ label: 'Destroy', kind: 'danger', icon: 'trash', attrs: { 'data-action': 'ask-destroy' } })}` : '',
    })}
    <p class="inf-meta">${kindPill(env)}${provisioning ? progressBar(env.statusText, env.progress) : statusPill({ text: env.statusText, tone: 'success' })}<span class="inf-muted">Cost per day <span class="inf-mono">${env.costText}</span></span></p>
    ${messageRegion()}
    <form class="card inf-form" data-form="destroy" hidden aria-label="Destroy ${env.name}">
      <strong>Destroy ${env.name}?</strong>
      <p class="inf-muted">Everything in it is removed and its cost stops. ${env.kind === 'preview' || env.kind === 'dev' ? 'A reason is optional for this kind.' : 'A Test or Staging environment needs the platform owner and a reason.'}</p>
      <label class="inf-field">Why? (kept in the audit log)<textarea name="reason" rows="2" maxlength="500"></textarea></label>
      <div class="actions">${button({ label: `Destroy ${env.name}`, kind: 'danger', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-destroy' } })}</div>
    </form>
    ${env.drift ? html`<section class="card inf-attention" aria-label="Needs attention">
      ${statusPill({ text: 'Drift', tone: 'warning', dot: false })}
      <p class="inf-attention__text">${env.drift.detail}</p>
      ${ctx.can('draft') && !provisioning ? html`<div class="actions">${button({ label: 'Restore from design', small: true, attrs: { 'data-action': 'restore', 'data-id': env.drift.id } })}${button({ label: 'Keep and update design', kind: 'secondary', small: true, attrs: { 'data-action': 'keep', 'data-id': env.drift.id } })}</div>` : ''}
    </section>` : ''}
    <div class="inf-split">
      <div class="inf-split__main inf-stack">
        ${card({ title: 'Tests here', meta: env.tests.text, body: env.tests.suites.length ? html`<ul class="inf-suites">${env.tests.suites.map(suite)}</ul>` : html`<p class="inf-muted">${env.tests.text}</p>` })}
        <section class="card" aria-label="Provisioning runs">
          <div class="card__head"><h2 class="card__title">Provisioning runs</h2></div>
          ${dataTable({
            caption: `Provisioning runs for ${env.name}`,
            empty: 'No runs recorded for this environment.',
            rows: env.runs,
            columns: [
              { key: 'reason', label: 'Why', render: (r) => r.reason },
              { key: 'design', label: 'Design', render: (r) => html`<span class="inf-mono">${r.designId} v${r.designVersion}</span>` },
              { key: 'status', label: 'Status', render: (r) => (r.status === 'running' ? progressBar(r.statusText, r.progress) : statusPill({ text: r.statusText, tone: r.tone })) },
              { key: 'when', label: 'When', render: (r) => r.when },
              { key: 'open', label: 'Run', render: (r) => html`<a href="${r.runHref}">Plan and log<span class="visually-hidden"> of the run ${r.when}</span></a>` },
            ],
          })}
        </section>
      </div>
      <div class="inf-split__side">
        ${card({ title: 'Deployed', body: env.deployedServices.length
          ? html`<ul class="inf-costs">${env.deployedServices.map((s) => html`<li><span>${s.service}</span><span class="inf-mono">${s.version}</span></li>`)}</ul>`
          : html`<p class="inf-muted">${env.deployed}</p>` })}
        ${card({ title: 'Built from', body: env.design
          ? html`<p><a href="${env.design.href}"><span class="inf-mono">${env.design.id}</span> · ${env.design.title}</a></p><p class="inf-muted">Running version ${env.design.version}.${env.design.behind ? html` Version ${env.design.latestVersion} of the design exists and has not been applied here.` : ' That is the latest version.'}</p>`
          : html`<p class="inf-muted">This environment is not linked to a design.</p>` })}
      </div>
    </div>`);
    return provisioning ? REFRESH_MS : 0;
  });

  view.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    const destroyForm = view.querySelector('[data-form="destroy"]');
    if (action === 'ask-destroy') {
      destroyForm.hidden = false;
      destroyForm.querySelector('textarea').focus();
      return;
    }
    if (action === 'cancel-destroy') {
      destroyForm.hidden = true;
      return;
    }
    const steps = {
      check: [() => ctx.api.post(`environments/${encodeURIComponent(params.name)}/drift-check`), (r) => (r.found.length ? `Found ${r.found.length} new difference${r.found.length === 1 ? '' : 's'} from the design.` : r.open ? 'Nothing new. The drift already listed is still open.' : 'No drift: this environment matches its design.')],
      restore: [() => ctx.api.post(`drift/${id}/restore`), () => 'Restoring from the design. The run has started.'],
      keep: [() => ctx.api.post(`drift/${id}/keep`), (r) => `Kept. Design ${r.design.id} is now at v${r.design.version} and waits for approval.`],
    }[action];
    if (!steps) return;
    try {
      const result = await steps[0]();
      await redraw();
      say(view, steps[1](result), 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="destroy"]');
    if (!form) return;
    e.preventDefault();
    try {
      await ctx.api.post(`environments/${encodeURIComponent(params.name)}/destroy`, { reason: new FormData(form).get('reason') });
      ctx.navigate('/environments');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }, { signal: ctx.signal });
}
