// Stage 3 · UX design for one item (product.md §5.4, mockup noobly-product-factory-ux-design): tabs Journey / Flows /
// Research; the journey (steps × Doing / Feeling / Pain / Opportunity, with out-of-scope links), the flows as their
// paths, the research results, and open questions with "Run a quick test".
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, followDraft, drafterName, nobodyDrafts } from '../lib.js';

const TABS = [['journey', 'Journey'], ['flows', 'Flows'], ['research', 'Research']];
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** A button that opens a person's own form (data-own="<form>"), shown beside the "Ask …" one. */
const writeYourself = (form, label) => button({ label, kind: 'secondary', small: true, icon: 'pen', attrs: { 'data-own': form } });

/** The journey a person writes: whose it is, and one step a line ("step | doing | feeling | pain | opportunity"). */
function ownJourneyForm(hidden) {
  return html`<form class="pf-form pf-form--inline" data-form="journey-own"${hidden ? html` hidden` : ''}>
    <label>Whose journey? <input name="persona" required maxlength="80" placeholder="e.g. evening shopper" autocomplete="off"></label>
    <label>Steps <span class="pf-hint">one a line: step | doing | feeling | pain | opportunity (at most 12)</span><textarea name="steps" rows="5" required placeholder="Pick a slot | scrolls the slot list | rushed | slots fill up | hold a slot for 10 minutes"></textarea></label>
    <p class="pf-message" role="alert" data-own-error hidden></p>
    <div class="actions">${button({ label: 'Save the journey', type: 'submit', small: true })}</div>
  </form>`;
}

function journeyCard(j, ctx, drafter) {
  if (!j.version) {
    const who = drafterName(drafter);
    const ask = who ? html`<form class="pf-form pf-form--inline" data-form="journey">
        <label>Whose journey? <input name="brief" required maxlength="200" placeholder="e.g. evening shopper" autocomplete="off"></label>
        <div class="actions">${button({ label: `Ask ${who} to draft it`, type: 'submit', kind: 'accent', small: true, icon: 'spark' })}${writeYourself('journey-own', 'Write it yourself')}</div></form>`
      : nobodyDrafts(drafter, 'write the journey yourself here.');
    return card({
      title: 'Journey',
      body: html`<p class="muted">No journey yet.</p>${ctx.can('draft') ? html`${ask}${ownJourneyForm(Boolean(who))}` : ''}`,
    });
  }
  const cell = (s, row) => {
    if (row === 'opportunity' && s.outOfScope) return html`<a href="${hrefFor(ctx, `/specs/${s.outOfScope}`)}">${s.opportunityText}</a>`;
    return s[row] ?? html`<span class="muted" aria-label="Nothing noted">—</span>`;
  };
  return html`<section class="card" aria-label="${j.title}">
    <div class="card__head"><h2 class="card__title">${j.title}</h2>${j.basis ? html`<span class="card__meta">${j.basis}</span>` : ''}</div>
    <div class="table-wrap" tabindex="0" role="region" aria-label="${j.title}"><table class="table pf-journey">
      <caption class="visually-hidden">${j.title}: steps across, what the person does, feels, finds painful, and the opportunity</caption>
      <thead><tr><th scope="col"><span class="visually-hidden">Row</span></th>${j.steps.map((s) => html`<th scope="col">${s.name}</th>`)}</tr></thead>
      <tbody>${j.rows.map((r) => html`<tr><th scope="row">${r.label}</th>${j.steps.map((s) => html`<td class="pf-journey__${r.key}">${cell(s, r.key)}</td>`)}</tr>`)}</tbody>
    </table></div>
  </section>`;
}

/** Every path through a flow from its first screen, so branches read as "yes → …" and "no → …". */
function paths(flow) {
  const out = new Map(flow.nodes.map((n) => [n.id, []]));
  for (const e of flow.edges) out.get(e.from)?.push(e);
  const incoming = new Set(flow.edges.map((e) => e.to));
  const start = flow.nodes.find((n) => !incoming.has(n.id)) ?? flow.nodes[0];
  const result = [];
  const walk = (id, trail, seen) => {
    const next = out.get(id) ?? [];
    if (!next.length || seen.has(id)) return result.push(trail);
    for (const e of next) walk(e.to, [...trail, { edge: e, node: e.to }], new Set([...seen, id]));
  };
  if (start) walk(start.id, [{ node: start.id }], new Set());
  return result;
}

