// Stage 2 · Architecture for one item (product.md §5.3, mockup noobly-product-factory-architecture): tabs Diagram /
// Decisions / Contracts / Standards; the container view (New / Existing / External) with its provenance and Edit as
// code; decisions with Accept / Discuss and New ADR; the standards check; the quality attributes (Factory gates).
import { html } from '/ui/js/html.js';
import { pageHead, card, button, statusPill, checklist, dataTable } from '/ui/js/components/index.js';
import { hrefFor, errorCard, isAbort, reloadable, say, followDraft, drafterName, nobodyDrafts } from '../lib.js';

const TABS = [['diagram', 'Diagram'], ['decisions', 'Decisions'], ['contracts', 'Contracts'], ['standards', 'Standards'], ['knowledge', 'Knowledge'], ['repositories', 'Repositories']];
const MAX_MATCHES = 20;
const ADR_TONE = { proposed: 'warning', accepted: 'success', superseded: 'neutral' };
const STATUS_WORD = { new: 'New', existing: 'Existing', external: 'External' };

/** Layers for the container view: each node one step further from the callers than what calls it. */
function layers(nodes, edges) {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      const next = (depth.get(e.from) ?? 0) + 1;
      if (depth.has(e.to) && next > depth.get(e.to) && next < nodes.length) {
        depth.set(e.to, next);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows = [];
  for (const n of nodes) (rows[depth.get(n.id)] ??= []).push(n);
  return rows.filter(Boolean);
}

/** What the code looks like, shown in an empty editor. */
const C4_EXAMPLE = [
  'C4Container',
  'title Container view · slots',
  'Container(slotApi, "Slot API", "Node 22", "holds and releases slots", $tags="new")',
  'ContainerDb(slotDb, "Slot store", "Postgres", "slots and holds", $tags="new")',
  'System_Ext(planner, "Delivery planner", "routes")',
  'Rel(slotApi, slotDb, "SQL")',
  'Rel(slotApi, planner, "HTTPS")',
].join('\n');

/** The container view as code (Mermaid C4): Edit as code, or a person writing the first version themselves. */
function codeEditor(d, ctx) {
  if (!ctx.can('draft')) return '';
  return html`<form class="pf-form pf-code" data-form="code" hidden>
      <label>Container view as code (Mermaid C4) <textarea name="code" rows="16" spellcheck="false" placeholder="${C4_EXAMPLE}">${d.code}</textarea></label>
      <label>What changed? <input name="changeNote" maxlength="300" autocomplete="off"></label>
      <div class="actions">${button({ label: 'Save the diagram', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-code' } })}</div>
    </form>`;
}

function containerView(d, ctx, drafter = null) {
  const who = drafterName(drafter);
  if (!d.version) {
    const write = button({ label: 'Write it as code', kind: who ? 'secondary' : 'primary', small: true, icon: 'pen', attrs: { 'data-action': 'edit-code' } });
    return card({
      title: 'Container view',
      body: html`<p class="muted">No container view yet.</p>${ctx.can('draft') ? html`${who ? '' : nobodyDrafts(drafter, 'write it yourself as code.')}<div class="actions">${who ? button({ label: `Ask ${who} to draft the container view`, kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'draft', 'data-kind': 'container-view' } }) : ''}${write}</div>${codeEditor(d, ctx)}` : ''}`,
    });
  }
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const legend = html`<ul class="pf-legend" role="list">${['new', 'existing', 'external'].map((s) => html`<li><span class="pf-node-key pf-node-key--${s}" aria-hidden="true"></span>${STATUS_WORD[s]}</li>`)}</ul>`;
  const diagramRows = layers(d.nodes, d.edges).map((row) => html`<li class="pf-layer"><ul class="pf-layer__nodes" role="list">${row.map((n) => html`<li class="pf-node pf-node--${n.status} pf-node--${n.kind}">
      <span class="pf-node__label">${n.label}</span>
      <span class="pf-node__meta">${[n.tech, n.description].filter(Boolean).join(' · ')}</span>
      <span class="pf-node__status">${STATUS_WORD[n.status]}</span>
    </li>`)}</ul></li>`);
  const edges = html`<ul class="pf-edges" role="list">${d.edges.map((e) => html`<li><span>${byId.get(e.from)?.label ?? e.from}</span> <span aria-hidden="true">→</span><span class="visually-hidden">calls</span> <span>${byId.get(e.to)?.label ?? e.to}</span>${e.label ? html` <span class="pf-edge__label">${e.label}</span>` : ''}</li>`)}</ul>`;
  const editor = codeEditor(d, ctx);
  return html`<section class="card pf-diagram" aria-label="Container view">
    <div class="card__head"><h2 class="card__title">${d.title ?? 'Container view'}</h2>${legend}</div>
    <ol class="pf-layers" aria-label="Containers, callers first">${diagramRows}</ol>
    <details class="pf-details"><summary>How they connect (${d.edges.length})</summary>${edges}</details>
    <div class="pf-provenance"><span>${d.provenance?.text ?? ''}${d.version ? ` · v${d.version}` : ''}</span>${ctx.can('draft') ? button({ label: 'Edit as code', kind: 'secondary', small: true, icon: 'pen', attrs: { 'data-action': 'edit-code' } }) : ''}</div>
    ${editor}
  </section>`;
}

