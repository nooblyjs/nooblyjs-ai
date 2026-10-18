// Platform · Repositories (product.md §5.7 item 14, mockup noobly-platform-repositories): "Agents can only touch what is
// granted here." Filters with counts, the table, and a repository's settings in a panel beside it (its own page at
// phone width). Changing access needs change-repo-access (Owner); the server checks, this page only hides controls.
// A repository's page has its own chat thread, so a question to a teammate there is checked against its access.
import { html } from '/ui/js/html.js';
import { button, chips, dataTable, statusPill } from '/ui/js/components/index.js';
import { head, flash, errorText, toggle, syncToggle, onChange } from './lib.js';

const LEAD = 'Agents can only touch what is granted here.';
const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'factory', label: 'Factory enabled' },
  { value: 'read-only', label: 'Read only' }, { value: 'not-indexed', label: 'Not indexed' },
];
const ACCESS = [{ value: 'none', label: 'No agent access' }, { value: 'read', label: 'Read only' }, { value: 'read-prs', label: 'Read + open PRs' }];
const TOGGLES = [
  { key: 'readCode', label: 'Read code and history' }, { key: 'pushAgentBranches', label: 'Push to agent branches' },
  { key: 'openPrs', label: 'Open pull requests' }, { key: 'merge', label: 'Merge after all gates pass' },
  { key: 'indexKnowledge', label: 'Index into Knowledge' },
];
const accessTone = (a) => (a === 'none' ? 'danger' : a === 'read' ? 'warning' : 'success');

function table(list, selected) {
  return dataTable({
    caption: 'Repositories',
    empty: 'No repositories match this filter.',
    rows: list,
    columns: [
      { key: 'name', label: 'Repository', render: (r) => html`<a class="repo-link" href="/platform/repositories/${r.id}"${r.id === selected ? html` aria-current="true"` : ''}>${r.name}</a>${r.source === 'bitbucket' ? html` ${statusPill({ text: r.gone ? 'Gone from Bitbucket' : 'Bitbucket', tone: r.gone ? 'danger' : 'info', dot: false })}` : r.sampleData ? html` ${statusPill({ text: 'Sample', tone: 'neutral', dot: false })}` : ''}<span class="repo-sub">${r.branch}${r.notes ? ` · ${r.notes}` : ''}</span>` },
      { key: 'stack', label: 'Stack' },
      { key: 'access', label: 'Agent access', render: (r) => statusPill({ text: r.accessText, tone: accessTone(r.access) }) },
      { key: 'image', label: 'Base image', render: (r) => html`<span class="mono">${r.build.image || '—'}</span>` },
      { key: 'gates', label: 'Gates', render: (r) => (r.gates ? r.gates : html`<span aria-hidden="true">—</span><span class="visually-hidden">No gates: agents can't open PRs here</span>`) },
      { key: 'lastActivity', label: 'Last activity', render: (r) => r.lastActivity || '—' },
    ],
  });
}

