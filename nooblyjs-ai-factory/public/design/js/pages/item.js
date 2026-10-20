// One item's design (Phase 16c), one part at a time: business requirements, solution architecture, functional analysis,
// stories, and the handoff of each story to Engineering. Agents draft (Ask … to draft); people accept, edit, merge,
// split and hand off. Every state is said in words. Data: GET /items/:id, GET /drafters.
import { html } from '/ui/js/html.js';
import { pageHead, card, notice, button, statusPill, dataTable, checklist } from '/ui/js/components/index.js';
import { PARTS } from '../module.js';

const href = (ctx, rel) => `${ctx.app.mountPath === '/' ? '' : ctx.app.mountPath}${rel}`;
const first = (name) => String(name ?? '').split(' ')[0];
const DRAFTS = { requirements: 'the business requirements', solution: 'the solution architecture', functional: 'the functional analysis', stories: 'the stories' };

function tabs(ctx, d, part) {
  return html`<nav aria-label="Parts of the design"><ul class="dz-tabs">${PARTS.map((p) => html`<li><a href="${href(ctx, `/${p.key}/${encodeURIComponent(d.itemId)}`)}"${p.key === part ? html` aria-current="page"` : ''}>${p.title}</a></li>`)}</ul></nav>`;
}

/** "Ask Ada to draft …", or why nobody can. */
function askButton(ctx, d, part, drafters) {
  if (!d.writable || !ctx.can('draft') || !DRAFTS[part]) return '';
  const who = drafters?.[part]?.teammate;
  if (!who) return html`<p class="muted">${drafters?.[part]?.reason ?? 'No agent teammate can draft here.'}</p>`;
  return button({ label: `Ask ${first(who.name)} to draft ${DRAFTS[part]}`, kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'draft', 'data-part': part } });
}

