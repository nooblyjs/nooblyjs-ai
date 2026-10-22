// Product · Objectives (NooblyJS Phase 25b): what the product work is for, by Now · Next · Later. Each objective with
// its strategic themes, its key results (measure, start → now, target, read from the monitor or typed in, status in
// words) and what serves it, with any item placed earlier than its objective pointed out. A person with `draft` sets one
// up, adds key results and links items; a Product lead (`approve`) moves one between horizons.
// Data: GET /objectives, /catalogue, /ideas, /specs. Writes: POST /objectives, PATCH /objectives/:id,
// POST /objectives/:id/move, /objectives/:id/key-results, /objectives/:id/key-results/:kr/readings.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say } from '../lib.js';

const HORIZONS = [['now', 'Now'], ['next', 'Next'], ['later', 'Later']];
const KR_TONE = { met: 'success', behind: 'warning', 'on-the-way': 'info', 'not-measured': 'neutral' };

function newForm(themes) {
  return html`<form class="card pf-form" data-form="new" hidden aria-label="Set an objective">
    <h2 class="card__title">Set an objective</h2>
    <label>Objective <input name="title" required maxlength="120" autocomplete="off" placeholder="More same-day orders"></label>
    <label>What it means <span class="pf-hint">optional, a sentence or two</span><textarea name="description" rows="2" maxlength="2000"></textarea></label>
    <fieldset class="pf-labels"><legend>Horizon</legend><div class="pf-labels__row">${HORIZONS.map(([k, l], i) => html`<label class="pf-radio"><input type="radio" name="horizon" value="${k}"${i === 0 ? html` checked` : ''}> ${l}</label>`)}</div></fieldset>
    ${themes.length ? html`<fieldset class="pf-labels"><legend>Strategic themes</legend><div class="pf-labels__row">${themes.map((t) => html`<label class="pf-radio"><input type="checkbox" name="themes" value="${t.name}"> ${t.name}</label>`)}</div></fieldset>` : ''}
    <div class="actions">${button({ label: 'Set it', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-new' } })}</div>
  </form>`;
}

function objectiveCard(o, { ctx, items }) {
  const canDraft = ctx.can('draft');
  const canMove = ctx.can('approve');
  const linked = new Set(o.links.map((l) => l.id));
  const krs = o.keyResults.length
    ? html`<ul class="pf-list" aria-label="Key results">${o.keyResults.map((k) => html`<li class="pf-kr">${statusPill({ text: k.statusText, tone: KR_TONE[k.status] })} <span>${k.text}</span>
        ${canDraft ? (k.source === 'monitor'
    ? button({ label: 'Read again', kind: 'secondary', small: true, attrs: { 'data-action': 'refresh', 'data-id': o.id, 'data-kr': k.id, 'aria-label': `Read again: ${k.measure}, from the monitor` } })
    : html`<form class="pf-inline" data-form="reading" data-id="${o.id}" data-kr="${k.id}"><label>Value today <input name="value" maxlength="40" autocomplete="off" required placeholder="${k.target}"></label>${button({ label: 'Record', kind: 'secondary', small: true, type: 'submit' })}</form>`) : ''}</li>`)}</ul>`
    : html`<p class="muted">No key results yet.</p>`;
  const krForm = canDraft ? html`<details class="pf-details"><summary>Add a key result</summary><form class="pf-form pf-form--inline" data-form="kr" data-id="${o.id}">
      <label>Measure <input name="measure" required maxlength="160" autocomplete="off" placeholder="Same-day slots still open at 12:00"></label>
      <div class="pf-form__row"><label>Starts at <input name="start" required maxlength="40" autocomplete="off" placeholder="18%"></label><label>Target <input name="target" required maxlength="40" autocomplete="off" placeholder="45%"></label></div>
      <label>Read from <select name="source"><option value="monitor">The monitor (Operations)</option><option value="typed">Typed in by a person</option></select></label>
      <p class="muted">Reading from Metrics comes later: Metrics doesn't measure named things for other apps yet.</p>
      <div class="actions">${button({ label: 'Add the key result', type: 'submit', small: true })}</div></form></details>` : '';
  const serves = html`<h3 class="card__title card__title--small">What serves it</h3>
    ${o.links.length ? html`<ul class="pf-list">${o.links.map((l) => html`<li><a href="${hrefFor(ctx, /^PRD-/.test(l.id) ? `/specs/${l.id}` : /^IDEA-/.test(l.id) ? `/business-cases/${l.id}` : /^FEAT-/.test(l.id) ? `/features/${l.id}` : `/epics/${l.id}`)}">${l.id} ${l.title}</a>${l.horizonText ? html` <span class="muted">· in ${l.horizonText}</span>` : ''}${l.mismatch ? html` ${statusPill({ text: 'Earlier than its objective', tone: 'warning' })}` : ''}${canDraft ? html` ${button({ label: 'Unlink', kind: 'secondary', small: true, attrs: { 'data-action': 'unlink', 'data-id': o.id, 'data-item': l.id, 'aria-label': `Unlink ${l.id} from ${o.id}` } })}` : ''}</li>`)}</ul>` : html`<p class="muted">Nothing serves it yet.</p>`}
    ${o.mismatches.length ? html`<p class="pf-message pf-message--error">${o.mismatches.join('. ')}.</p>` : ''}
    ${canDraft ? html`<form class="pf-inline" data-form="link" data-id="${o.id}"><label>Link <select name="target" required><option value="">An idea, spec, feature or epic</option>${items.filter((i) => !linked.has(i.id)).map((i) => html`<option value="${i.id}">${i.id} · ${i.title}</option>`)}</select></label>${button({ label: 'Link', kind: 'secondary', small: true, type: 'submit' })}</form>` : ''}`;
  const move = canMove ? html`<form class="pf-inline" data-form="move" data-id="${o.id}"><label>Move to <select name="horizon">${HORIZONS.filter(([k]) => k !== o.horizon).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>${button({ label: 'Move', kind: 'secondary', small: true, type: 'submit' })}</form>` : '';
  return html`<li class="card pf-objective" id="${o.id}">
    <div class="pf-note__head"><h2 class="card__title">${o.id} ${o.title}</h2>${statusPill({ text: o.horizonText, tone: 'info', dot: false })}${statusPill({ text: o.progressText, tone: o.keyResults.some((k) => k.status === 'behind') ? 'warning' : 'neutral' })}${o.sampleData ? html`<span class="muted">Sample data</span>` : ''}</div>
    ${o.description ? html`<p>${o.description}</p>` : ''}
    <p class="muted">${o.themes.length ? `Works towards ${o.themes.join(' and ')}` : 'No strategic theme'}</p>
    ${krs}${krForm}${serves}${move}
  </li>`;
}

