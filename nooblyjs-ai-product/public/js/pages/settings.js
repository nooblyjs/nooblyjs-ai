// Settings (product.md §5.8): the templates every portfolio's and value stream's document starts from. Anyone signed in
// reads them; an Approver changes one (a person: an agent never does). Data: GET /settings/templates. Writes:
// PUT /settings/templates/:kind { body } with If-Match.
import { html } from '/ui/js/html.js';
import { pageHead, card, button } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';

function templateView(t, ctx) {
  const preview = html`<ol class="pf-list">${t.sections.map((s) => html`<li><strong>${s.heading}</strong>${s.hint ? html` <span class="muted">· ${s.hint}</span>` : ''}</li>`)}</ol>`;
  const form = ctx.can('approve')
    ? html`<form class="pf-form" data-form="template" data-kind="${t.kind}" data-etag="${t.etag}" aria-label="Change the ${t.label.toLowerCase()} template">
        <label>Template <span class="pf-hint">Markdown. Each "## " heading is a section of the document; the text under it is the hint people see while they fill it in.</span>
          <textarea name="body" rows="14" maxlength="20000" spellcheck="true">${t.body}</textarea></label>
        <div class="actions">${button({ label: `Save the ${t.label.toLowerCase()} template`, type: 'submit' })}</div>
        <p class="muted">Documents keep what is written in them. A section you add shows empty in each one; a section you take out stays in the documents that have text in it.</p>
      </form>`
    : html`<p class="muted">An Approver can change this template.</p>`;
  return card({ title: `${t.label} template`, meta: t.text, body: html`${preview}${form}` });
}

export async function render(view, { ctx }) {
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    let templates;
    try {
      ({ templates } = await ctx.api.get('settings/templates'));
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the settings'));
      return;
    }
    if (!ctx.isCurrent()) return;
    view.innerHTML = String(html`${pageHead({
      eyebrow: 'Product Factory',
      title: 'Settings',
      lead: html`The templates that every portfolio's and value stream's document starts from. The documents are on the <a href="${hrefFor(ctx, '/portfolios')}">Portfolios</a> page.`,
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-stack">${templates.map((t) => templateView(t, ctx))}</div>`);
  }

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="template"]');
    if (!form) return;
    e.preventDefault();
    try {
      const saved = await ctx.api.put(`settings/templates/${form.dataset.kind}`, { body: form.elements.body.value }, { headers: { 'If-Match': form.dataset.etag } });
      await draw();
      say(message(), `The ${saved.label.toLowerCase()} template is saved as version ${saved.version}.`, 'success');
    } catch (err) {
      if (isAbort(err)) return;
      say(message(), err.status === 409 ? 'Someone changed this template since you opened it. Reload to see it, then make your change again.' : err.message, 'error');
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
