// Teammate profile (/team/:id): hero, about, skills, timesheet, model & cost, memory, billing chart.
// Also hosts the "Assign work" flow that calls the teammate's endpoint and streams the result.
import { api, stream, ApiError } from '../api.js';
import { html } from '../html.js';
import { icons } from '../icons.js';
import { avatar, bandColor, deepColor } from '../avatar.js';
import { money, rate, hours, hours1, tokens, count } from '../format.js';
import { statusPill, LEVELS, openDialog, confirmDialog, toast } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { mountAvatarPicker } from '../avatar-picker.js';
import { showWorkItem, usedSummary } from '../work-dialog.js';
import { memoryRow, byPinnedThenNewest } from '../memory-ui.js';
import { toolsCard, editTools, schedulesCard, editSchedule, runSchedule } from '../profile-automation.js';

const MEMORY_COLORS = { fact: '#7A2E14', preference: '#C2471F', source: '#F2A27E' };
const KIND_LABEL = { fact: 'Fact', preference: 'Preference', source: 'Source' };
const MODE_LABEL = { session: 'Session only', personal: 'Personal memory', team: 'Shared team memory' };

const levelMeter = (level) => html`
  <div role="img" aria-label="Level: ${LEVELS[level]}">
    <div class="level-meter" aria-hidden="true">${[1, 2, 3].map((n) => html`<div class="level-segment${n <= level ? ' filled' : ''}"></div>`)}</div>
    <div class="level-label" aria-hidden="true">${LEVELS[level]}</div>
  </div>`;

const SECTIONS = [['#about', 'About'], ['#skills', 'Skills'], ['#knowledge', 'Knowledge'], ['#tools', 'Tools'], ['#schedules', 'Schedules'], ['#memory', 'Memory'], ['#model', 'Model & cost'], ['#timesheet', 'Timesheet']];
const viaKey = (e) => (e.callerType === 'key' ? html`<div class="help">via API key “${e.caller}”</div>` : '');
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const heroStatus = (t) => statusPill(t.status);
const pauseLabel = (status) => (status === 'paused' || status === 'off' ? 'Resume' : 'Pause');

function heroCard(t) {
  const retired = Boolean(t.retiredAt);
  const deep = deepColor(t.avatar);
  return html`
    ${retired ? html`<div class="retired-banner" role="status"><span>${t.name} was retired on ${t.retiredLabel}. Their timesheets stay in billing.</span><button type="button" class="btn btn-secondary" data-action="reinstate">Reinstate ${t.name.split(' ')[0]}</button></div>` : ''}
    <section class="hero-section${retired ? ' retired' : ''}" style="background:${bandColor(t.avatar)}" aria-labelledby="tm-name">
      <div class="hero-avatar" style="background:${bandColor(t.avatar)}">${avatar(t.avatar, 124)}</div>
      <div class="hero-content">
        <div class="hero-info">
          <h1 id="tm-name" style="color:${deep}">${t.name}</h1>
          <div class="hero-meta" style="color:${deep}">
            <span id="hero-status" aria-live="polite">${retired ? statusPill('retired', 'Retired') : heroStatus(t)}</span>
            <span id="hero-task">${!retired && t.status === 'task' ? t.currentTask : ''}</span>
          </div>
          <div style="font-size:14px;color:${deep}">${t.role} · reports to ${t.reportsToName} · hired ${t.hiredLabel}</div>
        </div>
        ${retired ? '' : html`<div class="hero-actions">
          <button type="button" class="btn btn-secondary" data-action="edit-profile">Edit</button>
          <button type="button" class="btn btn-secondary" data-action="toggle-pause" id="pause-btn">${pauseLabel(t.status)}</button>
          <button type="button" class="btn btn-primary" data-action="assign">→ Assign work</button>
        </div>`}
      </div>
    </section>
    <nav class="tabs" aria-label="Profile sections">
      ${SECTIONS.map(([hash, label]) => html`<a class="tab${(location.hash || '#about') === hash ? ' active' : ''}" href="${hash}">${label}</a>`)}
    </nav>`;
}

function aboutCard(t) {
  const firstName = t.name.split(' ')[0];
  return html`
    <section class="card" id="about" aria-labelledby="about-h">
      <div class="card-head"><h2 class="card-title" id="about-h">About ${firstName}</h2><button type="button" class="btn btn-secondary" data-action="edit-persona">Edit persona</button></div>
      <p class="about-text">${t.about}</p>
      ${t.traits?.length ? html`<div class="traits">${t.traits.map((tr) => html`<span class="skill">${tr}</span>`)}</div>` : ''}
    </section>`;
}

function skillsCard(t) {
  return html`
    <section class="card" id="skills" aria-labelledby="skills-h">
      <div class="card-head"><h2 class="card-title" id="skills-h">Skills</h2><button type="button" class="btn btn-secondary" data-action="add-skill">Add skill</button></div>
      ${t.skills?.length
        ? t.skills.map(
            (s) => html`
          <div class="skill-row">
            <div><div class="skill-name">${s.name}</div><div class="skill-desc">${s.description}</div></div>
            <div class="skill-level">
              <button type="button" class="btn btn-secondary btn-sm skill-edit" data-action="edit-skill" data-skill="${s.id}" aria-label="Edit ${s.name}">Edit</button>
              ${levelMeter(s.level)}
            </div>
          </div>`,
          )
        : html`<p class="muted">No skills yet. Add one so ${t.name.split(' ')[0]} knows how you like this work done.</p>`}
    </section>`;
}