function adrCard(a, ctx, { full = false } = {}) {
  const canAccept = ctx.can('accept-decisions') && a.status === 'proposed';
  const actions = [
    canAccept ? button({ label: 'Accept', small: true, attrs: { 'data-action': 'accept', 'data-id': a.id, 'aria-label': `Accept ${a.id}` } }) : '',
    ctx.can('draft') && a.status === 'proposed' ? button({ label: 'Discuss', kind: 'secondary', small: true, attrs: { 'data-action': 'discuss', 'data-id': a.id, 'aria-label': `Discuss ${a.id}` } }) : '',
  ];
  return html`<li class="pf-adr">
    <div class="pf-adr__head"><span class="pf-adr__id">${a.id}</span>${statusPill({ text: a.statusText, tone: ADR_TONE[a.status] ?? 'neutral' })}</div>
    <span class="pf-adr__title">${a.title}</span>
    ${a.needs ? html`<span class="pf-adr__needs">${a.needs}</span>` : ''}
    ${a.supersededBy ? html`<span class="pf-adr__needs">Superseded by ${a.supersededBy}</span>` : ''}
    ${full ? html`${a.context ? html`<p><strong>Context.</strong> ${a.context}</p>` : ''}${a.decision ? html`<p><strong>Decision.</strong> ${a.decision}</p>` : ''}${a.consequences ? html`<p><strong>Consequences.</strong> ${a.consequences}</p>` : ''}${a.alternative ? html`<p><strong>Alternative considered.</strong> ${a.alternative}</p>` : ''}
      ${a.discussion.length ? html`<ul class="pf-links" role="list" aria-label="Discussion">${a.discussion.map((c) => html`<li><span class="pf-links__title">${c.by?.name ?? c.by?.id}</span><span class="pf-links__meta">${c.text}</span></li>`)}</ul>` : ''}` : ''}
    ${actions.some(Boolean) ? html`<div class="actions">${actions}</div>` : ''}
    <form class="pf-form pf-form--inline" data-form="discuss" data-id="${a.id}" hidden>
      <label>Your comment on ${a.id} <textarea name="text" rows="2" required maxlength="2000"></textarea></label>
      <div class="actions">${button({ label: 'Post comment', type: 'submit', kind: 'secondary', small: true })}</div>
    </form>
  </li>`;
}

function decisionsCard(adrs, ctx, { full = false, drafter = null } = {}) {
  // The hired teammate who drafts architecture (stage-agents.js). With nobody, a person writes the ADR (New ADR).
  const who = drafterName(drafter);
  const ask = who ? button({ label: `Ask ${who} to propose one`, kind: 'accent', small: true, icon: 'spark', attrs: { 'data-action': 'draft', 'data-kind': 'adr' } }) : '';
  const action = ctx.can('draft') ? html`<div class="actions">${button({ label: 'New ADR', kind: 'secondary', small: true, icon: 'plus', attrs: { 'data-action': 'new-adr' } })}${ask}</div>${!who && full ? nobodyDrafts(drafter, 'press New ADR to write one yourself.') : ''}` : '';
  return card({
    title: 'Decisions',
    body: html`${action}${adrs.length ? html`<ul class="pf-adrs" role="list">${adrs.map((a) => adrCard(a, ctx, { full }))}</ul>` : html`<p class="muted">No decisions yet.</p>`}`,
  });
}

