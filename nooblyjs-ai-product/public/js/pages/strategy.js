// Portfolios (product.md §5.7): the strategic themes; each portfolio with the themes it works towards, its value
// streams and its products; and links to each portfolio's and value stream's document. Since NooblyJS Phase 17, each
// portfolio's work hierarchy too: its portfolio epics, epics and features, each with its document and (an epic) its
// business case, and forms to add them (draft). Since CHG-010 the products are set up here too, in their value streams
// (they were in a panel on the Product board): add one (draft), press one to say where it is built (draft) or to rename,
// move or remove it (approve); an Approver renames or removes a portfolio the same way (pages/portfolios.js).
// Data: GET /catalogue, /hierarchy; POST /catalogue/epics, /catalogue/features.
// Writes: POST /catalogue/themes, /catalogue/portfolios, /catalogue/value-streams, /catalogue/products (draft); PATCH
// and DELETE /catalogue/themes/:name, /catalogue/portfolios/:name, /catalogue/products/:name (approve).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, listRow } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';
import { catalogueLabel, productAdder, labelEditForm, wirePortfolios } from './portfolios.js';

const enc = encodeURIComponent;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listed = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** A text box with an Add button, sent on Enter too. */
const adder = (key, placeholder, label = 'Add') => html`<div class="pf-adder"><span class="pf-label-add"><input data-new="${key}" maxlength="40" autocomplete="off" placeholder="${placeholder}" aria-label="${placeholder}">${button({ label, kind: 'secondary', small: true, attrs: { 'data-add': key } })}</span></div>`;

function themesView(c, ctx, editing) {
  const canAdd = ctx.can('draft');
  const canChange = ctx.can('approve');
  const row = (t) => {
    if (editing === t.name) {
      return html`<form class="pf-form pf-edit" data-form="theme" data-name="${t.name}" aria-label="Change ${t.name}">
        <label>Name <input name="name" required maxlength="40" value="${t.name}" autocomplete="off"></label>
        <label>What it means <span class="pf-hint">one line, at most 300 characters</span><input name="description" maxlength="300" value="${t.description ?? ''}" autocomplete="off"></label>
        <div class="actions">${button({ label: 'Save', type: 'submit', small: true })}${button({ label: `Remove ${t.name}`, kind: 'danger', small: true, attrs: { 'data-action': 'remove-theme', 'data-name': t.name } })}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel' } })}</div>
        <p class="muted">A theme a portfolio works towards can't be removed. Unlink it from the portfolio first.</p>
      </form>`;
    }
    const meta = [t.description, t.portfolios.length ? `${listed(t.portfolios)} ${t.portfolios.length === 1 ? 'works' : 'work'} towards it` : 'No portfolio works towards it yet'].filter(Boolean).join(' · ');
    return listRow({ title: t.name, meta, action: canChange ? button({ label: 'Change', kind: 'secondary', small: true, attrs: { 'data-action': 'edit-theme', 'data-name': t.name, 'aria-label': `Change ${t.name}` } }) : '' });
  };
  return card({
    title: 'Strategic themes',
    meta: plural(c.themes.length, 'theme'),
    body: html`<p class="muted">What the whole company is aiming for. Each portfolio works towards one or more of them.</p>
      ${c.themes.length ? html`<div class="rows">${c.themes.map(row)}</div>` : html`<p class="muted">No strategic themes yet.</p>`}
      ${canAdd ? html`<form class="pf-form pf-form--inline" data-form="new-theme" aria-label="Add a strategic theme">
        <div class="pf-form__row"><label>Theme <input name="name" required maxlength="40" autocomplete="off" placeholder="Leverage AI"></label>
        <label>What it means<input name="description" maxlength="300" autocomplete="off" aria-describedby="pf-theme-hint"><span class="pf-hint" id="pf-theme-hint">optional</span></label></div>
        <div class="actions">${button({ label: 'Add theme', type: 'submit', small: true })}</div>
      </form>` : ''}`,
  });
}

