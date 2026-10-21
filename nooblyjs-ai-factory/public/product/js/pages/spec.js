// Spec detail (product.md §5.2, mockup noobly-product-factory-spec): status, product and authorship; the sticky
// Request changes / Approve & send to Architecture; Problem, Goals, User stories, Acceptance criteria, Out of scope;
// and the side rail: Where this is, Readiness (with its one agent action), Linked knowledge, Reviewers.
// Data: GET /specs/:id and /specs/:id/versions. Writes: POST /specs/:id/drafts, POST /specs/:id/decision.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill, checklist, dataTable } from '/ui/js/components/index.js';
import { hrefFor, specPill, errorCard, isAbort, reloadable, say, followDraft, ago } from '../lib.js';

const REVIEW_TONE = { approved: 'success', waiting: 'neutral', 'changes-requested': 'warning' };

function section(title, body) {
  return body ? html`<section class="pf-section"><h2 class="pf-section__title">${title}</h2>${body}</section>` : '';
}

/** No hired teammate can draft specs (Teammates is running and has nobody): people write it themselves. */
const nobodyDrafts = (spec) => Boolean(spec.drafter && !spec.drafter.standalone && !spec.drafter.options.length);

function bodyView(spec) {
  if (spec.status === 'awaiting-brief' && !spec.version) {
    return html`<p class="muted">${nobodyDrafts(spec) ? 'Nothing written yet. Press Write the spec to write it yourself.' : 'Nothing written yet. Brief a teammate in the panel on the right, or press Write the spec to write it yourself.'}</p>`;
  }
  const goals = spec.goals.length
    ? dataTable({ caption: 'Goals', columns: [{ key: 'measure', label: 'Measure' }, { key: 'today', label: 'Today' }, { key: 'target', label: 'Target' }], rows: spec.goals })
    : null;
  const criteria = spec.acceptanceCriteria.length
    ? html`<ol class="pf-criteria">${spec.acceptanceCriteria.map((c) => (c.given
      ? html`<li><strong>Given</strong> ${c.given}, <strong>when</strong> ${c.when}, <strong>then</strong> ${c.then}</li>`
      : html`<li>${c.text}</li>`))}</ol>`
    : null;
  return html`
    ${section('Problem', spec.problem ? html`<p>${spec.problem}</p>` : null)}
    ${section('Goals', goals)}
    ${section('User stories', spec.stories.length ? html`<ul class="pf-list">${spec.stories.map((s) => html`<li>${s}</li>`)}</ul>` : null)}
    ${section('Acceptance criteria', criteria)}
    ${section('Out of scope', spec.outOfScope ? html`<p>${spec.outOfScope}</p>` : null)}
    ${section('Rollout plan', spec.rolloutPlan ? html`<p class="pf-pre">${spec.rolloutPlan}</p>` : null)}
    ${spec.sections.map((s) => section(s.heading, html`<p class="pf-pre">${s.text}</p>`))}`;
}

function trackerView(spec) {
  const words = { done: 'Done', current: 'Now', next: 'Next' };
  return card({
    title: 'Where this is',
    body: html`<ol class="pf-tracker">${spec.tracker.map((s) => html`<li class="pf-tracker__step pf-tracker__step--${s.state}"${s.state === 'current' ? html` aria-current="step"` : ''}><span class="pf-tracker__dot" aria-hidden="true"></span><span>${s.label}</span><span class="visually-hidden"> (${words[s.state]})</span></li>`)}</ol>`,
  });
}

function readinessView(spec, ctx) {
  if (!spec.readiness) return card({ title: 'Readiness', body: html`<p class="muted">Checked once the spec has content.</p>` });
  const items = spec.readiness.checks.map((c) => ({ text: c.text, state: c.passed === true ? 'done' : c.passed === false ? 'failed' : 'todo', note: c.passed === null ? 'Not checked yet' : undefined }));
  const failing = spec.readiness.checks.filter((c) => c.action);
  const canDraft = ctx.can('draft') && spec.status !== 'approved';
  // With no teammate to ask, a failing check is fixed with Edit.
  const actions = nobodyDrafts(spec)
    ? html`<p class="muted">Press Edit to fill in what is missing.</p>`
    : html`<div class="actions">${failing.map((c) => button({ label: c.action.label, kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'draft', 'data-kind': c.action.draft } }))}</div>`;
  return card({
    title: 'Readiness',
    meta: spec.readiness.text,
    body: html`${checklist({ items, label: `Readiness, ${spec.readiness.text}` })}${canDraft && failing.length ? actions : ''}`,
  });
}

