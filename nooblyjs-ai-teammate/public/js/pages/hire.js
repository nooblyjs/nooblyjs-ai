// Hire a teammate (/hire): five numbered fieldsets and a live preview with a monthly cost estimate.
import { api, ApiError } from '../api.js';
import { html } from '../html.js';
import { avatar } from '../avatar.js';
import { AVATAR_OPTIONS, mountAvatarPicker } from '../avatar-picker.js';
import { money, rate } from '../format.js';
import { toast } from '../ui.js';

const MEMORY_MODES = [
  { id: 'session', title: 'Session only', desc: 'Starts fresh on every task. Cheapest and most private.' },
  { id: 'personal', title: 'Personal memory', desc: 'Remembers people, preferences and past work across tasks.' },
  { id: 'team', title: 'Shared team memory', desc: 'Reads and adds to what the whole team knows.' },
];

/** Parses an uploaded skill pack: optional YAML-ish front matter (name, description) then instructions. */
function parseSkillPack(text, fileName) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const field = (key) => fm && new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm').exec(fm[1])?.[1];
  const heading = /^#\s+(.+)$/m.exec(text)?.[1];
  return {
    name: field('name') || heading || fileName.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' '),
    description: field('description') || '',
    instructions: (fm ? fm[2] : text).trim(),
  };
}

