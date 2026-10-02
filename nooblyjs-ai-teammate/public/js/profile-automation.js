// Profile cards for Phase 6: the tools a teammate may use, who they may hand work to, and their scheduled tasks.
import { api, ApiError } from './api.js';
import { html } from './html.js';
import { icons } from './icons.js';
import { openDialog, confirmDialog, toast } from './ui.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS = { completed: 'Last run done', running: 'Running now', failed: 'Last run failed', awaiting_approval: 'Last run waiting for approval' };
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function fieldErrors(dialog, err) {
  for (const el of dialog.querySelectorAll('.field-error')) el.textContent = '';
  if (!(err instanceof ApiError) || !err.details) return false;
  for (const [k, msg] of Object.entries(err.details)) {
    const slot = dialog.querySelector(`#err-${k}`);
    if (slot) slot.textContent = msg;
  }
  return true;
}

// ---------- Tools & handoffs ----------

export function toolsCard(t, catalogue, teammates) {
  const first = t.name.split(' ')[0];
  const allowed = catalogue.filter((c) => (t.tools ?? []).includes(c.id));
  const delegates = (t.delegatesTo ?? []).map((id) => teammates.find((m) => m.id === id)).filter(Boolean);
  return html`
    <section class="card" id="tools" aria-labelledby="tools-h">
      <div class="card-head"><h2 class="card-title" id="tools-h">Tools &amp; handoffs</h2><button type="button" class="btn btn-secondary needs-manager" data-action="edit-tools">Edit</button></div>
      ${allowed.length
        ? html`<ul class="tool-list">${allowed.map((c) => html`<li><strong>${c.label}</strong>${c.sideEffects === true ? html` <span class="help">· each use waits for approval</span>` : c.sideEffects === 'some' ? html` <span class="help">· changes wait for approval</span>` : ''}</li>`)}</ul>`
        : html`<p class="help">${first} can't use any tools yet, only what you give them in the task.</p>`}
      <div class="recent-title">Can hand work to</div>
      ${delegates.length
        ? html`<div class="traits">${delegates.map((d) => html`<a class="skill" href="/team/${d.id}">${d.name} · ${d.role}</a>`)}</div>`
        : html`<p class="help">Nobody. Allow handoffs and ${first} can ask teammates for help; their time is billed to them and linked to ${first}'s task.</p>`}
    </section>`;
}

export async function editTools(t, catalogue, onSaved) {
  const { teammates } = await api.get('/api/teammates');
  const others = teammates.filter((m) => m.id !== t.id);
  const first = t.name.split(' ')[0];
  await openDialog({
    title: `${first}'s tools and handoffs`,
    wide: true,
    body: html`
      <form id="tools-form" class="modal-body" style="padding:0" novalidate>
        <fieldset>
          <legend class="form-label">Tools ${first} may use</legend>
          ${catalogue.length
            ? catalogue.map((c) => html`<label class="check-row check-block"><input type="checkbox" name="tools" value="${c.id}" ${(t.tools ?? []).includes(c.id) ? 'checked' : ''}>
                <span><strong>${c.label}</strong><span class="help">${c.help}</span></span></label>`)
            : html`<p class="help">No tools are available.</p>`}
          <span class="field-error" id="err-tools"></span>
          <p class="help">The owner adds MCP servers under Settings → Tools. Every tool call is logged on the task.</p>
        </fieldset>
        <fieldset>
          <legend class="form-label">Teammates ${first} may hand work to</legend>
          <div class="key-teammates">${others.map((m) => html`<label class="check-row"><input type="checkbox" name="delegatesTo" value="${m.id}" ${(t.delegatesTo ?? []).includes(m.id) ? 'checked' : ''}> ${m.name} <span class="help">${m.role}</span></label>`)}</div>
          <span class="field-error" id="err-delegatesTo"></span>
          <p class="help">A handoff is a task of its own: billed to the teammate who does it, following their approval threshold, and linked to ${first}'s task. Work can be handed on at most twice.</p>
        </fieldset>
      </form>`,
    footer: html`<button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="tools-form" class="btn btn-primary">Save</button>`,
    setup(dialog) {
      dialog.querySelector('#tools-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const checked = (name) => [...dialog.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => c.value);
        try {
          await api.patch(`/api/teammates/${t.id}`, { tools: checked('tools'), delegatesTo: checked('delegatesTo') });
          toast(`${first}'s tools are saved`);
          dialog.close('saved');
          onSaved();
        } catch (err) {
          if (!fieldErrors(dialog, err)) toast(err.message, { error: true });
        }
      });
    },
  });
}

// ---------- Schedules ----------