function knowledgeCard(t) {
  const first = t.name.split(' ')[0];
  return html`
    <section class="card" id="knowledge" aria-labelledby="knowledge-h">
      <div class="card-head">
        <h2 class="card-title" id="knowledge-h">Knowledge</h2>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-secondary" data-action="upload-docs">${icons.upload}Upload</button>
          <button type="button" class="btn btn-secondary" data-action="add-doc">Write</button>
        </div>
      </div>
      ${t.knowledge?.length
        ? html`<div class="doc-list">${t.knowledge.map((d) => html`
            <button type="button" class="doc-row" data-action="edit-doc" data-doc="${d.id}">
              <span class="doc-icon" aria-hidden="true">${icons.doc}</span>
              <span class="doc-main">
                <span class="doc-title">${d.title}${d.project ? html` <span class="project-chip">${d.project}</span>` : ''}</span>
                <span class="doc-excerpt">${d.excerpt}</span>
              </span>
              <span class="doc-meta">${count(d.chars)} chars<br>${shortDate(d.updatedAt)}</span>
            </button>`)}</div>`
        : html`<p class="help">No documents yet. Add policies, notes or guides as .md or .txt and ${first} will use the passages that match each task, and cite them.</p>`}
      <input type="file" id="doc-files" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden>
    </section>`;
}

