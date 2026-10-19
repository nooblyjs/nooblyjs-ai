// Stage 4 · UI design for one item (product.md §5.5, mockup noobly-product-factory-ui-design): Open in canvas and
// Send to Software Factory; the screen gallery in device frames (Mobile / Web / Store console) with each screen's
// status; design-system reuse; the accessibility checks; and the handoff preview.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill, checklist } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, followDraft, drafterName, nobodyDrafts } from '../lib.js';

const SCREEN_TONE = { approved: 'success', 'in-review': 'info', draft: 'warning' };
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** A screen a person adds to the device shown: its title and what is on it, one line each. */
function ownScreenForm(device, label, hidden) {
  return html`<form class="pf-form pf-form--inline" data-form="screen-own" data-for-device="${device}"${hidden ? html` hidden` : ''}>
    <label>Screen title <input name="title" required maxlength="80" placeholder="e.g. Order tracking map" autocomplete="off"></label>
    <label>What is on it <span class="pf-hint">one a line, the title first</span><textarea name="elements" rows="4" placeholder="Order tracking&#10;Map with the driver&#10;Arrives 18:40"></textarea></label>
    <p class="pf-message" role="alert" data-own-error hidden></p>
    <div class="actions">${button({ label: `Add the ${label} screen`, type: 'submit', small: true })}</div>
  </form>`;
}

/** The handoff's work items as a person writes them: one a line, "repo | title". */
function ownPlanForm(h) {
  const example = `${h.repositories?.[0]?.split('/').pop() ?? 'slots-api'} | Add the slot hold endpoint`;
  return html`<form class="pf-form pf-form--inline" data-form="plan-own" hidden>
    <label>Work items <span class="pf-hint">one a line: repo | title</span><textarea name="items" rows="5" placeholder="${example}">${h.workItems.map((w) => `${w.repo} | ${w.title}`).join('\n')}</textarea></label>
    <p class="pf-message" role="alert" data-own-error hidden></p>
    <div class="actions">${button({ label: 'Save the work items', type: 'submit', small: true })}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-action': 'cancel-plan' } })}</div>
  </form>`;
}

function gallery(screens, device, ctx, drafter) {
  const tabs = html`<div class="pf-tabs" role="tablist" aria-label="Devices">${screens.devices.map((d) => html`<button type="button" role="tab" class="pf-tab" id="pf-device-${d.key}" aria-selected="${d.key === device}" aria-controls="pf-gallery" data-device="${d.key}">${d.label} <span class="pf-chip__count">${d.count}</span></button>`)}</div>`;
  const list = screens.screens.filter((s) => s.device === device);
  const frames = list.length
    ? html`<ul class="pf-gallery" role="list">${list.map((s) => html`<li class="pf-screen">
        <div class="pf-phone pf-phone--${s.device}" role="img" aria-label="${s.title}: ${s.elements.join('. ')}">${s.elements.map((e, i) => html`<span class="pf-phone__line${i === 0 ? ' pf-phone__line--title' : ''}">${e}</span>`)}</div>
        <span class="pf-screen__title">${s.title}</span>
        ${statusPill({ text: s.statusText, tone: SCREEN_TONE[s.status] ?? 'neutral' })}
        ${ctx.can('approve') && s.status !== 'approved' ? button({ label: 'Approve screen', kind: 'secondary', small: true, attrs: { 'data-action': 'approve-screen', 'data-id': s.id, 'data-etag': s.etag, 'aria-label': `Approve ${s.title}` } }) : ''}
      </li>`)}</ul>`
    : html`<p class="muted">No ${device === 'store-console' ? 'store console' : device} screens yet.</p>`;
  const who = drafterName(drafter);
  const label = screens.devices.find((d) => d.key === device)?.label.toLowerCase();
  const ask = !ctx.can('draft') ? '' : html`${who ? html`<form class="pf-form pf-form--inline" data-form="screen">
      <label>Ask ${who} for a screen <input name="brief" required maxlength="200" placeholder="e.g. order tracking map" autocomplete="off"></label>
      <div class="actions">${button({ label: 'Draft the screen', type: 'submit', kind: 'accent', small: true, icon: 'spark' })}${button({ label: 'Add one yourself', kind: 'secondary', small: true, icon: 'pen', attrs: { 'data-own': 'screen-own' } })}</div></form>`
    : nobodyDrafts(drafter, 'add the screen yourself here.')}${ownScreenForm(device, label, Boolean(who))}`;
  return html`<section class="card" aria-label="Screens"><div class="card__head"><h2 class="card__title">Screens · ${label}</h2></div>${tabs}<div id="pf-gallery" role="tabpanel" aria-labelledby="pf-device-${device}">${frames}</div>${ask}</section>`;
}

function designSystemCard(ds) {
  return card({
    title: 'Design system',
    meta: ds.version ?? '',
    body: html`<div class="pf-ds"><span class="pf-study__kind">Components reused</span><span class="pf-study__headline">${ds.text}</span>${ds.newComponents.length ? html`<span class="pf-links__meta">New: ${ds.newComponents.join(', ')}</span>` : ''}</div>`,
  });
}

