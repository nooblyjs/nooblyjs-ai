// /dev/teams (development sign-in only): the Teams simulator (tech.md §7.3, mockups noobly-teams-bot-*). A stand-in
// meeting chat where the NooblyJS bot can be tested before it goes near a tenant: type @NooblyJS, add a teammate, ask it
// something. What you type is sent to the bot as Microsoft Teams would send it, as the person you are signed in as.
//
// The chat's chrome is a neutral stand-in. Only the bot's cards are NooblyJS design, drawn from the same Adaptive
// Card JSON that would go to Teams.
import { html } from '/ui/js/html.js';
import { pageHead, button, statusPill, notice } from '/ui/js/components/index.js';
import { adaptiveCard } from './adaptive-card.js';

const HEAD = { eyebrow: 'NooblyJS · Development', title: 'Teams simulator', lead: 'A stand-in Teams chat for the NooblyJS bot. Mention @NooblyJS to bring an agent teammate into the meeting.' };
const time = (iso) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
const first = (name) => String(name ?? '').split(/\s+/)[0];

function person(m, when) {
  return html`<li class="tsim__msg">
    <span class="avatar avatar--small" aria-hidden="true">${m.from.initials}</span>
    <div class="tsim__body"><p class="tsim__who"><strong>${m.from.name}</strong> <span class="tsim__time">${when}</span></p><p class="tsim__text">${m.text}</p></div>
  </li>`;
}

function fromBot(m) {
  if (m.kind === 'system-line') return html`<li class="tsim__line"><span>${m.text}</span></li>`;
  return html`<li class="tsim__msg tsim__msg--bot">
    <span class="avatar avatar--small tsim__bot" aria-hidden="true">EX</span>
    <div class="tsim__body">
      <p class="tsim__who"><strong>NooblyJS</strong> <span class="tsim__tag">Bot</span> <span class="tsim__time">${time(m.at)}</span>${m.as ? html` <span class="visually-hidden">speaking as ${m.as.name}</span>` : ''}</p>
      ${m.text ? html`<p class="tsim__text">${m.text}</p>` : ''}${m.card ? adaptiveCard(m.card) : ''}
    </div>
  </li>`;
}

function status(data) {
  if (data.working) return html`<p class="tsim__status" role="status">${data.working.name} is working…</p>`;
  if (data.session) return html`<p class="tsim__status" role="status">${first(data.session.teammate.name)} is listening · mention @${first(data.session.teammate.name)} to ask</p>`;
  return html`<p class="tsim__status" role="status">No teammate is in this chat. Type @NooblyJS to add one.</p>`;
}

function chat(data, { error, draft }) {
  const s = data.session;
  return html`<section class="tsim__chat" aria-label="${data.meeting.title}">
    <header class="tsim__head">
      <div><h2 class="tsim__title">${data.meeting.title}</h2><p class="tsim__sub">${data.meeting.subtitle}</p></div>
      <ul class="tsim__faces" aria-label="People in this chat">${data.meeting.people.map((p) => html`<li class="avatar avatar--small" title="${p.name}"><span aria-hidden="true">${p.initials}</span><span class="visually-hidden">${p.name}</span></li>`)}${s ? html`<li class="avatar avatar--small avatar--agent" title="${s.teammate.name}"><span aria-hidden="true">${s.teammate.initials}</span><span class="visually-hidden">${s.teammate.name} (agent)</span></li>` : ''}</ul>
    </header>
    <p class="tsim__meta">${s
    ? html`${statusPill({ text: `${s.teammate.name} joined ${time(s.joinedAt)}`, tone: 'info' })} <span>Added by ${s.addedBy.name} · billed to ${s.billedTeam.name}${s.itemId ? html` · loaded <a href="/home/lifecycle/${s.itemId}">${s.itemId}</a>` : ''}</span>`
    : html`<span>${data.meeting.teamId ? `Linked to ${data.meeting.itemId ?? 'no item'} · a teammate's time is billed to the meeting's team.` : "Not linked to a team: a teammate's time is billed to the first team of whoever adds them."}</span>`}</p>
    <div class="tsim__log" role="log" aria-live="polite" aria-label="Messages" tabindex="0">
      <ol class="tsim__items">
        ${data.earlier.map((m) => person(m, m.time))}
        ${data.earlier.length ? html`<li class="tsim__line"><span>Earlier messages are not sent to the bot</span></li>` : ''}
        ${data.transcript.map((m) => (m.dir === 'in' ? person(m, time(m.at)) : fromBot(m)))}
      </ol>
    </div>
    ${status(data)}
    ${error ? html`<p class="flash flash--error" role="alert">${error}</p>` : ''}
    <form class="tsim__composer" data-composer>
      <label class="visually-hidden" for="tsim-text">Type a message</label>
      <textarea id="tsim-text" name="text" rows="2" maxlength="4000" placeholder="Type a message. @NooblyJS brings in a teammate.">${draft}</textarea>
      ${button({ label: 'Send', type: 'submit' })}
    </form>
    <p class="tsim__foot">${button({ label: 'Start this chat again', kind: 'secondary', small: true, attrs: { 'data-reset': '1' } })}<span>Clears what the bot sent and takes the teammate out, so the story can be run again.</span></p>
  </section>`;
}