function newAdrForm(d) {
  const deps = d.nodes.filter((n) => n.status !== 'existing');
  return html`<form class="card pf-form" data-form="new-adr" hidden>
    <h2 class="card__title">New architecture decision</h2>
    <label>Title <input name="title" required maxlength="160" autocomplete="off"></label>
    <label>Context <textarea name="context" rows="3"></textarea></label>
    <label>Decision <textarea name="decision" rows="3"></textarea></label>
    <label>Consequences <textarea name="consequences" rows="2"></textarea></label>
    <label>The new dependency it adds, if any <select name="dependency"><option value="">None</option>${deps.map((n) => html`<option value="${n.id}">${n.label}</option>`)}</select></label>
    <div class="actions">${button({ label: 'Propose', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-adr' } })}</div>
  </form>`;
}

function standardsCard(s) {
  return card({
    title: 'Standards check',
    meta: s.text,
    body: checklist({ label: `Standards check, ${s.text}`, items: s.checks.map((c) => ({ text: c.label ?? c.text, state: c.passed === true ? 'done' : c.passed === false ? 'failed' : 'todo', note: c.passed === false ? c.text : c.passed === null ? c.text : undefined })) }),
  });
}

function qaCard(qa) {
  return card({
    title: 'Quality attributes',
    meta: qa.gates,
    body: dataTable({
      caption: 'Quality attributes',
      empty: 'No quality attributes yet.',
      rows: qa.attributes,
      columns: [{ key: 'attribute', label: 'Attribute' }, { key: 'scenario', label: 'Scenario' }, { key: 'target', label: 'Target' }, { key: 'verifiedBy', label: 'Verified by' }],
    }),
  });
}

/**
 * The Knowledge tab: files and folders from the Knowledge Repository that this item is built with, each with a note on
 * what it is for. Search Knowledge (files and folders), then Link; the note can be changed or the link removed. The
 * Software Factory reads them as context for the item's work items.
 */
const whereIs = (k) => `[${k.space}]\\${String(k.path).split('/').join('\\')}`;

function knowledgeRow(k, canChoose, editing) {
  const name = k.href ? html`<a href="${k.href}">${k.title}</a>` : k.title;
  return html`<li class="pf-repo pf-know">
    <div class="pf-repo__main">
      <span class="pf-repo__name">${k.kind === 'folder' ? 'Folder' : 'File'} · ${name}</span>
      <span class="muted mono">${whereIs(k)}</span>
      ${editing ? html`<form class="pf-know__note" data-form="kn-note" data-id="${k.id}" aria-label="Note on ${k.title}">
          <label>What is it for?<input name="note" maxlength="300" value="${k.note ?? ''}" autocomplete="off"></label>
          <div class="actions">${button({ label: 'Save note', type: 'submit', small: true })}${button({ label: 'Cancel', kind: 'secondary', small: true, attrs: { 'data-kn-cancel': k.id } })}</div>
        </form>` : html`<span class="pf-know__said">${k.note ? k.note : html`<span class="muted">No note on what it is for.</span>`}</span>`}
    </div>
    ${canChoose && !editing ? html`<div class="actions">${button({ label: 'Edit note', kind: 'secondary', small: true, attrs: { 'data-kn-edit': k.id, 'aria-label': `Edit the note on ${k.title}` } })}${button({ label: 'Remove', kind: 'secondary', small: true, attrs: { 'data-kn-remove': k.id, 'aria-label': `Remove ${k.title}` } })}</div>` : ''}
  </li>`;
}

