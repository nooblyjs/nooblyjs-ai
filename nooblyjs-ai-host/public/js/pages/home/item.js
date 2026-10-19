// Home · Lifecycle · one item: where it is, its readiness, its approvals and its history, with the two things a
// person may do from here: move it on when no approval is waiting, and send it back with a reason. Its Jira issues
// (Phase 11) are read from Jira and linked here by key; NooblyJS never writes to Jira.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, checklist, statusPill, notice, dataTable } from '/ui/js/components/index.js';
import { ApiError } from '/ui/js/api.js';
import { workflowsApi, onChange, engineMissing, isMissing, dayLabel, timeText } from './lib.js';

const STAGES = ['discover', 'specify', 'architect', 'ux', 'ui', 'build', 'verify', 'release', 'operate'];

function tracker(item) {
  const at = STAGES.indexOf(item.stage);
  return html`<ol class="tracker" aria-label="Stages">${STAGES.map((key, i) => {
    const cell = item.cells[key];
    const state = item.status === 'completed' ? 'done' : i < at ? 'done' : i === at ? (item.late ? 'waiting' : 'now') : 'todo';
    const words = { done: 'done', now: 'now', waiting: 'waiting too long', todo: 'not reached' }[state];
    return html`<li class="tracker__stage tracker__stage--${state}"><span class="tracker__name">${i + 1} · ${key === 'ux' ? 'UX design' : key === 'ui' ? 'UI design' : key[0].toUpperCase() + key.slice(1)}</span><span class="tracker__state">${state === 'now' || state === 'waiting' ? cell?.text ?? words : words}</span></li>`;
  })}</ol>`;
}

const STATUS_TONES = { new: 'neutral', indeterminate: 'info', done: 'success' };

/** The item's linked Jira issues, live, with a box to link another by key and a search of the configured projects. */
const PR_TEXT = { OPEN: 'Open', MERGED: 'Merged', DECLINED: 'Declined', SUPERSEDED: 'Superseded', RECORDED: 'Not opened (recorded only)' };
const CATEGORY_TONES = { new: 'neutral', indeterminate: 'info', done: 'success' };

/** How a pull request's checks stand, in words. */
function checksText(c) {
  if (!c) return null;
  if (c.readable === false) return 'checks not readable with NooblyJS\'s token';
  if (!c.total) return 'no checks reported yet';
  return [`${c.passed} of ${c.total} checks passed`, c.failed ? `${c.failed} failed` : null, c.running ? `${c.running} running` : null].filter(Boolean).join(' · ');
}

/**
 * The item's work items in Jira and Bitbucket (Phase 13): each with its issue and its pull request, as NooblyJS last
 * read them, and what NooblyJS wrote or only recorded.
 */