/** Who drafts this spec: a hired teammate. With several and none chosen, a choice; with none, how to get one. */
function drafterChoice(spec) {
  const d = spec.drafter;
  if (!d || d.standalone) return '';
  if (d.teammate && d.options.length <= 1) return '';
  if (!d.options.length) return html`<p class="muted">No agent teammate is hired yet. <a href="/teammates/hire">Hire a teammate</a>, or press Write the spec and write it yourself.</p>`;
  return html`<label>Who drafts it <select name="teammateId" required>${d.teammate ? '' : html`<option value="">Choose a teammate</option>`}${d.options.map((o) => html`<option value="${o.id}"${d.teammate?.id === o.id ? html` selected` : ''}>${o.name}${o.role ? ` · ${o.role}` : ''}</option>`)}</select></label>`;
}

function briefView(spec, ctx) {
  if (spec.status !== 'awaiting-brief' || !ctx.can('draft')) return '';
  const who = spec.drafter && !spec.drafter.standalone ? spec.drafter.teammate : spec.agent;
  const nobody = nobodyDrafts(spec);
  return html`<form class="card pf-form" data-form="brief">
    <h2 class="card__title">${nobody ? 'No teammate to brief' : `Brief ${who?.name ?? 'a teammate'}`}</h2>
    ${drafterChoice(spec)}
    ${nobody ? '' : html`<label>What should this spec cover? <textarea name="brief" rows="4" required maxlength="4000" placeholder="The problem, who has it, and what good looks like."></textarea></label>
    <div class="actions">${button({ label: `Ask ${who?.name?.split(' ')[0] ?? 'them'} to draft`, type: 'submit', kind: 'accent', icon: 'spark' })}</div>`}
  </form>`;
}

/** The text of a headed section (Dependencies, Privacy review…), or ''. */
const sectionText = (spec, heading) => spec.sections.find((s) => heading.test(s.heading))?.text ?? '';
const OWN_SECTIONS = /^(dependencies|privacy review.*)$/i;

/** One goal a line: "measure | today | target". */
const goalLines = (goals) => goals.map((g) => [g.measure, g.today, g.target].join(' | ')).join('\n');
const criterionLines = (list) => list.map((c) => (c.given ? `Given ${c.given}, when ${c.when}, then ${c.then}` : c.text)).join('\n');
const lines = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** A person edits the spec's sections. Saving makes a new version, by them; the agent's draft is kept as the old one. */
function editView(spec) {
  return html`<form class="card pf-form pf-edit" data-form="edit">
    <h2 class="card__title">${spec.version ? 'Edit' : 'Write'} ${spec.id}</h2>
    <p class="muted">Saving makes version ${(spec.version ?? 0) + 1}, by you. Every earlier version is kept.</p>
    <label>Title <input name="title" required maxlength="120" value="${spec.title}"></label>
    <label>Problem <textarea name="problem" rows="5" maxlength="10000">${spec.problem ?? ''}</textarea></label>
    <label>Goals <span class="muted">one a line: measure | today | target</span><textarea name="goals" rows="4">${goalLines(spec.goals)}</textarea></label>
    <label>User stories <span class="muted">one a line</span><textarea name="stories" rows="4">${spec.stories.join('\n')}</textarea></label>
    <label>Acceptance criteria <span class="muted">one a line: "Given …, when …, then …", or plain text</span><textarea name="criteria" rows="4">${criterionLines(spec.acceptanceCriteria)}</textarea></label>
    <label>Out of scope <textarea name="outOfScope" rows="3" maxlength="5000">${spec.outOfScope ?? ''}</textarea></label>
    <label>Rollout plan <textarea name="rolloutPlan" rows="3" maxlength="10000">${spec.rolloutPlan ?? ''}</textarea></label>
    <label>Dependencies <span class="muted">the services, teams and systems this relies on. Filling it in passes "Dependencies named"</span><textarea name="dependencies" rows="3" maxlength="10000">${sectionText(spec, /^dependencies$/i)}</textarea></label>
    <label>Privacy review <span class="muted">personal data touched, where it is stored, retention. Saving it is your review: it passes "Privacy reviewed"</span><textarea name="privacy" rows="3" maxlength="10000">${sectionText(spec, /^privacy review/i)}</textarea></label>
    <label>What changed <span class="muted">optional, shown in Versions</span><input name="changeNote" maxlength="300"></label>
    <p class="pf-message" role="alert" data-edit-error hidden></p>
    <div class="actions">${button({ label: 'Save changes', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-edit' } })}</div>
  </form>`;
}

