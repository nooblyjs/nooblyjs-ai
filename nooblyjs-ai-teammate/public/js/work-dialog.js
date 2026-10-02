// Work item dialog: request, response, who asked, and what the teammate drew on (documents, memories, skills).
import { api } from './api.js';
import { html, raw } from './html.js';
import { money, hours1, tokens } from './format.js';
import { openDialog } from './ui.js';
import { renderMarkdown } from './markdown.js';

const callerLabel = (c) => (!c ? '' : c.type === 'key' ? `API key “${c.name}”` : c.type === 'schedule' ? `schedule “${c.name}”` : c.type === 'teammate' ? `${c.name} (teammate)` : c.name ?? c.type);
const TOOL_STATUS = { ok: 'Done', error: 'Failed', queued: 'Waiting for approval', approved: 'Approved and run', declined: 'Declined', failed: 'Approved, but failed' };

/** Tool calls and handoffs of a work item: what was called with what, and what came back. */
const toolLog = (w) => html`
  ${w.delegatedFrom ? html`<p class="help">Handed over by another teammate (<button type="button" class="task-link" data-open-work="${w.delegatedFrom.workId}" data-teammate="${w.delegatedFrom.teammateId}">see the original task</button>).</p>` : ''}
  ${w.delegations?.length ? html`<div class="form-group"><span class="form-label">Handed to teammates</span><ul class="used-list">${w.delegations.map((d) => html`<li><strong>${d.name ?? d.teammateId}</strong> · ${d.status === 'completed' ? money(d.amount ?? 0) : d.status}${d.workId ? html` · <button type="button" class="task-link" data-open-work="${d.workId}" data-teammate="${d.teammateId}">open their work</button>` : ''}${d.error ? html` <span class="field-error">${d.error}</span>` : ''}</li>`)}</ul></div>` : ''}
  ${w.toolCalls?.length ? html`<div class="form-group"><span class="form-label">Tool calls</span><ol class="tool-log">${w.toolCalls.map((c) => html`
    <li class="tool-${c.status}"><div><strong>${c.label ?? c.name}</strong> <span class="help">${TOOL_STATUS[c.status] ?? c.status}${c.durationMs ? ` · ${c.durationMs} ms` : ''}</span></div>
      <code class="tool-io">${c.input}</code>${c.output ? html`<div class="tool-out">${c.output}</div>` : ''}</li>`)}</ol></div>` : ''}`;

export const usedSummary = (w, skillNames = new Map()) => html`
  <div class="used-grid">
    <div><div class="preview-label">Documents</div>${w.knowledgeUsed?.length
      ? html`<ul class="used-list">${w.knowledgeUsed.map((k) => html`<li>${k.title}${k.heading && k.heading !== k.title ? html` <span class="help">— ${k.heading}</span>` : ''}</li>`)}</ul>`
      : html`<p class="help">None matched</p>`}</div>
    <div><div class="preview-label">Memories</div>${w.memoryUsed?.length
      ? html`<p class="help">${w.memoryUsed.length} ${w.memoryUsed.length === 1 ? 'item' : 'items'}${w.memoryUsed.length ? html`, e.g. “${w.memoryUsed[0].text}”` : ''}</p>`
      : html`<p class="help">None</p>`}</div>
    <div><div class="preview-label">Skills</div><p class="help">${w.skillsUsed?.length ? w.skillsUsed.map((id) => skillNames.get(id) ?? id).join(', ') : 'None'}</p></div>
  </div>`;

/**
 * Opens a work item. `onFollowUp(work)` adds a "Follow up" button (omitted when the teammate can't take work).
 */
export async function showWorkItem({ teammateId, workId, skillNames, onFollowUp }) {
  const w = await api.get(`/api/teammates/${teammateId}/work/${workId}`);
  let follow = false;
  let jump = null;
  await openDialog({
    title: 'Work item',
    wide: true,
    body: html`
      <div class="run-meta">
        <span><strong>${w.status}</strong></span><span>${new Date(w.startedAt).toLocaleString()}</span>
        <span class="num">${tokens(w.tokens)} tokens · ${hours1(w.hours)} · ${money(w.amount)}</span><span>${w.servedBy ?? w.modelId ?? ''}</span>
      </div>
      <div class="run-meta">
        ${w.caller ? html`<span>Requested by <strong>${callerLabel(w.caller)}</strong></span>` : ''}
        ${w.project ? html`<span>Project <span class="project-chip">${w.project}</span></span>` : ''}
        ${w.schedule ? html`<span>Scheduled run</span>` : ''}
        ${w.approvedBy ? html`<span>Approved by <strong>${w.approvedBy}</strong>${w.estimate ? ` (estimated ${money(w.estimate.amount)})` : ''}</span>` : ''}
      </div>
      <div class="form-group"><span class="form-label">Request</span><div class="output">${w.request}</div></div>
      <div class="form-group"><span class="form-label">Response</span><div class="output md">${w.response ? raw(renderMarkdown(w.response)) : w.error || ''}</div></div>
      ${toolLog(w)}
      ${w.knowledgeUsed || w.memoryUsed || w.skillsUsed ? html`<div class="form-group"><span class="form-label">What the teammate drew on</span>${usedSummary(w, skillNames)}</div>` : ''}`,
    footer: html`${onFollowUp && w.thread && w.status !== 'failed' ? html`<button type="button" class="btn btn-primary" id="work-follow">Follow up</button>` : ''}<button type="button" class="btn btn-secondary" data-close>Close</button>`,
    setup(dialog) {
      dialog.addEventListener('click', (e) => {
        const link = e.target.closest('[data-open-work]');
        if (!link) return;
        jump = { teammateId: link.dataset.teammate, workId: link.dataset.openWork };
        dialog.close('jump');
      });
      dialog.querySelector('#work-follow')?.addEventListener('click', () => {
        follow = true;
        dialog.close('follow');
      });
    },
  });
  if (follow) await onFollowUp(w);
  else if (jump) await showWorkItem({ ...jump, skillNames });
}