function workCard(work, canRefresh) {
  if (!work?.workItems?.length) return '';
  const recorded = work.writes.filter((w) => w.state === 'recorded').length;
  const rows = work.workItems.map((w) => {
    const reviewers = (w.pr?.reviewers ?? []).map((r) => `${r.name ?? 'A reviewer'}: ${r.state === 'approved' ? 'approved' : r.state === 'changes-requested' ? 'asked for changes' : 'waiting'}`).join('; ');
    return html`<li class="wait">
      ${w.issue ? statusPill({ text: w.issue.status ?? 'In Jira', tone: CATEGORY_TONES[w.issue.category] ?? 'neutral', dot: false }) : statusPill({ text: 'No issue yet', tone: 'neutral', dot: false })}
      <div class="wait__main"><span class="wait__title">${w.id}${w.title ? ` · ${w.title}` : ''}</span>
        <span class="row__meta">${w.issue
          ? html`<a href="${w.issue.url}" target="_blank" rel="noopener">${w.issue.key}</a> in Jira${w.issue.assignee ? ` · ${w.issue.assignee}` : ''}`
          : w.issueWrite?.state === 'recorded' ? 'Its Jira issue is recorded, not created: NooblyJS is not sending to Jira.' : w.issueWrite?.state === 'waiting-approval' ? 'Its Jira issue waits for an approval.' : w.issueWrite?.reason ?? 'No Jira issue.'}</span>
        ${w.pr ? html`<span class="row__meta">Pull request: ${w.pr.url ? html`<a href="${w.pr.url}" target="_blank" rel="noopener">#${w.pr.id} on ${w.pr.slug}</a>` : `on ${w.pr.slug}`} · ${PR_TEXT[w.pr.state] ?? w.pr.state}${w.pr.mergedBy ? ` by ${w.pr.mergedBy}` : ''}${w.pr.state === 'OPEN' && checksText(w.pr.checks) ? ` · ${checksText(w.pr.checks)}` : ''}${w.pr.state === 'OPEN' && reviewers ? ` · ${reviewers}` : ''}</span>` : ''}
        ${w.pr?.mergeIgnored ? html`<span class="row__meta">This merge does not count: ${w.pr.mergeIgnored}.</span>` : ''}
      </div>
    </li>`;
  });
  return card({
    title: 'Work items in Jira and Bitbucket',
    meta: `${work.workItems.length} work item${work.workItems.length === 1 ? '' : 's'}${recorded ? ` · ${recorded} write${recorded === 1 ? '' : 's'} recorded, not sent` : ''}`,
    body: html`<ul class="waits" role="list">${rows}</ul>
      ${work.allDoneInJira ? html`<p class="row__meta" role="status">All work items are done in Jira. The item moves to Verify when its pull requests are merged in Bitbucket, or when a person approves the merge.</p>` : ''}
      <p class="row__meta">Jira owns each issue's status; NooblyJS reads it every few minutes. A person merges a pull request in Bitbucket: NooblyJS never merges.</p>
      ${canRefresh ? html`<div class="actions">${button({ label: 'Read Jira and Bitbucket now', kind: 'secondary', attrs: { 'data-action': 'work-refresh' } })}</div>` : ''}`,
  });
}

function jiraCard(jira, canLink, found) {
  if (!jira) return '';
  const rows = jira.issues.map((i) => html`<li class="wait">
      ${i.unreadable ? statusPill({ text: 'Not readable', tone: 'warning', dot: false }) : statusPill({ text: i.status, tone: STATUS_TONES[i.statusCategory] ?? 'neutral', dot: false })}
      <div class="wait__main">${i.unreadable ? html`<span class="wait__title">${i.key}</span><span class="row__meta">${i.unreadable}</span>`
        : html`<a class="wait__title" href="${i.url}" target="_blank" rel="noopener">${i.key} · ${i.summary}</a><span class="row__meta">${[i.type, i.assignee ?? 'Unassigned', i.sprint ? i.sprint.name : null, i.storyPoints != null ? `${i.storyPoints} points` : null].filter(Boolean).join(' · ')}</span>`}</div>
      ${canLink ? button({ label: 'Unlink', kind: 'secondary', small: true, attrs: { 'data-unlink': i.key, 'aria-label': `Unlink ${i.key}` } }) : ''}
    </li>`);
  const results = found ? html`<ul class="waits" role="list" aria-label="Jira search results">${found.length ? found.map((i) => html`<li class="wait"><div class="wait__main"><span class="wait__title">${i.key} · ${i.summary}</span><span class="row__meta">${i.type} · ${i.status}${i.assignee ? ` · ${i.assignee}` : ''}</span></div>${button({ label: 'Link', kind: 'secondary', small: true, attrs: { 'data-link': i.key, 'aria-label': `Link ${i.key}` } })}</li>`) : html`<li class="row__meta">No issue matches.</li>`}</ul>` : '';
  return card({
    title: 'Jira',
    meta: jira.jira?.ok === false ? 'Jira could not be read just now' : `${jira.issues.length} linked · read from Jira`,
    body: html`${rows.length ? html`<ul class="waits" role="list">${rows}</ul>` : html`<p class="row__meta">No Jira issues linked yet.</p>`}
      ${canLink ? html`<form class="form form--inline" data-form="jira">
        <label class="field">Link a Jira issue: its key, or words to search for<input name="q" maxlength="200" autocomplete="off" placeholder="DTE-60, or slash command"></label>
        <div class="actions">${button({ label: 'Find', kind: 'secondary', type: 'submit' })}${button({ label: 'Refresh from Jira', kind: 'secondary', attrs: { 'data-action': 'jira-refresh' } })}</div>
      </form>${results}` : ''}
      <p class="row__meta">Linking keeps the issue's key here and changes nothing in Jira.</p>`,
  });
}