function accessibilityCard(a) {
  return card({
    title: 'Accessibility',
    meta: a.text,
    body: checklist({ label: `Accessibility, ${a.text}`, items: a.checks.map((c) => ({ text: c.passed === false ? c.text : c.label, state: c.passed === true ? 'done' : c.passed === false ? 'failed' : 'todo' })) }),
  });
}

function handoffCard(h, ctx, drafter) {
  const who = drafterName(drafter);
  const canPlan = ctx.can('draft') && h.status === 'draft';
  const plan = canPlan ? html`${who ? button({ label: h.count ? `Ask ${who} to replan` : `Ask ${who} to plan the handoff`, kind: 'secondary', small: true, icon: 'spark', attrs: { 'data-action': 'plan' } }) : ''}${button({ label: h.count ? 'Change the work items' : 'Plan it yourself', kind: 'secondary', small: true, icon: 'pen', attrs: { 'data-own': 'plan-own' } })}` : '';
  return card({
    title: 'Handoff preview',
    meta: h.statusText,
    body: html`<p class="pf-handoff__title">${h.title}</p>
      ${h.count ? html`<ul class="pf-links" role="list">${h.workItems.map((w) => html`<li><span class="pf-links__title">${w.text}</span></li>`)}</ul>` : ''}
      <p class="pf-cost">${h.text}</p>
      ${h.repositories?.length ? html`<p class="muted">Built in ${h.repositories.map((r) => r.split('/').pop()).join(', ')} (Architecture).</p>` : ''}
      ${h.outside?.length ? html`<p class="pf-adr__needs" role="note">${h.outside.join(', ')} ${h.outside.length === 1 ? 'is' : 'are'} not among the item's repositories, so this can't be sent yet. Change the work items, or the repositories in Architecture.</p>` : ''}
      ${canPlan && !who && !h.count ? nobodyDrafts(drafter, 'plan the work items yourself.') : ''}
      ${plan ? html`<div class="actions">${plan}</div>${ownPlanForm(h)}` : ''}`,
  });
}