/** Search results: folders first, then files, each with Link (or Linked). */
function knowledgeResults(found, state) {
  if (state.error) return html`<div data-kn-results><p class="muted" role="alert">${state.error}</p></div>`;
  if (!found) return html`<div data-kn-results><p class="muted">Type at least two letters to search Knowledge.</p></div>`;
  const row = (x) => html`<li class="pf-repo">
      <div class="pf-repo__main"><span class="pf-repo__name">${x.kind === 'folder' ? 'Folder' : 'File'} · ${x.title}</span><span class="muted mono">${whereIs(x)}${x.kind === 'folder' ? ` · ${x.documents} document${x.documents === 1 ? '' : 's'} found` : x.docKind ? ` · ${x.docKind}` : ''}</span></div>
      ${x.linked ? html`<span class="muted">Linked</span>` : button({ label: 'Link', kind: 'secondary', small: true, attrs: { 'data-kn-link': JSON.stringify({ kind: x.kind, space: x.space, path: x.path }), 'aria-label': `Link ${x.kind} ${x.title}` } })}
    </li>`;
  const none = !found.folders.length && !found.files.length;
  return html`<div data-kn-results>${none ? html`<p class="muted">Nothing in Knowledge matches "${found.query}".</p>` : html`
    ${found.folders.length ? html`<h3 class="pf-know__group">Folders</h3><ul class="pf-repos" role="list" aria-label="Folders that match">${found.folders.map(row)}</ul>` : ''}
    ${found.files.length ? html`<h3 class="pf-know__group">Files</h3><ul class="pf-repos" role="list" aria-label="Files that match">${found.files.map(row)}</ul>` : ''}`}</div>`;
}

function knowledgeTab(k, ctx, state) {
  const canChoose = ctx.can('draft') && ctx.person?.kind !== 'agent';
  return html`<section class="card" aria-labelledby="pf-know-title">
      <div class="card__head"><h2 class="card__title" id="pf-know-title">Knowledge for ${k.itemId}</h2><span class="card__meta">${k.text}</span></div>
      ${k.links.length ? html`<ul class="pf-repos" role="list" aria-label="${k.itemId}'s knowledge">${k.links.map((x) => knowledgeRow(x, canChoose, state.editing === x.id))}</ul>` : html`<p class="muted">None yet. Link the standards, decisions and documents this item must follow: the Software Factory reads them with each work item.</p>`}
    </section>
    ${canChoose ? html`<section class="card" aria-labelledby="pf-know-add-title">
      <div class="card__head"><h2 class="card__title" id="pf-know-add-title">Add knowledge</h2><span class="card__meta">From the Knowledge Repository</span></div>
      <div class="pf-know__fields">
        <label class="pf-search">Search Knowledge <input type="search" data-kn-search value="${state.query}" placeholder="A file or folder, e.g. queueing standard" autocomplete="off"></label>
        <label class="pf-search"><span>What is it for? <span class="muted">(optional, saved with the next link)</span></span><input data-kn-note-new maxlength="300" value="${state.note}" placeholder="e.g. Data relating to application standard" autocomplete="off"></label>
      </div>
      ${knowledgeResults(state.found, state)}
    </section>` : html`<p class="muted">Linking knowledge needs the draft permission.</p>`}`;
}

/**
 * The Repositories tab (NooblyJS Phase 11): where the item is built. Its repositories start as its product's; here a
 * person removes the ones it doesn't touch and adds others, found by searching Platform's catalogue (NooblyJS's list of
 * repositories, imported from Bitbucket). Each change is saved at once. The handoff only sends work to these.
 */
const repoMeta = (r) => [r.source === 'bitbucket' ? 'Bitbucket' : r.sampleData ? 'Sample' : 'NooblyJS record', r.project, r.stack, r.branch].filter(Boolean).join(' · ');

function repoRow(r, { action, canChoose }) {
  const name = r.url ? html`<a href="${r.url}" target="_blank" rel="noopener">${r.name}</a>` : r.name;
  const verb = action === 'add' ? 'Add' : 'Remove';
  return html`<li class="pf-repo">
    <div class="pf-repo__main"><span class="pf-repo__name">${name}</span><span class="muted">${repoMeta(r)}${r.accessText ? ` · agents: ${r.accessText}` : ''}${r.gone ? ' · no longer in Bitbucket' : ''}</span></div>
    ${canChoose ? button({ label: verb, kind: action === 'add' ? 'secondary' : 'secondary', small: true, attrs: { [`data-${action}-repo`]: r.name, 'aria-label': `${verb} ${r.name}` } }) : ''}
  </li>`;
}