function flowCard(flow) {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const step = (s, i) => {
    const n = byId.get(s.node);
    return html`${i ? html`<span class="pf-flow__arrow">${s.edge?.label ? html`<span class="pf-flow__branch">${s.edge.label}</span>` : ''}<span aria-hidden="true">→</span></span>` : ''}<span class="pf-flow__node pf-flow__node--${n?.kind ?? 'screen'}">${n?.label ?? s.node}${n?.kind === 'decision' ? html`<span class="visually-hidden"> (decision)</span>` : ''}</span>`;
  };
  return html`<section class="card" aria-label="Flow · ${flow.title}">
    <div class="card__head"><h2 class="card__title">Flow · ${flow.title}</h2><span class="card__meta">${flow.summary}</span></div>
    <ol class="pf-flow" aria-label="Paths through the flow">${paths(flow).map((p) => html`<li class="pf-flow__path">${p.map(step)}</li>`)}</ol>
  </section>`;
}

/** A flow a person writes: its title, and one step a line ("from → to", "| label" on a branch; "?" ends a decision). */
function ownFlowForm(hidden) {
  return html`<form class="card pf-form" data-form="flow-own"${hidden ? html` hidden` : ''}>
    <h2 class="card__title">Write a flow</h2>
    <label>Title <input name="title" required maxlength="120" placeholder="e.g. Release extra evening capacity" autocomplete="off"></label>
    <label>Steps <span class="pf-hint">one a line: Screen → Next screen. End a decision with "?" and name each branch after "|", e.g. Slot free? → Hold slot | yes</span><textarea name="steps" rows="6" required placeholder="Slot list → Slot free?&#10;Slot free? → Hold slot | yes&#10;Slot free? → Suggest another day | no"></textarea></label>
    <p class="pf-message" role="alert" data-own-error hidden></p>
    <div class="actions">${button({ label: 'Save the flow', type: 'submit', small: true })}</div>
  </form>`;
}

function flowsPanel(flows, ctx, drafter) {
  const who = drafterName(drafter);
  const ask = !ctx.can('draft') ? '' : who ? html`<form class="card pf-form" data-form="flow">
    <label>Draft another flow <input name="brief" required maxlength="200" placeholder="e.g. release extra evening capacity" autocomplete="off"></label>
    <div class="actions">${button({ label: `Ask ${who}`, type: 'submit', kind: 'accent', small: true, icon: 'spark' })}${writeYourself('flow-own', 'Write a flow yourself')}</div></form>`
    : card({ title: 'Add a flow', body: nobodyDrafts(drafter, 'write the flow yourself below.') });
  return html`${flows.length ? flows.map(flowCard) : card({ title: 'Flows', body: html`<p class="muted">No flows yet.</p>` })}${ask}${ctx.can('draft') ? ownFlowForm(Boolean(who)) : ''}`;
}

/** The flow's nodes and edges from its lines; a label ending in "?" is a decision. Or { error } naming the line. */
function flowFrom(text) {
  const nodes = new Map();
  const edges = [];
  const node = (label) => {
    const clean = label.trim().slice(0, 80);
    if (!nodes.has(clean)) {
      let id = slugify(clean) || 'step';
      while ([...nodes.values()].some((n) => n.id === id)) id = `${id}-2`;
      nodes.set(clean, { id, kind: clean.endsWith('?') ? 'decision' : 'screen', label: clean });
    }
    return nodes.get(clean).id;
  };
  for (const [i, line] of lines(text).entries()) {
    const [path, label] = line.split('|').map((x) => x.trim());
    const ends = path.split(/\s*(?:→|->)\s*/).filter(Boolean);
    if (!ends.length) return { error: `Line ${i + 1} has no step.` };
    if (ends.length > 2) return { error: `Line ${i + 1}: one arrow a line, "from → to".` };
    const ids = ends.map(node);
    if (ids.length === 2) edges.push({ from: ids[0], to: ids[1], ...(label ? { label: label.slice(0, 40) } : {}) });
  }
  if (!nodes.size) return { error: 'Write at least one step.' };
  if (nodes.size > 40) return { error: 'A flow has at most 40 screens and decisions.' };
  return { nodes: [...nodes.values()], edges };
}