/** The form's text back into the API's fields, or a sentence saying which line is wrong. */
function editFields(data, spec) {
  const goals = [];
  for (const [i, line] of lines(data.goals).entries()) {
    const [measure, today = '', target = ''] = line.split('|').map((x) => x.trim());
    if (!measure) return { error: `Goal ${i + 1} needs a measure: "measure | today | target".` };
    goals.push({ measure, today, target });
  }
  const acceptanceCriteria = lines(data.criteria).map((line) => {
    const m = /^given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+)$/i.exec(line);
    return m ? { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() } : { text: line };
  });
  return {
    fields: {
      title: data.title.trim(), problem: data.problem.trim(), goals, stories: lines(data.stories), acceptanceCriteria,
      outOfScope: data.outOfScope.trim(), rolloutPlan: data.rolloutPlan.trim(),
      // The other headed sections stay as they are; Dependencies and Privacy review come from the form.
      sections: [
        ...spec.sections.filter((s) => !OWN_SECTIONS.test(s.heading)),
        ...(data.dependencies.trim() ? [{ heading: 'Dependencies', text: data.dependencies.trim() }] : []),
        ...(data.privacy.trim() ? [{ heading: 'Privacy review', text: data.privacy.trim() }] : []),
      ], ...(data.changeNote.trim() ? { changeNote: data.changeNote.trim() } : {}),
    },
  };
}

function knowledgeView(spec) {
  return card({
    title: 'Linked knowledge',
    body: spec.knowledge.length
      ? html`<ul class="pf-links" role="list">${spec.knowledge.map((k) => html`<li><span class="pf-links__title">${k.title}</span><span class="pf-links__meta">${k.text}</span>${k.flagged ? html`<span class="pf-adr__needs">Flagged: ${k.flagged.reason}. Check what this spec takes from it.</span>` : ''}</li>`)}</ul>`
      : html`<p class="muted">No knowledge linked yet.</p>`,
  });
}

function reviewersView(spec) {
  return card({
    title: 'Reviewers',
    body: spec.reviewers.length
      ? html`<ul class="pf-links" role="list">${spec.reviewers.map((r) => html`<li class="pf-reviewer"><span><span class="pf-links__title">${r.you ? 'You' : r.name}</span><span class="pf-links__meta">${r.role ?? ''}</span></span>${statusPill({ text: r.statusText, tone: REVIEW_TONE[r.status] ?? 'neutral' })}</li>`)}</ul>`
      : html`<p class="muted">Reviewers are added when approval is requested.</p>`,
  });
}

function versionsView(versions) {
  return card({
    title: 'Versions',
    body: versions.length
      ? html`<ol class="pf-links pf-versions" reversed>${[...versions].reverse().map((v) => html`<li><span class="pf-links__title">v${v.version}${v.current ? ' (current)' : ''} · ${v.by?.name ?? 'unknown'}</span><span class="pf-links__meta">${v.note ?? ''}${v.at ? ` · ${ago(v.at)}` : ''}</span></li>`)}</ol>`
      : html`<p class="muted">No versions yet.</p>`,
  });
}

function editButton(spec, ctx, editing) {
  if (editing || !ctx.can('draft') || spec.status === 'approved') return '';
  // Before anything is written, a person can write it themselves instead of briefing a teammate.
  return button({ label: spec.version ? 'Edit' : 'Write the spec', kind: 'secondary', icon: 'pen', attrs: { 'data-action': 'edit' } });
}