function panel(data, { canChange, message }) {
  const r = data.repository;
  const locked = (key) => !canChange || key === 'merge' || r.access === 'none' || (r.access === 'read' && ['pushAgentBranches', 'openPrs'].includes(key));
  return html`<section class="card panel" aria-labelledby="repo-title">
    <div class="card__head"><h2 class="card__title" id="repo-title">${r.shortName} · repository settings</h2>
      ${r.url ? html`<span class="card__meta">${button({ label: 'View on Bitbucket', kind: 'secondary', small: true, href: r.url, attrs: { target: '_blank', rel: 'noopener' } })}</span>` : ''}</div>
    <p class="note">${r.source === 'bitbucket'
    ? (r.gone ? 'This repository is no longer in Bitbucket. NooblyJS keeps its record.' : 'Read from Bitbucket. NooblyJS never writes to it; agent access below is NooblyJS\'s own record.')
    : r.sampleData ? 'Sample data for the seed story: not a repository in Bitbucket.' : 'NooblyJS\'s own record of a repository: not imported from Bitbucket.'}</p>
    ${live(data.live, r)}
    ${flash(message)}
    <div>
      <h3>Agent access</h3>
      ${canChange ? html`<label class="field">Agent access<select name="access" data-change="access">${ACCESS.map((a) => html`<option value="${a.value}"${a.value === r.access ? html` selected` : ''}>${a.label}</option>`)}</select></label>`
        : html`<p>${statusPill({ text: r.accessText, tone: accessTone(r.access) })}</p>`}
    </div>
    <div>
      <h3>Build &amp; test</h3>
      <dl class="defs"><dt>Install</dt><dd class="mono">${r.build.install || '—'}</dd><dt>Test</dt><dd class="mono">${r.build.test || '—'}</dd><dt>Container image</dt><dd class="mono">${r.build.image || '—'}</dd></dl>
    </div>
    <div>
      <h3>What agents may do</h3>
      <ul class="toggles">${TOGGLES.map((t) => html`<li><span>${t.label}${t.key === 'merge' ? html` <span class="note">Agents never merge to main (governance). People merge.</span>` : ''}</span>${toggle({ name: t.key, checked: r.may[t.key], label: t.label, disabled: locked(t.key), attrs: html`data-toggle="${t.key}"` })}</li>`)}</ul>
    </div>
    <div>
      <h3>Secrets &amp; environments</h3>
      ${data.secrets.length ? html`<ul class="secret-list">${data.secrets.map((s) => html`<li><span class="mono">${s.name}</span><span class="muted">${s.ref.replace(/^vault:([^/]+)\/.*/, 'vault · $1')}</span></li>`)}</ul>` : html`<p class="note">No secrets mapped.</p>`}
      <p class="note">Agents never see production secrets. Preview environments get staging values only. <a href="/platform/secrets">Manage secrets</a></p>
    </div>
  </section>`;
}

/** What Bitbucket says right now: the last commits, branches and open pull requests, or why it cannot be read. */
function live(l, r) {
  if (!l) return '';
  if (!l.ok) return html`<div><h3>From Bitbucket</h3><p class="note">${l.reason === 'scope' ? `NooblyJS's Bitbucket token cannot read this repository${l.scope ? ` (it needs ${l.scope})` : ''}.` : `Bitbucket could not be read just now: ${l.message}`}${r.lastCommit ? ` Last seen: ${r.lastActivity}.` : ''}</p></div>`;
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const prs = l.pullRequests;
  return html`<div data-live>
    <h3>From Bitbucket</h3>
    <dl class="defs"><dt>Project</dt><dd>${l.repository.project ? `${l.repository.project.name} (${l.repository.project.key})` : '—'}</dd>
      <dt>Main branch</dt><dd class="mono">${l.repository.branch ?? '—'}</dd>
      <dt>Branches</dt><dd>${l.branches.length ? l.branches.map((b) => b.name).slice(0, 6).join(', ') : '—'}${l.branches.length > 6 ? ` and ${l.branches.length - 6} more` : ''}</dd>
      <dt>Open pull requests</dt><dd>${prs.ok ? (prs.total ? html`<ul class="secret-list">${prs.list.slice(0, 5).map((p) => html`<li><a href="${p.url}" target="_blank" rel="noopener">#${p.id} ${p.title}</a><span class="muted">${p.author ?? ''}</span></li>`)}</ul>` : 'None') : `This token cannot read pull requests${prs.scope ? ` (it needs ${prs.scope})` : ''}.`}</dd></dl>
    ${l.commits.length ? html`<h3>Latest commits</h3><ul class="secret-list">${l.commits.map((c) => html`<li><span><span class="mono">${c.hash.slice(0, 7)}</span> ${c.message}</span><span class="muted">${c.author ?? ''} · ${date(c.at)}</span></li>`)}</ul>` : ''}
  </div>`;
}

function connectForm(message) {
  return html`<section class="card" aria-label="Connect repository" id="connect">
    <div class="card__head"><h2 class="card__title">Connect repository</h2><span class="card__meta">Agents start with read-only access</span></div>
    ${flash(message)}
    <form class="form form--inline" data-form="connect">
      <label class="field">Repository (owner/repo)<input name="name" required maxlength="160" placeholder="acme/data-pipelines" autocomplete="off"></label>
      <label class="field">Branch<input name="branch" maxlength="100" value="main" autocomplete="off"></label>
      <label class="field">Stack<input name="stack" maxlength="60" autocomplete="off"></label>
      <div class="actions">${button({ label: 'Connect', type: 'submit' })}</div>
    </form>
  </section>`;
}

