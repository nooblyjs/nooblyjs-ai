// Portfolios and products on the Product board: the filter labels (portfolio, then its value streams, then its
// products), the label pickers in a form (no drop-downs: a label is chosen by pressing it, or typed and added), and
// the panel where they are set up. With nothing set up yet the panel opens by itself as "Start with your portfolios".
// Strategic themes, value streams and the documents are on the Portfolios page (strategy.js). Data: the board's
// `catalogue`, `portfolios`, `valueStreams` and `products`. Writes: POST /catalogue/portfolios and
// /catalogue/products (draft); PATCH and DELETE (approve), including a product's value stream.
// A product also says where it is built (NooblyJS Phase 11): its repositories, chosen from Platform's list, and its Jira
// project, from the ones NooblyJS reads. Anyone who may draft sets them: PUT /catalogue/products/:name/tools.
import { html } from '/ui/js/html.js';
import { button } from '/ui/js/components/index.js';
import { hrefFor, isAbort, say } from '../lib.js';

const enc = encodeURIComponent;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The board's filters: All and Mine, a label per portfolio; under a chosen portfolio a label per value stream (when it
 * has any), then a label per product (of the chosen value stream, when one is chosen).
 */
export function filtersView(board, ctx) {
  const chip = (label, count, active, query) => html`<a class="pf-chip${active ? ' pf-chip--on' : ''}" href="${hrefFor(ctx, `/board${query}`)}"${active ? html` aria-current="true"` : ''}>${label} <span class="pf-chip__count">${count}</span></a>`;
  const chosen = board.filter.portfolio;
  const stream = board.filter.valueStream;
  const streams = board.valueStreams ?? [];
  return html`<nav class="pf-chips" aria-label="Filter the board">
    ${board.filters.map((f) => chip(f.label, f.count, f.active, f.key === 'mine' ? '?mine=1' : ''))}
    ${board.portfolios.length ? html`<span class="pf-chips__divider" aria-hidden="true"></span>` : ''}
    ${board.portfolios.map((p) => chip(p.name, p.count, p.active && !stream && !board.filter.product, `?portfolio=${enc(p.name)}`))}
  </nav>
  ${chosen && streams.length ? html`<nav class="pf-chips pf-chips--sub" aria-label="Value streams in ${chosen}">
    <span class="pf-chips__label">Value streams in ${chosen}</span>
    ${streams.map((v) => chip(v.name, v.count, v.active && !board.filter.product, `?valueStream=${enc(v.name)}`))}
  </nav>` : ''}
  ${chosen && board.products.length ? html`<nav class="pf-chips pf-chips--sub" aria-label="Products in ${stream ?? chosen}">
    <span class="pf-chips__label">Products in ${stream ?? chosen}</span>
    ${board.products.map((p) => chip(p.name, p.count, p.active, `?product=${enc(p.name)}`))}
  </nav>` : ''}`;
}

/** A label that is pressed to choose it (a real button with aria-pressed), for a form's portfolio or product. */
const pick = (kind, name, { pressed = false, portfolio = null, hidden = false } = {}) => html`<button type="button" class="pf-chip pf-label${pressed ? ' pf-chip--on' : ''}" data-pick="${kind}" data-value="${name}"${portfolio ? html` data-portfolio="${portfolio}"` : ''} aria-pressed="${pressed ? 'true' : 'false'}"${hidden ? html` hidden` : ''}>${name}</button>`;

const adder = (kind, placeholder) => html`<span class="pf-label-add"><input data-new="${kind}" maxlength="40" autocomplete="off" placeholder="${placeholder}" aria-label="${placeholder}">${button({ label: 'Add', kind: 'secondary', small: true, attrs: { 'data-add': kind } })}</span>`;

/**
 * The portfolio and product of a form, as labels: press one, or type a new one and Add. Choosing a portfolio shows
 * its products. The choice is kept in hidden inputs `portfolio` and `product`.
 */