function portfolioView(p, c, ctx, editingThemes, editing) {
  const canChange = ctx.can('approve');
  const canAdd = ctx.can('draft');
  const looseProducts = p.products.filter((x) => !x.valueStream || !p.valueStreams.some((v) => v.name === x.valueStream));
  // The label being changed is this portfolio, or one of its products: its form shows in this card.
  const editingHere = editing && (editing.kind === 'portfolio' ? editing.name === p.name : p.products.some((x) => x.name === editing.name));
  const productRow = (list, valueStream) => html`<div class="pf-labels__row">${list.length ? list.map((x) => catalogueLabel('product', x, ctx, editing)) : html`<span class="muted">No products yet.</span>`}${canAdd ? productAdder(p.name, valueStream) : ''}</div>`;
  const themes = editingThemes
    ? html`<fieldset class="pf-labels" data-themes-of="${p.name}"><legend>Strategic themes <span class="muted">press the ones ${p.name} works towards</span></legend>
        <div class="pf-labels__row">${c.themes.map((t) => html`<button type="button" class="pf-chip pf-label${p.themes.includes(t.name) ? ' pf-chip--on' : ''}" data-pick-theme="${t.name}" aria-pressed="${p.themes.includes(t.name) ? 'true' : 'false'}">${t.name}</button>`)}</div>
        <div class="actions">${button({ label: 'Save themes', small: true, attrs: { 'data-action': 'save-themes', 'data-portfolio': p.name } })}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel' } })}</div>
      </fieldset>`
    : html`<p class="pf-portfolio__name">Works towards: <span class="muted">${p.themes.length ? listed(p.themes) : 'no strategic theme yet'}</span>
        ${canChange && c.themes.length ? button({ label: 'Change themes', kind: 'secondary', small: true, attrs: { 'data-action': 'edit-themes', 'data-portfolio': p.name, 'aria-label': `Change the themes ${p.name} works towards` } }) : ''}</p>`;
  return html`<section class="card pf-stack" aria-labelledby="pf-p-${p.id}">
    <div class="card__head"><h2 class="card__title" id="pf-p-${p.id}"><a href="${hrefFor(ctx, `/portfolios/${p.id}`)}">${p.name}</a></h2>
      <span class="card__meta">${plural(p.valueStreams.length, 'value stream')} · ${plural(p.products.length, 'product')}${canChange ? html` ${button({ label: 'Rename or remove', kind: 'secondary', small: true, attrs: { 'data-edit': 'portfolio', 'data-value': p.name, 'aria-expanded': editing?.kind === 'portfolio' && editing.name === p.name ? 'true' : 'false', 'aria-label': `Rename or remove ${p.name}` } })}` : ''}</span></div>
    ${themes}
    ${p.valueStreams.map((v) => html`<div class="pf-stream" aria-label="${v.name}">
      <h3 class="pf-stream__name"><a href="${hrefFor(ctx, `/value-streams/${v.id}`)}">${v.name}</a> <span class="muted">value stream · ${plural(v.products.length, 'product')}</span></h3>
      ${productRow(p.products.filter((x) => x.valueStream === v.name), v.name)}
    </div>`)}
    ${p.valueStreams.length ? '' : html`<p class="muted">No value streams. A portfolio can have none.</p>`}
    ${looseProducts.length || !p.valueStreams.length ? html`<div class="pf-stream" aria-label="${p.name}'s products in no value stream">
      <h3 class="pf-stream__name">${p.valueStreams.length ? 'In no value stream' : 'Products'}</h3>
      ${productRow(looseProducts, null)}
    </div>` : ''}
    ${editingHere ? labelEditForm(c, ctx, editing) : ''}
    ${canAdd ? adder(`vs:${p.name}`, `Add a value stream to ${p.name}`) : ''}
    ${canChange || canAdd ? html`<p class="muted">${canChange ? 'Press a product to rename it, move it to another value stream or portfolio, remove it, or say where it is built.' : 'Press a product to say where it is built.'}</p>` : ''}
  </section>`;
}