export async function render(view, { params, query, ctx }) {
  const id = params.id;
  let device = ['mobile', 'web', 'store-console'].includes(query.get('device')) ? query.get('device') : 'mobile';
  let data = null;

  async function load() {
    const base = `ui/${encodeURIComponent(id)}`;
    const [overview, screens, ds, a11y, handoff, drafters] = await Promise.all([
      ctx.api.get(base), ctx.api.get(`${base}/screens`), ctx.api.get(`${base}/design-system`),
      ctx.api.get(`${base}/accessibility-checks`), ctx.api.get(`${base}/handoff-preview`),
      // Who drafts UI: a teammate hired in Digital Teammates (or nobody, and people do it themselves).
      ctx.api.get('drafters').catch(() => null),
    ]);
    return { overview, screens, ds, a11y, handoff, drafter: drafters?.ui ?? null };
  }

  function paint() {
    const { overview, screens, ds, a11y, handoff, drafter } = data;
    const canSend = ctx.can('approve') && handoff.status === 'draft' && handoff.count > 0 && !handoff.outside?.length;
    const actions = html`${button({ label: 'Open in canvas', kind: 'secondary', icon: 'screen', disabled: !overview.canvasUrl, href: overview.canvasUrl ?? undefined, attrs: overview.canvasUrl ? {} : { 'aria-describedby': 'pf-canvas-note' } })}${canSend ? button({ label: 'Send to Software Factory', icon: 'handoff', attrs: { 'data-action': 'send' } }) : ''}`;
    const lead = html`${overview.lead ?? 'Screens, design-system reuse and accessibility, ready to hand off.'} <a href="${hrefFor(ctx, `/specs/${overview.itemId}`)}">${overview.itemId} · ${overview.title}</a>`;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Stage 4', title: 'UI Design', lead, actions })}
      ${overview.canvasUrl ? '' : html`<p class="pf-cost" id="pf-canvas-note">Open in canvas needs Figma, which isn't connected yet.</p>`}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-draft" data-draft hidden></div>
      <form class="card pf-form" data-form="send" hidden>
        <h2 class="card__title">Send ${handoff.count} work items to the Software Factory</h2>
        ${a11y.checks.some((c) => c.passed === false) ? html`<p class="pf-adr__needs">Still open: ${a11y.checks.filter((c) => c.passed === false).map((c) => c.text).join('; ')}. They go with the handoff.</p>` : ''}
        <label>Note for the Software Factory (optional) <textarea name="note" rows="2" maxlength="1000"></textarea></label>
        <div class="actions">${button({ label: 'Send', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-send' } })}</div>
      </form>
      ${gallery(screens, device, ctx, drafter)}
      <div class="grid pf-panels">${designSystemCard(ds)}${accessibilityCard(a11y)}${handoffCard(handoff, ctx, drafter)}</div>`);
  }

  async function draw() {
    try {
      data = await load();
    } catch (err) {
      if (isAbort(err)) return;
      view.innerHTML = String(err.status === 404 ? html`${pageHead({ eyebrow: 'Product Factory · Stage 4', title: 'UI Design' })}<p class="muted">There is no spec ${id}. <a href="${hrefFor(ctx, '/ui')}">See the UI Design list</a>.</p>` : errorCard(err, `${id}'s UI design`));
      return;
    }
    if (!ctx.isCurrent()) return;
    ctx.setTitle(`UI Design · ${data.overview.itemId}`);
    paint();
  }

  const message = () => view.querySelector('[data-message]');
  async function act(fn, done) {
    try {
      const result = await fn();
      await draw();
      say(message(), typeof done === 'function' ? done(result) : done, 'success');
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, err.status === 503 ? 'warning' : 'error');
    }
  }
  async function askToDraft(body) {
    try {
      const job = await ctx.api.post(`ui/${encodeURIComponent(id)}/drafts`, body);
      const box = view.querySelector('[data-draft]');
      const done = await followDraft(ctx, job.draftId, (j) => {
        box.hidden = false;
        box.innerHTML = String(html`<span>${j.text}</span><span class="pf-progress" role="progressbar" aria-label="${j.text}" aria-valuenow="${j.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${j.progress}%"></span></span>`);
      });
      await draw();
      say(message(), done.text, done.status === 'done' ? 'success' : 'error');
    } catch (err) {
      if (!isAbort(err)) say(message(), err.details ? Object.values(err.details).join(' ') : err.message, 'error');
    }
  }

  view.addEventListener('click', (e) => {
    const t = e.target;
    const tab = t.closest('[data-device]');
    if (tab) {
      device = tab.dataset.device;
      paint();
      view.querySelector(`#pf-device-${device}`)?.focus();
      return;
    }
    if (t.closest('[data-action="send"]')) {
      const form = view.querySelector('[data-form="send"]');
      form.hidden = false;
      form.querySelector('textarea').focus();
      return;
    }
    if (t.closest('[data-action="cancel-send"]')) return void (view.querySelector('[data-form="send"]').hidden = true);
    const approve = t.closest('[data-action="approve-screen"]');
    if (approve) {
      approve.disabled = true;
      return act(() => ctx.api.put(`ui/${encodeURIComponent(id)}/screens/${approve.dataset.id}`, { status: 'approved' }, { headers: { 'If-Match': approve.dataset.etag } }), (s) => `${s.title} is approved.`);
    }
    const own = t.closest('[data-own]');
    if (own) {
      const form = view.querySelector(`[data-form="${own.dataset.own}"]`);
      form.hidden = false;
      form.querySelector('input, textarea')?.focus();
      return undefined;
    }
    if (t.closest('[data-action="cancel-plan"]')) return void (view.querySelector('[data-form="plan-own"]').hidden = true);
    const plan = t.closest('[data-action="plan"]');
    if (plan) {
      plan.disabled = true;
      askToDraft({ kind: 'handoff-plan' });
    }
    return undefined;
  }, { signal: ctx.signal });

  /** Saves what a person wrote; a mistake is said in the form, and their text stays. */
  async function saveOwn(form, fn, done) {
    const box = form.querySelector('[data-own-error]');
    try {
      const result = await fn();
      await draw();
      say(message(), done(result), 'success');
    } catch (err) {
      if (isAbort(err)) return;
      box.hidden = false;
      box.textContent = err.details ? `${err.message} ${Object.values(err.details).join(' ')}` : err.message;
    }
  }
  const fail = (form, text) => {
    const box = form.querySelector('[data-own-error]');
    box.hidden = false;
    box.textContent = text;
  };

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'send') act(() => ctx.api.post(`ui/${encodeURIComponent(id)}/handoff`, f.note.trim() ? { note: f.note.trim() } : {}), (r) => r.text);
    if (form.dataset.form === 'screen') askToDraft({ kind: 'screen', brief: f.brief.trim() });
    if (form.dataset.form === 'screen-own') {
      const screenId = slugify(f.title);
      if (!screenId) return fail(form, 'Give the screen a title with letters or digits.');
      if (data.screens.screens.some((s) => s.id === screenId)) return fail(form, `There is already a screen called ${f.title.trim()}.`);
      const elements = lines(f.elements);
      saveOwn(form, () => ctx.api.put(`ui/${encodeURIComponent(id)}/screens/${screenId}`, { title: f.title.trim(), device: form.dataset.forDevice, elements: elements.length ? elements : [f.title.trim()] }, { headers: { 'If-Match': `"${id}.screen.${screenId}@0"` } }), (s) => `Added the screen ${s.title}.`);
    }
    if (form.dataset.form === 'plan-own') {
      const workItems = [];
      for (const [i, line] of lines(f.items).entries()) {
        const [repo, title] = line.split('|').map((x) => x.trim());
        if (!repo || !title) return fail(form, `Line ${i + 1} needs a repo and a title: "repo | title".`);
        workItems.push({ repo, title });
      }
      saveOwn(form, () => ctx.api.put(`ui/${encodeURIComponent(id)}/handoff-preview`, { workItems }, { headers: { 'If-Match': `"${id}.handoff@${data.handoff.version}"` } }), (h) => (h.count ? `Saved: ${h.title}.` : 'The handoff has no work items now.'));
    }
    return undefined;
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
