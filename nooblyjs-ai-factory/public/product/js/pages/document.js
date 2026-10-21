// A portfolio's or a value stream's document (product.md §5.7): its sections, from the template in Settings, each
// with its hint; where it sits (themes, value streams, products); and, for an Approver, renaming, moving and removing
// it. Data: GET /portfolios/:id or /value-streams/:id. Writes: PUT the same with If-Match (draft); PATCH and DELETE
// /catalogue/portfolios/:name or /catalogue/value-streams/:name (approve).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, listRow } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, ago } from '../lib.js';

const enc = encodeURIComponent;
const KINDS = {
  portfolio: { api: 'portfolios', catalogue: 'portfolios', label: 'Portfolio' },
  'value-stream': { api: 'value-streams', catalogue: 'value-streams', label: 'Value stream' },
  // NooblyJS Phase 17: the work hierarchy's documents (no renaming or removing yet).
  'portfolio-epic': { api: 'portfolio-epics', label: 'Portfolio epic', hierarchy: true },
  epic: { api: 'epics', label: 'Epic', hierarchy: true },
  feature: { api: 'features', label: 'Feature', hierarchy: true },
};

function sectionsView(doc) {
  return doc.sections.map((s) => html`<section class="pf-section">
    <h2 class="pf-section__title">${s.heading}</h2>
    ${s.text ? html`<p class="pf-pre">${s.text}</p>` : html`<p class="muted">Not filled in yet. ${s.hint}</p>`}
    ${s.inTemplate ? '' : html`<p class="pf-hint">No longer in the template. Empty it to remove it.</p>`}
  </section>`);
}

function editView(doc) {
  return html`<form class="card pf-form pf-edit" data-form="document" aria-label="Edit ${doc.name}">
    <h2 class="card__title">Edit ${doc.name}</h2>
    <p class="muted">The sections come from the ${doc.kindLabel.toLowerCase()} template in Settings.</p>
    ${doc.sections.map((s, i) => html`<label>${s.heading}${s.hint ? html` <span class="pf-hint">${s.hint}</span>` : ''}${s.inTemplate ? '' : html` <span class="pf-hint">No longer in the template</span>`}
      <textarea name="s${i}" rows="4" maxlength="20000">${s.text}</textarea></label>`)}
    <div class="actions">${button({ label: 'Save', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-edit' } })}</div>
  </form>`;
}

/** Where it sits, on the side: the themes, value streams and products (a value stream's portfolio too). */
function railView(doc, kind, ctx) {
  if (KINDS[kind].hierarchy) {
    return html`${card({ title: 'Where it sits', body: html`<p>${[doc.portfolio, doc.valueStream].filter(Boolean).join(' › ') || 'No portfolio'}</p>${doc.parent ? html`<p class="muted">Under <a href="${hrefFor(ctx, `/portfolio-epics/${doc.parent}`)}">${doc.parent}</a></p>` : ''}${doc.epic ? html`<p class="muted">A feature of <a href="${hrefFor(ctx, `/epics/${doc.epic}`)}">${doc.epic}</a></p>` : ''}` })}
      ${kind === 'feature' ? card({ title: 'Ideas', body: html`<p class="muted">The ideas filed under it are on the <a href="${hrefFor(ctx, `/board?feature=${doc.id}`)}">Product board</a>.</p>` }) : card({ title: 'Business case', body: html`<p><a href="${hrefFor(ctx, `/business-cases/${doc.id}`)}">Open its business case</a></p>` })}`;
  }
  const themes = card({
    title: 'Strategic themes',
    body: doc.themes.length
      ? html`<ul class="pf-links" role="list">${doc.themes.map((t) => html`<li><span class="pf-links__title">${t.name}</span>${t.description ? html`<span class="pf-links__meta">${t.description}</span>` : ''}</li>`)}</ul>`
      : html`<p class="muted">${kind === 'portfolio' ? 'This portfolio works towards no strategic theme yet.' : `${doc.portfolio} works towards no strategic theme yet.`}</p>`,
  });
  const products = (names) => card({ title: 'Products', body: names.length ? html`<p>${names.join(', ')}</p>` : html`<p class="muted">No products yet. Add them on the <a href="${hrefFor(ctx, '/board')}">Product board</a>.</p>` });
  if (kind === 'portfolio') {
    return html`${themes}${card({
      title: 'Value streams',
      body: doc.valueStreams.length
        ? html`<div class="rows">${doc.valueStreams.map((v) => listRow({ title: v.name, meta: v.text, href: hrefFor(ctx, `/value-streams/${v.id}`) }))}</div>`
        : html`<p class="muted">None. Add one on the <a href="${hrefFor(ctx, '/portfolios')}">Portfolios</a> page.</p>`,
    })}${products(doc.products.map((p) => p.name))}`;
  }
  return html`${card({ title: 'Portfolio', body: doc.portfolioId ? html`<p><a href="${hrefFor(ctx, `/portfolios/${doc.portfolioId}`)}">${doc.portfolio}</a></p>` : html`<p>${doc.portfolio ?? 'None'}</p>` })}${themes}${products(doc.products)}`;
}