function timesheetCard(t) {
  const { entries, totals } = t.timesheet;
  return html`
    <section class="card" id="timesheet" aria-labelledby="ts-h">
      <div class="card-head"><h2 class="card-title" id="ts-h">Timesheet · this week</h2><span class="d-flex gap-2"><a href="/timeline?teammate=${t.id}">Timeline</a><a href="/billing">All billing</a></span></div>
      ${entries.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Day</th><th scope="col">Task</th><th scope="col">Hours</th><th scope="col">Tokens</th><th scope="col">Billed</th></tr></thead>
            <tbody>${entries.map(
              (e) => html`<tr>
                <td>${e.day}</td>
                <td>${e.workId ? html`<button type="button" class="task-link" data-action="view-work" data-work="${e.workId}">${e.task}</button>` : e.task}${viaKey(e)}</td>
                <td>${hours1(e.hours)}</td><td>${tokens(e.tokens)}</td><td>${money(e.amount)}</td>
              </tr>`,
            )}</tbody>
            <tfoot><tr><td colspan="2">This week</td><td>${hours1(totals.hours)}</td><td>${tokens(totals.tokens)}</td><td>${money(totals.amount)}</td></tr></tfoot>
          </table></div>`
        : html`<p class="muted">No time logged this week yet. Assign some work and it will show up here.</p>`}
    </section>`;
}

function modelCard(t) {
  const c = t.costBreakdown;
  return html`
    <section class="model-card" id="model" aria-label="Model and cost">
      <div class="model-badge">${t.modelInfo.tier} ${t.modelInfo.symbol}</div>
      <div class="model-name">${t.modelInfo.name}</div>
      <div class="cost-items">
        <div class="cost-item"><span class="cost-label">Model compute</span><span>${rate(c.compute)}</span></div>
        <div class="cost-item"><span class="cost-label">Tools &amp; memory</span><span>${rate(c.tools)}</span></div>
        <div class="cost-item"><span class="cost-label">Margin</span><span>${rate(c.margin)}</span></div>
      </div>
      <div class="cost-item total"><span class="cost-label">Billing rate</span><span>${rate(c.rate)}</span></div>
      <button type="button" class="btn btn-on-dark" data-action="change-model">Change model</button>
    </section>`;
}

function memoryCard(t) {
  const m = t.memory;
  const session = m.mode === 'session';
  return html`
    <section class="card" id="memory" aria-labelledby="memory-h">
      <h2 class="card-title" id="memory-h">Memory</h2>
      <div class="memory-count">${count(m.count)} of ${count(m.cap)} items</div>
      <div class="memory-mode">${MODE_LABEL[m.mode]}${m.pinned ? ` · ${m.pinned} pinned` : ''}</div>
      ${session
        ? html`<p class="help">${t.name.split(' ')[0]} starts fresh on every task and keeps nothing between them.</p>`
        : html`
          <div class="memory-kinds">
            ${['fact', 'preference', 'source'].map((k) => html`<span class="memory-kind"><span class="sw" style="background:${MEMORY_COLORS[k]}" aria-hidden="true"></span><strong>${KIND_LABEL[k]}s</strong>${count(m.byKind[k])}</span>`)}
          </div>
          <div class="recent-title">Recently learned</div>
          <div class="recent-list">
            ${m.recent.length
              ? m.recent.map((r) => html`<div class="recent-item"><p>${r.pinned ? html`<span class="pin-mark" title="Pinned">${icons.pin}</span>` : ''}${r.text}</p><div class="meta">${KIND_LABEL[r.kind]} · learned ${r.learned}${r.project ? html` · <span class="project-chip">${r.project}</span>` : ''}</div></div>`)
              : html`<p class="help">Nothing yet. Memories appear after ${t.name.split(' ')[0]} finishes a task.</p>`}
          </div>`}
      <div class="memory-actions">
        <button type="button" class="btn btn-secondary" data-action="review-memory" ${session && !m.count ? 'disabled' : ''}>Review memory</button>
        <button type="button" class="btn btn-danger" data-action="reset-memory" ${!m.count ? 'disabled' : ''}>Reset</button>
      </div>
    </section>`;
}

function billedCard(t, warnAtPct) {
  const max = Math.max(...t.weekly.map((w) => w.amount), 1);
  const capPct = t.monthlyCap ? Math.round((t.monthBilled / t.monthlyCap) * 100) : 0;
  const capWarn = capPct >= (warnAtPct ?? 80);
  return html`
    <section class="card" aria-labelledby="billed-h">
      <h2 class="card-title" id="billed-h">Billed · last 30 days</h2>
      <div class="billed-total">
        <div class="billed-amount">${money(t.billed30d.amount)}</div>
        <div class="billed-hours">${hours(t.billed30d.hours).replace('h', '')} hours</div>
      </div>
      <div class="billed-bars" role="img" aria-label="${t.weekly.map((w) => `${w.label}: ${money(w.amount)}`).join(', ')}">
        ${t.weekly.map((w) => html`<span class="${w.current ? 'current' : ''}" style="height:${(w.amount / max) * 100}%"></span>`)}
      </div>
      <div class="billed-labels" aria-hidden="true">${t.weekly.map((w) => html`<span class="${w.current ? 'current' : ''}">${w.label}</span>`)}</div>
      ${t.monthlyCap ? html`<div class="billed-foot${capWarn ? ' warn' : ''}">${capWarn ? icons.alert : ''}${money(t.monthBilled)} of the ${money(t.monthlyCap)} monthly cap used this month (${capPct}%)</div>` : ''}
    </section>`;
}

// ---------- Dialogs ----------

const skillNamesOf = (t) => new Map((t.skills ?? []).map((s) => [s.id, s.name]));

/** `followUp` continues an earlier conversation: { thread, title, project }. */
async function assignWork(t, ctx, onFinished, followUp = null) {
  const first = t.name.split(' ')[0];
  const centres = ctx.meta?.costCentres ?? [t.costCentre];
  const projects = ctx.meta?.projects ?? [];
  let controller = null;
  let current = followUp;
  await openDialog({
    title: followUp ? `Follow up with ${first}` : `Assign work to ${first}`,
    wide: true,
    body: html`
      <form id="assign-form" class="modal-body" style="padding:0">
        <div class="follow-banner" id="follow-banner" hidden></div>
        <div class="form-group">
          <label class="form-label" for="task-input">What should ${first} work on?</label>
          <textarea class="form-input" id="task-input" name="task" required maxlength="20000" placeholder="One clear question or outcome, plus any context and a deadline."></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="centre-input">Bill to</label>
            <select class="form-input" id="centre-input" name="costCentre">${centres.map((c) => html`<option ${c === t.costCentre ? 'selected' : ''}>${c}</option>`)}</select>
          </div>
          <div class="form-group">
            <label class="form-label" for="project-input">Project <span class="help">(optional)</span></label>
            <input class="form-input" id="project-input" name="project" list="project-options" maxlength="48" placeholder="e.g. acme" aria-describedby="project-help">
            <datalist id="project-options">${projects.map((p) => html`<option value="${p}"></option>`)}</datalist>
          </div>
        </div>
        <div class="notice notice-warn" id="cost-confirm" role="alert" hidden></div>
        <p class="help" id="project-help">With a project, ${first} only uses documents and memories for that project (plus untagged ones), and what they learn is tagged with it. Runs on ${t.modelInfo.name} at ${rate(t.rate)}; time is logged as pending until you approve it.</p>
      </form>
      <div id="run" hidden>
        <div class="run-meta" id="run-meta"></div>
        <div class="output md" id="output" aria-live="polite" tabindex="0"></div>
        <div class="run-meta" id="run-result"></div>
        <div id="run-used"></div>
      </div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close id="assign-cancel">Cancel</button>
      <button type="button" class="btn btn-secondary" id="assign-follow" hidden>Follow up</button>
      <button type="submit" form="assign-form" class="btn btn-primary" id="assign-submit">${icons.arrowRight}Start work</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#assign-form');
      const runEl = dialog.querySelector('#run');
      const output = dialog.querySelector('#output');
      const meta = dialog.querySelector('#run-meta');
      const resultEl = dialog.querySelector('#run-result');
      const usedEl = dialog.querySelector('#run-used');
      const submit = dialog.querySelector('#assign-submit');
      const cancel = dialog.querySelector('#assign-cancel');
      const followBtn = dialog.querySelector('#assign-follow');
      const banner = dialog.querySelector('#follow-banner');
      const projectInput = dialog.querySelector('#project-input');
      const costBox = dialog.querySelector('#cost-confirm');
      // Set after the server says the estimate is over the approval threshold and shows it to the owner.
      let confirmCost = false;
      const resetCost = () => {
        confirmCost = false;
        costBox.hidden = true;
        submit.innerHTML = String(html`${icons.arrowRight}Start work`);
      };
      form.task.addEventListener('input', () => confirmCost && resetCost());

      // In a follow-up the project comes from the conversation and can't be changed.
      const showFollowUp = () => {
        banner.hidden = !current;
        projectInput.disabled = Boolean(current);
        projectInput.value = current?.project ?? '';
        if (current) banner.innerHTML = String(html`<strong>Following up on</strong> “${current.title}”${current.project ? html` · project <span class="project-chip">${current.project}</span>` : ''}. ${first} sees the earlier turns of this conversation.`);
      };
      showFollowUp();
      dialog.querySelector('#task-input').focus();

      followBtn.addEventListener('click', () => {
        text = '';
        output.innerHTML = '';
        resultEl.innerHTML = '';
        usedEl.innerHTML = '';
        runEl.hidden = true;
        form.hidden = false;
        form.task.value = '';
        submit.hidden = false;
        followBtn.hidden = true;
        cancel.textContent = 'Close';
        showFollowUp();
        form.task.focus();
      });
      // Re-render the Markdown at most once per frame while text streams in.
      let text = '';
      let frame = 0;
      const paint = () => {
        frame = 0;
        const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
        output.innerHTML = renderMarkdown(text);
        if (atBottom) output.scrollTop = output.scrollHeight;
      };
      const append = (chunk) => {
        text += chunk;
        frame ||= requestAnimationFrame(paint);
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.task.trim()) return;
        if (current) data.thread = current.thread;
        if (confirmCost) data.confirmCost = true;
        resetCost();
        form.hidden = true;
        runEl.hidden = false;
        submit.hidden = true;
        cancel.textContent = 'Stop';
        meta.innerHTML = String(html`<span class="spinner" aria-hidden="true"></span> <span>${t.name.split(' ')[0]} is working…</span>`);
        controller = new AbortController();
        try {
          await stream(`/api/teammates/${t.id}/tasks`, data, {
            start: (s) => {
              meta.innerHTML = String(html`<span class="spinner" aria-hidden="true"></span><span>Working on <strong>${s.model}</strong>${s.provider === 'mock' ? ' (offline mock)' : ''}</span>`);
            },
            delta: (d) => append(d.text),
            tool: (tc) => {
              if (tc.status === 'running') meta.innerHTML = String(html`<span class="spinner" aria-hidden="true"></span><span>Using <strong>${tc.label}</strong>…</span>`);
              else if (tc.status === 'queued') toast(`${t.name.split(' ')[0]} asked to use ${tc.label}. It waits for approval in Billing.`);
            },
            memory: (m) => toast(`${t.name.split(' ')[0]} remembered ${m.items.length} new ${m.items.length === 1 ? 'thing' : 'things'}`),
            done: (r) => {
              text = r.output || text;
              paint();
              meta.innerHTML = String(html`<span>${r.stopReason === 'refusal' ? 'The model declined this task.' : 'Done.'}</span>`);
              resultEl.innerHTML = String(html`
                <span>Logged <strong class="num">${hours1(r.hours)}</strong> at ${rate(r.entry.rate)} = <strong class="num">${money(r.amount)}</strong> (pending approval)</span>
                <span class="num">${tokens(r.tokens)} tokens · API cost ${money(r.apiCost)}</span>
                ${r.memoriesAdded.length ? html`<span>${r.memoriesAdded.length} new ${r.memoriesAdded.length === 1 ? 'memory' : 'memories'}</span>` : ''}`);
              usedEl.innerHTML = String(usedSummary(r, skillNamesOf(t)));
              current = { thread: r.thread, title: current?.title ?? data.task.split('\n')[0].slice(0, 80), project: r.project };
              followBtn.hidden = false;
            },
            error: (err) => {
              meta.innerHTML = String(html`<span class="field-error">${err.message}</span>`);
            },
          }, controller.signal);
        } catch (err) {
          if (err.name === 'AbortError') meta.textContent = 'Stopped.';
          else {
            meta.innerHTML = String(html`<span class="field-error">${err.message}</span>`);
            if (err instanceof ApiError && err.status !== 502) {
              form.hidden = false;
              runEl.hidden = true;
              submit.hidden = false;
            }
            if (err instanceof ApiError && err.code === 'approval_required') {
              const { estimate, threshold } = err.details;
              confirmCost = true;
              costBox.hidden = false;
              costBox.innerHTML = String(html`This task is estimated at <strong class="num">${money(estimate.amount)}</strong> (${hours1(estimate.hours)}, about ${tokens(estimate.tokens)} tokens), over ${first}'s ${money(threshold)} approval threshold. As the owner you can approve it and start now.`);
              submit.innerHTML = String(html`${icons.check}Approve &amp; start`);
              submit.focus();
            }
          }
        } finally {
          controller = null;
          cancel.textContent = 'Close';
        }
      });
      return () => controller?.abort();
    },
  });
  onFinished();
}