/** The journey's steps from its lines, or { error } naming the line. */
function stepsFrom(text) {
  const steps = [];
  for (const [i, line] of lines(text).entries()) {
    const [name, doing, feeling, pain, opportunity] = line.split('|').map((x) => x.trim());
    if (!name) return { error: `Step ${i + 1} needs a name before the first "|".` };
    steps.push({ name: name.slice(0, 80), doing: doing || null, feeling: feeling || null, pain: pain || null, opportunity: opportunity || null });
  }
  if (!steps.length) return { error: 'Write at least one step.' };
  if (steps.length > 12) return { error: 'A journey has at most 12 steps.' };
  return { steps };
}

function researchPanel(research, questions, ctx, drafter) {
  const who = drafterName(drafter);
  const studies = research.studies.length
    ? html`<div class="grid">${research.studies.map((s) => html`<section class="card pf-study" aria-label="${s.title}">
        <span class="pf-study__kind">${s.title}</span>
        ${s.headline ? html`<span class="pf-study__headline">${s.headline}</span>` : ''}
        ${s.finding ? html`<p class="pf-study__finding">${s.finding}</p>` : ''}
      </section>`)}</div>`
    : card({ title: 'Research', body: html`<p class="muted">No research yet.</p>` });
  const open = questions.questions;
  const qs = open.length ? html`<ul class="pf-questions" role="list">${open.map((q) => html`<li class="card pf-question">
      <span class="pf-study__kind">${q.status === 'open' ? 'Open question' : 'Answered'}</span>
      <span class="pf-question__text">${q.text}</span>
      ${q.answer ? html`<p>${q.answer}</p>` : ''}
      ${q.quickTest ? statusPill({ text: 'Quick test run · see Research', tone: 'info' }) : ''}
      ${q.status === 'open' && ctx.can('draft') ? html`<div class="actions">${who && !q.quickTest ? button({ label: `Ask ${who} to run a quick test`, kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'quick-test', 'data-question': q.id } }) : ''}${button({ label: 'Answer it', kind: 'secondary', small: true, attrs: { 'data-action': 'answer', 'data-question': q.id, 'aria-label': `Answer: ${q.text}` } })}</div>
        <form class="pf-form pf-form--inline" data-form="answer" data-question="${q.id}" hidden>
          <label>Your answer <textarea name="answer" rows="2" required maxlength="1000"></textarea></label>
          <div class="actions">${button({ label: 'Save the answer', type: 'submit', small: true })}</div>
        </form>` : ''}
    </li>`)}</ul>` : '';
  return html`${studies}${qs}`;
}

