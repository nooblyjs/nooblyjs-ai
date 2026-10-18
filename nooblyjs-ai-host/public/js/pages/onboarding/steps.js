// First-login onboarding (product.md §5.8, mockup noobly-platform-onboarding-first-login): four steps that set a
// person's work role, teams and tools. Nothing is saved until "Open my home" (or "Skip for now"); the step is kept
// in the URL so Back and refresh behave. The work role shapes the home: it never grants a permission.
import { html } from '/ui/js/html.js';
import { createApi } from '/ui/js/api.js';
import { button, statusPill, notice } from '/ui/js/components/index.js';
import { icon } from '/ui/js/icons.js';

const STEPS = [
  { label: 'Your role', hint: 'So we show the right work' },
  { label: "What you'll do", hint: 'Your part of the lifecycle' },
  { label: 'Teams & tools', hint: 'Filter to your teams' },
  { label: 'Your home', hint: 'Tuned for you' },
];
const api = createApi('/api/v1');
const root = document.getElementById('onboarding');
const stepsNav = document.getElementById('onboarding-steps');
const state = { step: 1, role: null, teams: new Set(), tools: {}, approvalsInTeams: true, data: null, error: null, busy: false };

const role = () => state.data.roles.find((r) => r.key === state.role) ?? state.data.roles[0];
const firstName = (name) => String(name ?? '').split(/\s+/)[0];
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function head(eyebrow, title, lead) {
  return html`<header class="ob-head"><span class="eyebrow">${eyebrow}</span><h1 class="ob-title" tabindex="-1">${title}</h1><p class="lead">${lead}</p></header>`;
}

function stepRole() {
  const { person, suggested, profile } = state.data;
  const lead = profile?.workRole
    ? 'Pick the role that fits what you do now. It changes your home, not what you are allowed to do.'
    : suggested ? html`We picked one from your profile's job title ("${suggested.jobTitle}"). Change it if it's wrong.` : 'Pick the one closest to what you do. You can change it later.';
  return html`${head('Step 1 of 4', profile?.workRole ? 'What do you do?' : `Welcome, ${firstName(person.name)}. What do you do?`, lead)}
    <fieldset class="ob-roles"><legend class="visually-hidden">Your role</legend>${state.data.roles.map((r) => html`<label class="ob-role">
      <input type="radio" name="role" value="${r.key}" class="visually-hidden"${r.key === state.role ? html` checked` : ''}>
      <span class="ob-role__top"><span class="ob-role__icon" aria-hidden="true">${r.initials}</span><span class="ob-role__tick">Selected</span></span>
      <span class="ob-role__name">${r.name}</span>
      <span class="ob-role__blurb">${r.blurb}</span>
    </label>`)}</fieldset>`;
}

function stepWork() {
  const r = role();
  return html`${head(`Step 2 of 4 · ${r.name}`, "Here's what you'll do in NooblyJS", r.promise)}
    <ol class="ob-cards">${r.tasks.map((t, i) => html`<li class="ob-card">
      <span class="ob-card__n" aria-hidden="true">${i + 1}</span>
      <span class="ob-card__title">${t.title}</span>
      <span class="ob-card__detail">${t.detail}</span>
      <span class="pill">${t.where}</span>
    </li>`)}</ol>
    <div class="ob-pair">
      <section class="ob-card" aria-label="Your home will lead with">
        <h2 class="ob-card__title">Your home will lead with</h2>
        <ul class="ob-ticks">${r.leadsWith.map((f) => html`<li>${icon('check', { size: 16, stroke: 2.4 })}${f}</li>`)}</ul>
      </section>
      <section class="ob-card ob-card--navy" aria-label="Agents who'll work with you">
        <span class="ob-card__eyebrow">Agents who'll work with you</span>
        <span class="ob-card__big">${r.agents}</span>
        <span class="ob-card__detail">They draft; you decide. Nothing leaves your stage without your approval.</span>
      </section>
    </div>`;
}

function stepTeams() {
  const r = role();
  return html`${head('Step 3 of 4', 'Your teams and tools', 'Your dashboards only show work from the teams you pick.')}
    <div class="ob-pair">
      <fieldset class="ob-card ob-list"><legend class="ob-card__title">Teams</legend>${state.data.teams.map((t) => html`<label class="ob-row">
        <span class="ob-row__text"><span class="ob-row__name">${t.name}</span><span class="ob-row__meta">${t.suggested ? 'Suggested · you are on this team · ' : ''}${t.counts}</span></span>
        <input type="checkbox" name="team" value="${t.id}"${state.teams.has(t.id) ? html` checked` : ''}>
      </label>`)}</fieldset>
      <section class="ob-card ob-list" aria-label="Tools">
        <h2 class="ob-card__title">Tools</h2>
        <div class="ob-row"><span class="ob-row__name">Microsoft Teams</span>${statusPill({ text: 'Signs you in', tone: 'success', dot: false })}</div>
        ${r.tools.map((t) => html`<label class="ob-row"><span class="ob-row__text"><span class="ob-row__name">${t.name}</span><span class="ob-row__meta">Connect it when integrations arrive</span></span><input type="checkbox" name="tool" value="${t.key}"${state.tools[t.key] ? html` checked` : ''}></label>`)}
        <label class="ob-row"><span class="ob-row__name">Send approvals to me in Teams</span><input type="checkbox" name="approvalsInTeams"${state.approvalsInTeams ? html` checked` : ''}></label>
        <p class="ob-row__meta">Your choices are saved now. The connections themselves arrive with the Microsoft 365 and integration phases.</p>
      </section>
    </div>`;
}