async function changeModel(t, ctx, onSaved) {
  const models = ctx.meta.models;
  await openDialog({
    title: 'Change model',
    body: html`
      <form id="model-form" class="modal-body" style="padding:0">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="visually-hidden">Model</legend>
          <div class="model-options">${models.map(
            (m) => html`<label class="model-card">
              <input class="hidden-radio" type="radio" name="model" value="${m.id}" ${m.id === t.model ? 'checked' : ''}>
              <div class="model-tier">${m.tier} · ${m.symbol}</div>
              <div class="model-name">${m.name}</div>
              <div class="model-desc">${m.description}</div>
              <div class="model-price">From ${rate(m.baseRate)}</div>
            </label>`,
          )}</div>
        </fieldset>
        <div class="form-group" style="max-width:240px">
          <label class="form-label" for="rate-input">Hourly rate (USD)</label>
          <input class="form-input" id="rate-input" name="rate" type="number" min="0" step="0.5" value="${t.rate}" required>
        </div>
        <p class="help">Choosing a model resets the rate to that model's suggested price. Existing timesheet entries keep the rate they were logged at.</p>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="model-form" class="btn btn-primary">Save</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#model-form');
      form.addEventListener('change', (e) => {
        if (e.target.name === 'model') form.rate.value = models.find((m) => m.id === e.target.value).baseRate;
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.patch(`/api/teammates/${t.id}`, { model: form.model.value, rate: Number(form.rate.value) });
          toast(`${t.name.split(' ')[0]} now runs on ${models.find((m) => m.id === form.model.value).name}`);
          dialog.close('saved');
          onSaved();
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
}

async function addSkill(t, ctx, onSaved) {
  const owned = new Set(t.skills.map((s) => s.id));
  const available = ctx.meta.skills.filter((s) => !owned.has(s.id));
  await openDialog({
    title: 'Add skill',
    body: html`
      <form id="skill-form" class="modal-body" style="padding:0">
        <div class="form-group">
          <label class="form-label" for="skill-select">Skill</label>
          <select class="form-input" id="skill-select" name="skillId">
            ${available.map((s) => html`<option value="${s.id}">${s.name} — ${s.description}</option>`)}
            <option value="">+ A new skill…</option>
          </select>
        </div>
        <div id="new-skill" class="form-row" ${available.length ? 'hidden' : ''}>
          <div class="form-group"><label class="form-label" for="skill-name">Name</label><input class="form-input" id="skill-name" name="name" maxlength="60"></div>
          <div class="form-group"><label class="form-label" for="skill-desc">Description</label><input class="form-input" id="skill-desc" name="description" maxlength="160"></div>
        </div>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="form-label" style="margin-bottom:8px">Level</legend>
          <div class="choice-row">${[1, 2, 3].map(
            (l) => html`<label class="memory-option"><input class="hidden-radio" type="radio" name="level" value="${l}" ${l === 1 ? 'checked' : ''}><div class="memory-label">${LEVELS[l]}</div></label>`,
          )}</div>
        </fieldset>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="skill-form" class="btn btn-primary">Add skill</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#skill-form');
      const newSkill = dialog.querySelector('#new-skill');
      form.skillId.addEventListener('change', () => (newSkill.hidden = Boolean(form.skillId.value)));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(form));
        try {
          await api.post(`/api/teammates/${t.id}/skills`, { ...body, level: Number(body.level) });
          dialog.close('saved');
          await ctx.refreshMeta();
          onSaved();
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
}

async function reviewMemory(t, onChanged) {
  let { items } = await api.get(`/api/teammates/${t.id}/memory`);
  let changed = false;
  const others = (m) => (m.teammateId !== t.id ? 'a teammate' : '');
  await openDialog({
    title: `${t.name.split(' ')[0]}'s memory`,
    wide: true,
    body: html`
      <p class="muted">${MODE_LABEL[t.memory.mode]} · ${count(items.length)} of ${count(t.memory.cap)} items. Pin what matters: pinned items are always used and never merged. Delete anything wrong or out of date.</p>
      <div class="memory-list" id="memory-list"></div>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Done</button>`,
    setup(dialog) {
      const list = dialog.querySelector('#memory-list');
      const draw = () => {
        list.innerHTML = String(items.length ? html`${[...items].sort(byPinnedThenNewest).map((m) => memoryRow(m, { contributor: others(m) }))}` : html`<p class="muted">Nothing remembered yet.</p>`);
      };
      draw();
      list.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-delete]');
        const pin = e.target.closest('[data-pin]');
        const work = e.target.closest('[data-work]');
        try {
          if (del) {
            del.disabled = true;
            await api.del(`/api/teammates/${t.id}/memory/${del.dataset.delete}`);
            items = items.filter((m) => m.id !== del.dataset.delete);
            changed = true;
            draw();
          } else if (pin) {
            const item = items.find((m) => m.id === pin.dataset.pin);
            const updated = await api.patch(`/api/teammates/${t.id}/memory/${item.id}`, { pinned: !item.pinned });
            item.pinned = updated.pinned;
            changed = true;
            draw();
            list.querySelector(`[data-pin="${item.id}"]`)?.focus();
          } else if (work) {
            await showWorkItem({ teammateId: work.dataset.teammate, workId: work.dataset.work, skillNames: skillNamesOf(t) });
          }
        } catch (err) {
          if (del) del.disabled = false;
          toast(err.message, { error: true });
        }
      });
    },
  });
  if (changed) onChanged();
}