export async function render(view, { ctx, query }) {
  let meetings = [];
  let current = query?.get?.('meeting') ?? null;
  let data = null;
  let error = null;
  let busy = false;
  let reloading = null;

  const draft = () => view.querySelector('#tsim-text')?.value ?? '';

  function draw({ keepDraft = true, focus = false } = {}) {
    const typed = keepDraft ? draft() : '';
    view.innerHTML = String(html`${pageHead(HEAD)}
    <div class="tsim">
      <nav class="tsim__list" aria-label="Chats">
        <p class="tsim__list-title">Chat</p>
        <ul>${meetings.map((m) => html`<li><a class="tsim__chat-link" href="/dev/teams?meeting=${m.id}"${m.id === current ? html` aria-current="page"` : ''}><strong>${m.title}</strong><span>${m.subtitle}</span></a></li>`)}</ul>
      </nav>
      ${data ? chat(data, { error, draft: typed }) : notice({ title: 'No simulated meetings', text: 'data/teams/sim/meetings.yaml lists the meetings shown here. Run npm run seed to write the sample ones.' })}
    </div>`);
    const log = view.querySelector('.tsim__log');
    if (log) log.scrollTop = log.scrollHeight;
    if (focus) view.querySelector('#tsim-text')?.focus();
  }

  async function load(options) {
    if (!current) return draw(options);
    data = await ctx.hostApi.get(`dev/teams/${encodeURIComponent(current)}`);
    if (ctx.isCurrent()) draw(options);
  }

  /** Sends one thing to the bot, then shows what came back. One at a time, as a person types. */
  async function send(path, body, options) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await ctx.hostApi.post(`dev/teams/${encodeURIComponent(current)}/${path}`, body);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      error = err.message;
    } finally {
      busy = false;
    }
    await load(options);
  }

  view.addEventListener('submit', (event) => {
    if (!event.target.matches('[data-composer]')) return;
    event.preventDefault();
    const text = draft().trim();
    if (text) send('messages', { text }, { keepDraft: false, focus: true });
  }, { signal: ctx.signal });

  view.addEventListener('keydown', (event) => {
    // Enter sends, Shift+Enter breaks the line, as in the chat panel.
    if (event.target.id !== 'tsim-text' || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    event.target.form.requestSubmit();
  }, { signal: ctx.signal });

  view.addEventListener('click', (event) => {
    const submit = event.target.closest('[data-card-submit]');
    if (submit) {
      let payload = null;
      try { payload = JSON.parse(submit.dataset.cardSubmit); } catch { /* not a card the bot sent */ }
      if (payload) send('actions', { data: payload }, { focus: true });
      return;
    }
    if (event.target.closest('[data-reset]')) send('reset', {}, { keepDraft: false, focus: true });
  }, { signal: ctx.signal });

  // The bot's replies (and its "working…") arrive as events; redraw when one is about this chat.
  ctx.sse.on('*', (event) => {
    if (event.conversationId !== current || busy) return;
    clearTimeout(reloading);
    reloading = setTimeout(() => { if (ctx.isCurrent()) load().catch(() => {}); }, 150);
  }, { signal: ctx.signal });
  ctx.signal.addEventListener('abort', () => clearTimeout(reloading), { once: true });

  view.innerHTML = String(html`${pageHead(HEAD)}<p class="loading" role="status">Loading the simulator…</p>`);
  meetings = (await ctx.hostApi.get('dev/teams')).meetings;
  if (!meetings.some((m) => m.id === current)) current = meetings[0]?.id ?? null;
  await load({ keepDraft: false });
}