function requirementsPart(ctx, d, drafters) {
  const canAccept = d.writable && ctx.can('accept-requirement') && ctx.person?.kind !== 'agent';
  const canEdit = d.writable && ctx.can('draft');
  return card({
    title: 'Business requirements',
    meta: d.parts.requirements,
    body: html`${d.requirements.length ? dataTable({
      caption: 'Business requirements',
      columns: [
        { key: 'id', label: 'Id' },
        { key: 'text', label: 'Requirement', render: (r) => html`${r.text}<p class="dz-quote">${r.source?.quote ?? ''}</p><span class="muted">From the spec's ${r.source?.section ?? 'text'}</span>` },
        { key: 'status', label: 'Status', render: (r) => statusPill({ text: r.statusText, tone: r.status === 'accepted' ? 'success' : 'warning' }) },
        { key: 'actions', label: 'Actions', render: (r) => html`<span class="dz-inline">${canAccept && r.status !== 'accepted' ? button({ label: 'Accept', kind: 'secondary', small: true, attrs: { 'data-action': 'accept', 'data-id': r.id, 'aria-label': `Accept ${r.id}` } }) : ''}${canEdit ? button({ label: 'Edit', kind: 'secondary', small: true, attrs: { 'data-action': 'edit-req', 'data-id': r.id, 'aria-label': `Edit ${r.id}` } }) : ''}</span>
          <form class="dz-form" data-form="req" data-id="${r.id}" hidden><label>Statement<textarea name="text" rows="2" maxlength="1000" required>${r.text}</textarea></label>${button({ label: 'Save', type: 'submit', small: true })}</form>` },
      ],
      rows: d.requirements,
    }) : html`<p class="muted">No business requirements yet. They are written from the spec and its elicitation record.</p>`}
    <div class="actions">${askButton(ctx, d, 'requirements', drafters)}</div>`,
  });
}

function solutionPart(ctx, d, drafters) {
  const canEdit = d.writable && ctx.can('draft');
  const systems = card({
    title: 'Impacted systems',
    meta: `${d.systems.length} system${d.systems.length === 1 ? '' : 's'}`,
    body: d.systems.length ? html`<form data-form="systems">${dataTable({
      caption: 'Impacted systems',
      columns: [
        { key: 'name', label: 'System', render: (s) => html`<strong>${s.name}</strong><br><span class="muted">${s.repo}</span>` },
        { key: 'change', label: 'Change', render: (s) => (canEdit ? html`<select name="change" data-name="${s.name}" aria-label="Change to ${s.name}">${['new', 'changed', 'retired'].map((c) => html`<option value="${c}"${c === s.change ? html` selected` : ''}>${c[0].toUpperCase()}${c.slice(1)}</option>`)}</select>` : s.changeText) },
        { key: 'team', label: 'Owner', render: (s) => (canEdit ? html`<input name="team" data-name="${s.name}" value="${s.team ?? ''}" maxlength="80" aria-label="Team that owns ${s.name}">` : s.team ?? 'No owner named') },
        { key: 'note', label: 'What Knowledge and Platform say', render: (s) => html`${s.note || ''}${s.knowledge?.length ? html`<ul class="dz-criteria">${s.knowledge.map((k) => html`<li>${k.href ? html`<a href="${k.href}">${k.title}</a>` : k.title}</li>`)}</ul>` : ''}` },
      ],
      rows: d.systems,
    })}${canEdit ? html`<div class="actions">${button({ label: 'Save the systems', type: 'submit', kind: 'secondary', small: true })}</div>` : ''}</form>`
      : html`<p class="muted">No impacted systems yet. They come from the item's repositories (Platform) and Knowledge.</p>`,
  });
  const nfrs = card({
    title: 'NFRs',
    meta: `${d.nfrs.length} from the NFR catalogue and the quality attributes`,
    body: dataTable({
      caption: 'NFRs',
      columns: [{ key: 'id', label: 'Id' }, { key: 'category', label: 'Category' }, { key: 'requirement', label: 'Requirement' }, { key: 'target', label: 'Target' }, { key: 'source', label: 'Source', render: (n) => n.source?.text ?? '' }],
      rows: d.nfrs,
      empty: 'No NFRs yet.',
    }),
  });
  const landscape = card({
    title: 'Feature landscape',
    meta: `${d.features.length} feature${d.features.length === 1 ? '' : 's'}`,
    body: dataTable({
      caption: 'Feature landscape',
      columns: [
        { key: 'id', label: 'Id' }, { key: 'title', label: 'Feature' },
        { key: 'stories', label: 'Stories', render: (f) => (f.stories.length ? f.stories.join(', ') : 'None yet') },
        { key: 'dependsOn', label: 'Depends on', render: (f) => (canEdit
          ? html`<span class="dz-inline"><input name="dependsOn" data-feature="${f.id}" value="${(f.dependsOn ?? []).join(', ')}" maxlength="200" placeholder="Nothing" aria-label="Features ${f.id} depends on, by id">${button({ label: 'Save', kind: 'secondary', small: true, attrs: { 'data-action': 'save-feature', 'data-id': f.id, 'aria-label': `Save what ${f.id} depends on` } })}</span>`
          : f.dependsOn?.length ? f.dependsOn.join(', ') : 'Nothing') },
      ],
      rows: d.features,
      empty: 'No features yet.',
    }),
  });
  const more = card({
    title: 'Container view, decisions and the rest',
    body: html`<ul class="dz-criteria"><li><a href="${d.links.architecture}">The container view, ADRs and the standards check</a></li><li>${d.threatModel}</li><li><a href="${d.links.infrastructure}">The infrastructure design is in Infrastructure</a></li></ul>`,
  });
  return html`<div class="actions">${askButton(ctx, d, 'solution', drafters)}</div>${systems}${nfrs}${landscape}${more}`;
}