export function labelFields(board, { product = null } = {}) {
  const c = board.catalogue;
  const all = [...c.portfolios.flatMap((p) => p.products), ...c.unfiled];
  const current = product ? all.find((p) => p.name === product) ?? null : null;
  const portfolio = current?.portfolio ?? null;
  return html`<div data-labels>
    <fieldset class="pf-labels">
      <legend>Portfolio</legend>
      <div class="pf-labels__row" data-list="portfolio">${c.portfolios.map((p) => pick('portfolio', p.name, { pressed: p.name === portfolio }))}${adder('portfolio', 'Add a portfolio')}</div>
      <input type="hidden" name="portfolio" value="${portfolio ?? ''}">
    </fieldset>
    <fieldset class="pf-labels">
      <legend>Product <span class="muted" data-product-hint>${portfolio ? `in ${portfolio}` : 'choose a portfolio first, or add a product on its own'}</span></legend>
      <div class="pf-labels__row" data-list="product">${all.map((p) => pick('product', p.name, { pressed: p.name === product, portfolio: p.portfolio, hidden: Boolean(portfolio) ? p.portfolio !== portfolio : Boolean(p.portfolio) }))}${adder('product', 'Add a product')}</div>
      <input type="hidden" name="product" value="${product ?? ''}">
    </fieldset>
  </div>`;
}