export async function render(view, { ctx, params }) {
  let filter = 'all';
  let message = null;
  let showConnect = false;
  const selected = params.id ?? null;
  const api = ctx.hostApi;
  if (selected) ctx.chat.scope({ kind: 'repository', id: selected });

  async function draw() {
    const [list, detail] = await Promise.all([
      api.get('platform/repositories', { query: { filter } }),
      selected ? api.get(`platform/repositories/${encodeURIComponent(selected)}`).catch((err) => ({ error: err })) : null,
    ]);
    if (!ctx.isCurrent()) return;
    const canChange = ctx.can('change-repo-access');
    if (detail?.repository) ctx.setTitle(detail.repository.name);
    const counted = FILTERS.map((f) => ({ ...f, count: list.counts[f.value] }));
    view.innerHTML = String(html`${head('Repositories', `${list.counts.all} connected. ${LEAD}`, canChange ? html`${button({ label: 'Refresh from Bitbucket', kind: 'secondary', attrs: { 'data-action': 'import' } })}${button({ label: 'Connect repository', icon: 'plus', attrs: { 'data-action': 'connect', 'aria-expanded': showConnect ? 'true' : 'false' } })}` : '')}
    ${showConnect ? connectForm(message) : !selected ? flash(message) : ''}
    ${chips({ label: 'Show repositories', name: 'filter', items: counted, current: filter })}
    <div class="repos${detail ? ' repos--detail' : ''}">
      <section class="card card--flush" aria-label="Repositories">${table(list.repositories, selected)}</section>
      ${detail?.repository ? panel(detail, { canChange, message: showConnect ? null : message })
        : detail?.error ? html`<section class="card" role="alert"><p>${errorText(detail.error)}</p><p>${button({ label: 'All repositories', kind: 'secondary', href: '/platform/repositories' })}</p></section>` : ''}
    </div>`);
  }

  async function change(patch, done) {
    try {
      const { repository } = await api.patch(`platform/repositories/${encodeURIComponent(selected)}`, patch);
      message = { tone: 'ok', text: done(repository) };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }

  view.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      return draw();
    }
    const refresh = event.target.closest('[data-action="import"]');
    if (refresh) {
      refresh.disabled = true;
      try {
        const r = await api.post('platform/repositories/import', {});
        message = { tone: 'ok', text: `Read from Bitbucket: ${r.added.length} new, ${r.updated.length} refreshed${r.gone.length ? `, ${r.gone.length} no longer there` : ''}${r.missing.length ? `. Not found: ${r.missing.join(', ')}` : ''}.` };
      } catch (err) {
        if (err?.name === 'AbortError') return undefined;
        message = { tone: 'error', text: errorText(err) };
      }
      return draw();
    }
    if (event.target.closest('[data-action="connect"]')) {
      showConnect = !showConnect;
      message = null;
      await draw();
      if (showConnect) view.querySelector('#connect input')?.focus();
    }
  }, { signal: ctx.signal });

  view.addEventListener('change', (event) => {
    const access = event.target.closest('[data-change="access"]');
    if (access) return change({ access: access.value }, (r) => `Agent access on ${r.name} is now "${r.accessText}".`);
    const box = event.target.closest('[data-toggle]');
    if (!box) return undefined;
    syncToggle(box);
    const label = TOGGLES.find((t) => t.key === box.dataset.toggle)?.label ?? box.dataset.toggle;
    return change({ may: { [box.dataset.toggle]: box.checked } }, (r) => `${label} is ${r.may[box.dataset.toggle] ? 'on' : 'off'} for ${r.name}.`);
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="connect"]');
    if (!form) return;
    event.preventDefault();
    try {
      const { repository } = await api.post('platform/repositories', Object.fromEntries(new FormData(form)));
      message = { tone: 'ok', text: `${repository.name} is connected. Agents may read it; change that in its settings.` };
      showConnect = false;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  onChange(ctx, draw, { types: ['repo.', 'secret.'] });
  await draw();
}