/** Rename, move (a value stream) and remove: an Approver's. */
function changeView(doc, kind, portfolios) {
  return html`<form class="card pf-form" data-form="change" aria-label="Rename or remove ${doc.name}">
    <h2 class="card__title">Rename or remove</h2>
    <label>Name <input name="name" required maxlength="40" value="${doc.name}" autocomplete="off"></label>
    ${kind === 'value-stream' ? html`<label>Portfolio <span class="pf-hint">its products move with it</span><select name="portfolio">${portfolios.map((p) => html`<option${p === doc.portfolio ? html` selected` : ''}>${p}</option>`)}</select></label>` : ''}
    <div class="actions">${button({ label: 'Save', type: 'submit', small: true })}${button({ label: `Remove ${doc.name}`, kind: 'danger', small: true, attrs: { 'data-action': 'remove' } })}</div>
    <p class="muted">${kind === 'portfolio' ? 'A portfolio with products or value streams in it can\'t be removed.' : 'A value stream with products in it can\'t be removed.'} Removing it removes its document.</p>
  </form>`;
}

export async function render(view, { params, route, ctx }) {
  const kind = route.meta.kind;
  const k = KINDS[kind];
  let doc = null;
  let editing = false;
  let portfolios = [];
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    try {
      [doc, portfolios] = await Promise.all([
        ctx.api.get(`${k.api}/${enc(params.id)}`),
        ctx.can('approve') && kind === 'value-stream' ? ctx.api.get('catalogue').then((c) => c.portfolios.map((p) => p.name)) : [],
      ]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, `this ${k.label.toLowerCase()}`));
      return;
    }
    if (!ctx.isCurrent()) return;
    const behind = doc.template.madeFrom != null && doc.template.madeFrom < doc.template.version;
    const lead = doc.version
      ? `${doc.filled} of ${doc.sections.filter((s) => s.inTemplate).length} sections filled in · ${doc.text}${doc.updatedAt ? `, ${ago(doc.updatedAt)}` : ''}`
      : 'Nothing written yet.';
    view.innerHTML = String(html`${pageHead({
      eyebrow: kind === 'portfolio' ? 'Portfolio' : k.hierarchy ? `${k.label} · ${doc.id}` : `Value stream · ${doc.portfolio ?? 'no portfolio'}`,
      title: doc.name,
      lead,
      actions: ctx.can('draft') && !editing ? button({ label: 'Edit', icon: 'pen', attrs: { 'data-action': 'edit' } }) : '',
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${behind ? html`<p class="muted">The ${k.label.toLowerCase()} template has changed since this was written. New sections show empty.</p>` : ''}
      <div class="pf-columns">
        <div class="pf-body pf-stack">${editing ? editView(doc) : card({ body: html`<div class="pf-stack">${sectionsView(doc)}</div>`, label: `${doc.name} document` })}</div>
        <aside class="pf-rail pf-stack" aria-label="Where ${doc.name} sits">${railView(doc, kind, ctx)}${ctx.can('approve') && !k.hierarchy ? changeView(doc, kind, portfolios) : ''}</aside>
      </div>`);
  }

  view.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="edit"]')) {
      editing = true;
      await draw();
      view.querySelector('[data-form="document"] textarea')?.focus();
      return;
    }
    if (e.target.closest('[data-action="cancel-edit"]')) {
      editing = false;
      await draw();
      return;
    }
    if (e.target.closest('[data-action="remove"]')) {
      try {
        await ctx.api.del(`catalogue/${k.catalogue}/${enc(doc.name)}`);
        ctx.navigate('/portfolios');
      } catch (err) {
        if (!isAbort(err)) say(message(), err.message, 'error');
      }
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      if (form.dataset.form === 'document') {
        // Only the sections that changed are sent; the rest keep what is saved.
        const sections = doc.sections.map((s, i) => ({ heading: s.heading, text: data[`s${i}`] ?? '' })).filter((s, i) => s.text.trim() !== doc.sections[i].text);
        if (sections.length) await ctx.api.put(`${k.api}/${enc(doc.id)}`, { sections }, { headers: { 'If-Match': doc.etag } });
        editing = false;
        await draw();
        say(message(), sections.length ? `${doc.name} is saved as version ${doc.version}.` : 'Nothing changed.', 'success');
      } else if (form.dataset.form === 'change') {
        const body = { ...(data.name.trim() !== doc.name ? { name: data.name } : {}), ...(data.portfolio && data.portfolio !== doc.portfolio ? { portfolio: data.portfolio } : {}) };
        if (Object.keys(body).length) await ctx.api.patch(`catalogue/${k.catalogue}/${enc(doc.name)}`, body);
        await draw();
        say(message(), `${doc.name} was saved.`, 'success');
      }
    } catch (err) {
      if (isAbort(err)) return;
      say(message(), err.status === 409 && form.dataset.form === 'document' ? 'Someone saved this document since you opened it. Reload to see their changes, then make yours again.' : err.message, 'error');
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
