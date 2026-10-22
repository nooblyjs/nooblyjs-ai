// One infrastructure design (mockup: .claude/steering/ui/noobly-infrastructure-design-from-architecture): what it is
// built from, its resources per kind of environment, the generated code, the plan, the cost estimate, the policy
// checks and the approvals, with the decision only the platform owner can take.
// Data: GET /designs/:id?kind=, POST /designs/:id/decision (If-Match), POST /designs/:id/drafts (NooblyJS Phase 26: Ines
// Tau drafts a new version from the architecture, when a person with draft asks).
import { html } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { button, card, chips, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, messageRegion } from '../lib.js';

const KINDS = new Set(['preview', 'dev', 'test', 'staging', 'production']);
const CHECK = {
  passed: { word: 'Passed', iconName: 'check', tone: 'success' },
  warning: { word: 'Warning', iconName: 'alert', tone: 'warning' },
  failed: { word: 'Failed', iconName: 'x', tone: 'danger' },
  off: { word: 'Switched off', iconName: 'clock', tone: 'neutral' },
};

const resource = (r) => html`<li class="inf-resource inf-resource--${r.state}"><span class="inf-resource__name">${r.name}</span><span class="inf-resource__detail">${r.detail}</span><span class="visually-hidden">${r.stateLabel}</span></li>`;

