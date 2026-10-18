// Team board (/board and /board/:postId, .claude/specs/team-board/design.md §6): where teammates and people work out
// loud. The feed with filters and the side column (Working on now, Open asks, Needs a person), the composer, and one
// post with its thread and the actions the viewer may take. Built from the UI kit's components; the post card, the
// composer and the side column are the app's own. The server checks every action again: buttons only hide what
// someone can't do.
import { html, raw } from '/ui/js/html.js';
import { icon } from '/ui/js/icons.js';
import { pageHead, chips, statusPill, button, notice, card } from '/ui/js/components/index.js';
import { avatar } from '../avatar.js';
import { renderMarkdown } from '../markdown.js';
import { money, rate, plural } from '../format.js';
import { toast } from '../ui.js';
import { api, appUrl, enter } from '../client.js';

const KINDS = [
  { key: 'working-on', label: 'Working on', help: "I'm on this, for this item, until about then." },
  { key: 'finding', label: 'Finding', help: 'Something I learned that others should know, with its sources.' },
  { key: 'ask', label: 'Ask', help: 'A question to the team, or to someone named with @.' },
  { key: 'heads-up', label: 'Heads-up', help: 'I changed something that affects your work.' },
  { key: 'needs-person', label: 'Needs a person', help: 'Blocked on something only a person may do: approve, merge, decide, grant or spend.' },
  { key: 'done', label: 'Done', help: 'Finished: what came out of it.' },
  { key: 'note', label: 'Note', help: 'Anything else: announcements, context, links.' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const SORTS = [{ value: 'newest', label: 'Newest' }, { value: 'useful', label: 'Most useful' }, { value: 'waiting', label: 'Waiting longest' }];
const SIGNALS = [
  { key: 'useful', label: 'Useful' },
  { key: 'seen', label: 'Seen' },
  { key: 'take', label: "I'll take it", kinds: ['ask', 'heads-up'] },
  { key: 'same', label: 'Same here', kinds: ['ask'] },
];
const WHERE = [{ value: 'approval', label: 'An approval' }, { value: 'pr', label: 'A pull request' }, { value: 'item', label: 'An item' }, { value: 'other', label: 'Somewhere else' }];

// ---------------------------------------------------------------------------- small pieces

// "How long ago" is measured against the board's own time (NooblyJS's business clock), which every response carries.
let serverOffset = 0;
const noteServerTime = (iso) => {
  if (iso) serverOffset = Date.parse(iso) - Date.now();
};
const nowMs = () => Date.now() + serverOffset;

function ago(iso, at = nowMs()) {
  const mins = Math.round((at - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
const waited = (ms) => {
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'under an hour';
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
};
const initials = (name) => String(name ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/** A teammate's face in a square (agents are square), a person's initials in a circle, the board's own mark. */
function face(author, team, size = 40) {
  if (author.kind === 'agent') {
    const t = team.get(author.id);
    return t ? html`<span class="tmk-face tmk-face--agent">${avatar(t.avatar, size)}</span>` : html`<span class="avatar avatar--agent tmk-face--initials" aria-hidden="true">${initials(author.name)}</span>`;
  }
  if (author.kind === 'system') return html`<span class="avatar tmk-face--system" aria-hidden="true">${icon('chat', { size: 18 })}</span>`;
  return html`<span class="avatar tmk-face--initials" aria-hidden="true">${initials(author.name)}</span>`;
}

const TONE = { active: 'info', stale: 'warning', open: 'warning', answered: 'success', acknowledged: 'success', resolved: 'success', promoted: 'success', done: 'success' };
function kindPill(p) {
  const tone = p.kind === 'needs-person' && p.state === 'open' ? 'danger' : TONE[p.state] ?? 'neutral';
  return statusPill({ text: p.stateLabel ? `${p.kindLabel} · ${p.stateLabel}` : p.kindLabel, tone });
}

const topicChip = (t) => html`<button type="button" class="tmk-topic" data-topic="${t}" aria-label="Show posts on ${t}">${t}</button>`;
const sourceList = (sources = []) => (sources.length
  ? html`<ul class="tmk-sources" aria-label="Sources">${sources.map((s) => html`<li>${icon('doc', { size: 14 })}${s.href ? html`<a href="${s.href}"${/^https?:/.test(s.href) ? html` target="_blank" rel="noopener noreferrer"` : ''}>${s.label}</a>` : s.label}</li>`)}</ul>`
  : '');
const costLine = (p) => (p.author.kind === 'agent' && p.task?.costUsd != null
  ? html`<span class="tmk-cost">cost ${money(p.task.costUsd)}${p.task.modelRoute ? ` · ${p.task.modelRoute}` : ''}</span>`
  : '');

function signalButtons(p, mayPost) {
  return html`<div class="tmk-signals" role="group" aria-label="Signals">${SIGNALS.filter((s) => !s.kinds || s.kinds.includes(p.kind)).map((s) => {
    const n = p.signals?.[s.key] ?? 0;
    const mine = (p.mySignals ?? []).includes(s.key);
    return mayPost && !p.hidden
      ? html`<button type="button" class="tmk-signal" data-signal="${s.key}" data-post="${p.id}" aria-pressed="${mine ? 'true' : 'false'}">${s.label}${n ? html` <span class="tmk-signal__n">${n}</span>` : ''}</button>`
      : (n ? html`<span class="tmk-signal tmk-signal--static">${s.label} <span class="tmk-signal__n">${n}</span></span>` : '');
  })}</div>`;
}

function stateNote(p) {
  if (p.hidden) return html`<p class="tmk-hidden">${icon('alert', { size: 16 })}Hidden by ${p.hidden.by.name}: ${p.hidden.reason}</p>`;
  const bits = [];
  if (p.pinned) bits.push('Pinned');
  if (p.claim?.eta && p.state === 'active' && Date.parse(p.claim.eta) > nowMs()) bits.push(`about ${waited(Date.parse(p.claim.eta) - nowMs())} left`);
  if (p.resolution) bits.push(`Resolved by ${p.resolution.by.name}${p.resolution.where?.id ? ` · ${p.resolution.where.id}` : ''}${p.resolution.where?.note ? ` · ${p.resolution.where.note}` : ''}`);
  if (p.promotedBy) bits.push(`Promoted to team memory by ${p.promotedBy.name}`);
  if (p.acknowledgedBy?.length) bits.push(`Acknowledged by ${p.acknowledgedBy.map((a) => a.name).join(', ')}`);
  if (p.takenBy?.length) bits.push(`${plural(p.takenBy.length, 'person or teammate', 'people or teammates')} took it`);
  if (p.auto) bits.push('Posted automatically');
  if (p.resting) bits.push('Resting · waiting for a person');
  return bits.length ? html`<p class="tmk-post__state">${bits.join(' · ')}</p>` : '';
}

/** One post as a card in the feed (`full` on its own page: the whole body, no "open" link). */
function postCard(p, { team, mayPost, full = false }) {
  const agent = p.author.kind === 'agent';
  const text = full ? p.body : p.preview;
  return html`<article class="tmk-post${agent ? ' tmk-post--agent' : ''}${p.pinned ? ' tmk-post--pinned' : ''}" aria-labelledby="post-${p.id}-title">
    <header class="tmk-post__head">
      ${face(p.author, team)}
      <div class="tmk-post__who">
        <h2 class="tmk-post__name" id="post-${p.id}-title">${p.author.name}${agent ? html` <span class="tmk-tag">Agent</span>` : ''}<span class="visually-hidden">, ${p.kindLabel}</span></h2>
        <span class="tmk-post__meta"><time datetime="${p.createdAt}">${ago(p.createdAt)}</time></span>
      </div>
      ${kindPill(p)}
    </header>
    ${p.hidden ? '' : html`<div class="tmk-post__body${agent ? ' tmk-post__body--agent' : ''}">${raw(renderMarkdown(text))}</div>`}
    ${stateNote(p)}
    ${p.hidden ? '' : sourceList(p.sources)}
    <div class="tmk-topics">${p.topics.map(topicChip)}</div>
    <footer class="tmk-post__foot">
      ${signalButtons(p, mayPost)}
      ${costLine(p)}
      ${full ? '' : html`<a class="tmk-post__open" href="${appUrl(`/board/${p.id}`)}">${p.replyCount ? plural(p.replyCount, 'reply', 'replies') : 'Open thread'}<span class="visually-hidden"> on ${p.author.name}'s ${p.kindLabel}</span></a>`}
    </footer>
  </article>`;
}

function sideColumn(now, team) {
  const row = (p, extra) => html`<li><a class="tmk-side__row" href="${appUrl(`/board/${p.id}`)}">${face(p.author, team, 32)}<span><span class="tmk-side__title">${p.claim?.title ?? p.preview}</span><span class="tmk-side__meta">${extra}</span></span></a></li>`;
  const list = (items, empty, extra) => (items.length ? html`<ul class="tmk-side__list">${items.map((p) => row(p, extra(p)))}</ul>` : html`<p class="tmk-side__empty">${empty}</p>`);
  return html`
    ${card({ title: 'Working on now', meta: String(now.workingOn.length), body: list(now.workingOn, 'Nobody has claimed anything.', (p) => `${p.author.name} · ${p.topics[0]} · ${p.state === 'stale' ? `stale · since ${ago(p.createdAt)}` : `since ${ago(p.createdAt)}`}`) })}
    ${card({ title: 'Open asks', meta: String(now.openAsks.length), body: list(now.openAsks, 'No questions waiting.', (p) => `${p.author.name} · waiting ${waited(p.ageMs)}${p.signals?.same ? ` · Same here ${p.signals.same}` : ''}`) })}
    ${card({ title: 'Needs a person', meta: String(now.needsPerson.length), body: list(now.needsPerson, 'Nobody is blocked on a person.', (p) => `${p.author.name} · open ${waited(p.ageMs)}`) })}`;
}

function summary(now) {
  const working = now.workingOn.filter((p) => p.state === 'active').length;
  const asks = now.openAsks.length;
  const oldDay = now.openAsks.filter((p) => p.ageMs >= 86400000).length;
  const parts = [];
  parts.push(working ? `${plural(working, 'piece of work is', 'pieces of work are')} claimed right now.` : 'Nobody has claimed any work right now.');
  parts.push(asks ? `${plural(asks, 'ask is', 'asks are')} waiting for an answer${oldDay ? `, ${oldDay} for over a day` : ''}.` : 'No questions are waiting.');
  if (now.needsPerson.length) parts.push(`${plural(now.needsPerson.length, 'post needs', 'posts need')} a person.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------- the composer

function composer(team, preset = {}) {
  const teammates = [...team.values()].filter((t) => !t.retiredAt);
  return html`<form class="tmk-compose" id="board-compose" novalidate aria-labelledby="compose-title">
    <h2 class="tmk-compose__title" id="compose-title">New post</h2>
    <fieldset class="tmk-kinds">
      <legend>What kind of post?</legend>
      ${KINDS.filter((k) => k.key !== 'done').map((k) => html`<label class="tmk-kind"><input type="radio" name="kind" value="${k.key}"${(preset.kind ?? 'finding') === k.key ? ' checked' : ''}><span><span class="tmk-kind__label">${k.label}</span><span class="tmk-kind__help">${k.help}</span></span></label>`)}
    </fieldset>
    <div class="tmk-field">
      <label for="compose-topics">Topics</label>
      <input id="compose-topics" name="topics" list="board-topics" value="${preset.topics ?? ''}" placeholder="item:PRD-031, repo:web-storefront, team:delivery-squad, #slots" aria-describedby="compose-topics-help" autocomplete="off">
      <datalist id="board-topics"></datalist>
      <span class="tmk-field__help" id="compose-topics-help">One to five, separated by commas.</span>
      <span class="tmk-field__error" data-error="topics" aria-live="polite"></span>
    </div>
    <div class="tmk-field">
      <label for="compose-body">Post</label>
      <textarea id="compose-body" name="body" rows="5" maxlength="4000" aria-describedby="compose-body-help"></textarea>
      <span class="tmk-field__help" id="compose-body-help">Markdown works. Mention a teammate with @ to ask them to reply: it runs a task for them and is billed. Never post secrets.</span>
      <span class="tmk-field__error" data-error="body" aria-live="polite"></span>
    </div>
    <details class="tmk-mentionable"><summary>Teammates you can mention</summary>
      <ul>${teammates.map((t) => html`<li><code>@${t.name.split(' ')[0]}</code> ${t.name} · ${t.role} · ${t.status === 'paused' ? 'Paused' : t.status === 'off' ? 'Off shift' : 'Can reply'} · ${rate(t.rate)}</li>`)}</ul>
    </details>
    <div class="tmk-field tmk-field--pair">
      <div><label for="compose-source">Source (optional)</label><input id="compose-source" name="sourceLabel" placeholder="PRD-031 v5"></div>
      <div><label for="compose-source-link">Link</label><input id="compose-source-link" name="sourceHref" type="url" placeholder="https://…"></div>
      <span class="tmk-field__error" data-error="sources" aria-live="polite"></span>
    </div>
    <p class="tmk-field__error" data-error="form" role="alert"></p>
    <div class="actions">${button({ label: 'Post', type: 'submit', icon: 'chat' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-compose' } })}</div>
  </form>`;
}

function showErrors(form, err) {
  for (const el of form.querySelectorAll('[data-error]')) el.textContent = '';
  const details = err?.details && typeof err.details === 'object' ? err.details : {};
  let placed = false;
  for (const [field, message] of Object.entries(details)) {
    const el = form.querySelector(`[data-error="${field}"]`);
    if (el) {
      el.textContent = message;
      placed = true;
    }
  }
  if (!placed) form.querySelector('[data-error="form"]').textContent = err?.message ?? 'That did not work. Try again.';
}

// ---------------------------------------------------------------------------- the pages

let leave = null;

export async function render(frameView, { params, query, ctx: frame }) {
  const { view, ctx } = await enter(frameView, frame, 'board', { kit: true });
  const roster = await api.get('/api/v1/teammates').catch(() => ({ teammates: [] }));
  if (!ctx.isCurrent()) return;
  const team = new Map(roster.teammates.map((t) => [t.id, t]));
  const may = { post: ctx.can('post'), manage: ctx.can('manager') };
  const me = ctx.session?.user ?? {};
  let timer = null;
  const later = (fn) => {
    clearTimeout(timer);
    timer = setTimeout(fn, 300);
  };
  leave = () => clearTimeout(timer);
  if (params.postId) return postPage(view, ctx, { id: params.postId, team, may, me, later });
  return feedPage(view, ctx, { query, team, may, later });
}

async function feedPage(view, ctx, { query, team, may, later }) {
  const state = {
    kind: query.get('kind') ?? '',
    topic: query.get('topic') ?? '',
    sort: SORTS.some((s) => s.value === query.get('sort')) ? query.get('sort') : 'newest',
    open: query.get('state') === 'open',
    q: query.get('q') ?? '',
  };
  view.innerHTML = String(html`
    ${pageHead({ eyebrow: 'Digital Teammates', title: 'Team board', lead: html`<span id="board-summary"></span>`, actions: may.post ? button({ label: 'New post', icon: 'plus', attrs: { 'data-action': 'compose' } }) : '' })}
    <div id="compose-slot"></div>
    <div class="tmk-bar"><div id="kind-filters"></div>
      <div class="tmk-search" role="search"><label class="visually-hidden" for="board-search">Search the board</label><input id="board-search" type="search" placeholder="Search posts, people and topics" value="${state.q}" autocomplete="off"></div>
    </div>
    <div class="tmk-bar tmk-bar--quiet" id="sub-filters"></div>
    <p class="visually-hidden" aria-live="polite" id="board-count"></p>
    <div class="tmk-board">
      <div class="tmk-board__feed" id="feed"></div>
      <aside class="tmk-board__side" id="side" aria-label="Right now on the board"></aside>
    </div>`);
  const feed = view.querySelector('#feed');
  let data = null;
  let now = null;

  const params = (extra = {}) => {
    const p = new URLSearchParams();
    if (state.kind) p.set('kind', state.kind);
    if (state.topic) p.set('topic', state.topic);
    if (state.sort !== 'newest') p.set('sort', state.sort);
    if (state.open) p.set('state', 'open');
    if (state.q.trim()) p.set('q', state.q.trim());
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p;
  };

  const draw = () => {
    view.querySelector('#board-summary').textContent = summary(now);
    view.querySelector('#kind-filters').innerHTML = String(chips({
      label: 'Filter by kind', name: 'kind', current: state.kind,
      items: [{ value: '', label: 'All', count: data.counts.all }, ...KINDS.map((k) => ({ value: k.key, label: k.label, count: data.counts[k.key] ?? 0 }))],
    }));
    view.querySelector('#sub-filters').innerHTML = String(html`
      ${state.topic ? html`<span class="tmk-active-topic">Topic: <strong>${state.topic}</strong> <button type="button" class="tmk-link" data-action="clear-topic">Show every topic</button></span>` : ''}
      ${chips({ label: 'Show', name: 'open', small: true, current: state.open ? 'open' : 'all', items: [{ value: 'all', label: 'Everything' }, { value: 'open', label: 'Still open' }] })}
      ${chips({ label: 'Sort', name: 'sort', small: true, current: state.sort, items: SORTS })}`);
    view.querySelector('#side').innerHTML = String(sideColumn(now, team));
    feed.innerHTML = String(data.posts.length
      ? html`<ol class="tmk-feed" aria-label="Posts">${data.posts.map((p) => html`<li>${postCard(p, { team, mayPost: may.post })}</li>`)}</ol>${data.next ? html`<div class="tmk-more">${button({ label: 'Show more', kind: 'secondary', attrs: { 'data-action': 'more' } })}</div>` : ''}`
      : notice({ tone: 'muted', iconName: 'search', title: 'Nothing on the board matches', text: 'Try another kind, topic or word.', actions: button({ label: 'Clear filters', kind: 'secondary', attrs: { 'data-action': 'clear' } }) }));
    view.querySelector('#board-count').textContent = `${plural(data.total, 'post')} shown`;
    const url = new URL(location.href);
    url.search = params().toString();
    history.replaceState(history.state, '', url.pathname + url.search);
  };

  const load = async () => {
    [data, now] = await Promise.all([api.get(`/api/v1/board/posts?${params()}`), api.get('/api/v1/board/now')]);
    noteServerTime(now.now);
    if (ctx.isCurrent()) draw();
  };
  await load();

  const openComposer = () => {
    const slot = view.querySelector('#compose-slot');
    if (slot.firstElementChild) return slot.querySelector('textarea').focus();
    slot.innerHTML = String(composer(team, { topics: state.topic }));
    const form = slot.querySelector('form');
    api.get('/api/v1/board/topics').then(({ topics }) => {
      form.querySelector('#board-topics').innerHTML = String(html`${topics.map((t) => html`<option value="${t.topic}"></option>`)}`);
    }).catch(() => {});
    form.querySelector('textarea').focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const sourceLabel = String(f.get('sourceLabel') ?? '').trim();
      const sourceHref = String(f.get('sourceHref') ?? '').trim();
      const body = {
        kind: f.get('kind'),
        topics: String(f.get('topics') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        body: f.get('body'),
        sources: sourceLabel || sourceHref ? [{ label: sourceLabel || sourceHref, ...(sourceHref ? { href: sourceHref } : {}) }] : [],
      };
      try {
        const post = await api.post('/api/v1/board/posts', body);
        slot.replaceChildren();
        toast(post.mentions?.length ? `Posted. ${plural(post.mentions.length, 'teammate')} will reply in the thread.` : 'Posted on the board.');
        await load();
        feed.querySelector(`#post-${post.id}-title`)?.closest('article')?.querySelector('a, button')?.focus();
      } catch (err) {
        showErrors(form, err);
      }
    });
  };

  view.addEventListener('click', async (e) => {
    const t = e.target;
    const action = t.closest('[data-action]')?.dataset.action;
    if (action === 'compose') return openComposer();
    if (action === 'cancel-compose') {
      view.querySelector('#compose-slot').replaceChildren();
      return view.querySelector('[data-action="compose"]')?.focus();
    }
    if (action === 'clear' || action === 'clear-topic') {
      if (action === 'clear') Object.assign(state, { kind: '', q: '', open: false, sort: 'newest' });
      state.topic = '';
      view.querySelector('#board-search').value = state.q;
      return load();
    }
    if (action === 'more') {
      const next = await api.get(`/api/v1/board/posts?${params({ cursor: data.next })}`);
      data = { ...next, posts: [...data.posts, ...next.posts] };
      return draw();
    }
    const kindBtn = t.closest('[data-kind]');
    if (kindBtn && kindBtn.closest('#kind-filters')) {
      state.kind = kindBtn.dataset.kind;
      await load();
      return view.querySelector(`#kind-filters [data-kind="${state.kind}"]`)?.focus();
    }
    const openBtn = t.closest('[data-open]');
    if (openBtn) {
      state.open = openBtn.dataset.open === 'open';
      await load();
      return view.querySelector(`[data-open="${openBtn.dataset.open}"]`)?.focus();
    }
    const sortBtn = t.closest('[data-sort]');
    if (sortBtn) {
      state.sort = sortBtn.dataset.sort;
      await load();
      return view.querySelector(`[data-sort="${state.sort}"]`)?.focus();
    }
    const topic = t.closest('[data-topic]');
    if (topic) {
      state.topic = topic.dataset.topic;
      await load();
      return view.querySelector('[data-action="clear-topic"]')?.focus();
    }
    const signal = t.closest('[data-signal]');
    if (signal) await toggleSignal(signal, load);
  });
  view.querySelector('#board-search').addEventListener('input', (e) => {
    state.q = e.target.value;
    later(load);
  });
  ctx.on('board', () => later(() => load().catch(() => {})));
}

async function toggleSignal(btn, reload) {
  const on = btn.getAttribute('aria-pressed') !== 'true';
  try {
    const url = `/api/v1/board/posts/${encodeURIComponent(btn.dataset.post)}/signals/${btn.dataset.signal}`;
    if (on) await api.put(url, {});
    else await api.del(url);
    const key = `[data-post="${btn.dataset.post}"][data-signal="${btn.dataset.signal}"]`;
    await reload();
    document.querySelector(key)?.focus();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function replyItem(r, p, { team, may, me }) {
  const agent = r.author.kind === 'agent';
  const mine = r.author.kind === 'person' && r.author.id === me.id;
  const askOwner = (p.author.kind === 'person' && p.author.id === me.id) || may.post;
  return html`<li class="tmk-reply${agent ? ' tmk-reply--agent' : ''}${r.author.kind === 'system' ? ' tmk-reply--system' : ''}${p.answeredBy === r.id ? ' tmk-reply--answer' : ''}" id="${r.id}">
    ${face(r.author, team, 34)}
    <div class="tmk-reply__main">
      <div class="tmk-reply__head"><span class="tmk-reply__name">${mine ? 'You' : r.author.name}</span>${agent ? html`<span class="tmk-tag">Agent</span>` : ''}${r.correctionOf ? html`<span class="tmk-tag tmk-tag--fix">Correction</span>` : ''}${p.answeredBy === r.id ? html`<span class="tmk-tag tmk-tag--answer">Answer</span>` : ''}<time datetime="${r.at}">${ago(r.at)}</time></div>
      ${r.hidden ? html`<p class="tmk-hidden">Hidden by ${r.hidden.by.name}: ${r.hidden.reason}</p>` : html`<div class="tmk-reply__body">${raw(renderMarkdown(r.body))}</div>`}
      <div class="tmk-reply__foot">
        ${agent && r.task?.costUsd != null ? html`<span class="tmk-cost">${r.auto ? 'Posted automatically · ' : ''}cost ${money(r.task.costUsd)}${r.task.modelRoute ? ` · ${r.task.modelRoute}` : ''}</span>` : ''}
        ${p.kind === 'ask' && p.state === 'open' && askOwner && !r.hidden && r.author.kind !== 'system' ? html`<button type="button" class="tmk-link" data-action="answer" data-reply="${r.id}">Mark as the answer</button>` : ''}
        ${mine && !r.hidden && !p.hidden ? html`<button type="button" class="tmk-link" data-action="correct" data-reply="${r.id}">Correct this</button>` : ''}
        ${may.manage && !r.hidden ? html`<button type="button" class="tmk-link" data-action="hide-reply" data-reply="${r.id}">Hide</button>` : ''}
      </div>
    </div>
  </li>`;
}

function actionsFor(p, { may, me }) {
  if (p.hidden) return '';
  const mine = p.author.kind === 'person' && p.author.id === me.id;
  const list = [];
  if (may.post && p.kind === 'heads-up' && p.state === 'open') list.push(button({ label: 'Acknowledge', kind: 'secondary', attrs: { 'data-action': 'acknowledge' } }));
  if (may.post && p.kind === 'needs-person' && p.state === 'open') list.push(button({ label: 'Resolve…', attrs: { 'data-action': 'resolve' } }));
  if (may.post && p.kind === 'finding' && p.state === 'open') list.push(button({ label: 'Promote to team memory', kind: 'secondary', icon: 'book', attrs: { 'data-action': 'promote' } }));
  if (mine) list.push(button({ label: 'Correct this post', kind: 'secondary', attrs: { 'data-action': 'correct', 'data-reply': p.id } }));
  if (may.manage) list.push(button({ label: p.pinned ? 'Unpin' : 'Pin', kind: 'secondary', attrs: { 'data-action': 'pin' } }));
  if (may.manage) list.push(button({ label: 'Hide…', kind: 'danger', attrs: { 'data-action': 'hide' } }));
  return list.length ? html`<div class="actions tmk-post__actions">${list}</div>` : '';
}

const resolveForm = html`<form class="tmk-compose tmk-compose--inline" id="resolve-form" novalidate aria-labelledby="resolve-title">
  <h2 class="tmk-compose__title" id="resolve-title">Where did you act?</h2>
  <p class="tmk-field__help">Resolving here approves nothing. Approve, merge or decide in NooblyJS first, then say where, so the teammate and the team can follow it.</p>
  <div class="tmk-field tmk-field--pair">
    <div><label for="where-kind">Where</label><select id="where-kind" name="kind">${WHERE.map((w) => html`<option value="${w.value}">${w.label}</option>`)}</select></div>
    <div><label for="where-id">Which one</label><input id="where-id" name="id" placeholder="APR-14, PR #485, PRD-031"></div>
  </div>
  <div class="tmk-field"><label for="where-href">Link (optional)</label><input id="where-href" name="href" placeholder="https://… or /home/approvals"></div>
  <div class="tmk-field"><label for="where-note">Note (optional)</label><input id="where-note" name="note" maxlength="500"></div>
  <span class="tmk-field__error" data-error="where" aria-live="polite"></span>
  <p class="tmk-field__error" data-error="form" role="alert"></p>
  <div class="actions">${button({ label: 'Resolve', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-inline' } })}</div>
</form>`;

const hideForm = (what) => html`<form class="tmk-compose tmk-compose--inline" id="hide-form" novalidate aria-labelledby="hide-title">
  <h2 class="tmk-compose__title" id="hide-title">Hide this ${what}</h2>
  <p class="tmk-field__help">Hidden text stays in the board's files and the audit log. The board shows who hid it and why.</p>
  <div class="tmk-field"><label for="hide-reason">Why</label><input id="hide-reason" name="reason" maxlength="300" required></div>
  <span class="tmk-field__error" data-error="reason" aria-live="polite"></span>
  <p class="tmk-field__error" data-error="form" role="alert"></p>
  <div class="actions">${button({ label: 'Hide', kind: 'danger', type: 'submit' })}${button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-inline' } })}</div>
</form>`;

async function postPage(view, ctx, { id, team, may, me, later }) {
  let p;
  const enc = encodeURIComponent(id);
  try {
    p = await api.get(`/api/v1/board/posts/${enc}`);
    noteServerTime(p.now);
  } catch (err) {
    if (!ctx.isCurrent()) return;
    view.innerHTML = String(notice({ tone: 'error', title: err.status === 404 ? 'That post is not on the board' : 'The post could not be loaded', text: err.status === 404 ? 'It may have a mistyped link.' : err.message, actions: button({ label: 'Back to the board', href: appUrl('/board') }), headingLevel: 1 }));
    return;
  }
  if (!ctx.isCurrent()) return;
  let correcting = null;

  const draw = () => {
    view.innerHTML = String(html`
      <p class="tmk-back"><a href="${appUrl('/board')}">Back to the Team board</a></p>
      <h1 class="visually-hidden">${p.kindLabel} by ${p.author.name}</h1>
      ${postCard(p, { team, mayPost: may.post, full: true })}
      ${actionsFor(p, { may, me })}
      <div id="inline-slot"></div>
      <section class="tmk-thread" aria-labelledby="thread-title">
        <h2 class="tmk-thread__title" id="thread-title">${p.replies.length ? plural(p.replies.length, 'reply', 'replies') : 'No replies yet'}</h2>
        ${p.resting ? notice({ tone: 'muted', iconName: 'clock', title: 'Resting · waiting for a person', text: 'Agents have replied to each other four times in a row, so they are not woken here until a person replies.' }) : ''}
        <ol class="tmk-replies">${p.replies.map((r) => replyItem(r, p, { team, may, me }))}</ol>
        ${may.post && !p.hidden ? html`<form class="tmk-compose tmk-compose--reply" id="reply-form" novalidate>
          <div class="tmk-field">
            <label for="reply-body">${correcting ? 'Your correction' : 'Reply'}</label>
            <textarea id="reply-body" name="body" rows="3" maxlength="2000" aria-describedby="reply-help"></textarea>
            <span class="tmk-field__help" id="reply-help">${correcting ? 'A correction is shown with what it corrects. Nothing is edited.' : 'Mention a teammate with @ to ask them to reply (it is billed).'}</span>
            <span class="tmk-field__error" data-error="body" aria-live="polite"></span>
          </div>
          <p class="tmk-field__error" data-error="form" role="alert"></p>
          <div class="actions">${button({ label: correcting ? 'Post correction' : 'Reply', type: 'submit' })}${correcting ? button({ label: 'Cancel', kind: 'secondary', attrs: { 'data-action': 'cancel-correct' } }) : ''}</div>
        </form>` : ''}
      </section>`);
    const form = view.querySelector('#reply-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post(`/api/v1/board/posts/${enc}/replies`, { body: new FormData(form).get('body'), ...(correcting ? { correctionOf: correcting } : {}) });
        correcting = null;
        await load();
        view.querySelector('#reply-body')?.focus();
      } catch (err) {
        showErrors(form, err);
      }
    });
  };
  const load = async () => {
    p = await api.get(`/api/v1/board/posts/${enc}`);
    if (ctx.isCurrent()) draw();
  };
  draw();

  const act = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
      await load();
    } catch (err) {
      toast(err.message, { error: true });
    }
  };
  const inline = (markup, onSubmit) => {
    const slot = view.querySelector('#inline-slot');
    slot.innerHTML = String(markup);
    const form = slot.querySelector('form');
    form.querySelector('input, select')?.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await onSubmit(Object.fromEntries(new FormData(form)));
        await load();
      } catch (err) {
        showErrors(form, err);
      }
    });
  };

  view.addEventListener('click', async (e) => {
    const t = e.target;
    const el = t.closest('[data-action]');
    const action = el?.dataset.action;
    if (action === 'acknowledge') return act(() => api.post(`/api/v1/board/posts/${enc}/acknowledge`), 'Acknowledged.');
    if (action === 'promote') return act(() => api.post(`/api/v1/board/posts/${enc}/promote`), 'Added to team memory.');
    if (action === 'pin') return act(() => api.post(`/api/v1/board/posts/${enc}/pin`, { pinned: !p.pinned }), p.pinned ? 'Unpinned.' : 'Pinned to the top of the board.');
    if (action === 'answer') return act(() => api.post(`/api/v1/board/posts/${enc}/answer`, { replyId: el.dataset.reply }), 'Marked as answered.');
    if (action === 'resolve') return inline(resolveForm, (w) => api.post(`/api/v1/board/posts/${enc}/resolve`, { where: w }));
    if (action === 'hide') return inline(hideForm('post'), ({ reason }) => api.post(`/api/v1/board/posts/${enc}/hide`, { reason }));
    if (action === 'hide-reply') return inline(hideForm('reply'), ({ reason }) => api.post(`/api/v1/board/posts/${enc}/replies/${encodeURIComponent(el.dataset.reply)}/hide`, { reason }));
    if (action === 'cancel-inline') return view.querySelector('#inline-slot').replaceChildren();
    if (action === 'correct' || action === 'cancel-correct') {
      correcting = action === 'correct' ? el.dataset.reply : null;
      draw();
      return view.querySelector('#reply-body')?.focus();
    }
    const topic = t.closest('[data-topic]');
    if (topic) return ctx.navigate(`/board?topic=${encodeURIComponent(topic.dataset.topic)}`);
    const signal = t.closest('[data-signal]');
    if (signal) await toggleSignal(signal, load);
  });
  ctx.on('board', (live) => {
    if (live.postId === id) later(() => load().catch(() => {}));
  });
}

/** The frame calls this when the person leaves the page. */
export function destroy() {
  leave?.();
  leave = null;
}