function viewWork(t, workId, ctx, reload) {
  const canWork = !t.retiredAt && t.status !== 'paused' && t.status !== 'off';
  return showWorkItem({
    teammateId: t.id,
    workId,
    skillNames: skillNamesOf(t),
    onFollowUp: canWork ? (w) => assignWork(t, ctx, reload, { thread: w.thread, title: w.request.split('\n')[0].slice(0, 80), project: w.project }) : undefined,
  });
}

/** Add or edit a knowledge document. Upload fills the form from a .md/.txt file. */
async function editDocument(t, ctx, docId, onSaved) {
  const doc = docId ? await api.get(`/api/teammates/${t.id}/knowledge/${docId}`) : { title: '', content: '', project: '' };
  const projects = ctx.meta?.projects ?? [];
  let changed = false;
  await openDialog({
    title: docId ? 'Edit document' : 'Add a document',
    wide: true,
    body: html`
      <form id="doc-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="d-title">Title</label><input class="form-input" id="d-title" name="title" maxlength="120" value="${doc.title}" required aria-describedby="err-title"><span class="field-error" id="err-title"></span></div>
          <div class="form-group"><label class="form-label" for="d-project">Project <span class="help">(optional)</span></label><input class="form-input" id="d-project" name="project" list="doc-projects" maxlength="48" value="${doc.project ?? ''}" placeholder="Shared with every project" aria-describedby="err-project"><datalist id="doc-projects">${projects.map((p) => html`<option value="${p}"></option>`)}</datalist><span class="field-error" id="err-project"></span></div>
        </div>
        <div class="form-group">
          <div class="card-head" style="margin-bottom:8px"><label class="form-label" for="d-content" style="margin:0">Text (Markdown or plain text)</label>${docId ? '' : html`<button type="button" class="btn-link" id="d-upload" style="padding:0">Load from a .md or .txt file</button>`}</div>
          <textarea class="form-input code" id="d-content" name="content" style="min-height:300px" aria-describedby="err-content d-help">${doc.content}</textarea>
          <span class="help" id="d-help">Headings help: each task gets the best-matching passages, labelled with the nearest heading.${doc.filename ? ` Uploaded from ${doc.filename}.` : ''}</span>
          <span class="field-error" id="err-content"></span>
        </div>
        <input type="file" id="d-file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden>
      </form>`,
    footer: html`${docId ? html`<button type="button" class="btn btn-danger spacer" id="d-delete">Delete</button>` : ''}
      <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="submit" form="doc-form" class="btn btn-primary">${docId ? 'Save' : 'Add document'}</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#doc-form');
      let filename = null;
      form.elements[docId ? 'content' : 'title'].focus();
      dialog.querySelector('#d-upload')?.addEventListener('click', () => dialog.querySelector('#d-file').click());
      dialog.querySelector('#d-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!/\.(md|markdown|txt)$/i.test(file.name)) return toast('Only .md and .txt files can be uploaded', { error: true });
        if (file.size > 2 * 1024 * 1024) return toast('Files must be 2 MB or smaller', { error: true });
        filename = file.name;
        form.elements.content.value = await file.text();
        if (!form.elements.title.value.trim()) form.elements.title.value = file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
        const f = form.elements;
        const body = { title: f.title.value, content: f.content.value, project: f.project.value };
        if (filename) body.filename = filename;
        try {
          if (docId) await api.patch(`/api/teammates/${t.id}/knowledge/${docId}`, body);
          else await api.post(`/api/teammates/${t.id}/knowledge`, body);
          changed = true;
          toast(docId ? 'Document saved' : `Added “${body.title.trim() || filename}”`);
          dialog.close('saved');
        } catch (err) {
          if (err instanceof ApiError && err.details) {
            for (const [k, msg] of Object.entries(err.details)) {
              const slot = dialog.querySelector(`#err-${k}`) ?? dialog.querySelector('#err-content');
              slot.textContent = msg;
            }
          }
          toast(err.message, { error: true });
        }
      });
      dialog.querySelector('#d-delete')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: `Delete “${doc.title}”?`, message: `${t.name.split(' ')[0]} will stop using it. Work items that already cited it keep the reference.`, confirmLabel: 'Delete document' });
        if (!ok) return;
        try {
          await api.del(`/api/teammates/${t.id}/knowledge/${docId}`);
          changed = true;
          toast('Document deleted');
          dialog.close('deleted');
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
  if (changed) {
    await ctx.refreshMeta();
    onSaved();
  }
}