function functionalPart(ctx, d, drafters) {
  const canEdit = d.writable && ctx.can('draft');
  const side = (i, which) => (canEdit && !i[which] ? html`<input name="${which}" maxlength="120" placeholder="Name the ${which === 'from' ? 'caller' : 'callee'}" aria-label="The ${which} side of ${i.id}">` : i[which] || html`<strong>Missing</strong>`);
  const interfaces = card({
    title: 'Interface requirements',
    meta: d.parts.functional,
    body: html`${dataTable({
      caption: 'Interface requirements',
      columns: [
        { key: 'id', label: 'Id' },
        { key: 'name', label: 'Interface', render: (i) => html`${i.name}<br><span class="muted">${i.kind.toUpperCase()}</span>` },
        { key: 'from', label: 'From', render: (i) => side(i, 'from') },
        { key: 'to', label: 'To', render: (i) => side(i, 'to') },
        { key: 'contract', label: 'Contract' },
        { key: 'state', label: 'Both sides', render: (i) => statusPill({ text: i.complete ? 'Both named' : 'A side missing', tone: i.complete ? 'success' : 'danger' }) },
        { key: 'actions', label: 'Actions', render: (i) => (canEdit ? html`<span class="dz-inline">${!i.complete ? button({ label: 'Save sides', kind: 'secondary', small: true, attrs: { 'data-action': 'save-sides', 'data-id': i.id, 'aria-label': `Save the sides of ${i.id}` } }) : ''}${button({ label: 'Remove', kind: 'secondary', small: true, attrs: { 'data-action': 'remove-interface', 'data-id': i.id, 'aria-label': `Remove ${i.id}` } })}</span>` : '') },
      ],
      rows: d.interfaces,
      empty: 'No interfaces yet.',
    })}
    ${canEdit ? html`<form class="dz-form" data-form="interface-add" aria-label="Add an interface">
      <label>Name<input name="name" maxlength="160" required placeholder="Slot API → Store service"></label>
      <label>Kind<select name="kind"><option value="api">API</option><option value="event">Event</option><option value="file">File</option></select></label>
      <label>From<input name="from" maxlength="120"></label>
      <label>To<input name="to" maxlength="120"></label>
      <label>Contract<input name="contract" maxlength="500"></label>
      ${button({ label: 'Add the interface', type: 'submit', kind: 'secondary', small: true })}</form>` : ''}`,
  });
  const technical = card({
    title: 'Technical requirements',
    meta: `${d.technical.length} per impacted system`,
    body: dataTable({
      caption: 'Technical requirements',
      columns: [{ key: 'id', label: 'Id' }, { key: 'system', label: 'System' }, { key: 'text', label: 'Requirement' }, { key: 'serves', label: 'Serves', render: (t) => (t.serves ?? []).join(', ') }],
      rows: d.technical,
      empty: 'No technical requirements yet.',
    }),
  });
  return html`<div class="actions">${askButton(ctx, d, 'functional', drafters)}</div>${interfaces}${technical}`;
}

function storiesPart(ctx, d, drafters) {
  const canEdit = d.writable && ctx.can('draft');
  const open = d.stories.filter((s) => !s.handedOff);
  return card({
    title: 'Stories',
    meta: d.parts.stories,
    body: html`${d.stories.length ? html`<form data-form="merge">${dataTable({
      caption: 'Stories',
      columns: [
        ...(canEdit ? [{ key: 'pick', label: 'Pick', render: (s) => (s.handedOff ? '' : html`<input type="checkbox" name="merge" value="${s.id}" aria-label="Pick ${s.id} to merge">`) }] : []),
        { key: 'id', label: 'Id' },
        { key: 'title', label: 'Story', render: (s) => html`<strong>${s.title}</strong><p class="dz-traces">Feature ${s.feature} · ${s.featureTitle}</p><p class="dz-traces">Traces: ${(s.requirements ?? []).join(', ') || 'no business requirement'} · ${(s.systems ?? []).join(', ') || 'no system'} · ${(s.interfaces ?? []).length} interfaces · ${(s.technical ?? []).length} technical · ${(s.nfrs ?? []).length} NFRs</p>${s.criteria?.length ? html`<ul class="dz-criteria">${s.criteria.map((c) => html`<li>${c}</li>`)}</ul>` : html`<p class="dz-traces">No acceptance criteria yet</p>`}` },
        { key: 'stage', label: 'Where it is', render: (s) => statusPill({ text: s.handedOff ? `In ${s.stageLabel}` : s.stageLabel === 'Design' ? 'In Design' : s.stageLabel, tone: s.handedOff ? 'success' : 'info' }) },
        ...(canEdit ? [{ key: 'actions', label: 'Actions', render: (s) => (s.handedOff ? html`<a href="${s.href}">Open in Lifecycle</a>` : html`${button({ label: 'Split', kind: 'secondary', small: true, attrs: { 'data-action': 'split', 'data-id': s.id, 'aria-label': `Split ${s.id}` } })}
          <div data-form="split" data-id="${s.id}" hidden><label>New stories, one title per line (the first stays ${s.id})<textarea name="titles" rows="3"></textarea></label>${button({ label: 'Split the story', small: true, attrs: { 'data-action': 'do-split', 'data-id': s.id } })}</div>`) }] : []),
      ],
      rows: d.stories,
    })}${canEdit && open.length > 1 ? html`<div class="actions">${button({ label: 'Merge the picked stories', type: 'submit', kind: 'secondary', small: true })}</div>` : ''}</form>`
      : html`<p class="muted">No stories yet. They are proposed from the feature landscape and the functional analysis.</p>`}
    <div class="actions">${askButton(ctx, d, 'stories', drafters)}</div>`,
  });
}

