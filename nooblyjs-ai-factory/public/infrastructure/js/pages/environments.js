// Environments (mockup: .claude/steering/ui/noobly-infrastructure-environments): the promotion path, every environment,
// what needs attention, the infrastructure agent and cost by kind.
// Data: GET /environments, /promotion-paths/slots, /drift, /summary, /designs.
import { html } from '/ui/js/html.js';
import { pageHead, button, card, dataTable, statusPill, meter } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, messageRegion, kindPill, toned, progressBar, REFRESH_MS } from '../lib.js';

const PRODUCT = 'slots';

const tile = (t) => {
  const body = html`<span class="inf-tile__kind">${t.label}</span><span class="inf-tile__value">${t.value}</span><span class="inf-tile__line inf-tone--${t.line.tone}">${t.line.text}</span>`;
  const cls = `inf-tile inf-tile--${t.kind}`;
  return t.href ? html`<li><a class="${cls}" href="${t.href}">${body}</a></li>` : html`<li><div class="${cls}">${body}</div></li>`;
};

const attention = (d, ctx) => html`<section class="card inf-attention" aria-label="Needs attention">
  ${statusPill({ text: `Drift · ${d.environment}`, tone: 'warning', dot: false })}
  <p class="inf-attention__text">${d.detail}</p>
  ${d.status === 'open' && ctx.can('draft')
    ? html`<div class="actions">${button({ label: 'Restore from design', small: true, attrs: { 'data-action': 'restore', 'data-id': d.id } })}${button({ label: 'Keep and update design', kind: 'secondary', small: true, attrs: { 'data-action': 'keep', 'data-id': d.id } })}</div>`
    : html`<p class="inf-muted">${d.statusText}</p>`}
</section>`;

const newForm = (designs) => html`<form class="card inf-form" data-form="new" hidden>
  <h2 class="card__title">New environment</h2>
  <p class="inf-muted">Preview and Dev are provisioned at once. Test and Staging need a design version approved for them. Production only changes through a release.</p>
  <div class="inf-form__row">
    <label>Design<select name="designId" required>${designs.map((d) => html`<option value="${d.id}">${d.id} · ${d.title}</option>`)}</select></label>
    <label>Kind<select name="kind" required><option value="preview">Preview</option><option value="dev">Dev</option><option value="test">Test</option><option value="staging">Staging</option></select></label>
    <label>Name<input name="name" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" maxlength="48" placeholder="test-slots-2" autocomplete="off"></label>
  </div>
  <div class="actions">${button({ label: 'Create and provision', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-new' } })}</div>
</form>`;

export async function render(view, { ctx }) {
  let formOpen = false;

  const redraw = await reloadable(view, ctx, async () => {
    let environments;
    let path;
    let drift;
    let summary;
    let designs;
    try {
      [{ environments }, path, { drift }, summary, { designs }] = await Promise.all([
        ctx.api.get('environments'), ctx.api.get(`promotion-paths/${PRODUCT}`), ctx.api.get('drift'), ctx.api.get('summary'), ctx.api.get('designs'),
      ]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the environments'));
      return 0;
    }
    if (!ctx.isCurrent() || formOpen) return formOpen ? REFRESH_MS : 0;
    const { agent, spend } = summary;

    view.innerHTML = String(html`${pageHead({
      eyebrow: 'NooblyJS · Infrastructure',
      title: 'Environments',
      lead: 'Where the Software Factory deploys, and where tests run against real infrastructure. Every environment is built from an approved design.',
      actions: html`${button({ label: 'Designs', kind: 'secondary', href: hrefFor(ctx, '/designs') })}${ctx.can('draft') ? button({ label: 'New environment', icon: 'plus', attrs: { 'data-action': 'new' } }) : ''}`,
    })}
    ${messageRegion()}
    ${newForm(designs)}
    <section class="card" aria-label="Promotion path">
      <div class="card__head"><h2 class="card__title">Promotion path · ${path.label}</h2><span class="card__meta">${path.note}</span></div>
      <ol class="inf-path">${path.tiles.map(tile)}</ol>
    </section>
    <div class="inf-split">
      <section class="card inf-split__main" aria-label="Environments">
        <div class="card__head"><h2 class="card__title">All environments</h2><span class="card__meta">${environments.length} in all</span></div>
        ${dataTable({
          caption: 'All environments',
          empty: 'No environments yet. Create one from an approved design.',
          rows: environments,
          columns: [
            { key: 'name', label: 'Environment', render: (e) => html`<a class="inf-mono inf-env" href="${e.href}">${e.name}</a><span class="inf-sub inf-tone--${e.note.tone}">${e.note.text}</span>` },
            { key: 'kind', label: 'Kind', render: (e) => kindPill(e) },
            { key: 'deployed', label: 'Deployed', render: (e) => (e.status === 'provisioning' ? progressBar(e.deployed, e.progress) : e.deployed) },
            { key: 'tests', label: 'Tests here', render: (e) => toned(e.tests.text, e.tests.tone) },
            { key: 'cost', label: 'Cost / day', numeric: true, render: (e) => html`<span class="inf-mono">${e.costText}</span>` },
          ],
        })}
      </section>
      <div class="inf-split__side">
        ${drift.map((d) => attention(d, ctx))}
        ${agent ? html`<section class="card inf-agent" aria-label="Infrastructure agent">
          <div class="inf-agent__head"><span class="avatar avatar--agent" aria-hidden="true">${agent.initials}</span><div><p class="inf-agent__name">${agent.name} · ${agent.role}</p><p class="inf-agent__work">${agent.working}</p></div></div>
          <p class="inf-agent__about">${agent.about}</p>
        </section>` : ''}
        ${card({
          title: `Cost by kind · ${spend.monthName}`,
          meta: spend.text,
          body: spend.byKind.length
            ? html`<div class="inf-stack">${spend.byKind.map((k) => meter({ label: k.label, value: k.text, ratio: k.ratio }))}</div>`
            : html`<p class="inf-muted">Nothing has been spent this month.</p>`,
        })}
      </div>
    </div>`);
    return environments.some((e) => e.status === 'provisioning') ? REFRESH_MS : 0;
  });

  const form = () => view.querySelector('[data-form="new"]');
  const act = async (label, request, done) => {
    try {
      const result = await request();
      await redraw();
      say(view, done(result), 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, `${label}: ${err.message}`, 'error');
    }
  };

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'new' || action === 'cancel-new') {
      formOpen = action === 'new';
      if (form()) form().hidden = !formOpen;
      if (formOpen) form().querySelector('select').focus();
      else redraw();
    }
    if (action === 'restore') act("Couldn't restore", () => ctx.api.post(`drift/${id}/restore`), (r) => `Restoring ${r.drift.environment} from the design. The run has started.`);
    if (action === 'keep') act("Couldn't keep the change", () => ctx.api.post(`drift/${id}/keep`), (r) => `Kept. Design ${r.design.id} is now at v${r.design.version} and waits for approval.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form="new"]')) return;
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    formOpen = false;
    act("Couldn't create the environment", () => ctx.api.post('environments', body), (r) => `${r.environment.name} is being provisioned.`);
  }, { signal: ctx.signal });
}