const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export async function render(view, { params, query, ctx }) {
  let kind = KINDS.has(query.get('kind')) ? query.get('kind') : 'test';
  let asking = false;

  const redraw = await reloadable(view, ctx, async () => {
    let d;
    try {
      d = await ctx.api.get(`designs/${encodeURIComponent(params.id)}`, { query: { kind } });
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, `design ${params.id}`));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    ctx.setTitle?.(`${d.id} · Design`);
    // The team chat panel shows the thread of the item this design was built for.
    if (d.itemId) ctx.chat?.scope?.({ kind: 'item', id: d.itemId });
    view.dataset.etag = d.etag;

    view.innerHTML = String(html`<nav class="inf-crumbs" aria-label="Breadcrumb"><a href="${hrefFor(ctx, '/environments')}">Infrastructure</a><span aria-hidden="true">/</span><a href="${hrefFor(ctx, '/designs')}">Designs</a><span aria-hidden="true">/</span><span class="inf-mono" aria-current="page">${d.id}</span></nav>
    <header class="page-head">
      <div class="page-head__text">
        <h1 class="page-title inf-title">${d.title}</h1>
        <p class="inf-meta"><span class="pill inf-mono">${d.id} · v${d.version}</span>${statusPill({ text: d.statusText, tone: d.tone, dot: false })}<span class="inf-muted">${d.draftedText}</span></p>
      </div>
      <div class="actions">
        ${ctx.can('draft') && d.itemId ? button({ label: 'Ask Ines for a new draft', kind: 'secondary', attrs: { 'data-action': 'redraft', 'aria-label': `Ask Ines Tau for a new draft of ${d.id} from the architecture` } }) : ''}
        ${d.decision.canRequestChanges ? button({ label: 'Request changes', kind: 'secondary', attrs: { 'data-action': 'ask' } }) : ''}
        ${button({ label: d.decision.label, disabled: !d.decision.allowed, attrs: { 'data-action': 'approve' } })}
      </div>
    </header>
    ${d.decision.allowed ? '' : html`<p class="inf-muted inf-why">${d.decision.reason}</p>`}
    ${d.redraft ? html`<p class="inf-why" role="note">${icon('info', { size: 16 })} ${d.redraft.text} Nothing drafts by itself: ask Ines when you want one.</p>` : ''}
    ${messageRegion()}
    <form class="card inf-form" data-form="changes"${asking ? '' : html` hidden`}>
      <label>What should change?<textarea name="comment" rows="3" required maxlength="2000"></textarea></label>
      <div class="actions">${button({ label: 'Send back to the agent', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-ask' } })}</div>
    </form>
    <section class="inf-built" aria-label="Built from">
      <span class="inf-muted">Built from</span>
      ${d.builtFrom.map((b) => html`<a class="inf-chip" href="${b.href}">${b.label}</a>`)}
      ${d.blueprint ? html`<span class="inf-chip inf-chip--plain">Blueprint · ${d.blueprint.name} v${d.blueprint.version}</span>` : ''}
    </section>
    <div class="inf-split">
      <div class="inf-split__main inf-stack">
        <section class="card" aria-label="Resources">
          <div class="card__head"><h2 class="card__title">Resources</h2>${chips({ label: 'Environment', name: 'kind', small: true, current: kind, items: d.kinds.map((k) => ({ value: k.kind, label: k.label })) })}</div>
          <ul class="inf-legend" aria-label="Legend"><li><span class="inf-swatch inf-swatch--new" aria-hidden="true"></span>New</li><li><span class="inf-swatch inf-swatch--changed" aria-hidden="true"></span>Changed</li><li><span class="inf-swatch inf-swatch--existing" aria-hidden="true"></span>Existing, shared</li></ul>
          <dl class="inf-layers">${d.layers.map((layer) => html`<dt>${layer.label}</dt><dd><ul class="inf-resources">${layer.resources.map(resource)}</ul></dd>`)}</dl>
        </section>
        <section class="card inf-code" aria-label="Infrastructure code">
          <div class="card__head"><h2 class="card__title">Infrastructure code · <span class="inf-mono">${d.code.path}</span></h2>${d.code.pullRequest ? html`<span class="card__meta">Pull request #${d.code.pullRequest}${d.code.repo ? html` · ${d.code.repo}` : ''}</span>` : html`<span class="card__meta">No pull request yet</span>`}</div>
          <pre tabindex="0" aria-label="Generated infrastructure code"><code>${d.code.text || '# This design uses no blueprints yet.'}</code></pre>
        </section>
      </div>
      <div class="inf-split__side">
        ${card({ title: `Plan for ${d.kindLabel}`, body: html`<ul class="inf-plan">
          <li class="inf-plan__n inf-plan__n--add"><strong>+${d.plan.add}</strong><span>to add</span></li>
          <li class="inf-plan__n inf-plan__n--change"><strong>~${d.plan.change}</strong><span>to change</span></li>
          <li class="inf-plan__n"><strong>${d.plan.destroy}</strong><span>to destroy</span></li></ul>` })}
        ${card({ title: 'Estimated cost per day', body: html`<ul class="inf-costs">${d.costEstimate.map((c) => html`<li${c.current ? html` class="inf-costs__current" aria-current="true"` : ''}><span>${c.label}</span><span class="inf-mono">${c.text}</span></li>`)}</ul>` })}
        ${card({ title: 'Policy checks', body: html`<ul class="inf-checks">${d.policyChecks.map((c) => html`<li class="inf-tone--${CHECK[c.result].tone}">${icon(CHECK[c.result].iconName, { size: 16, stroke: 2.2 })}<span class="visually-hidden">${CHECK[c.result].word}: </span><span>${c.text}</span></li>`)}</ul>` })}
        ${card({ title: 'Approvals', body: html`<ul class="inf-approvals">${d.approvals.map((a) => html`<li><span class="avatar avatar--small" aria-hidden="true">${initials(a.name ?? a.role)}</span><span class="inf-approvals__who">${a.name ? `${a.name} · ${a.role}` : a.role}</span>${statusPill({ text: a.stateText, tone: a.tone, dot: false })}</li>`)}</ul><p class="inf-note">${d.applyNote}</p>` })}
      </div>
    </div>`);
    return 0;
  });

  view.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-kind]');
    if (chip) {
      kind = chip.dataset.kind;
      await redraw();
      view.querySelector(`[data-kind="${kind}"]`)?.focus();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'ask' || action === 'cancel-ask') {
      asking = action === 'ask';
      const form = view.querySelector('[data-form="changes"]');
      form.hidden = !asking;
      if (asking) form.querySelector('textarea').focus();
    }
    if (action === 'redraft') {
      try {
        const r = await ctx.api.post(`designs/${encodeURIComponent(params.id)}/drafts`, {});
        await redraw();
        say(view, r.text, 'success');
      } catch (err) {
        if (!isAbort(err)) say(view, err.message, 'error');
      }
      return;
    }
    if (action === 'approve') decide({ decision: 'approve', kind }, (r) => `Approved. ${r.runs.length} run${r.runs.length === 1 ? ' has' : 's have'} started: ${r.runs.map((run) => run.environment).join(', ') || 'no environment of this kind exists yet'}.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form="changes"]')) return;
    e.preventDefault();
    asking = false;
    decide({ decision: 'request-changes', comment: new FormData(e.target).get('comment') }, () => 'Sent back with your comment.');
  }, { signal: ctx.signal });

  async function decide(body, done) {
    try {
      const result = await ctx.api.post(`designs/${encodeURIComponent(params.id)}/decision`, body, { headers: { 'If-Match': view.dataset.etag } });
      await redraw();
      say(view, done(result), 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  }
}