function stepHome() {
  const r = role();
  const teams = state.data.teams.filter((t) => state.teams.has(t.id)).map((t) => t.name);
  const where = teams.length ? ` on the ${teams.join(' and ')}` : '';
  return html`${head('Step 4 of 4', "You're set", `Your home is tuned for ${article(r.name)} ${r.name.toLowerCase()}${where}.`)}
    <div class="ob-card ob-set">
      <section class="ob-set__things" aria-label="Your first three things">
        <span class="eyebrow">Your first three things</span>
        <ol class="ob-things">${r.firstThings.map((f) => html`<li><span class="ob-things__mark" aria-hidden="true"></span>${f}</li>`)}</ol>
      </section>
      <div class="ob-preview" aria-hidden="true"><span class="ob-preview__rail"></span><div class="ob-preview__body"><span class="ob-preview__title"></span><div class="ob-preview__tiles"><span></span><span></span><span></span></div><span class="ob-preview__panel"></span><span class="ob-preview__label">Preview · ${r.name} home</span></div></div>
    </div>
    ${teams.length ? '' : html`<p class="ob-note">You haven't picked a team, so your home will show only the items you own. Go back to add one.</p>`}`;
}

function draw({ focus = true } = {}) {
  stepsNav.innerHTML = String(html`<ol class="ob-steps">${STEPS.map((s, i) => {
    const n = i + 1;
    const cls = n === state.step ? 'ob-step--current' : n < state.step ? 'ob-step--done' : '';
    return html`<li><button type="button" class="ob-step ${cls}" data-step="${n}"${n === state.step ? html` aria-current="step"` : ''}><span class="ob-step__dot" aria-hidden="true">${n}</span><span class="ob-step__text"><span class="ob-step__label">${s.label}</span><span class="ob-step__hint">${s.hint}</span></span></button></li>`;
  })}</ol>`);
  const body = [stepRole, stepWork, stepTeams, stepHome][state.step - 1]();
  const returning = Boolean(state.data.profile?.onboarding.completed);
  root.innerHTML = String(html`<div class="ob-step-body">${body}</div>
    ${state.error ? html`<p class="ob-error" role="alert">${state.error}</p>` : ''}
    <footer class="ob-foot">
      ${state.step > 1 ? button({ label: 'Back', kind: 'secondary', attrs: { 'data-action': 'back' } }) : returning ? html`<a href="/">Cancel</a>` : button({ label: 'Skip for now', kind: 'secondary', attrs: { 'data-action': 'skip' } })}
      ${state.step < 4 ? button({ label: 'Continue', attrs: { 'data-action': 'next' } }) : button({ label: 'Open my home', attrs: { 'data-action': 'finish' } })}
    </footer>`);
  document.title = `${STEPS[state.step - 1].label} · Getting started · NooblyJS`;
  if (focus) root.querySelector('h1')?.focus();
}

function go(step, { push = true } = {}) {
  state.step = Math.min(4, Math.max(1, step));
  state.error = null;
  if (push) history.pushState({}, '', `/onboarding?step=${state.step}`);
  draw();
  window.scrollTo(0, 0);
}

root.addEventListener('change', (event) => {
  const el = event.target;
  if (el.name === 'role') state.role = el.value;
  else if (el.name === 'team') state.teams[el.checked ? 'add' : 'delete'](el.value);
  else if (el.name === 'tool') state.tools[el.value] = el.checked;
  else if (el.name === 'approvalsInTeams') state.approvalsInTeams = el.checked;
});

stepsNav.addEventListener('click', (event) => {
  const step = event.target.closest('[data-step]')?.dataset.step;
  if (step) go(Number(step));
});

root.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || state.busy) return;
  if (action === 'next') return go(state.step + 1);
  if (action === 'back') return go(state.step - 1);
  state.busy = true;
  try {
    const result = action === 'skip'
      ? await api.post('me/onboarding/skip', {})
      : await api.post('me/onboarding', { workRole: state.role, teams: [...state.teams], tools: state.tools, approvalsInTeams: state.approvalsInTeams });
    location.assign(result.home);
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    draw({ focus: false });
    root.querySelector('.ob-error')?.scrollIntoView({ block: 'nearest' });
  }
});

window.addEventListener('popstate', () => go(Number(new URLSearchParams(location.search).get('step')) || 1, { push: false }));

try {
  state.data = await api.get('me/onboarding');
  const { profile, suggested, roles, teams } = state.data;
  state.role = profile?.workRole ?? suggested?.role ?? roles[0].key;
  state.teams = new Set(profile?.teams?.length ? profile.teams : teams.filter((t) => t.suggested).map((t) => t.id));
  state.tools = { ...(profile?.tools ?? {}) };
  state.approvalsInTeams = profile ? profile.notifications.approvalsInTeams : true;
  state.step = Math.min(4, Math.max(1, Number(new URLSearchParams(location.search).get('step')) || 1));
  draw({ focus: false });
} catch (err) {
  if (err.status === 401) location.assign('/login?next=/onboarding');
  else root.innerHTML = String(notice({ title: "Onboarding couldn't load", text: err.message, tone: 'error', headingLevel: 1 }));
}