const history = (rows, now) => html`<ol class="history">${rows.map((h) => html`<li class="history__row${h.kind === 'sent-back' ? ' history__row--back' : ''}">
    <span class="history__text">${h.text}</span>
    <span class="row__meta">${dayLabel(h.enteredAt, now)} · ${timeText(h.enteredAt, now)}${h.byName ? ` · ${h.byName}` : ''}</span>
  </li>`)}</ol>`;

export async function render(view, { ctx, params }) {
  const api = workflowsApi(ctx);
  const head = { eyebrow: 'NooblyJS · Lifecycle', title: params.id };
  // The item's team chat thread (shared with its Spec and Architecture pages in the Product Factory).
  ctx.chat.scope({ kind: 'item', id: params.id });
  let message = null;
  let found = null; // Jira search results, while someone is linking
  let freshJira = false;

  async function draw() {
    let data;
    try {
      data = await api.get(`items/${encodeURIComponent(params.id)}`);
    } catch (err) {
      if (isMissing(err)) return engineMissing(view, head);
      if (err instanceof ApiError && err.status === 404) {
        view.innerHTML = String(html`${pageHead(head)}${notice({ title: 'No such item', text: err.message, tone: 'muted', actions: button({ label: 'Back to Lifecycle', kind: 'secondary', href: '/home/lifecycle' }) })}`);
        return;
      }
      throw err;
    }
    // The gate list comes from the item's architecture (the Product Factory). Without it the page still works.
    const gates = await ctx.hostApi.get(`home/items/${encodeURIComponent(params.id)}/gates`).catch(() => null);
    // Its Software Factory work: one run per work item whose repository the Factory knows.
    const work = await ctx.hostApi.get(`home/items/${encodeURIComponent(params.id)}/runs`).catch(() => null);
    // Its Jira issues (Phase 11), read live. Without Jira connected the card says so and the page still works.
    const jira = await ctx.hostApi.get(`devtools/links/${encodeURIComponent(params.id)}${freshJira ? '?fresh=1' : ''}`).catch(() => null);
    freshJira = false;
    // Its work items in Jira and Bitbucket (Phase 13): the issue and pull request of each, as NooblyJS last read them.
    const tracked = await ctx.hostApi.get(`devtools/work/${encodeURIComponent(params.id)}`).catch(() => null);
    if (!ctx.isCurrent()) return;
    const { item, readiness, actions } = data;
    const RUN_TONES = { running: 'info', parked: 'warning', delivered: 'success', merged: 'success', gate_failed: 'danger', error: 'danger', agent_failed: 'danger' };
    const runsCard = work?.runs?.length || work?.waiting?.length
      ? card({
        title: 'Software Factory',
        meta: `${work.runs.length} run${work.runs.length === 1 ? '' : 's'}${work.waiting.length ? ` · ${work.waiting.length} waiting` : ''}`,
        body: html`${work.runs.length ? html`<ul class="waits" role="list">${work.runs.map((r) => html`<li class="wait"><div class="wait__main"><a class="wait__title" href="${r.href}">${r.title}</a>${r.jiraIssues?.length ? html` <span class="row__meta">${r.jiraIssues.join(', ')}</span>` : ''}<span class="row__meta"><span class="mono">${r.repo}</span>${r.gates ? ` · gates: ${r.gates}` : ''}${r.pr ? ` · PR ${r.pr}` : ''}${r.costUsd ? ` · $${r.costUsd.toFixed(2)}` : ''}</span></div>${statusPill({ text: r.statusText, tone: RUN_TONES[r.status] ?? 'neutral' })}</li>`)}</ul>` : ''}
        ${work.waiting.length ? html`<p class="row__meta">Not started: ${work.waiting.map((w) => `${w.title} (${w.reason})`).join('; ')}.</p>` : ''}`,
      })
      : '';
    const gateCard = gates?.gates?.length
      ? card({
        title: 'Quality gates',
        meta: gates.final ? `${gates.gates.length} gates` : 'Not final yet',
        body: html`<p class="row__meta">${gates.text}</p>${dataTable({
          caption: 'Quality gates for this item',
          columns: [{ key: 'attribute', label: 'Attribute' }, { key: 'scenario', label: 'Scenario' }, { key: 'target', label: 'Target' }, { key: 'verifiedBy', label: 'Verified by' }],
          rows: gates.gates,
        })}`,
      })
      : '';
    ctx.setTitle(`${item.ref} · ${item.title}`);
    const failing = readiness.failing.length > 0;
    const approvals = data.approvals.length
      ? html`<ul class="waits" role="list">${data.approvals.map((a) => html`<li class="wait">${statusPill({ text: a.tag, tone: a.tone, dot: false })}<div class="wait__main"><a class="wait__title" href="${a.href}">${a.title}</a><span class="row__meta">${a.status === 'open' ? `Waiting ${a.age}${a.due ? ` · ${a.due.text}` : ''}` : a.status === 'approved' ? `Approved${a.decidedByName ? ` by ${a.decidedByName}` : ''}` : a.status === 'withdrawn' ? 'Withdrawn' : 'Changes requested'}</span></div></li>`)}</ul>`
      : html`<p class="row__meta">No approvals yet.</p>`;

    const advance = actions.canAdvance ? html`<form class="form" data-form="advance">
        ${failing ? html`<label class="field">Readiness is ${readiness.passed} of ${readiness.total}. To move on anyway, say why<textarea name="override" rows="2" required></textarea></label>` : ''}
        <div class="actions">${button({ label: actions.advanceLabel, type: 'submit' })}</div>
      </form>` : actions.blockedBy.length ? html`<p class="row__meta">This step has an approval waiting. Decide it in <a href="/home/approvals?id=${actions.blockedBy[0]}">Approvals</a>.</p>` : '';
    const sendBack = actions.canSendBack ? html`<form class="form" data-form="send-back">
        <label class="field">Send back to<select name="to" required>${actions.sendBackTo.map((s) => html`<option value="${s.key}">${s.label}</option>`).reverse()}</select></label>
        <label class="field">Why is it going back?<textarea name="reason" rows="2" required maxlength="2000"></textarea></label>
        <div class="actions">${button({ label: 'Send back', kind: 'secondary', type: 'submit' })}</div>
      </form>` : '';
    const nothing = !advance && !sendBack ? html`<p class="row__meta">${item.status === 'completed' ? 'This item is complete.' : 'Moving an item on or sending it back needs the approve permission.'}</p>` : '';

    view.innerHTML = String(html`${pageHead({
      eyebrow: 'NooblyJS · Lifecycle', title: item.title,
      lead: `${item.ref} · ${item.status === 'completed' ? 'Completed' : `in ${item.stageLabel}`} · owned by ${item.ownerName} · ${item.age} old`,
      actions: html`${item.specHref ? button({ label: 'Open the spec', kind: 'secondary', href: item.specHref }) : ''}${button({ label: 'All items', kind: 'secondary', href: '/home/lifecycle' })}`,
    })}
    ${message ? html`<p class="flash flash--${message.tone}" role="${message.tone === 'error' ? 'alert' : 'status'}">${message.text}</p>` : ''}
    ${card({ title: 'Where this is', body: tracker(item) })}
    <div class="split">
      ${card({ title: 'Readiness', meta: readiness.total ? `${readiness.passed} of ${readiness.total} checks` : null, body: readiness.total ? checklist({ label: 'Readiness checks', items: readiness.checks.map((c) => ({ text: c.text, state: c.passed ? 'done' : 'failed' })) }) : html`<p class="row__meta">${item.stageLabel} has no readiness checks.</p>` })}
      ${card({ title: 'Approvals', body: approvals })}
    </div>
    ${gateCard}
    ${jiraCard(jira, ctx.can('draft'), found)}
    ${workCard(tracked, ctx.can('draft'))}
    ${runsCard}
    <div class="split">
      ${card({ title: 'History', body: history(data.history, data.at) })}
      ${card({ title: 'Decide', meta: 'Only a person can do these', body: html`${advance}${sendBack}${nothing}` })}
    </div>`);
  }

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'jira') return findInJira(form);
    const fields = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = form.dataset.form === 'advance'
        ? await api.post(`items/${encodeURIComponent(params.id)}/advance`, fields.override ? { override: { reason: fields.override } } : {})
        : await api.post(`items/${encodeURIComponent(params.id)}/send-back`, { to: fields.to, reason: fields.reason });
      message = { tone: 'ok', text: result.text };
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
    }
    await draw();
    view.querySelector('.flash')?.scrollIntoView({ block: 'nearest' });
  }, { signal: ctx.signal });

  const target = `devtools/links/${encodeURIComponent(params.id)}`;
  /** A key links at once; words search the Jira projects NooblyJS reads. */
  async function findInJira(form) {
    const q = new FormData(form).get('q').trim();
    if (!q) return;
    try {
      if (/^[A-Za-z][A-Za-z0-9_]{1,19}-\d+$/.test(q)) {
        const r = await ctx.hostApi.post(target, { key: q });
        message = { tone: 'ok', text: r.added ? `${r.issue.key} is linked to ${params.id}.` : `${r.issue.key} was already linked.` };
        found = null;
      } else {
        found = (await ctx.hostApi.get('devtools/jira/issues', { query: { q } })).issues;
        message = null;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
    }
    await draw();
    view.querySelector('[data-form="jira"] input')?.focus();
  }

  view.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-link]');
    const unlink = event.target.closest('[data-unlink]');
    const refresh = event.target.closest('[data-action="jira-refresh"]');
    if (event.target.closest('[data-action="work-refresh"]')) {
      // Reads only: the linked issues and the open pull requests, as the timer does every few minutes.
      await ctx.hostApi.post('devtools/sync', {}).then(() => { message = { tone: 'ok', text: 'Read from Jira and Bitbucket just now.' }; }, (err) => { message = { tone: 'error', text: err.message }; });
      return draw();
    }
    if (!link && !unlink && !refresh) return;
    try {
      if (link) {
        const r = await ctx.hostApi.post(target, { key: link.dataset.link });
        message = { tone: 'ok', text: `${r.issue.key} is linked to ${params.id}.` };
        found = null;
      } else if (unlink) {
        await ctx.hostApi.del(`${target}/${encodeURIComponent(unlink.dataset.unlink)}`);
        message = { tone: 'ok', text: `${unlink.dataset.unlink} is no longer linked. Nothing changed in Jira.` };
      } else {
        freshJira = true;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: err.message };
    }
    await draw();
  }, { signal: ctx.signal });

  await draw();
  onChange(ctx, () => {
    // Don't redraw under someone who is typing a reason.
    if ([...view.querySelectorAll('textarea, [data-form="jira"] input')].some((t) => t.value.trim())) return;
    return draw();
  }, { types: ['item.', 'approval.', 'handoff.', 'readiness.', 'clock.', 'run.', 'pr.', 'jira.'] });
}