/** NooblyJS Phase 17: a portfolio's work, epics above their features, and the forms that add them. */
function workView(p, h, ctx) {
  const epics = h.epics.filter((e) => e.portfolio === p.name);
  const pes = epics.filter((e) => e.kind === 'portfolio-epic');
  const featureRow = (id) => {
    const f = h.features.find((x) => x.id === id);
    return f ? listRow({ title: `${f.id} · ${f.name}`, meta: 'Feature', href: hrefFor(ctx, `/features/${f.id}`) }) : '';
  };
  const epicRow = (e) => html`${listRow({ title: `${e.id} · ${e.name}`, meta: [e.kindLabel, e.valueStream, e.parent ? `under ${e.parent}` : null].filter(Boolean).join(' · '), href: hrefFor(ctx, `/${e.kind === 'epic' ? 'epics' : 'portfolio-epics'}/${e.id}`),
    action: button({ label: 'Business case', kind: 'secondary', small: true, href: hrefFor(ctx, `/business-cases/${e.id}`) }) })}
    ${e.features.length ? html`<div class="rows pf-indent">${e.features.map(featureRow)}</div>` : ''}`;
  const forms = ctx.can('draft') ? html`<form class="pf-form pf-form--inline" data-form="new-epic" data-portfolio="${p.name}" aria-label="Add an epic to ${p.name}">
      <div class="pf-form__row"><label>Epic <input name="name" required maxlength="40" autocomplete="off" placeholder="Same-day everything"></label>
      <label>Kind <select name="kind"><option value="epic">Epic</option><option value="portfolio-epic">Portfolio epic</option></select></label>
      <label>Value stream <select name="valueStream"><option value="">None</option>${p.valueStreams.map((v) => html`<option>${v.name}</option>`)}</select></label>
      ${pes.length ? html`<label>Under <select name="parent"><option value="">The portfolio</option>${pes.map((e) => html`<option value="${e.id}">${e.id} · ${e.name}</option>`)}</select></label>` : ''}</div>
      <div class="actions">${button({ label: 'Add epic', type: 'submit', small: true })}</div></form>
    ${epics.some((e) => e.kind === 'epic') ? html`<form class="pf-form pf-form--inline" data-form="new-feature" aria-label="Add a feature in ${p.name}">
      <div class="pf-form__row"><label>Feature <input name="name" required maxlength="40" autocomplete="off" placeholder="See capacity by store"></label>
      <label>Epic <select name="epic">${epics.filter((e) => e.kind === 'epic').map((e) => html`<option value="${e.id}">${e.id} · ${e.name}</option>`)}</select></label></div>
      <div class="actions">${button({ label: 'Add feature', type: 'submit', small: true })}</div></form>` : ''}` : '';
  return html`<div class="pf-stack" aria-label="${p.name}'s work"><h3 class="card__title card__title--small">Work: portfolio epics, epics and features</h3>
    ${epics.length ? html`<div class="rows">${[...pes, ...epics.filter((e) => e.kind === 'epic' && !e.parent), ...epics.filter((e) => e.kind === 'epic' && e.parent)].map(epicRow)}</div>` : html`<p class="muted">No epics yet. An idea sits under a feature, a feature under an epic.</p>`}
    ${forms}</div>`;
}