export async function render(view, { params, query, ctx }) {
  const id = params.id;
  let tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'journey';
  let data = null;

  async function load() {
    const base = `ux/${encodeURIComponent(id)}`;
    const [spec, journey, { flows }, research, questions, drafters] = await Promise.all([
      ctx.api.get(`specs/${encodeURIComponent(id)}`), ctx.api.get(`${base}/journey`), ctx.api.get(`${base}/flows`),
      ctx.api.get(`${base}/research`), ctx.api.get(`${base}/questions`),
      // Who drafts UX: a teammate hired in Digital Teammates (or nobody, and people write it themselves).
      ctx.api.get('drafters').catch(() => null),
    ]);
    return { spec, journey, flows, research, questions, drafter: drafters?.ux ?? null };
  }

  function paint() {
    const { spec, journey, flows, research, questions, drafter } = data;
    const lead = html`Journey, flow and research for <a href="${hrefFor(ctx, `/specs/${spec.id}`)}">${spec.id} · ${spec.title}</a>.`;
    const tabs = html`<div class="pf-tabs" role="tablist" aria-label="UX views">${TABS.map(([k, l]) => html`<button type="button" role="tab" class="pf-tab" id="pf-tab-${k}" aria-selected="${k === tab}" aria-controls="pf-panel" data-tab="${k}">${l}</button>`)}</div>`;
    const panel = tab === 'journey'
      ? html`${journeyCard(journey, ctx, drafter)}${flows[0] ? flowCard(flows[0]) : ''}${researchPanel(research, questions, ctx, drafter)}`
      : tab === 'flows' ? flowsPanel(flows, ctx, drafter) : researchPanel(research, questions, ctx, drafter);
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Stage 3', title: 'UX Design', lead })}
      ${tabs}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-draft" data-draft hidden></div>
      <div id="pf-panel" role="tabpanel" aria-labelledby="pf-tab-${tab}" class="pf-stack">${panel}</div>`);
  }

  async function draw() {
    try {
      data = await load();
    } catch (err) {
      if (isAbort(err)) return;
      view.innerHTML = String(err.status === 404 ? html`${pageHead({ eyebrow: 'Product Factory · Stage 3', title: 'UX Design' })}<p class="muted">There is no spec ${id}. <a href="${hrefFor(ctx, '/ux')}">See the UX list</a>.</p>` : errorCard(err, `${id}'s UX work`));
      return;
    }
    if (!ctx.isCurrent()) return;
    ctx.setTitle(`UX Design · ${data.spec.id}`);
    paint();
  }

  const message = () => view.querySelector('[data-message]');
  async function askToDraft(body) {
    try {
      const job = await ctx.api.post(`ux/${encodeURIComponent(id)}/drafts`, body);
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
    const tabButton = e.target.closest('[data-tab]');
    if (tabButton) {
      tab = tabButton.dataset.tab;
      paint();
      view.querySelector(`#pf-tab-${tab}`)?.focus();
      return;
    }
    const own = e.target.closest('[data-own]');
    if (own) {
      const form = view.querySelector(`[data-form="${own.dataset.own}"]`);
      form.hidden = false;
      form.querySelector('input, textarea')?.focus();
      return;
    }
    const answer = e.target.closest('[data-action="answer"]');
    if (answer) {
      const form = view.querySelector(`[data-form="answer"][data-question="${CSS.escape(answer.dataset.question)}"]`);
      form.hidden = false;
      form.querySelector('textarea').focus();
      return;
    }
    const quick = e.target.closest('[data-action="quick-test"]');
    if (quick) {
      quick.disabled = true;
      askToDraft({ kind: 'quick-test', questionId: quick.dataset.question });
    }
  }, { signal: ctx.signal });

  /** Saves what a person wrote; a mistake in the form is said in the form, and their text stays. */
  async function saveOwn(form, fn, done) {
    const box = form.querySelector('[data-own-error]');
    try {
      const result = await fn();
      await draw();
      say(message(), done(result), 'success');
    } catch (err) {
      if (isAbort(err)) return;
      const text = err.details ? `${err.message} ${Object.values(err.details).join(' ')}` : err.message;
      if (box) { box.hidden = false; box.textContent = text; } else say(message(), text, 'error');
    }
  }
  const fail = (form, text) => {
    const box = form.querySelector('[data-own-error]');
    box.hidden = false;
    box.textContent = text;
  };
  const base = `ux/${encodeURIComponent(id)}`;

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const brief = f.brief?.trim();
    if (form.dataset.form === 'journey') askToDraft({ kind: 'journey', brief });
    if (form.dataset.form === 'flow') askToDraft({ kind: 'flow', brief });
    if (form.dataset.form === 'journey-own') {
      const { steps, error } = stepsFrom(f.steps);
      if (error) return fail(form, error);
      saveOwn(form, () => ctx.api.put(`${base}/journey`, { persona: f.persona.trim(), steps }, { headers: { 'If-Match': `"${id}.journey@${data.journey.version}"` } }), (j) => `Saved ${j.title}.`);
    }
    if (form.dataset.form === 'flow-own') {
      const flowId = slugify(f.title);
      if (!flowId) return fail(form, 'Give the flow a title with letters or digits.');
      if (data.flows.some((x) => x.id === flowId)) return fail(form, `There is already a flow called ${f.title.trim()}. Give this one another title.`);
      const { nodes, edges, error } = flowFrom(f.steps);
      if (error) return fail(form, error);
      saveOwn(form, () => ctx.api.put(`${base}/flows/${flowId}`, { title: f.title.trim(), nodes, edges }, { headers: { 'If-Match': `"${id}.flow.${flowId}@0"` } }), (x) => `Saved the flow ${x.title}.`);
    }
    if (form.dataset.form === 'answer') {
      const q = data.questions;
      const list = q.questions.map((x) => ({ id: x.id, text: x.text, status: x.status, answer: x.answer ?? null, ...(x.id === form.dataset.question ? { status: 'answered', answer: f.answer.trim() } : {}) }));
      saveOwn(form, () => ctx.api.put(`${base}/questions`, { questions: list }, { headers: { 'If-Match': `"${id}.questions@${q.version}"` } }), () => 'Your answer is saved. The question is answered.');
    }
    return undefined;
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
