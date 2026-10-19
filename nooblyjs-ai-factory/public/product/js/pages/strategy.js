// Portfolios (product.md §5.7): the strategic themes; each portfolio with the themes it works towards, its value
// streams and its products; and links to each portfolio's and value stream's document. Data: GET /catalogue.
// Writes: POST /catalogue/themes, /catalogue/portfolios, /catalogue/value-streams (draft); PATCH and DELETE
// /catalogue/themes/:name, and PATCH /catalogue/portfolios/:name { themes } (approve).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, listRow } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';

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

function portfolioView(p, c, ctx, editingThemes) {
  const canChange = ctx.can('approve');
  const looseProducts = p.products.filter((x) => !x.valueStream || !p.valueStreams.some((v) => v.name === x.valueStream));
  const themes = editingThemes
    ? html`<fieldset class="pf-labels" data-themes-of="${p.name}"><legend>Strategic themes <span class="muted">press the ones ${p.name} works towards</span></legend>
        <div class="pf-labels__row">${c.themes.map((t) => html`<button type="button" class="pf-chip pf-label${p.themes.includes(t.name) ? ' pf-chip--on' : ''}" data-pick-theme="${t.name}" aria-pressed="${p.themes.includes(t.name) ? 'true' : 'false'}">${t.name}</button>`)}</div>
        <div class="actions">${button({ label: 'Save themes', small: true, attrs: { 'data-action': 'save-themes', 'data-portfolio': p.name } })}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel' } })}</div>
      </fieldset>`
    : html`<p class="pf-portfolio__name">Works towards: <span class="muted">${p.themes.length ? listed(p.themes) : 'no strategic theme yet'}</span>
        ${canChange && c.themes.length ? button({ label: 'Change themes', kind: 'secondary', small: true, attrs: { 'data-action': 'edit-themes', 'data-portfolio': p.name, 'aria-label': `Change the themes ${p.name} works towards` } }) : ''}</p>`;
  return html`<section class="card pf-stack" aria-labelledby="pf-p-${p.id}">
    <div class="card__head"><h2 class="card__title" id="pf-p-${p.id}"><a href="${hrefFor(ctx, `/portfolios/${p.id}`)}">${p.name}</a></h2>
      <span class="card__meta">${plural(p.valueStreams.length, 'value stream')} · ${plural(p.products.length, 'product')}</span></div>
    ${themes}
    <div class="rows">${p.valueStreams.map((v) => listRow({ title: v.name, href: hrefFor(ctx, `/value-streams/${v.id}`), meta: `Value stream · ${v.products.length ? v.products.join(', ') : 'no products yet'}` }))}</div>
    ${p.valueStreams.length ? '' : html`<p class="muted">No value streams. A portfolio can have none.</p>`}
    ${looseProducts.length ? html`<p class="muted">${p.valueStreams.length ? 'In no value stream' : 'Products'}: ${looseProducts.map((x) => x.name).join(', ')}</p>` : ''}
    ${ctx.can('draft') ? adder(`vs:${p.name}`, `Add a value stream to ${p.name}`) : ''}
  </section>`;
}

export async function render(view, { ctx }) {
  let catalogue = null;
  let editingTheme = null;    // the theme an Approver is changing
  let editingThemesOf = null; // the portfolio whose themes an Approver is choosing
  const message = () => view.querySelector('[data-message]');

  async function draw() {
    try {
      catalogue = await ctx.api.get('catalogue');
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
      ${c.portfolios.map((p) => portfolioView(p, c, ctx, editingThemesOf === p.name))}
      ${c.portfolios.length ? '' : card({ title: 'Start with your portfolios', body: html`<p class="muted">A portfolio is a large area of the business, such as Buying or Banking. Add yours, then their value streams and products.</p>` })}
      ${ctx.can('draft') ? card({ title: 'Add a portfolio', body: html`<p class="muted">It starts with a document made from the portfolio template.</p>${adder('portfolio', 'Add a portfolio', 'Add portfolio')}` }) : html`<p class="muted">Adding a portfolio, value stream or theme needs the draft permission.</p>`}
      <p class="muted">Products are added and moved on the <a href="${hrefFor(ctx, '/board')}">Product board</a> (Portfolios &amp; products).</p>`);
  }

  async function act(fn, text, focus) {
    try {
      const result = await fn();
      editingTheme = null;
      editingThemesOf = null;
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
    if (form.dataset.form === 'new-theme') {
      act(() => ctx.api.post('catalogue/themes', { name: data.name, ...(data.description.trim() ? { description: data.description } : {}) }), (r) => (r.added ? `${r.theme} is a strategic theme now.` : `${r.theme} is already a strategic theme.`));
    } else if (form.dataset.form === 'theme') {
      const was = form.dataset.name;
      const body = { description: data.description.trim() || null, ...(data.name.trim() !== was ? { name: data.name } : {}) };
      act(() => ctx.api.patch(`catalogue/themes/${enc(was)}`, body), (r) => `${r.theme} was saved.`);
    }
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