function handoffPart(ctx, d) {
  // Any person but a Viewer may give a Design handoff (Phase 16b); never an agent.
  const mayHand = d.writable && ctx.person?.kind !== 'agent' && ctx.person?.accessRole !== 'Viewer';
  const ready = d.readiness.total && d.readiness.passed === d.readiness.total;
  const checks = d.readiness.total
    ? checklist({ label: 'Design\'s readiness checks', items: d.readiness.checks.map((c) => ({ text: c.text, state: c.passed ? 'done' : 'failed', note: c.passed ? 'Passes' : 'Fails' })) })
    : html`<p class="muted">Design's checks start with the first part of the design.</p>`;
  const open = d.stories.filter((s) => !s.handedOff);
  return html`${card({ title: 'Before a Design handoff', meta: `${d.readiness.passed} of ${d.readiness.total} checks pass`, body: checks })}
    ${card({
      title: 'Hand stories to Engineering',
      meta: d.parts.handoff,
      body: html`${d.stories.length ? dataTable({
        caption: 'Stories to hand off',
        columns: [
          { key: 'id', label: 'Id' },
          { key: 'title', label: 'Story' },
          { key: 'systems', label: 'Work items', render: (s) => `${(s.systems ?? []).length} (${(s.systems ?? []).join(', ') || 'no system'})` },
          { key: 'stage', label: 'Where it is', render: (s) => (s.handedOff ? statusPill({ text: `Handed off · ${s.stageLabel}`, tone: 'success' }) : mayHand ? button({ label: 'Hand off to Engineering', small: true, attrs: { 'data-action': 'handoff', 'data-id': s.id, 'aria-label': `Hand off ${s.id} to Engineering` } }) : statusPill({ text: 'In Design', tone: 'info' })) },
        ],
        rows: d.stories,
      }) : html`<p class="muted">No stories yet.</p>`}
      ${mayHand && open.length && !ready ? html`<div class="dz-form"><label>Override the failing checks, with a reason<input name="override" maxlength="500" placeholder="Why it can go on anyway"></label></div>` : ''}`,
    })}`;
}