/** The panel where portfolios and products are set up. `editing` is the label an Approver is changing, or null. */
export function portfoliosPanel(board, ctx, { open, editing }) {
  const c = board.catalogue;
  if (!open && !c.empty) return '';
  const canAdd = ctx.can('draft');
  const canChange = ctx.can('approve');
  // An Approver changes any label; anyone who may draft says where a product is built.
  const editable = (kind) => canChange || (canAdd && kind === 'product');
  const where = (item) => [...(item.repositories ?? []).map((r) => r.split('/').pop()), ...(item.jiraProject ? [`Jira ${item.jiraProject}`] : [])].join(' · ');
  const label = (kind, item) => (editable(kind)
    ? html`<button type="button" class="pf-chip pf-label" data-edit="${kind}" data-value="${item.name}" aria-expanded="${editing?.kind === kind && editing.name === item.name ? 'true' : 'false'}">${item.name} <span class="pf-chip__count">${item.count}</span>${kind === 'product' && where(item) ? html`<span class="pf-label__where">${where(item)}</span>` : ''}<span class="visually-hidden">: ${canChange ? 'rename, move, remove or say where it is built' : 'say where it is built'}</span></button>`
    : html`<span class="pf-chip pf-label">${item.name} <span class="pf-chip__count">${item.count}</span>${kind === 'product' && where(item) ? html`<span class="pf-label__where">${where(item)}</span>` : ''}</span>`);
  const tools = () => {
    const choices = editing.choices;
    if (!choices) return '';
    const repos = editing.repositories ?? [];
    const known = choices.repositories.map((r) => r.name);
    const all = [...known, ...repos.filter((r) => !known.includes(r))];
    return html`<fieldset class="pf-labels">
        <legend>Repositories <span class="muted">where its work is built (Platform · Repositories)</span></legend>
        <div class="pf-labels__row">${all.length ? all.map((name) => html`<button type="button" class="pf-chip pf-label${repos.includes(name) ? ' pf-chip--on' : ''}" data-pick="repo" data-value="${name}" aria-pressed="${repos.includes(name) ? 'true' : 'false'}">${name}</button>`) : html`<span class="muted">Platform lists no repositories yet.</span>`}</div>
        <input type="hidden" name="repositories" value="${repos.join(',')}">
      </fieldset>
      <fieldset class="pf-labels">
        <legend>Jira project <span class="muted">the ones NooblyJS reads (Platform · Settings · Integrations)</span></legend>
        <div class="pf-labels__row">${choices.jiraProjects.length ? choices.jiraProjects.map((p) => pick('jira', p.key, { pressed: p.key === editing.jiraProject })) : html`<span class="muted">NooblyJS reads no Jira project yet.</span>`}</div>
        <input type="hidden" name="jiraProject" value="${editing.jiraProject ?? ''}">
      </fieldset>`;
  };
  const streams = c.portfolios.flatMap((p) => p.valueStreams ?? []);
  const editForm = () => {
    if (!editing) return '';
    const isProduct = editing.kind === 'product';
    return html`<form class="pf-form pf-edit" data-form="edit-label" aria-label="Change ${editing.name}">
      ${canChange ? html`<label>Name <input name="name" required maxlength="40" value="${editing.name}" autocomplete="off"></label>` : html`<h3 class="pf-portfolio__name">${editing.name}</h3>`}
      ${isProduct && canChange ? html`<fieldset class="pf-labels"><legend>Portfolio</legend><div class="pf-labels__row">${c.portfolios.map((p) => pick('move', p.name, { pressed: p.name === editing.portfolio }))}</div><input type="hidden" name="portfolio" value="${editing.portfolio ?? ''}"></fieldset>
      <fieldset class="pf-labels"><legend>Value stream <span class="muted">optional; one in the product's portfolio</span></legend><div class="pf-labels__row">${streams.length ? streams.map((v) => pick('stream', v.name, { pressed: v.name === editing.valueStream, portfolio: v.portfolio, hidden: v.portfolio !== editing.portfolio })) : ''}<span class="muted" data-no-streams${streams.some((v) => v.portfolio === editing.portfolio) ? html` hidden` : ''}>No value streams in this portfolio.</span></div><input type="hidden" name="valueStream" value="${editing.valueStream ?? ''}"></fieldset>` : ''}
      ${isProduct ? tools() : ''}
      <div class="actions">${button({ label: 'Save', type: 'submit', small: true })}${canChange ? button({ label: `Remove ${editing.name}`, kind: 'danger', small: true, attrs: { 'data-action': 'remove-label' } }) : ''}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel-edit' } })}</div>
      <p class="muted">${isProduct ? `New ideas and specs in ${editing.name} start with these repositories and this Jira project; an item's Architecture can narrow them.${canChange ? ' Renaming a product refiles everything under it. One with items filed under it cannot be removed.' : ''}` : 'A portfolio with products in it cannot be removed.'}</p>
    </form>`;
  };
  return html`<section class="card pf-portfolios" aria-labelledby="pf-portfolios-title" data-panel="portfolios">
    <div class="card__head"><h2 class="card__title" id="pf-portfolios-title">${c.empty ? 'Start with your portfolios' : 'Portfolios & products'}</h2>
      ${c.empty ? '' : html`<span class="card__meta">${plural(c.portfolios.length, 'portfolio')} · ${plural(c.portfolios.reduce((n, p) => n + p.products.length, 0) + c.unfiled.length, 'product')}</span>`}</div>
    <p class="muted">${c.empty
      ? 'A portfolio is a large area of the business (Digital, Buying, Banking). Add yours, then the products in each (Registration, Payments). Ideas and specs then sit in a product, and the board filters by both.'
      : 'Type a name to add a label. Ideas and specs sit in a product; a product sits in one portfolio, and may sit in one of its value streams.'}${canChange && !c.empty ? ' Press a label to rename, move or remove it.' : ''} Strategic themes, value streams and each portfolio's document are on the <a href="${hrefFor(ctx, '/portfolios')}">Portfolios</a> page.</p>
    ${c.portfolios.map((p) => html`<div class="pf-portfolio" data-portfolio="${p.name}">
      <h3 class="pf-portfolio__name">${label('portfolio', p)}</h3>
      <div class="pf-labels__row">${p.products.length ? p.products.map((x) => label('product', x)) : html`<span class="muted">No products yet.</span>`}${canAdd ? html`<span class="pf-label-add"><input data-new-product-in="${p.name}" maxlength="40" autocomplete="off" placeholder="Add a product to ${p.name}" aria-label="Add a product to ${p.name}">${button({ label: 'Add', kind: 'secondary', small: true, attrs: { 'data-add-product-in': p.name } })}</span>` : ''}</div>
    </div>`)}
    ${c.unfiled.length ? html`<div class="pf-portfolio"><h3 class="pf-portfolio__name">In no portfolio yet</h3><div class="pf-labels__row">${c.unfiled.map((x) => label('product', x))}</div><p class="muted">${canChange ? 'Press a product to put it in a portfolio.' : 'An Approver can put these in a portfolio.'}</p></div>` : ''}
    ${canAdd ? html`<div class="pf-portfolio"><span class="pf-label-add"><input data-new-portfolio maxlength="40" autocomplete="off" placeholder="Add a portfolio" aria-label="Add a portfolio">${button({ label: 'Add portfolio', small: true, attrs: { 'data-add-portfolio': '1' } })}</span></div>` : html`<p class="muted">Adding a label needs the draft permission.</p>`}
    ${editForm()}
  </section>`;
}

/**
 * Wires the labels: the pickers in forms, and the panel's adds and changes. `state` is { open, editing }; `redraw`
 * draws the board again; `message()` is the page's live region.
 */
export function wirePortfolios(view, ctx, { state, redraw, board, message }) {
  const find = (kind, name) => {
    const c = board().catalogue;
    if (kind === 'portfolio') return c.portfolios.find((p) => p.name === name) ?? null;
    return [...c.portfolios.flatMap((p) => p.products), ...c.unfiled].find((p) => p.name === name) ?? null;
  };
  const done = async (text, focus) => {
    await redraw();
    say(message(), text, 'success');
    if (focus) view.querySelector(focus)?.focus();
  };
  const fail = (err) => { if (!isAbort(err)) say(message(), err.message, 'error'); };

  /** The repositories Platform lists and the Jira projects NooblyJS reads (NooblyJS's own API), for a product's tools. */
  async function toolChoices() {
    const api = ctx.hostApi;
    const [repos, tools] = await Promise.all([
      api ? api.get('platform/repositories').catch(() => null) : null,
      api ? api.get('devtools/status').catch(() => null) : null,
    ]);
    return {
      repositories: (repos?.repositories ?? []).filter((r) => !r.gone).map((r) => ({ name: r.name, source: r.source })),
      jiraProjects: (tools?.jira?.projects ?? (tools?.config?.jira?.projects ?? []).map((key) => ({ key }))).map((p) => ({ key: p.key, name: p.name ?? null })),
    };
  }

  /** Shows the chosen portfolio's products in a form, and keeps the hidden inputs in step. */
  function choose(root, kind, value) {
    if (kind === 'repo') {
      // Several repositories: each label is pressed on or off on its own.
      const field = root.querySelector('input[name="repositories"]');
      const list = field.value ? field.value.split(',') : [];
      const next = list.includes(value) ? list.filter((r) => r !== value) : [...list, value];
      field.value = next.join(',');
      const b = root.querySelector(`[data-pick="repo"][data-value="${CSS.escape(value)}"]`);
      b.setAttribute('aria-pressed', next.includes(value) ? 'true' : 'false');
      b.classList.toggle('pf-chip--on', next.includes(value));
      return;
    }
    const input = root.querySelector(`input[name="${kind === 'move' ? 'portfolio' : kind === 'jira' ? 'jiraProject' : kind === 'stream' ? 'valueStream' : kind}"]`);
    const on = input.value !== value; // pressing the chosen label again clears it
    input.value = on ? value : '';
    for (const b of root.querySelectorAll(`[data-pick="${kind}"]`)) {
      const pressed = on && b.dataset.value === value;
      b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      b.classList.toggle('pf-chip--on', pressed);
    }
    if (kind === 'portfolio') {
      const product = root.querySelector('input[name="product"]');
      for (const b of root.querySelectorAll('[data-pick="product"]')) {
        b.hidden = on ? b.dataset.portfolio !== value : Boolean(b.dataset.portfolio);
        if (b.hidden && b.dataset.value === product.value) {
          product.value = '';
          b.setAttribute('aria-pressed', 'false');
          b.classList.remove('pf-chip--on');
        }
      }
      const hint = root.querySelector('[data-product-hint]');
      if (hint) hint.textContent = on ? `in ${value}` : 'choose a portfolio first, or add a product on its own';
    }
    if (kind === 'move') {
      // Only the chosen portfolio's value streams can be chosen; one from another portfolio is let go.
      const portfolio = on ? value : '';
      const stream = root.querySelector('input[name="valueStream"]');
      let shown = 0;
      for (const b of root.querySelectorAll('[data-pick="stream"]')) {
        b.hidden = b.dataset.portfolio !== portfolio;
        if (!b.hidden) shown += 1;
        if (b.hidden && stream && b.dataset.value === stream.value) {
          stream.value = '';
          b.setAttribute('aria-pressed', 'false');
          b.classList.remove('pf-chip--on');
        }
      }
      const none = root.querySelector('[data-no-streams]');
      if (none) none.hidden = shown > 0;
    }
    if (kind === 'product' && on) {
      // A product names its portfolio.
      const portfolio = root.querySelector(`[data-pick="product"][data-value="${CSS.escape(value)}"]`)?.dataset.portfolio;
      const field = root.querySelector('input[name="portfolio"]');
      if (portfolio && field.value !== portfolio) choose(root, 'portfolio', portfolio);
    }
  }

  /** Adds a typed label inside a form: saved at once, then shown pressed. */
  async function addInForm(root, kind) {
    const input = root.querySelector(`[data-new="${kind}"]`);
    const name = input.value.trim();
    if (!name) return input.focus();
    try {
      const portfolio = root.querySelector('input[name="portfolio"]').value || null;
      const result = kind === 'portfolio'
        ? await ctx.api.post('catalogue/portfolios', { name })
        : await ctx.api.post('catalogue/products', { name, portfolio });
      const saved = kind === 'portfolio' ? result.portfolio : result.product;
      const list = root.querySelector(`[data-list="${kind}"]`);
      if (![...list.querySelectorAll(`[data-pick="${kind}"]`)].some((b) => b.dataset.value === saved)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pf-chip pf-label';
        b.dataset.pick = kind;
        b.dataset.value = saved;
        if (kind === 'product' && result.portfolio) b.dataset.portfolio = result.portfolio;
        b.setAttribute('aria-pressed', 'false');
        b.textContent = saved;
        list.insertBefore(b, list.querySelector('.pf-label-add'));
      }
      input.value = '';
      if (root.querySelector(`input[name="${kind}"]`).value !== saved) choose(root, kind, saved);
      say(message(), kind === 'portfolio' ? `${saved} is a portfolio now.` : `${saved} is a product${result.portfolio ? ` in ${result.portfolio}` : ''} now.`, 'success');
    } catch (err) {
      fail(err);
    }
  }

  view.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-action="portfolios"]')) {
      state.open = !state.open;
      state.editing = null;
      await redraw();
      view.querySelector('[data-panel="portfolios"] input')?.focus();
      return;
    }
    const picked = t.closest('[data-pick]');
    if (picked) return choose(picked.closest('[data-labels], [data-form="edit-label"]'), picked.dataset.pick, picked.dataset.value);
    const add = t.closest('[data-add]');
    if (add) return addInForm(add.closest('[data-labels]'), add.dataset.add);

    if (t.closest('[data-add-portfolio]')) {
      const input = view.querySelector('[data-new-portfolio]');
      if (!input.value.trim()) return input.focus();
      try {
        const { portfolio, added } = await ctx.api.post('catalogue/portfolios', { name: input.value });
        state.open = true;
        await done(added ? `${portfolio} is a portfolio now. Add its products.` : `${portfolio} is already a portfolio.`, `[data-new-product-in="${CSS.escape(portfolio)}"]`);
      } catch (err) {
        fail(err);
      }
      return;
    }
    const addIn = t.closest('[data-add-product-in]');
    if (addIn) {
      const portfolio = addIn.dataset.addProductIn;
      const input = view.querySelector(`[data-new-product-in="${CSS.escape(portfolio)}"]`);
      if (!input.value.trim()) return input.focus();
      try {
        const result = await ctx.api.post('catalogue/products', { name: input.value, portfolio });
        await done(result.added ? `${result.product} is a product in ${portfolio} now.` : `${result.product} is already a product${result.portfolio ? ` in ${result.portfolio}` : ''}.`, `[data-new-product-in="${CSS.escape(portfolio)}"]`);
      } catch (err) {
        fail(err);
      }
      return;
    }
    const edit = t.closest('[data-edit]');
    if (edit) {
      const item = find(edit.dataset.edit, edit.dataset.value);
      const closing = state.editing?.name === edit.dataset.value && state.editing.kind === edit.dataset.edit;
      // A product's choices are read before the form is drawn, so nothing redraws it under a person's typing.
      const choices = !closing && edit.dataset.edit === 'product' ? await toolChoices() : null;
      state.editing = closing ? null : { kind: edit.dataset.edit, name: edit.dataset.value, portfolio: item?.portfolio ?? null, valueStream: item?.valueStream ?? null, repositories: item?.repositories ?? [], jiraProject: item?.jiraProject ?? null, choices };
      await redraw();
      view.querySelector('[data-form="edit-label"] input[name="name"], [data-form="edit-label"] [data-pick]')?.focus();
      return;
    }
    if (t.closest('[data-action="cancel-edit"]')) {
      state.editing = null;
      return redraw();
    }
    if (t.closest('[data-action="remove-label"]') && state.editing) {
      const { kind, name } = state.editing;
      try {
        await ctx.api.del(`catalogue/${kind === 'portfolio' ? 'portfolios' : 'products'}/${enc(name)}`);
        state.editing = null;
        await done(`${name} was removed.`);
      } catch (err) {
        fail(err);
      }
    }
    return undefined;
  }, { signal: ctx.signal });

  // Enter in an "add a label" box adds the label; it must not send the form around it.
  view.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target.closest('[data-new], [data-new-portfolio], [data-new-product-in]');
    if (!input) return;
    e.preventDefault();
    input.parentElement.querySelector('button')?.click();
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="edit-label"]');
    if (!form || !state.editing) return;
    e.preventDefault();
    const { kind, name, portfolio, valueStream } = state.editing;
    const data = Object.fromEntries(new FormData(form));
    const newName = data.name === undefined ? name : data.name.trim();
    try {
      if (kind === 'portfolio') {
        await ctx.api.patch(`catalogue/portfolios/${enc(name)}`, { name: data.name });
      } else {
        const body = {
          ...(data.name !== undefined && newName !== name ? { name: newName } : {}),
          ...(data.portfolio !== undefined && (data.portfolio || null) !== portfolio ? { portfolio: data.portfolio || null } : {}),
          ...(data.valueStream !== undefined && (data.valueStream || null) !== valueStream ? { valueStream: data.valueStream || null } : {}),
        };
        if (Object.keys(body).length) await ctx.api.patch(`catalogue/products/${enc(name)}`, body);
        if (data.repositories !== undefined) {
          const repositories = data.repositories ? data.repositories.split(',') : [];
          const jiraProject = data.jiraProject || null;
          if (repositories.join(',') !== (state.editing.repositories ?? []).join(',') || jiraProject !== (state.editing.jiraProject ?? null)) {
            await ctx.api.put(`catalogue/products/${enc(newName)}/tools`, { repositories, jiraProject });
          }
        }
      }
      state.editing = null;
      await done(`${newName} was saved.`);
    } catch (err) {
      fail(err);
    }
  }, { signal: ctx.signal });
}