/** Platform's repositories that match the search and are not in the item yet, the closest first. */
function matches(choices, chosen, q) {
  const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return choices
    .filter((c) => !chosen.includes(c.name) && !c.gone)
    .filter((c) => words.every((w) => [c.name, c.project, c.stack, c.notes].join(' ').toLowerCase().includes(w)));
}

function resultsList(found, canChoose) {
  if (!found.length) return html`<p class="muted" data-repo-results>No repository in Platform matches. Platform · Repositories imports more from Bitbucket.</p>`;
  return html`<div data-repo-results><ul class="pf-repos" role="list" aria-label="Repositories you can add">${found.slice(0, MAX_MATCHES).map((r) => repoRow(r, { action: 'add', canChoose }))}</ul>
    ${found.length > MAX_MATCHES ? html`<p class="muted">${found.length - MAX_MATCHES} more: type more of the name to narrow it.</p>` : ''}</div>`;
}

function repositoriesTab(r, choices, ctx, q) {
  const canChoose = ctx.can('draft') && ctx.person?.kind !== 'agent';
  const byName = new Map(choices.map((c) => [c.name, c]));
  const chosen = r.repositories.map((x) => x.name);
  const mine = r.repositories.map((x) => ({ ...(byName.get(x.name) ?? {}), ...x, url: x.url ?? byName.get(x.name)?.url ?? null }));
  return html`<section class="card" aria-labelledby="pf-repos-title">
      <div class="card__head"><h2 class="card__title" id="pf-repos-title">Repositories for ${r.itemId}</h2><span class="card__meta">${r.text}</span></div>
      ${mine.length ? html`<ul class="pf-repos" role="list" aria-label="${r.itemId}'s repositories">${mine.map((x) => repoRow(x, { action: 'remove', canChoose }))}</ul>` : html`<p class="muted">None yet. Add the repositories this item changes: the handoff can only send work items to these.</p>`}
      <p class="muted">The handoff can only send work items to these repositories.${r.jiraProject ? ` Jira project: ${r.jiraProject}.` : ''}</p>
    </section>
    ${canChoose ? html`<section class="card" aria-labelledby="pf-repos-add-title">
      <div class="card__head"><h2 class="card__title" id="pf-repos-add-title">Add a repository</h2><span class="card__meta">${choices.length} in Platform</span></div>
      <label class="pf-search">Search repositories <input type="search" data-repo-search value="${q}" placeholder="Name, project or stack, e.g. harness" autocomplete="off"></label>
      ${resultsList(matches(choices, chosen, q), canChoose)}
    </section>` : html`<p class="muted">Choosing an item's repositories needs the draft permission.</p>`}`;
}

function contractsCard(d) {
  const apis = d.nodes.filter((n) => n.status === 'new' && n.kind === 'container');
  return card({
    title: 'Contracts',
    meta: 'Every API has a contract',
    body: dataTable({
      caption: 'Contracts',
      empty: 'No new APIs in this design.',
      rows: apis.map((n) => ({ n, c: d.contracts.find((c) => c.container === n.id) })),
      columns: [
        { key: 'api', label: 'Container', render: (r) => r.n.label },
        { key: 'contract', label: 'Contract', render: (r) => r.c?.name ?? 'None yet' },
        { key: 'status', label: 'Status', render: (r) => statusPill({ text: r.c ? r.c.status ?? 'draft' : 'Missing', tone: r.c ? 'info' : 'warning' }) },
      ],
    }),
  });
}