export async function render(view, { params, route, ctx }) {
  const part = route.meta?.part ?? 'requirements';
  const id = params.id;
  let message = '';
  let tone = 'info';
  let d;
  let drafters = null;

  const paint = () => {
    const title = PARTS.find((p) => p.key === part)?.title ?? 'Design';
    const body = { requirements: requirementsPart, solution: solutionPart, functional: functionalPart, stories: storiesPart, handoff: handoffPart }[part](ctx, d, drafters);
    view.innerHTML = String(html`<div class="dz">${pageHead({
      eyebrow: `Software Factory · Design · ${d.ref}`,
      title: `${title}: ${d.title}`,
      lead: d.writable ? `${d.ref} is in Design. ${d.parts.handoff}.` : `${d.ref} is in ${d.stageLabel}, so its design is read only here.`,
      actions: button({ label: 'Open in Lifecycle', kind: 'secondary', small: true, href: d.links.item }),
    })}${tabs(ctx, d, part)}<p class="dz-message${tone === 'error' ? ' dz-message--error' : ''}" role="status" aria-live="polite">${message}</p>${body}</div>`);
  };

  const load = async () => {
    try {
      [d, drafters] = await Promise.all([ctx.api.get(`items/${encodeURIComponent(id)}`), ctx.api.get('drafters').catch(() => null)]);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      view.innerHTML = String(notice({ title: `Couldn't load the design of ${id}`, text: err.message, tone: 'error' }));
      return;
    }
    if (ctx.isCurrent()) paint();
  };

  /** Runs one change; the answer is the item's design, drawn again, and what happened is said. */
  const act = async (fn, done) => {
    try {
      const result = await fn();
      const next = result?.design ?? result;
      if (next?.itemId) d = next;
      [message, tone] = [typeof done === 'function' ? done(result) : done, 'info'];
    } catch (err) {
      if (err?.name === 'AbortError') return;
      [message, tone] = [err.message, 'error'];
    }
    if (ctx.isCurrent()) paint();
  };
  const path = (rest) => `items/${encodeURIComponent(id)}${rest}`;

  view.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const target = el.dataset.id;
    const actions = {
      draft: () => act(() => ctx.api.post(path(`/draft/${el.dataset.part}`), {}), `Drafted ${DRAFTS[el.dataset.part]}.`),
      accept: () => act(() => ctx.api.post(path(`/requirements/${target}/accept`), {}), `${target} accepted.`),
      'edit-req': () => { const f = view.querySelector(`[data-form="req"][data-id="${target}"]`); if (f) f.hidden = !f.hidden; },
      'remove-interface': () => act(() => ctx.api.del(path(`/interfaces/${target}`)), `${target} removed.`),
      'save-sides': () => {
        const row = el.closest('tr');
        const body = {};
        for (const input of row.querySelectorAll('input[name="from"], input[name="to"]')) if (input.value.trim()) body[input.name] = input.value.trim();
        return act(() => ctx.api.patch(path(`/interfaces/${target}`), body), `${target} saved.`);
      },
      'save-feature': () => {
        const input = view.querySelector(`input[data-feature="${CSS.escape(target)}"]`);
        const dependsOn = String(input?.value ?? '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
        return act(() => ctx.api.patch(path(`/features/${target}`), { dependsOn }), dependsOn.length ? `${target} depends on ${dependsOn.join(', ')}.` : `${target} depends on nothing.`);
      },
      split: () => { const f = view.querySelector(`[data-form="split"][data-id="${target}"]`); if (f) f.hidden = !f.hidden; },
      'do-split': () => {
        const f = view.querySelector(`[data-form="split"][data-id="${target}"]`);
        const titles = f.querySelector('textarea').value.split('\n').map((t) => t.trim()).filter(Boolean);
        return act(() => ctx.api.post(path(`/stories/${target}/split`), { parts: titles.map((title) => ({ title })) }), (r) => `${target} split into ${[target, ...(r.made ?? [])].join(', ')}.`);
      },
      handoff: () => {
        const reason = view.querySelector('input[name="override"]')?.value.trim();
        return act(() => ctx.api.post(path(`/stories/${target}/handoff`), reason ? { override: { reason } } : {}), (r) => r.text);
      },
    };
    if (actions[el.dataset.action]) {
      e.preventDefault();
      actions[el.dataset.action]();
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'req') act(() => ctx.api.patch(path(`/requirements/${form.dataset.id}`), { text: form.elements.text.value }), `${form.dataset.id} saved; it is proposed again.`);
    if (kind === 'systems') {
      const systems = d.systems.map((s) => ({
        name: s.name, repo: s.repo, note: s.note,
        change: form.querySelector(`select[data-name="${CSS.escape(s.name)}"]`)?.value ?? s.change,
        team: form.querySelector(`input[data-name="${CSS.escape(s.name)}"]`)?.value.trim() || null,
      }));
      act(() => ctx.api.put(path('/systems'), { systems }), 'The impacted systems are saved.');
    }
    if (kind === 'interface-add') {
      const f = Object.fromEntries(new FormData(form));
      act(() => ctx.api.post(path('/interfaces'), f), (r) => `${r.interfaceId} added${f.from && f.to ? '' : ', with a side still to name'}.`);
    }
    if (kind === 'merge') {
      const ids = [...form.querySelectorAll('input[name="merge"]:checked')].map((c) => c.value);
      act(() => ctx.api.post(path('/stories/merge'), { ids }), `Merged ${ids.slice(1).join(', ')} into ${ids[0]}.`);
    }
  }, { signal: ctx.signal });

  await load();
}