/** Uploads several .md/.txt files at once, each becoming a document titled after its file name. */
async function uploadDocuments(t, files, onDone) {
  let added = 0;
  for (const file of files) {
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      toast(`${file.name}: only .md and .txt files can be uploaded`, { error: true });
      continue;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast(`${file.name} is over 2 MB`, { error: true });
      continue;
    }
    try {
      await api.post(`/api/teammates/${t.id}/knowledge`, { filename: file.name, content: await file.text() });
      added += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, { error: true });
    }
  }
  if (added) toast(`Added ${added} ${added === 1 ? 'document' : 'documents'}`);
  if (added) onDone();
}

const STATUS_CHOICES = [
  { id: 'available', label: 'Available' },
  { id: 'paused', label: 'Paused' },
  { id: 'off', label: 'Off shift' },
];

function fieldErrors(form, details = {}) {
  for (const el of form.querySelectorAll('.field-error')) el.textContent = '';
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const [key, message] of Object.entries(details)) {
    const err = form.querySelector(`#err-${key}`);
    if (err) err.textContent = message;
    form.elements[key]?.setAttribute?.('aria-invalid', 'true');
  }
  const first = Object.keys(details).find((k) => form.elements[k]?.focus);
  if (first) form.elements[first].focus();
}

async function editProfile(t, ctx, { onSaved, onRetired }) {
  const first = t.name.split(' ')[0];
  let avatarValue = t.avatar;
  await openDialog({
    title: `Edit ${first}`,
    wide: true,
    body: html`
      <form id="edit-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-group">
          <span class="form-label" id="edit-avatar-label">Avatar</span>
          <div class="avatar-grid" role="group" aria-labelledby="edit-avatar-label" id="edit-avatar"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="e-name">Name</label><input class="form-input" id="e-name" name="name" maxlength="60" value="${t.name}" required aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
          <div class="form-group"><label class="form-label" for="e-role">Job title</label><input class="form-input" id="e-role" name="role" maxlength="80" value="${t.role}" required aria-describedby="err-role"><span class="field-error" id="err-role"></span></div>
        </div>
        <div class="form-group"><label class="form-label" for="e-about">About · working style</label><textarea class="form-input" id="e-about" name="about" maxlength="2000">${t.about}</textarea></div>
        <div class="form-group">
          <label class="form-label" for="e-traits">Traits</label>
          <textarea class="form-input" id="e-traits" name="traits" style="min-height:96px" aria-describedby="traits-help err-traits">${(t.traits ?? []).join('\n')}</textarea>
          <span class="help" id="traits-help">One per line, for example "Works 07:00–19:00 SAST". Up to 12.</span><span class="field-error" id="err-traits"></span>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="e-status">Status</label>
            <select class="form-input" id="e-status" name="status">
              ${t.status === 'task' ? html`<option value="" selected>On a task (unchanged)</option>` : ''}
              ${STATUS_CHOICES.map((s) => html`<option value="${s.id}" ${s.id === t.status ? 'selected' : ''}>${s.label}</option>`)}
            </select>
          </div>
          <div class="form-group"><label class="form-label" for="e-centre">Bill to</label>
            <select class="form-input" id="e-centre" name="costCentre">${ctx.meta.costCentres.map((c) => html`<option ${c === t.costCentre ? 'selected' : ''}>${c}</option>`)}</select>
          </div>
          <div class="form-group"><label class="form-label" for="e-cap">Monthly cap (USD)</label><input class="form-input" id="e-cap" name="monthlyCap" type="number" min="0" step="50" value="${t.monthlyCap}" aria-describedby="err-monthlyCap"><span class="field-error" id="err-monthlyCap"></span></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="e-threshold">Needs approval over (USD per task)</label><input class="form-input" id="e-threshold" name="approvalThreshold" type="number" min="0" step="10" value="${t.approvalThreshold ?? ''}" placeholder="No limit" aria-describedby="err-approvalThreshold"><span class="field-error" id="err-approvalThreshold"></span></div>
          <div class="form-group"><label class="form-label" for="e-memcap">Memory cap (items)</label><input class="form-input" id="e-memcap" name="memoryCap" type="number" min="0" step="100" value="${t.memoryCap}" aria-describedby="err-memoryCap"><span class="field-error" id="err-memoryCap"></span></div>
        </div>
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="form-label" style="margin-bottom:8px">Memory</legend>
          <div class="memory-options">${[
            ['session', 'Session only', 'Starts fresh on every task. Cheapest and most private.'],
            ['personal', 'Personal memory', 'Remembers people, preferences and past work across tasks.'],
            ['team', 'Shared team memory', 'Reads and adds to what the whole team knows.'],
          ].map(([id, title, desc]) => html`<label class="memory-option"><input class="hidden-radio" type="radio" name="memoryMode" value="${id}" ${id === t.memory.mode ? 'checked' : ''}><div class="memory-label">${title}</div><div class="memory-desc">${desc}</div></label>`)}</div>
        </fieldset>
      </form>`,
    footer: html`<button type="button" class="btn btn-danger spacer" id="retire-btn">Retire ${first}</button>
      <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="submit" form="edit-form" class="btn btn-primary">Save changes</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#edit-form');
      mountAvatarPicker(dialog.querySelector('#edit-avatar'), { value: t.avatar, onChange: (a) => (avatarValue = a) });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        const traits = f.traits.value.split('\n').map((x) => x.trim()).filter(Boolean);
        const body = {
          name: f.name.value, role: f.role.value, about: f.about.value, traits, costCentre: f.costCentre.value,
          monthlyCap: f.monthlyCap.value, memoryCap: f.memoryCap.value, memoryMode: f.memoryMode.value,
          approvalThreshold: f.approvalThreshold.value === '' ? null : f.approvalThreshold.value, avatar: avatarValue,
        };
        if (f.status.value) body.status = f.status.value;
        const missing = {};
        if (!body.name.trim()) missing.name = 'Required';
        if (!body.role.trim()) missing.role = 'Required';
        if (traits.length > 12) missing.traits = 'Up to 12 traits';
        if (Object.keys(missing).length) return fieldErrors(form, missing);
        try {
          await api.patch(`/api/teammates/${t.id}`, body);
          toast('Profile saved');
          dialog.close('saved');
          onSaved();
        } catch (err) {
          if (err instanceof ApiError && err.details) fieldErrors(form, err.details);
          toast(err.message, { error: true });
        }
      });

      dialog.querySelector('#retire-btn').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Retire ${t.name}?`,
          message: `${first} will leave the roster and stop taking work. Their timesheets, invoices and files are kept, and you can reinstate them from their profile link.`,
          confirmLabel: `Retire ${first}`,
          danger: true,
        });
        if (!ok) return;
        try {
          await api.post(`/api/teammates/${t.id}/retire`);
          dialog.close('retired');
          onRetired();
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
}

async function editPersona(t, onSaved) {
  let saved = false;
  await openDialog({
    title: `${t.name.split(' ')[0]}'s persona`,
    wide: true,
    body: html`
      <p class="help">This is the system prompt sent with every task. Skills and memory are added after it automatically. Markdown is supported.</p>
      <div class="editor-tabs" role="tablist" aria-label="Persona editor">
        <button type="button" role="tab" id="tab-write" aria-controls="panel-write" aria-selected="true">Write</button>
        <button type="button" role="tab" id="tab-preview" aria-controls="panel-preview" aria-selected="false" tabindex="-1">Preview</button>
      </div>
      <div role="tabpanel" id="panel-write" aria-labelledby="tab-write">
        <label class="visually-hidden" for="persona-input">Persona instructions</label>
        <textarea class="form-input code" id="persona-input" maxlength="20000" spellcheck="true">${t.instructions}</textarea>
      </div>
      <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview" hidden>
        <div class="persona-preview md" id="persona-preview" tabindex="0"></div>
      </div>`,
    footer: html`<button type="button" class="btn btn-secondary spacer" id="persona-reset">Reset to default</button>
      <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" id="persona-save">Save persona</button>`,
    setup(dialog) {
      const input = dialog.querySelector('#persona-input');
      const tabs = [...dialog.querySelectorAll('[role="tab"]')];
      const select = (tab) => {
        for (const t2 of tabs) {
          const on = t2 === tab;
          t2.setAttribute('aria-selected', String(on));
          t2.tabIndex = on ? 0 : -1;
          dialog.querySelector(`#${t2.getAttribute('aria-controls')}`).hidden = !on;
        }
        if (tab.id === 'tab-preview') dialog.querySelector('#persona-preview').innerHTML = renderMarkdown(input.value);
        tab.focus();
      };
      tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') select(tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
        });
      });
      dialog.querySelector('#persona-save').addEventListener('click', async () => {
        if (!input.value.trim()) return toast('The persona cannot be empty', { error: true });
        try {
          await api.patch(`/api/teammates/${t.id}`, { instructions: input.value });
          saved = true;
          toast('Persona saved');
          dialog.close('saved');
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
      dialog.querySelector('#persona-reset').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Reset to the default persona?',
          message: `This replaces the current instructions with the standard persona built from ${t.name.split(' ')[0]}'s role, about and traits.`,
          confirmLabel: 'Reset persona',
        });
        if (!ok) return;
        try {
          const updated = await api.post(`/api/teammates/${t.id}/persona/reset`);
          input.value = updated.instructions;
          saved = true;
          select(tabs[0]);
          toast('Persona reset to default');
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
  if (saved) onSaved();
}

async function editSkill(t, skillId, onSaved) {
  const own = t.skills.find((s) => s.id === skillId);
  const lib = await api.get(`/api/skills/${encodeURIComponent(skillId)}`).catch(() => null);
  const first = t.name.split(' ')[0];
  const others = (lib?.usedBy ?? []).filter((u) => u.id !== t.id).map((u) => u.name);
  let changed = false;
  await openDialog({
    title: own.name,
    wide: true,
    body: html`
      <form id="skill-edit-form" class="modal-body" style="padding:0">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="form-label" style="margin-bottom:8px">${first}'s level</legend>
          <div class="choice-row">${[1, 2, 3].map(
            (l) => html`<label class="memory-option"><input class="hidden-radio" type="radio" name="level" value="${l}" ${l === own.level ? 'checked' : ''}><div class="memory-label">${LEVELS[l]}</div></label>`,
          )}</div>
        </fieldset>
        ${lib
          ? html`
            <div class="form-group"><label class="form-label" for="sk-desc">Description</label><input class="form-input" id="sk-desc" name="description" maxlength="160" value="${lib.description}"></div>
            <div class="form-group">
              <label class="form-label" for="sk-instr">Instructions</label>
              <textarea class="form-input code" id="sk-instr" name="instructions" style="min-height:200px" aria-describedby="sk-shared">${lib.instructions}</textarea>
              <span class="help" id="sk-shared">${others.length ? `This skill is shared. Changes to the description and instructions also apply to ${others.join(', ')}.` : 'These instructions are added to the prompt whenever this skill is used.'}</span>
            </div>`
          : html`<p class="help">This skill is no longer in the library, so only the level can be changed.</p>`}
      </form>`,
    footer: html`<button type="button" class="btn btn-danger spacer" id="skill-remove">Remove from ${first}</button>
      <button type="button" class="btn btn-secondary" data-close>Cancel</button>
      <button type="submit" form="skill-edit-form" class="btn btn-primary">Save</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#skill-edit-form');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        try {
          if (Number(f.level.value) !== own.level) await api.patch(`/api/teammates/${t.id}/skills/${encodeURIComponent(skillId)}`, { level: Number(f.level.value) });
          if (lib && (f.description.value !== lib.description || f.instructions.value !== lib.instructions)) {
            await api.patch(`/api/skills/${encodeURIComponent(skillId)}`, { description: f.description.value, instructions: f.instructions.value });
          }
          changed = true;
          dialog.close('saved');
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
      dialog.querySelector('#skill-remove').addEventListener('click', async () => {
        const ok = await confirmDialog({ title: `Remove ${own.name}?`, message: `${first} will stop using this skill. You can add it back at any time.`, confirmLabel: 'Remove skill' });
        if (!ok) return;
        try {
          await api.del(`/api/teammates/${t.id}/skills/${encodeURIComponent(skillId)}`);
          changed = true;
          dialog.close('removed');
        } catch (err) {
          toast(err.message, { error: true });
        }
      });
    },
  });
  if (changed) onSaved();
}

// ---------- Page ----------

export async function render(view, { params, ctx, isCurrent }) {
  const [id] = params;
  if (!ctx.meta) await ctx.refreshMeta();
  let current = null;

  let catalogue = [];
  const load = async () => {
    const [t, tools, sched, roster] = await Promise.all([
      api.get(`/api/teammates/${id}`), api.get('/api/tools'), api.get(`/api/schedules?teammate=${encodeURIComponent(id)}`), api.get('/api/teammates'),
    ]);
    if (!isCurrent()) return;
    catalogue = tools.tools;
    current = t;
    if (!t.retiredAt) ctx.rememberProfile(t.id);
    document.title = `${t.name} · Teammates`;
    view.classList.toggle('is-retired', Boolean(t.retiredAt));
    view.innerHTML = String(html`
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/team">Team roster</a> / <span aria-current="page">${t.name}</span></nav>
      ${heroCard(t)}
      <div class="content-grid">
        <div>${aboutCard(t)}${skillsCard(t)}${knowledgeCard(t)}${toolsCard(t, catalogue, roster.teammates)}${schedulesCard(t, sched.schedules)}${timesheetCard(t)}</div>
        <div>${modelCard(t)}${memoryCard(t)}${billedCard(t, ctx.meta?.warnAtPct)}</div>
      </div>`);
    view.onclick = (e) => handle(e, t);
    view.onchange = (e) => {
      if (e.target.id !== 'doc-files' || !e.target.files.length) return;
      const files = [...e.target.files];
      e.target.value = '';
      uploadDocuments(t, files, reload);
    };
  };

  const reload = async () => {
    await load();
    ctx.refreshMeta();
  };

  async function handle(e, t) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    try {
      if (action === 'toggle-pause') {
        const resume = t.status === 'paused' || t.status === 'off';
        btn.disabled = true;
        await api.patch(`/api/teammates/${t.id}`, { status: resume ? 'available' : 'paused' });
        toast(`${t.name.split(' ')[0]} is ${resume ? 'available again' : 'paused'}`);
        await reload();
      } else if (action === 'assign') {
        if (t.status === 'paused' || t.status === 'off') {
          toast(`${t.name.split(' ')[0]} is ${t.status === 'paused' ? 'paused' : 'off shift'}. Resume them to assign work.`, { error: true });
          return;
        }
        await assignWork(t, ctx, reload);
      } else if (action === 'edit-profile') {
        await editProfile(t, ctx, {
          onSaved: reload,
          onRetired: () => {
            toast(`${t.name} has been retired`);
            ctx.refreshMeta();
            ctx.navigate('/team');
          },
        });
      } else if (action === 'reinstate') {
        btn.disabled = true;
        await api.post(`/api/teammates/${t.id}/reinstate`);
        toast(`${t.name.split(' ')[0]} is back on the team`);
        await reload();
      } else if (action === 'edit-persona') await editPersona(t, reload);
      else if (action === 'change-model') await changeModel(t, ctx, reload);
      else if (action === 'add-skill') await addSkill(t, ctx, reload);
      else if (action === 'edit-skill') await editSkill(t, btn.dataset.skill, reload);
      else if (action === 'review-memory') await reviewMemory(t, reload);
      else if (action === 'reset-memory') {
        const team = t.memory.mode === 'team';
        if (await confirmDialog({
          title: `Reset ${t.name.split(' ')[0]}'s memory?`,
          message: team ? 'This deletes everything this teammate added to shared team memory. It cannot be undone.' : `This permanently deletes all ${t.memory.count} memory items. It cannot be undone.`,
          confirmLabel: 'Reset memory',
          danger: true,
        })) {
          await api.del(`/api/teammates/${t.id}/memory`);
          toast('Memory reset');
          await reload();
        }
      } else if (action === 'view-work') await viewWork(t, btn.dataset.work, ctx, reload);
      else if (action === 'add-doc') await editDocument(t, ctx, null, reload);
      else if (action === 'edit-doc') await editDocument(t, ctx, btn.dataset.doc, reload);
      else if (action === 'upload-docs') view.querySelector('#doc-files').click();
      else if (action === 'edit-tools') await editTools(t, catalogue, reload);
      else if (action === 'add-schedule') await editSchedule(t, null, ctx, reload);
      else if (action === 'edit-schedule') await editSchedule(t, (await api.get(`/api/schedules?teammate=${t.id}`)).schedules.find((x) => x.id === btn.dataset.schedule), ctx, reload);
      else if (action === 'run-schedule') {
        btn.disabled = true;
        await runSchedule(btn.dataset.schedule);
        await reload();
      }
    } catch (err) {
      toast(err.message, { error: true });
      btn.disabled = false;
    }
  }

  // Live updates: patch the status pill in place; reload for new time entries unless a dialog is open
  // (dialogs reload the page themselves when they close).
  const offStatus = ctx.on('teammate', (e) => {
    if (e.id !== id || !current || current.retiredAt) return;
    current.status = e.status;
    current.currentTask = e.currentTask;
    const pill = view.querySelector('#hero-status');
    if (pill) {
      pill.innerHTML = String(heroStatus(current));
      pill.firstElementChild?.classList.add('live');
    }
    const task = view.querySelector('#hero-task');
    if (task) task.textContent = current.status === 'task' ? current.currentTask ?? '' : '';
    const pause = view.querySelector('#pause-btn');
    if (pause) pause.textContent = pauseLabel(e.status);
  });
  const offSchedule = ctx.on('schedule', (e) => {
    if (e.teammateId === id && !document.querySelector('dialog[open]')) load().catch(() => {});
  });
  const offTime = ctx.on('timesheet', (e) => {
    if (e.teammateId === id && !document.querySelector('dialog[open]')) load().catch(() => {});
  });

  await load();
  return {
    cleanup: () => {
      view.onclick = null;
      view.onchange = null;
      view.classList.remove('is-retired');
      offSchedule();
      offStatus();
      offTime();
    },
  };
}
