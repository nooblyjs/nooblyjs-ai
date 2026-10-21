// Test analysis (Phase 16d): the stories in Engineer with their coverage in words, and a story's test cases: drafted by
// the test agent from its acceptance criteria under the test policy, edited, added and removed by a test analyst, who
// marks each ready. Data: GET /stories, GET /stories/:id. Phase 20: a case whose criterion changed in Design says so,
// with the old and new words; in Build and Test a person may still edit it or mark it ready again (only such a case).
import { html } from '/ui/js/html.js';
import { pageHead, card, listRow, notice, button, statusPill, dataTable } from '/ui/js/components/index.js';

const LEVELS = ['unit', 'contract', 'integration', 'e2e', 'performance', 'manual'];
const LEVEL_TEXT = { unit: 'Unit', contract: 'Contract', integration: 'Integration', e2e: 'E2E', performance: 'Performance', manual: 'By a person' };
const href = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel}`;

async function list(view, ctx) {
  const { stories } = await ctx.api.get('stories');
  view.innerHTML = String(html`${pageHead({ eyebrow: 'Software Factory · Engineering', title: 'Test analysis', lead: 'Each story in Engineer, its test cases from the acceptance criteria, which the AI automates and at which level, and what a person checks by hand. Every criterion needs a ready test case before the Engineering sign-off.' })}
    ${card({
      title: `${stories.length} ${stories.length === 1 ? 'story is' : 'stories are'} in Engineer`,
      body: stories.length ? html`<div class="rows">${stories.map((s) => listRow({
        title: `${s.ref} · ${s.title}`,
        meta: s.drafted ? `${s.summary.text} · ${s.summary.cases} test cases, ${s.summary.automated} automated` : 'No test analysis yet',
        pill: { text: !s.drafted ? 'Not started' : s.summary.ready === s.summary.criteria ? 'Every criterion ready' : 'Cases to make ready', tone: !s.drafted ? 'warning' : s.summary.ready === s.summary.criteria ? 'success' : 'info' },
        href: href(ctx, `/test-analysis/${encodeURIComponent(s.id)}`),
      }))}</div>` : html`<p class="muted">Nothing is in Engineer. A story comes here with its Design handoff.</p>`,
    })}`);
}

function caseRow(ctx, d, c) {
  const canEdit = (d.writable || (d.reviewable && c.criterionChanged)) && ctx.can('draft');
  const person = ctx.person?.kind !== 'agent';
  return html`<strong>${c.title}</strong>${c.criterionChanged ? html`<p class="qa-gwt">${c.criterionChanged.text}. Was: “${c.criterionChanged.from}”${c.criterionChanged.to ? html`. Now: “${c.criterionChanged.to}”` : ''}</p>` : ''}${c.given ? html`<p class="qa-gwt">Given ${c.given}, when ${c.when}, then ${c.then}</p>` : ''}
    <p class="qa-gwt">${c.interface ? `Interface ${c.interface} · ` : ''}${c.journey ? `Journey: ${c.journey} · ` : ''}${c.nfr ? `${c.nfr} · ` : ''}Runs against ${(c.systems ?? []).join(', ') || 'every system'}</p>
    ${canEdit ? html`<span class="qa-inline">${c.status !== 'ready' && person ? button({ label: 'Mark ready', kind: 'secondary', small: true, attrs: { 'data-action': 'ready', 'data-id': c.id, 'aria-label': `Mark ${c.id} ready` } }) : ''}${button({ label: 'Edit', kind: 'secondary', small: true, attrs: { 'data-action': 'edit', 'data-id': c.id, 'aria-label': `Edit ${c.id}` } })}${d.writable ? button({ label: 'Remove', kind: 'secondary', small: true, attrs: { 'data-action': 'remove', 'data-id': c.id, 'aria-label': `Remove ${c.id}` } }) : ''}</span>
    <form class="qa-form" data-form="edit" data-id="${c.id}" hidden>${fields(c)}${button({ label: 'Save', type: 'submit', small: true })}</form>` : ''}`;
}

const fields = (c = {}) => html`<label>Title<input name="title" value="${c.title ?? ''}" maxlength="200" required></label>
  <label>Given<input name="given" value="${c.given ?? ''}" maxlength="400"></label>
  <label>When<input name="when" value="${c.when ?? ''}" maxlength="400"></label>
  <label>Then<input name="then" value="${c.then ?? ''}" maxlength="400"></label>
  <label>Level<select name="level">${LEVELS.map((l) => html`<option value="${l}"${l === (c.level ?? 'integration') ? html` selected` : ''}>${LEVEL_TEXT[l]}</option>`)}</select></label>
  <label><span><input type="checkbox" name="automate"${(c.automate ?? true) ? html` checked` : ''}> The AI automates it</span></label>`;

function story(ctx, d, message) {
  const canEdit = d.writable && ctx.can('draft');
  return html`${pageHead({
    eyebrow: `Software Factory · Engineering · ${d.storyId}`, title: `Test analysis: ${d.title}`,
    lead: d.drafted ? `${d.summary.text}. ${d.summary.automated} of ${d.summary.cases} test cases are for the AI to automate.` : 'No test analysis yet.',
    actions: html`${button({ label: 'Open in Lifecycle', kind: 'secondary', small: true, href: d.href })}${d.designHref ? button({ label: 'Its design', kind: 'secondary', small: true, href: d.designHref }) : ''}`,
  })}
  <p class="qa-message${message.tone === 'error' ? ' qa-message--error' : ''}" role="status" aria-live="polite">${message.text}</p>
  ${canEdit ? html`<div class="actions">${button({ label: d.drafted ? 'Ask Ada to draft what is missing' : 'Ask Ada to draft the test analysis', kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'draft' } })}</div>` : ''}
  ${d.summary.changedText ? notice({ title: 'A criterion changed', text: `${d.summary.changedText}. Check each against the criterion as it reads now: edit it, or mark it ready again.`, tone: 'warning' }) : ''}
  ${card({ title: 'Acceptance criteria', meta: d.summary.text, body: html`<ol class="qa-criteria">${d.criteria.map((c) => html`<li>${c.text}<br>${statusPill({ text: c.ready ? 'Has a ready test case' : c.cases.length ? `${c.cases.join(', ')}: none ready yet` : 'No test case yet', tone: c.ready ? 'success' : 'warning' })}</li>`)}</ol>` })}
  ${d.interfaces.length ? card({ title: 'Interfaces', body: html`<ul class="qa-criteria">${d.interfaces.map((i) => html`<li>${i.id} · ${i.name}: ${i.tested ? 'has a ready integration test' : 'no ready integration test yet'}</li>`)}</ul>` }) : ''}
  ${card({
    title: 'Test cases', meta: `${d.summary.readyCases} of ${d.summary.cases} ready`,
    body: html`${dataTable({
      caption: 'Test cases',
      columns: [
        { key: 'id', label: 'Id' },
        { key: 'title', label: 'Test case', render: (c) => caseRow(ctx, d, c) },
        { key: 'level', label: 'Level', render: (c) => html`${LEVEL_TEXT[c.level] ?? c.level}<br><span class="muted">${c.automate ? 'Automated by the AI' : 'Checked by a person'}</span>` },
        { key: 'status', label: 'Status', render: (c) => statusPill(c.criterionChanged ? { text: 'Criterion changed', tone: 'warning' } : { text: c.status === 'ready' ? `Ready · ${c.readyBy?.name ?? ''}`.trim() : 'Draft', tone: c.status === 'ready' ? 'success' : 'warning' }) },
      ],
      rows: d.cases, empty: 'No test cases yet.',
    })}${canEdit && d.drafted ? html`<form class="qa-form" data-form="add" aria-label="Add a test case">${fields()}${button({ label: 'Add the test case', type: 'submit', kind: 'secondary', small: true })}</form>` : ''}`,
  })}
  ${d.sample ? html`<p class="muted">Sample data of the seed story.</p>` : ''}`;
}

export async function render(view, { params, route, ctx }) {
  const message = { text: '', tone: 'info' };
  let d;
  const paint = () => { view.innerHTML = String(story(ctx, d, message)); };
  const fail = (err) => { if (err?.name !== 'AbortError') view.innerHTML = String(notice({ title: "Couldn't load the test analysis", text: err.message, tone: 'error' })); };
  if (route.meta?.view !== 'story') return list(view, ctx).catch(fail);
  const path = `stories/${encodeURIComponent(params.id)}`;
  try { d = await ctx.api.get(path); } catch (err) { return fail(err); }
  if (!ctx.isCurrent()) return undefined;
  paint();

  const act = async (fn, done) => {
    try {
      const next = await fn();
      if (next?.storyId) d = next;
      Object.assign(message, { text: typeof done === 'function' ? done(next) : done, tone: 'info' });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      Object.assign(message, { text: err.message, tone: 'error' });
    }
    if (ctx.isCurrent()) paint();
  };
  const body = (form) => {
    const f = Object.fromEntries(new FormData(form));
    return { title: f.title, given: f.given, when: f.when, then: f.then, level: f.level, automate: form.querySelector('[name="automate"]')?.checked === true };
  };
  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = el.dataset.id;
    const actions = {
      draft: () => act(() => ctx.api.post(`${path}/draft`, {}), (r) => `Drafted: ${r.summary.cases} test cases.`),
      ready: () => act(() => ctx.api.post(`${path}/cases/${id}/ready`, {}), `${id} is ready.`),
      remove: () => act(() => ctx.api.del(`${path}/cases/${id}`), `${id} removed.`),
      edit: () => { const f = view.querySelector(`[data-form="edit"][data-id="${id}"]`); if (f) f.hidden = !f.hidden; },
    };
    if (actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](); }
  }, { signal: ctx.signal });
  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'edit') act(() => ctx.api.patch(`${path}/cases/${form.dataset.id}`, body(form)), `${form.dataset.id} saved; it is a draft again.`);
    if (form.dataset.form === 'add') act(() => ctx.api.post(`${path}/cases`, body(form)), (r) => `${r.caseId} added.`);
  }, { signal: ctx.signal });
  return undefined;
}