function decisionView(spec, ctx) {
  if (spec.status === 'approved' && ctx.can('approve')) {
    return html`<div class="pf-decision" role="group" aria-label="Your decision">
      ${button({ label: 'Send back to Product', kind: 'secondary', attrs: { 'data-action': 'send-back' } })}
      <form class="pf-form pf-form--inline" data-form="send-back" hidden>
        <label>Why is it going back? <textarea name="reason" rows="3" required maxlength="2000"></textarea></label>
        <div class="actions">${button({ label: 'Send back', type: 'submit', kind: 'secondary' })}</div>
      </form>
    </div>`;
  }
  // A draft (or one sent back with changes) goes to its reviewers when the person who owns it says so.
  if (['drafting', 'changes-requested'].includes(spec.status) && spec.version && ctx.can('draft')) {
    return button({ label: 'Send for review', attrs: { 'data-action': 'send-for-review' } });
  }
  if (spec.status !== 'in-review' || !ctx.can('approve')) return '';
  return html`<div class="pf-decision" role="group" aria-label="Your decision">
    ${button({ label: 'Request changes', kind: 'secondary', attrs: { 'data-action': 'request-changes' } })}
    ${button({ label: 'Approve & send to Architecture', attrs: { 'data-action': 'approve' } })}
    <form class="pf-form pf-form--inline" data-form="override" hidden>
      <p class="pf-adr__needs" data-override-text></p>
      <label>Approve anyway: why is it ready? <textarea name="override" rows="3" required maxlength="2000" placeholder="For example: no personal data is touched; dependencies are covered in ADR-002."></textarea></label>
      <div class="actions">${button({ label: 'Approve with this reason', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-override' } })}</div>
    </form>
    <form class="pf-form pf-form--inline" data-form="changes" hidden>
      <label>What needs to change? <textarea name="reason" rows="3" required maxlength="2000"></textarea></label>
      <div class="actions">${button({ label: 'Send request', type: 'submit', kind: 'secondary' })}</div>
    </form>
  </div>`;
}

/** NooblyJS Phase 18: the spec's accepted requirements (its elicitation's), each with where it came from. */
function requirementsView(spec, ctx) {
  const list = spec.requirements ?? [];
  return card({
    title: 'Requirements', meta: `${list.length}`,
    body: html`${list.length ? html`<ul class="pf-links" role="list">${list.map((r) => html`<li><span class="pf-links__title">${r.id} ${r.text}</span><span class="pf-links__meta">${r.quotes?.[0] ? `“${r.quotes[0].quote}”` : ''} · accepted by ${r.acceptedBy?.name ?? r.acceptedBy?.id}</span></li>`)}</ul>` : html`<p class="muted">No accepted requirement yet.</p>`}
      <p><a href="${hrefFor(ctx, `/elicitation/${spec.id}`)}">Elicitation: stakeholders, sessions, candidates, NFRs, questions</a></p>`,
  });
}