export function schedulesCard(t, schedules) {
  const first = t.name.split(' ')[0];
  return html`
    <section class="card" id="schedules" aria-labelledby="sch-h">
      <div class="card-head"><h2 class="card-title" id="sch-h">Schedules</h2><button type="button" class="btn btn-secondary needs-manager" data-action="add-schedule">${icons.plus}Add</button></div>
      ${schedules.length
        ? schedules.map((s) => html`
          <div class="schedule-row${s.enabled === false ? ' paused' : ''}">
            <div class="schedule-main">
              <div class="skill-name">${s.name}${s.project ? html` <span class="project-chip">${s.project}</span>` : ''}</div>
              <div class="skill-desc">${s.cadenceLabel} (${s.timezone})${s.enabled === false ? ' · paused' : s.nextRunAt ? ` · next ${when(s.nextRunAt)}` : ''}</div>
              ${s.lastStatus ? html`<div class="help${s.lastStatus === 'failed' ? ' field-error' : ''}">${STATUS[s.lastStatus] ?? s.lastStatus}${s.lastRunAt ? `, ${when(s.lastRunAt)}` : ''}${s.lastError ? `: ${s.lastError}` : ''}
                ${s.lastWorkId ? html` · <button type="button" class="task-link" data-action="view-work" data-work="${s.lastWorkId}">open</button>` : ''}</div>` : ''}
            </div>
            <div class="schedule-actions needs-manager">
              <button type="button" class="btn btn-secondary btn-sm" data-action="run-schedule" data-schedule="${s.id}">Run now</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="edit-schedule" data-schedule="${s.id}">Edit</button>
            </div>
          </div>`)
        : html`<p class="help">No schedules. Give ${first} recurring work, like “weekly account briefs every Monday at 08:00”.</p>`}
    </section>`;
}

export async function editSchedule(t, schedule, ctx, onSaved) {
  const first = t.name.split(' ')[0];
  const s = schedule ?? { name: '', task: '', cadence: { days: [1], time: '08:00' }, enabled: true };
  const centres = ctx.meta?.costCentres ?? [];
  await openDialog({
    title: schedule ? `Edit “${schedule.name}”` : `New schedule for ${first}`,
    wide: true,
    body: html`
      <form id="sch-form" class="modal-body" style="padding:0" novalidate>
        <div class="form-group"><label class="form-label" for="sch-name">Name</label><input class="form-input" id="sch-name" name="name" maxlength="80" value="${s.name}" placeholder="e.g. Weekly account briefs" aria-describedby="err-name"><span class="field-error" id="err-name"></span></div>
        <div class="form-group"><label class="form-label" for="sch-task">What should ${first} do each time?</label><textarea class="form-input" id="sch-task" name="task" maxlength="20000" aria-describedby="err-task">${s.task}</textarea><span class="field-error" id="err-task"></span></div>
        <fieldset>
          <legend class="form-label">On these days</legend>
          <div class="day-picks">${DAY_NAMES.map((d, i) => html`<label class="day-pick"><input type="checkbox" name="days" value="${i + 1}" ${s.cadence.days.includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`)}</div>
          <span class="field-error" id="err-days"></span>
        </fieldset>
        <div class="form-row">
          <div class="form-group"><label class="form-label" for="sch-time">At</label><input class="form-input" id="sch-time" name="time" type="time" value="${s.cadence.time}" aria-describedby="err-time sch-tz"><span class="help" id="sch-tz">Workspace time zone (Settings)</span><span class="field-error" id="err-time"></span></div>
          <div class="form-group"><label class="form-label" for="sch-centre">Bill to</label><select class="form-input" id="sch-centre" name="costCentre"><option value="">${t.costCentre} (default)</option>${centres.map((c) => html`<option ${c === s.costCentre ? 'selected' : ''}>${c}</option>`)}</select></div>
          <div class="form-group"><label class="form-label" for="sch-project">Project <span class="help">(optional)</span></label><input class="form-input" id="sch-project" name="project" maxlength="48" value="${s.project ?? ''}" aria-describedby="err-project"><span class="field-error" id="err-project"></span></div>
        </div>
        ${schedule ? html`<label class="check-row"><input type="checkbox" name="enabled" ${s.enabled !== false ? 'checked' : ''}> Active (untick to pause without deleting)</label>` : ''}
        <p class="help">Scheduled runs are billed like any task and count as “system” calls, so work over ${first}'s approval threshold waits for approval.</p>
      </form>`,
    footer: html`${schedule ? html`<button type="button" class="btn btn-danger" id="sch-delete">Delete</button>` : ''}<span class="spacer"></span>
      <button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" form="sch-form" class="btn btn-primary">${schedule ? 'Save' : 'Add schedule'}</button>`,
    setup(dialog) {
      const form = dialog.querySelector('#sch-form');
      form.name.focus();
      dialog.querySelector('#sch-delete')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Delete “${schedule.name}”?`, message: 'Past runs stay in the timeline and timesheets.', confirmLabel: 'Delete schedule' }))) return;
        await api.del(`/api/schedules/${schedule.id}`);
        toast('Schedule deleted');
        dialog.close('deleted');
        onSaved();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          name: form.name.value, task: form.task.value, project: form.project.value, costCentre: form.costCentre.value,
          cadence: { days: [...form.querySelectorAll('input[name="days"]:checked')].map((c) => Number(c.value)), time: form.time.value },
        };
        if (schedule) body.enabled = form.enabled.checked;
        else body.teammateId = t.id;
        try {
          const saved = schedule ? await api.patch(`/api/schedules/${schedule.id}`, body) : await api.post('/api/schedules', body);
          toast(saved.enabled === false ? 'Schedule paused' : `Next run ${when(saved.nextRunAt)}`);
          dialog.close('saved');
          onSaved();
        } catch (err) {
          if (!fieldErrors(dialog, err)) toast(err.message, { error: true });
        }
      });
    },
  });
}

export async function runSchedule(id) {
  await api.post(`/api/schedules/${id}/run`);
  toast('Running now. It appears in the timesheet and timeline when it finishes.');
}