export async function render(view, { params, query, ctx }) {
  const id = params.id;
  // The item's team chat thread, shared with its Spec page (NooblyJS team chat).
  ctx.chat.scope({ kind: 'architecture', id });
  let tab = TABS.some(([k]) => k === query.get('tab')) ? query.get('tab') : 'diagram';
  let data = null;
  let search = ''; // the Repositories tab's search, kept across redraws
  // The Knowledge tab: its search, the note for the next link, the results, and the link whose note is being edited.
  const know = { query: '', note: '', found: null, error: null, editing: null, asked: 0 };

  async function load() {
    const base = `architecture/${encodeURIComponent(id)}`;
    const [spec, diagram, { adrs }, standards, qa, repositories, knowledge, platform, drafters] = await Promise.all([
      ctx.api.get(`specs/${encodeURIComponent(id)}`), ctx.api.get(`${base}/diagram`), ctx.api.get(`${base}/adrs`),
      ctx.api.get(`${base}/standards-check`), ctx.api.get(`${base}/quality-attributes`), ctx.api.get(`${base}/repositories`), ctx.api.get(`${base}/knowledge`),
      // Platform's list, to choose from (NooblyJS's own API; not there when the Product Factory runs on its own).
      ctx.hostApi ? ctx.hostApi.get('platform/repositories').catch(() => null) : null,
      // Who drafts architecture: a teammate hired in Digital Teammates (or nobody yet).
      ctx.api.get('drafters').catch(() => null),
    ]);
    const choices = (platform?.repositories ?? []).map((r) => ({ name: r.name, project: r.project ?? null, stack: r.stack ?? '', branch: r.branch ?? null, notes: r.notes ?? '', source: r.source ?? null, sampleData: r.sampleData === true, accessText: r.accessText ?? null, url: r.url ?? null, gone: r.gone === true }));
    return { spec, diagram, adrs, standards, qa, repositories, knowledge, choices, drafter: drafters?.architecture ?? null };
  }

  function paint() {
    const { spec, diagram, adrs, standards, qa, repositories, knowledge, choices, drafter } = data;
    const fresh = diagram.nodes.filter((n) => n.status === 'new').length;
    const open = adrs.filter((a) => a.status === 'proposed').length;
    const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    const summary = diagram.version ? ` ${words[fresh] ?? fresh} new container${fresh === 1 ? '' : 's'}, ${(words[open] ?? String(open)).toLowerCase()} decision${open === 1 ? '' : 's'} to sign off.` : '';
    const lead = html`Solution design for <a href="${hrefFor(ctx, `/specs/${spec.id}`)}">${spec.id} · ${spec.title}</a>.${summary}`;
    const tabs = html`<div class="pf-tabs" role="tablist" aria-label="Architecture views">${TABS.map(([k, l]) => html`<button type="button" role="tab" class="pf-tab" id="pf-tab-${k}" aria-selected="${k === tab}" aria-controls="pf-panel" data-tab="${k}">${l}</button>`)}</div>`;
    let panel;
    if (tab === 'diagram') {
      panel = html`<div class="pf-columns"><div class="pf-body pf-stack">${containerView(diagram, ctx, drafter)}</div><aside class="pf-rail" aria-label="Decisions and standards">${decisionsCard(adrs, ctx, { drafter })}${standardsCard(standards)}</aside></div>${qaCard(qa)}`;
    } else if (tab === 'decisions') {
      panel = decisionsCard(adrs, ctx, { full: true, drafter });
    } else if (tab === 'contracts') {
      panel = contractsCard(diagram);
    } else if (tab === 'knowledge') {
      panel = knowledgeTab(knowledge, ctx, know);
    } else if (tab === 'repositories') {
      panel = repositoriesTab(repositories, choices, ctx, search);
    } else {
      panel = html`${standardsCard(standards)}${qaCard(qa)}`;
    }
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Product Factory · Stage 2', title: 'Architecture', lead })}
      ${tabs}
      <p class="pf-message" role="status" aria-live="polite" data-message></p>
      <div class="pf-draft" data-draft hidden></div>
      ${ctx.can('draft') ? newAdrForm(diagram) : ''}
      <div id="pf-panel" role="tabpanel" aria-labelledby="pf-tab-${tab}" class="pf-stack">${panel}</div>`);
  }

  async function draw() {
    try {
      data = await load();
    } catch (err) {
      if (isAbort(err)) return;
      view.innerHTML = String(err.status === 404 ? html`${pageHead({ eyebrow: 'Product Factory · Stage 2', title: 'Architecture' })}<p class="muted">There is no spec ${id}. <a href="${hrefFor(ctx, '/architecture')}">See the Architecture list</a>.</p>` : errorCard(err, `${id}'s architecture`));
      return;
    }
    if (!ctx.isCurrent()) return;
    ctx.setTitle(`Architecture · ${data.spec.id}`);
    paint();
  }

  const message = () => view.querySelector('[data-message]');
  async function act(fn, done) {
    try {
      const result = await fn();
      await draw();
      if (done) say(message(), typeof done === 'function' ? done(result) : done, 'success');
    } catch (err) {
      if (isAbort(err)) return;
      const details = err.details ? ` ${Object.entries(err.details).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : '';
      say(message(), `${err.message}${details}`, 'error');
    }
  }

  async function askToDraft(kind) {
    try {
      const job = await ctx.api.post(`architecture/${encodeURIComponent(id)}/drafts`, { kind });
      const box = view.querySelector('[data-draft]');
      const done = await followDraft(ctx, job.draftId, (j) => {
        box.hidden = false;
        box.innerHTML = String(html`<span>${j.text}</span><span class="pf-progress" role="progressbar" aria-label="${j.text}" aria-valuenow="${j.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${j.progress}%"></span></span>`);
      });
      await draw();
      say(message(), done.text, done.status === 'done' ? 'success' : 'error');
    } catch (err) {
      if (!isAbort(err)) say(message(), err.message, 'error');
    }
  }

  view.addEventListener('click', async (e) => {
    const t = e.target;
    const tabButton = t.closest('[data-tab]');
    if (tabButton) {
      tab = tabButton.dataset.tab;
      paint();
      view.querySelector(`#pf-tab-${tab}`)?.focus();
      return;
    }
    const show = (selector, focus) => {
      const el = view.querySelector(selector);
      if (!el) return;
      el.hidden = false;
      el.querySelector(focus)?.focus();
    };
    const base = `architecture/${encodeURIComponent(id)}/knowledge`;
    const linkIt = t.closest('[data-kn-link]');
    if (linkIt) {
      const where = JSON.parse(linkIt.dataset.knLink);
      linkIt.disabled = true;
      await act(async () => {
        const r = await ctx.api.post(base, { ...where, note: know.note });
        know.note = '';
        await findKnowledge();
        return r;
      }, (r) => `Linked ${r.link.title} to ${id}. The Software Factory reads it with each work item.`);
      view.querySelector('[data-kn-search]')?.focus();
      return undefined;
    }
    const editNote = t.closest('[data-kn-edit]');
    if (editNote) {
      know.editing = editNote.dataset.knEdit;
      paint();
      view.querySelector('[data-form="kn-note"] input')?.focus();
      return undefined;
    }
    if (t.closest('[data-kn-cancel]')) {
      know.editing = null;
      paint();
      return undefined;
    }
    const unlink = t.closest('[data-kn-remove]');
    if (unlink) {
      unlink.disabled = true;
      await act(async () => {
        const r = await ctx.api.del(`${base}/${encodeURIComponent(unlink.dataset.knRemove)}`);
        if (know.found) await findKnowledge();
        return r;
      }, 'Removed. Nothing changed in Knowledge.');
      view.querySelector('[data-kn-remove], [data-kn-search]')?.focus();
      return undefined;
    }
    const add = t.closest('[data-add-repo]');
    const remove = t.closest('[data-remove-repo]');
    if (add || remove) {
      const name = (add ?? remove).dataset[add ? 'addRepo' : 'removeRepo'];
      const current = data.repositories.repositories.map((x) => x.name);
      const next = add ? [...current, name] : current.filter((n) => n !== name);
      (add ?? remove).disabled = true;
      await act(() => ctx.api.put(`architecture/${encodeURIComponent(id)}/repositories`, { repositories: next }), add ? `Added ${name} to ${id}.` : `Removed ${name} from ${id}.`);
      // Keep the person where they were: back in the search after adding, on the list after removing.
      view.querySelector(add ? '[data-repo-search]' : '[data-remove-repo], [data-repo-search]')?.focus();
      return undefined;
    }
    if (t.closest('[data-action="edit-code"]')) return show('[data-form="code"]', 'textarea');
    if (t.closest('[data-action="cancel-code"]')) return void (view.querySelector('[data-form="code"]').hidden = true);
    if (t.closest('[data-action="new-adr"]')) return show('[data-form="new-adr"]', 'input');
    if (t.closest('[data-action="cancel-adr"]')) return void (view.querySelector('[data-form="new-adr"]').hidden = true);
    const discuss = t.closest('[data-action="discuss"]');
    if (discuss) return show(`[data-form="discuss"][data-id="${discuss.dataset.id}"]`, 'textarea');
    const accept = t.closest('[data-action="accept"]');
    if (accept) {
      accept.disabled = true;
      return act(() => ctx.api.post(`adrs/${accept.dataset.id}/accept`, {}), (adr) => `${adr.id} is accepted. It is now the decision of record.`);
    }
    const draft = t.closest('[data-action="draft"]');
    if (draft) {
      draft.disabled = true;
      askToDraft(draft.dataset.kind);
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'code') {
      const etag = `"${id}.diagram@${data.diagram.version}"`;
      act(() => ctx.api.put(`architecture/${encodeURIComponent(id)}/diagram`, { code: f.code, ...(f.changeNote.trim() ? { changeNote: f.changeNote.trim() } : {}) }, { headers: { 'If-Match': etag } }), (d) => `Saved the container view as v${d.version}.`);
    } else if (form.dataset.form === 'new-adr') {
      const body = { title: f.title, addsDependency: Boolean(f.dependency) };
      for (const k of ['context', 'decision', 'consequences', 'dependency']) if (f[k]?.trim()) body[k] = f[k].trim();
      act(() => ctx.api.post(`architecture/${encodeURIComponent(id)}/adrs`, body), (adr) => `Proposed ${adr.id}: ${adr.title}.`);
    } else if (form.dataset.form === 'kn-note') {
      act(async () => {
        const r = await ctx.api.patch(`architecture/${encodeURIComponent(id)}/knowledge/${encodeURIComponent(form.dataset.id)}`, { note: f.note });
        know.editing = null;
        return r;
      }, (r) => `Saved the note on ${r.link.title}.`);
    } else if (form.dataset.form === 'discuss') {
      act(() => ctx.api.post(`adrs/${form.dataset.id}/discuss`, { text: f.text.trim() }), 'Your comment was added.');
    }
  }, { signal: ctx.signal });

  /** Asks Knowledge for files and folders that match; a later search wins over an earlier one still on its way. */
  async function findKnowledge() {
    const asked = ++know.asked;
    const q = know.query.trim();
    if (q.length < 2) {
      know.found = null;
      know.error = null;
    } else {
      try {
        const found = await ctx.api.get(`architecture/${encodeURIComponent(id)}/knowledge/search`, { query: { q } });
        if (asked !== know.asked) return;
        know.found = found;
        know.error = null;
      } catch (err) {
        if (isAbort(err) || asked !== know.asked) return;
        know.found = null;
        know.error = err.message;
      }
    }
    const box = view.querySelector('[data-kn-results]');
    if (box) box.outerHTML = String(knowledgeResults(know.found, know));
  }
  let knowTimer = null;
  ctx.signal.addEventListener('abort', () => clearTimeout(knowTimer), { once: true });

  view.addEventListener('input', (e) => {
    if (e.target.closest('[data-kn-note-new]')) {
      know.note = e.target.value;
      return;
    }
    if (e.target.closest('[data-kn-search]')) {
      know.query = e.target.value;
      clearTimeout(knowTimer);
      knowTimer = setTimeout(findKnowledge, 250);
      return;
    }
    const box = e.target.closest('[data-repo-search]');
    if (!box) return;
    search = box.value;
    const chosen = data.repositories.repositories.map((x) => x.name);
    view.querySelector('[data-repo-results]').outerHTML = String(resultsList(matches(data.choices, chosen, search), true));
  }, { signal: ctx.signal });

  await reloadable(view, ctx, draw);
}