export async function render(view, { params, ctx }) {
  const id = params.id;
  ctx.chat.scope({ kind: 'spec', id });
  let following = null;
  let editing = false; // the edit form is open
  let current = null;  // the spec as last drawn (its version is the If-Match of a save)
  // What the last action said. A redraw (a live update from someone else, or from this action) keeps it on screen.
  let flash = null;
  const tell = (text, tone = 'info') => {
    flash = { text, tone };
    say(view.querySelector('[data-message]'), text, tone);
  };
  // Someone else (or "Apply to spec" in the thread) changed this spec: show it, unless a form here is being typed in.
  ctx.sse.on('spec.updated', (event) => {
    if (event.itemId !== id || !ctx.isCurrent()) return;
    if ([...view.querySelectorAll('textarea')].some((el) => el.value.trim() && el.offsetParent !== null)) return;
    draw();
  });

  async function draw() {
    let spec;
    let versions = [];
    try {
      [spec, { versions }] = await Promise.all([ctx.api.get(`specs/${encodeURIComponent(id)}`), ctx.api.get(`specs/${encodeURIComponent(id)}/versions`)]);
    } catch (err) {
      if (isAbort(err)) return;
      view.innerHTML = String(err.status === 404
        ? html`${pageHead({ eyebrow: 'Product · Specs', title: id })}<p class="muted">There is no spec ${id}. <a href="${hrefFor(ctx, '/specs')}">See all specs</a>.</p>`
        : errorCard(err, id));
      return;
    }
    if (!ctx.isCurrent()) return;
    current = spec;
    if (spec.status === 'approved') editing = false;
    ctx.setTitle(`${spec.id} ${spec.title}`);
    const lead = html`${spec.authorship.text}${spec.updatedAt ? ` · updated ${ago(spec.updatedAt)}` : ''}`;
    view.innerHTML = String(html`
      ${pageHead({ eyebrow: html`<a href="${hrefFor(ctx, '/specs')}">Specs</a> / ${spec.id}`, title: spec.title, lead, actions: html`${editButton(spec, ctx, editing)}${decisionView(spec, ctx)}` })}
      <div class="pf-pills">${specPill(spec)}${spec.product ? statusPill({ text: spec.portfolio ? `${spec.product} · ${spec.portfolio}` : spec.product, tone: 'neutral', dot: false }) : ''}<span class="pf-cost">${spec.agentCost.text}</span></div>
      ${spec.sentBack ? html`<p class="pf-adr__needs" role="note">${spec.sentBack.text}</p>` : ''}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-draft" data-draft hidden></div>
      <div class="pf-columns">
        ${editing ? editView(spec) : html`<article class="card pf-body" aria-label="${spec.id} spec">${bodyView(spec)}</article>`}
        <aside class="pf-rail" aria-label="About this spec">
          ${briefView(spec, ctx)}${requirementsView(spec, ctx)}${trackerView(spec)}${readinessView(spec, ctx)}${knowledgeView(spec)}${reviewersView(spec)}${versionsView(versions)}
        </aside>
      </div>`);
    if (flash) say(view.querySelector('[data-message]'), flash.text, flash.tone);
  }

  /** Shows a drafting job's progress until it finishes, then redraws the spec with the new version. */
  async function watch(draftId) {
    if (following === draftId) return;
    following = draftId;
    const box = () => view.querySelector('[data-draft]');
    try {
      const job = await followDraft(ctx, draftId, (j) => {
        const el = box();
        if (!el) return;
        el.hidden = false;
        el.innerHTML = String(html`<span>${j.text}</span><span class="pf-progress" role="progressbar" aria-label="${j.text}" aria-valuenow="${j.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${j.progress}%"></span></span>`);
      });
      following = null;
      await draw();
      tell(job.text, job.status === 'done' ? 'success' : 'error');
    } catch (err) {
      following = null;
      if (!isAbort(err)) tell(err.message, 'error');
    }
  }

  async function save(form) {
    const { fields, error } = editFields(Object.fromEntries(new FormData(form)), current);
    const box = form.querySelector('[data-edit-error]');
    if (error) { box.hidden = false; box.textContent = error; return; }
    const before = current?.version ?? 0;
    try {
      const saved = await ctx.api.put(`specs/${encodeURIComponent(id)}`, fields, { headers: { 'If-Match': `"${current.id}@${current.version ?? 0}"` } });
      editing = false;
      await draw();
      tell(saved.version === before ? 'Nothing changed, so no new version was made.' : `Saved as version ${saved.version}.`, 'success');
    } catch (err) {
      if (isAbort(err)) return;
      box.hidden = false;
      box.textContent = err.status === 409 ? `${err.message} Your text is still in the form.` : (Object.values(err.details ?? {})[0] ? `${err.message} ${Object.values(err.details)[0]}` : err.message);
    }
  }

  async function askToDraft(kind, brief, teammateId = null) {
    try {
      const job = await ctx.api.post(`specs/${encodeURIComponent(id)}/drafts`, { kind, ...(brief ? { brief } : {}), ...(teammateId ? { teammateId } : {}) });
      tell(`${job.teammate?.name ?? 'The agent'} is on it.`, 'info');
      await watch(job.draftId);
    } catch (err) {
      if (!isAbort(err)) tell(err.details?.brief ?? err.message, 'error');
    }
  }

  async function decide(decision, reason, override = null) {
    try {
      const result = await ctx.api.post(`specs/${encodeURIComponent(id)}/decision`, { decision, ...(reason ? { reason } : {}), ...(override ? { override } : {}) });
      await draw();
      tell(result.text, 'success');
    } catch (err) {
      if (isAbort(err)) return;
      // Readiness checks fail: say which, and offer to approve anyway with a reason (recorded and audited).
      if (err.code === 'readiness_failed' && decision === 'approve') {
        const form = view.querySelector('[data-form="override"]');
        if (form) {
          const failing = (err.details?.failing ?? []).map((c) => c.text).join(', ');
          form.querySelector('[data-override-text]').textContent = `${err.details?.passed ?? '?'} of ${err.details?.total ?? '?'} readiness checks pass${failing ? `. Not yet: ${failing}` : ''}. Fix them (Edit, or ask the teammate in Readiness), or approve anyway with a reason.`;
          form.hidden = false;
          form.querySelector('textarea').focus();
          return;
        }
      }
      tell(err.message, err.status === 503 ? 'warning' : 'error');
    }
  }

  async function sendForReview() {
    try {
      const sent = await ctx.api.post(`specs/${encodeURIComponent(id)}/review`, {});
      await draw();
      const names = (sent.reviewers ?? []).map((r) => r.name).filter(Boolean);
      tell(`Sent for review${names.length ? ` to ${names.join(' and ').replace(/\.$/, '')}` : ''}. It is In review on the board.`, 'success');
    } catch (err) {
      if (!isAbort(err)) tell(err.message, err.status === 503 ? 'warning' : 'error');
    }
  }

  async function sendBack(reason) {
    try {
      const result = await ctx.api.post(`specs/${encodeURIComponent(id)}/send-back`, { to: 'product', reason });
      await draw();
      tell(result.text, 'success');
    } catch (err) {
      if (!isAbort(err)) tell(err.message, err.status === 503 ? 'warning' : 'error');
    }
  }

  view.addEventListener('click', (e) => {
    const draft = e.target.closest('[data-action="draft"]');
    if (draft) {
      draft.disabled = true;
      askToDraft(draft.dataset.kind);
      return;
    }
    if (e.target.closest('[data-action="edit"]')) {
      editing = true;
      draw().then(() => view.querySelector('[data-form="edit"] input[name="title"]')?.focus());
      return;
    }
    if (e.target.closest('[data-action="cancel-override"]')) {
      view.querySelector('[data-form="override"]').hidden = true;
      return;
    }
    if (e.target.closest('[data-action="cancel-edit"]')) {
      editing = false;
      draw();
      return;
    }
    if (e.target.closest('[data-action="approve"]')) {
      decide('approve');
      return;
    }
    const review = e.target.closest('[data-action="send-for-review"]');
    if (review) {
      review.disabled = true;
      sendForReview();
      return;
    }
    if (e.target.closest('[data-action="send-back"]')) {
      const form = view.querySelector('[data-form="send-back"]');
      form.hidden = false;
      form.querySelector('textarea').focus();
      return;
    }
    if (e.target.closest('[data-action="request-changes"]')) {
      const form = view.querySelector('[data-form="changes"]');
      form.hidden = false;
      form.querySelector('textarea').focus();
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'brief') askToDraft('spec', data.brief.trim(), data.teammateId || null);
    if (form.dataset.form === 'edit') save(form);
    if (form.dataset.form === 'changes') decide('request-changes', data.reason.trim());
    if (form.dataset.form === 'override') decide('approve', null, data.override.trim());
    if (form.dataset.form === 'send-back') sendBack(data.reason.trim());
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
  // A draft already running for this spec (asked for elsewhere) shows its progress here too.
  try {
    const { drafts } = await ctx.api.get('drafts', { query: { itemId: id, status: 'running' } });
    // Seeded sample jobs never finish, so they aren't followed.
    const mine = drafts.find((d) => !d.sample);
    if (mine) watch(mine.id);
  } catch (err) {
    if (!isAbort(err)) console.warn('Product: could not check for a running draft', err);
  }
}