export async function render(view, { ctx }) {
  const message = () => view.querySelector('[data-message]');

  async function draw(flash = null) {
    let objectives; let catalogue; let ideas; let specs;
    try {
      [{ objectives }, catalogue, { ideas }, { specs }] = await Promise.all([ctx.api.get('objectives'), ctx.api.get('catalogue'), ctx.api.get('ideas'), ctx.api.get('specs')]);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the objectives'));
      return;
    }
    if (!ctx.isCurrent()) return;
    const items = [...specs.map((s) => ({ id: s.id, title: s.title })), ...ideas.filter((i) => !['merged', 'closed', 'suggested'].includes(i.status)).map((i) => ({ id: i.id, title: i.title })), ...(catalogue.features ?? []).map((f) => ({ id: f.id, title: f.name }))];
    view.innerHTML = String(html`${pageHead({
      eyebrow: 'Product · Strategy',
      title: 'Objectives',
      lead: 'What the product work is for, by Now (the next three months), Next (the three after) and Later. A key result is behind when an outcome review measured it short of its target.',
      actions: ctx.can('draft') ? button({ label: 'Set an objective', icon: 'plus', attrs: { 'data-action': 'new' } }) : '',
    })}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      ${ctx.can('draft') ? newForm(catalogue.themes ?? []) : ''}
      ${HORIZONS.map(([k, l]) => {
    const here = objectives.filter((o) => o.horizon === k);
    return html`<section class="pf-stack" aria-labelledby="pf-h-${k}"><h2 class="pf-stream__name" id="pf-h-${k}">${l} <span class="muted">${here.length} objective${here.length === 1 ? '' : 's'}</span></h2>
      ${here.length ? html`<ul class="pf-stack" role="list">${here.map((o) => objectiveCard(o, { ctx, items }))}</ul>` : html`<p class="muted">None in ${l}.</p>`}</section>`;
  })}`);
    if (flash) say(message(), flash.text, flash.tone);
  }

  const run = async (fn, text) => {
    try {
      const out = await fn();
      await draw({ text: typeof text === 'function' ? text(out) : text, tone: 'success' });
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  };
  const current = async (id) => ctx.api.get(`objectives/${id}`);

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id, kr, item } = el.dataset;
    if (action === 'new') { const f = view.querySelector('[data-form="new"]'); f.hidden = false; f.elements.title.focus(); }
    else if (action === 'cancel-new') { e.preventDefault(); view.querySelector('[data-form="new"]').hidden = true; }
    else if (action === 'refresh') run(() => ctx.api.post(`objectives/${id}/key-results/${kr}/readings`, { refresh: true }), `${kr} was read again from the monitor.`);
    else if (action === 'unlink') run(async () => ctx.api.patch(`objectives/${id}`, { links: (await current(id)).links.map((l) => l.id).filter((x) => x !== item) }), `${item} no longer serves ${id}.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const f = form.elements;
    const id = form.dataset.id;
    const kind = form.dataset.form;
    if (kind === 'new') run(() => ctx.api.post('objectives', { title: f.title.value, description: f.description.value, horizon: new FormData(form).get('horizon'), themes: new FormData(form).getAll('themes') }), (o) => `${o.id} is set, in ${o.horizonText}. Add its key results.`);
    else if (kind === 'kr') run(() => ctx.api.post(`objectives/${id}/key-results`, { measure: f.measure.value, start: f.start.value, target: f.target.value, source: f.source.value }), `The key result is added to ${id}.`);
    else if (kind === 'reading') run(() => ctx.api.post(`objectives/${id}/key-results/${form.dataset.kr}/readings`, { value: f.value.value }), `${form.dataset.kr} is recorded.`);
    // Not `item`: form.elements.item is the collection's own method.
    else if (kind === 'link') run(async () => ctx.api.patch(`objectives/${id}`, { links: [...(await current(id)).links.map((l) => l.id), f.target.value] }), `${f.target.value} serves ${id}.`);
    else if (kind === 'move') run(() => ctx.api.post(`objectives/${id}/move`, { horizon: f.horizon.value }), (o) => `${o.id} is in ${o.horizonText} now.`);
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