export async function render(view, { ctx }) {
  let catalogue = null;
  let hierarchy = { epics: [], features: [] };
  let editingTheme = null;    // the theme an Approver is changing
  let editingThemesOf = null; // the portfolio whose themes an Approver is choosing
  const labels = { editing: null }; // the portfolio or product whose form is open (pages/portfolios.js)
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    try {
      [catalogue, hierarchy] = await Promise.all([ctx.api.get('catalogue'), ctx.api.get('hierarchy').catch(() => ({ epics: [], features: [] }))]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the portfolios'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const c = catalogue;
    view.innerHTML = String(html`${pageHead({
      eyebrow: 'Product Factory · Strategy',
      title: 'Portfolios',
      lead: 'Strategic themes, the portfolios that work towards them, and their value streams. Open one to read or fill in its document.',
      actions: button({ label: 'Templates', kind: 'secondary', icon: 'settings', href: hrefFor(ctx, '/settings') }),
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${themesView(c, ctx, editingTheme)}
      ${c.portfolios.map((p) => html`${portfolioView(p, c, ctx, editingThemesOf === p.name, labels.editing)}${card({ body: workView(p, hierarchy, ctx), label: `${p.name}'s work` })}`)}
      ${c.unfiled.length ? card({ title: 'Products in no portfolio', body: html`<div class="pf-labels__row">${c.unfiled.map((x) => catalogueLabel('product', x, ctx, labels.editing))}</div>${labels.editing?.kind === 'product' && c.unfiled.some((x) => x.name === labels.editing.name) ? labelEditForm(c, ctx, labels.editing) : ''}<p class="muted">${ctx.can('approve') ? 'Press a product to put it in a portfolio.' : 'An Approver can put these in a portfolio.'}</p>` }) : ''}
      ${c.portfolios.length ? '' : card({ title: 'Start with your portfolios', body: html`<p class="muted">A portfolio is a large area of the business, such as Buying or Banking. Add yours, then their value streams and products.</p>` })}
      ${ctx.can('draft') ? card({ title: 'Add a portfolio', body: html`<p class="muted">It starts with a document made from the portfolio template. Then add its value streams and products.</p>${adder('portfolio', 'Add a portfolio', 'Add portfolio')}` }) : html`<p class="muted">Adding a portfolio, value stream, product or theme needs the draft permission.</p>`}`);
  }

  async function act(fn, text, focus) {
    try {
      const result = await fn();
      editingTheme = null;
      editingThemesOf = null;
      labels.editing = null;
      await draw();
      say(message(), typeof text === 'function' ? text(result) : text, 'success');
      if (focus) view.querySelector(focus)?.focus();
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  }

  view.addEventListener('click', async (e) => {
    const t = e.target;
    const add = t.closest('[data-add]');
    if (add) {
      const key = add.dataset.add;
      const input = view.querySelector(`[data-new="${CSS.escape(key)}"]`);
      const name = input.value.trim();
      if (!name) return input.focus();
      if (key === 'portfolio') {
        return act(() => ctx.api.post('catalogue/portfolios', { name }), (r) => (r.added ? `${r.portfolio} is a portfolio now, with its document.` : `${r.portfolio} is already a portfolio.`));
      }
      const portfolio = key.slice(3);
      return act(() => ctx.api.post('catalogue/value-streams', { name, portfolio }), (r) => (r.added ? `${r.valueStream} is a value stream in ${r.portfolio} now, with its document.` : `${r.valueStream} is already a value stream in ${r.portfolio}.`), `[data-new="${CSS.escape(key)}"]`);
    }
    const editTheme = t.closest('[data-action="edit-theme"]');
    if (editTheme) {
      editingTheme = editTheme.dataset.name;
      editingThemesOf = null;
      labels.editing = null;
      await draw();
      view.querySelector('[data-form="theme"] input')?.focus();
      return undefined;
    }
    const editThemes = t.closest('[data-action="edit-themes"]');
    if (editThemes) {
      editingThemesOf = editThemes.dataset.portfolio;
      editingTheme = null;
      await draw();
      view.querySelector('[data-pick-theme]')?.focus();
      return undefined;
    }
    if (t.closest('[data-action="cancel"]')) {
      editingTheme = null;
      editingThemesOf = null;
      return draw();
    }
    const pick = t.closest('[data-pick-theme]');
    if (pick) {
      const on = pick.getAttribute('aria-pressed') !== 'true';
      pick.setAttribute('aria-pressed', on ? 'true' : 'false');
      pick.classList.toggle('pf-chip--on', on);
      return undefined;
    }
    const save = t.closest('[data-action="save-themes"]');
    if (save) {
      const portfolio = save.dataset.portfolio;
      const themes = [...view.querySelectorAll(`[data-themes-of="${CSS.escape(portfolio)}"] [data-pick-theme][aria-pressed="true"]`)].map((b) => b.dataset.pickTheme);
      return act(() => ctx.api.patch(`catalogue/portfolios/${enc(portfolio)}`, { themes }), (r) => (r.themes.length ? `${r.portfolio} works towards ${listed(r.themes)}.` : `${r.portfolio} works towards no strategic theme now.`));
    }
    const remove = t.closest('[data-action="remove-theme"]');
    if (remove) return act(() => ctx.api.del(`catalogue/themes/${enc(remove.dataset.name)}`), `${remove.dataset.name} was removed.`);
    return undefined;
  }, { signal: ctx.signal });

  // Enter in an "add" box adds; it must not send a form around it.
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.closest('[data-new]')) return;
    e.preventDefault();
    e.target.parentElement.querySelector('button')?.click();
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'new-epic') {
      act(() => ctx.api.post('catalogue/epics', { kind: data.kind, name: data.name, portfolio: form.dataset.portfolio, ...(data.valueStream ? { valueStream: data.valueStream } : {}), ...(data.parent ? { parent: data.parent } : {}) }), (r) => `${r.epic.id} · ${r.epic.name} is ${r.epic.kind === 'epic' ? 'an epic' : 'a portfolio epic'} in ${[r.epic.portfolio, r.epic.valueStream].filter(Boolean).join(' › ')} now, with its document.`);
    } else if (form.dataset.form === 'new-feature') {
      act(() => ctx.api.post('catalogue/features', { name: data.name, epic: data.epic }), (r) => `${r.feature.id} · ${r.feature.name} is a feature of ${r.feature.epic.id} now. File ideas under it on the board.`);
    } else if (form.dataset.form === 'new-theme') {
      act(() => ctx.api.post('catalogue/themes', { name: data.name, ...(data.description.trim() ? { description: data.description } : {}) }), (r) => (r.added ? `${r.theme} is a strategic theme now.` : `${r.theme} is already a strategic theme.`));
    } else if (form.dataset.form === 'theme') {
      const was = form.dataset.name;
      const body = { description: data.description.trim() || null, ...(data.name.trim() !== was ? { name: data.name } : {}) };
      act(() => ctx.api.patch(`catalogue/themes/${enc(was)}`, body), (r) => `${r.theme} was saved.`);
    }
  }, { signal: ctx.signal });

  // Products and a portfolio's name: their labels, adders and form (pages/portfolios.js).
  wirePortfolios(view, ctx, { state: labels, redraw: draw, catalogue: () => catalogue, message });

  await reloadable(view, ctx, draw);
}