export async function render(view, { query, ctx }) {
  const meta = ctx.meta ?? (await ctx.refreshMeta());
  if (!meta) throw new Error('Could not load the model catalogue');
  const models = meta.models;
  const defaultModel = models.find((m) => m.id === 'sonnet') ?? models[0];

  const state = {
    draftId: null,
    name: '',
    role: '',
    avatar: AVATAR_OPTIONS[0],
    model: defaultModel.id,
    skills: new Set(),
    memoryMode: 'personal',
    rate: defaultModel.baseRate,
    monthlyCap: 1500,
    costCentre: meta.costCentres[0] ?? '',
    showAllSkills: false,
    busy: false,
  };

  const draftId = query.get('draft');
  if (draftId) {
    try {
      const d = await api.get(`/api/drafts/${encodeURIComponent(draftId)}`);
      Object.assign(state, {
        draftId: d.id, name: d.name ?? '', role: d.role ?? '', avatar: d.avatar ?? state.avatar, model: d.model ?? state.model,
        skills: new Set(d.skills ?? []), memoryMode: d.memoryMode ?? state.memoryMode, rate: d.rate ?? state.rate,
        monthlyCap: d.monthlyCap ?? state.monthlyCap, costCentre: d.costCentre ?? state.costCentre,
      });
    } catch {
      toast('That draft could not be loaded, so this is a fresh form.', { error: true });
    }
  }

  const skillById = () => new Map(ctx.meta.skills.map((s) => [s.id, s]));
  const modelOf = (id) => models.find((m) => m.id === id);
  const firstName = () => state.name.trim().split(/\s+/)[0] || '';

  view.innerHTML = String(html`
    <div class="header" style="display:block">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/team">Team roster</a> / <span aria-current="page">Hire</span></nav>
      <h1>Hire a teammate</h1>
      <p class="header-subtitle">Five decisions: who they are, what they run on, what they can do, what they remember and what they cost.</p>
    </div>
    <div class="form-grid">
      <form id="hire-form" novalidate>
        <div class="form-banner" id="form-banner" role="alert" hidden></div>

        <fieldset class="form-section">
          <legend class="section-header"><span class="section-number" aria-hidden="true">1</span><span class="section-title">Identity</span></legend>
          <div class="form-group">
            <label class="form-label" for="f-name">Name</label>
            <input class="form-input" id="f-name" name="name" maxlength="60" autocomplete="off" required placeholder="e.g. Ada Quill" value="${state.name}" aria-describedby="err-name">
            <span class="field-error" id="err-name"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="f-role">Job title</label>
            <input class="form-input" id="f-role" name="role" maxlength="80" autocomplete="off" required placeholder="e.g. Research Analyst" value="${state.role}" aria-describedby="err-role">
            <span class="field-error" id="err-role"></span>
          </div>
          <div class="form-group">
            <span class="form-label" id="avatar-label">Avatar</span>
            <div class="avatar-grid" role="group" aria-labelledby="avatar-label" id="avatar-picker"></div>
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend class="section-header"><span class="section-number" aria-hidden="true">2</span><span class="section-title">Model</span></legend>
          <div class="model-options">${models.map(
            (m) => html`<label class="model-card">
              <input class="hidden-radio" type="radio" name="model" value="${m.id}" ${m.id === state.model ? 'checked' : ''}>
              <div class="model-tier">${m.tier} · ${m.symbol}</div>
              <div class="model-name">${m.name}</div>
              <div class="model-desc">${m.description}</div>
              <div class="model-price">From ${rate(m.baseRate)}</div>
            </label>`,
          )}</div>
        </fieldset>

        <fieldset class="form-section">
          <legend class="section-header"><span class="section-number" aria-hidden="true">3</span><span class="section-title">Skills</span></legend>
          <div class="skill-chips" id="skill-chips"></div>
          <button type="button" class="btn-link mt-1" id="upload-skill">+ Upload a skill pack</button>
          <input type="file" id="skill-file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden>
        </fieldset>

        <fieldset class="form-section">
          <legend class="section-header"><span class="section-number" aria-hidden="true">4</span><span class="section-title">Memory</span></legend>
          ${MEMORY_MODES.map(
            (m) => html`<label class="memory-option"><input class="hidden-radio" type="radio" name="memoryMode" value="${m.id}" ${m.id === state.memoryMode ? 'checked' : ''}><div class="memory-label">${m.title}</div><div class="memory-desc">${m.desc}</div></label>`,
          )}
        </fieldset>

        <fieldset class="form-section">
          <legend class="section-header"><span class="section-number" aria-hidden="true">5</span><span class="section-title">Billing</span></legend>
          <div class="form-group">
            <label class="form-label" for="f-rate">Hourly rate (USD)</label>
            <input class="form-input" id="f-rate" name="rate" type="number" min="0" step="0.5" inputmode="decimal" value="${state.rate}" aria-describedby="err-rate">
            <span class="field-error" id="err-rate"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="f-cap">Monthly cap (USD)</label>
            <input class="form-input" id="f-cap" name="monthlyCap" type="number" min="0" step="50" inputmode="decimal" value="${state.monthlyCap}" aria-describedby="err-monthlyCap">
            <span class="field-error" id="err-monthlyCap"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="f-centre">Bill to</label>
            <select class="form-input" id="f-centre" name="costCentre">${meta.costCentres.map((c) => html`<option ${c === state.costCentre ? 'selected' : ''}>${c}</option>`)}</select>
          </div>
          <p class="help mt-1">The rate starts at the model's suggested price. Work stops and you are asked before the cap is passed.</p>
        </fieldset>

        <div class="button-group">
          <a class="btn-link" href="/team">Cancel</a>
          <button type="button" class="btn btn-secondary" id="save-draft">Save draft</button>
          <button type="submit" class="btn btn-primary" id="hire-submit"></button>
        </div>
      </form>

      <aside aria-label="Preview">
        <div class="preview-card" id="preview" aria-live="polite"></div>
      </aside>
    </div>`);

  const form = view.querySelector('#hire-form');
  const picker = view.querySelector('#avatar-picker');
  const chips = view.querySelector('#skill-chips');
  const preview = view.querySelector('#preview');
  const submit = view.querySelector('#hire-submit');
  const banner = view.querySelector('#form-banner');

  const drawSkills = () => {
    const all = ctx.meta.skills;
    const visible = state.showAllSkills ? all : all.filter((s) => s.featured || state.skills.has(s.id));
    chips.innerHTML = String(html`
      ${visible.map((s) => {
        const on = state.skills.has(s.id);
        return html`<button type="button" class="skill-chip${on ? ' active' : ''}" data-skill="${s.id}" aria-pressed="${on}" title="${s.description}"><span aria-hidden="true">${on ? '✓' : '+'}</span>${s.name}</button>`;
      })}
      ${all.length > visible.length || state.showAllSkills ? html`<button type="button" class="btn-link" id="toggle-all-skills">${state.showAllSkills ? 'Show fewer' : `Show all ${all.length} skills`}</button>` : ''}`);
  };

  const drawPreview = () => {
    const m = modelOf(state.model);
    const map = skillById();
    const r = Number(state.rate) || 0;
    const cap = Number(state.monthlyCap) || 0;
    const hoursPerMonth = meta.billing?.estimateHoursPerMonth ?? 80;
    const estimate = r * hoursPerMonth;
    const capHours = r > 0 ? Math.floor(cap / r) : Infinity;
    preview.innerHTML = String(html`
      <div class="preview-title">PREVIEW</div>
      <div class="preview-avatar">${avatar(state.avatar, 96)}</div>
      <div class="preview-name">${state.name.trim() || 'Your new teammate'}</div>
      <div class="preview-role">${state.role.trim() || 'Job title'}</div>
      ${state.skills.size ? html`<div class="preview-skills">${[...state.skills].map((id) => html`<span class="preview-skill">${map.get(id)?.name ?? id}</span>`)}</div>` : ''}
      <div class="preview-grid">
        <div class="preview-item"><div class="preview-label">Model</div><div class="preview-value">${m.name}</div></div>
        <div class="preview-item"><div class="preview-label">Rate</div><div class="preview-value">${rate(r)}</div></div>
        <div class="preview-item"><div class="preview-label">Memory</div><div class="preview-value">${{ session: 'Session only', personal: 'Personal', team: 'Shared team' }[state.memoryMode]}</div></div>
        <div class="preview-item"><div class="preview-label">Monthly cap</div><div class="preview-value">${money(cap)}</div></div>
      </div>
      <div class="estimate-card">
        <div class="estimate-title">At ${hoursPerMonth} hours a month →</div>
        <div class="estimate-amount">${money(estimate)}</div>
        ${estimate > cap
          ? html`<div class="estimate-subtitle warn">Hits the ${money(cap)} cap after ${capHours} hours</div>`
          : html`<div class="estimate-subtitle">Comfortably under the ${money(cap)} cap</div>`}
      </div>`);
    submit.textContent = `Hire ${firstName() || 'teammate'}`;
  };

  const showErrors = (details = {}) => {
    for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const [key, message] of Object.entries(details)) {
      const err = form.querySelector(`#err-${key}`);
      if (err) err.textContent = message;
      form.elements[key]?.setAttribute?.('aria-invalid', 'true');
    }
  };

  const payload = () => ({
    name: state.name.trim(), role: state.role.trim(), avatar: state.avatar, model: state.model, skills: [...state.skills],
    memoryMode: state.memoryMode, rate: Number(state.rate), monthlyCap: Number(state.monthlyCap), costCentre: state.costCentre,
  });

  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name === 'name' || name === 'role' || name === 'rate' || name === 'monthlyCap') state[name] = value;
    drawPreview();
  });
  form.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (name === 'model') {
      state.model = value;
      state.rate = modelOf(value).baseRate; // choosing a model resets the rate
      form.elements.rate.value = state.rate;
    } else if (name === 'memoryMode' || name === 'costCentre') state[name] = value;
    drawPreview();
  });

  chips.addEventListener('click', (e) => {
    if (e.target.closest('#toggle-all-skills')) {
      state.showAllSkills = !state.showAllSkills;
      drawSkills();
      chips.querySelector('#toggle-all-skills')?.focus();
      return;
    }
    const chip = e.target.closest('[data-skill]');
    if (!chip) return;
    const id = chip.dataset.skill;
    state.skills.has(id) ? state.skills.delete(id) : state.skills.add(id);
    drawSkills();
    drawPreview();
    chips.querySelector(`[data-skill="${CSS.escape(id)}"]`)?.focus();
  });

  view.querySelector('#upload-skill').addEventListener('click', () => view.querySelector('#skill-file').click());
  view.querySelector('#skill-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 100 * 1024) return toast('Skill packs must be 100 KB or smaller', { error: true });
    try {
      const skill = await api.post('/api/skills', parseSkillPack(await file.text(), file.name));
      await ctx.refreshMeta();
      state.skills.add(skill.id);
      drawSkills();
      drawPreview();
      toast(`Added the “${skill.name}” skill`);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  view.querySelector('#save-draft').addEventListener('click', async () => {
    try {
      const draft = await api.post('/api/drafts', { id: state.draftId ?? undefined, ...payload() });
      state.draftId = draft.id;
      history.replaceState(null, '', `/hire?draft=${draft.id}`);
      toast('Draft saved. Bookmark this page to come back to it.');
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    showErrors();
    banner.hidden = true;
    const body = payload();
    const missing = {};
    if (!body.name) missing.name = 'Give your teammate a name';
    if (!body.role) missing.role = 'Add a job title';
    if (Object.keys(missing).length) {
      showErrors(missing);
      form.elements[Object.keys(missing)[0]].focus();
      return;
    }
    state.busy = true;
    submit.disabled = true;
    try {
      const t = await api.post('/api/teammates', body);
      toast(`Welcome to the team, ${t.name.split(' ')[0]}!`);
      ctx.refreshMeta();
      ctx.navigate(`/team/${t.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        showErrors(err.details);
        const first = Object.keys(err.details).find((k) => form.elements[k]);
        if (first) form.elements[first].focus();
      }
      banner.textContent = err.message;
      banner.hidden = false;
    } finally {
      state.busy = false;
      submit.disabled = false;
    }
  });

  mountAvatarPicker(picker, {
    value: state.avatar,
    onChange: (a) => {
      state.avatar = a;
      drawPreview();
    },
  });
  drawSkills();
  drawPreview();
}
