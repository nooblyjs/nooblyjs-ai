// One release: its feature and stories, the evidence pack (merged pull requests and their approvals, tests, findings,
// the SBOM), the release notes the release agent drafted, the rollout and rollback plans, each deployment, and its
// history. Data: GET /releases/:id. Writes: POST /releases/:id/approval (draft), /advance and /rollback
// (deploy-production, people only). The deploy approval itself is given on Home · Approvals, by two people.
import { html } from '/ui/js/html.js';
import { pageHead, card, button, notice } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable, say, messageRegion, statusOf, mockNote, versions } from '../lib.js';

export async function render(view, { ctx, params }) {
  const id = encodeURIComponent(params.id);
  const redraw = await reloadable(view, ctx, async () => {
    let r;
    try {
      r = await ctx.api.get(`releases/${id}`);
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the release'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    const ev = r.evidence ?? {};
    const canAsk = ['draft', 'changes-requested'].includes(r.status) && ctx.can('draft');
    const canDeploy = r.inProduction && ctx.can('deploy-production');
    view.innerHTML = String(html`${pageHead({
      eyebrow: `Operations · ${r.itemId} · ${r.featureId}`, title: `${r.id} · ${r.name}`, lead: `${r.version}: ${r.featureTitle}. Puts ${versions(r.deploys)} in ${r.production}.`,
      actions: html`${canAsk ? button({ label: 'Ask for the deploy approval', attrs: { 'data-action': 'approval' } }) : ''}${r.status === 'waiting-approval' && r.approvalId ? button({ label: 'Decide it in Approvals', kind: 'secondary', href: `/home/approvals?id=${r.approvalId}` }) : ''}${canDeploy && r.status === 'piloting' ? button({ label: 'Go to the next step', attrs: { 'data-action': 'advance' } }) : ''}`,
    })}
      <p class="ops-meta">${statusOf(r)} ${r.inProduction ? html`<span>${r.percent}% of ${r.production}</span>` : ''}</p>
      ${mockNote()}
      ${messageRegion()}
      ${r.rolledBack ? notice({ title: 'Rolled back', text: `${r.rolledBack.by?.name ?? 'A person'} rolled it back: ${r.rolledBack.reason}. ${r.production} runs ${versions(r.rolledBack.to)} again.`, tone: 'error' }) : ''}
      ${ev.findings?.open?.length ? notice({ title: 'Open findings', text: ev.findings.open.map((f) => `${f.id} (${f.severityLabel}): ${f.title}`).join('; '), tone: 'warning' }) : ''}
      <div class="ops-columns">
        ${card({ title: 'Evidence', meta: ev.text ?? '', body: html`
          <h3>Pull requests and their approvals</h3>
          <ul>${(ev.pullRequests ?? []).map((p) => html`<li>${p.ref} · ${p.title} <span class="ops-sub">${p.merged ? `Merged by ${p.mergedBy ?? 'a person'}` : 'Not merged'} · ${p.approvals.map((a) => `${a.label} by ${a.by}${a.for ? ` for ${a.for}` : ''}`).join(' · ') || 'no approvals recorded'}${p.evidence ? ` · ${p.evidence}` : ''}</span></li>`)}</ul>
          <h3>Tests</h3>
          <ul>${(ev.tests?.stories ?? []).map((t) => html`<li>${t.storyId}: ${t.coverage ?? 'no coverage yet'}${t.latestRun ? html`<span class="ops-sub">${t.latestRun.id}: ${t.latestRun.text}</span>` : ''}</li>`)}${(ev.tests?.environments ?? []).map((e) => html`<li>${e.environment}: ${e.text}</li>`)}</ul>
          <h3>Security</h3>
          <p>${ev.findings?.open?.length ? `${ev.findings.open.length} open: ${ev.findings.open.map((f) => f.id).join(', ')}` : 'No open finding.'}${ev.findings?.accepted?.length ? ` Accepted risks: ${ev.findings.accepted.map((f) => `${f.id} until ${String(f.acceptedUntil ?? '').slice(0, 10)}`).join(', ')}.` : ''}</p>
          <p class="ops-sub">SBOM: ${(ev.sbom?.repos ?? []).map((s) => `${s.repo} (${s.components.length} components)`).join(', ') || 'none recorded'}</p>` })}
        ${card({ title: 'Release notes', meta: r.notes?.draftedBy ? `Drafted by ${r.notes.draftedBy.name}` : '', body: html`<pre class="ops-notes">${r.notes?.text ?? ''}</pre>` })}
        ${card({ title: 'Rollout and rollback', body: html`<p>${r.rollout?.text ?? ''}${r.rollout?.featureFlags ? html`<span class="ops-sub">Feature flags: ${r.rollout.featureFlags}</span>` : ''}</p><p>${r.rollback?.text ?? ''}</p>
          ${canDeploy ? html`<form class="ops-form" data-form="rollback"><label>Why roll it back? <input name="reason" required maxlength="500"></label>${button({ label: 'Roll back', type: 'submit', kind: 'danger' })}</form>` : ''}` })}
        ${card({ title: 'Deployments', body: (r.deployments ?? []).length ? html`<ol class="ops-history">${r.deployments.map((d) => html`<li><span class="ops-muted">${String(d.at).slice(0, 16).replace('T', ' ')}</span> ${d.rolledBack ? `Rolled back: ${d.reason}` : `${d.label}: ${d.percent}% of ${d.environment}`} · ${versions(d.deployed)}</li>`)}</ol>` : html`<p class="ops-muted">Not deployed yet.</p>` })}
        ${(r.writes ?? []).length ? card({ title: 'Jira and Bitbucket', body: html`<ul>${r.writes.map((w) => html`<li>${w.kind === 'jira.fix-version' ? 'Fix version' : 'Tag'} on ${w.target}: ${w.sent ? 'sent' : w.state === 'recorded' ? 'recorded, not sent (the write gate is closed)' : w.state}${w.message ? html`<span class="ops-sub">${w.message}</span>` : ''}</li>`)}</ul>` }) : ''}
        ${card({ title: 'History', body: html`<ol class="ops-history">${(r.history ?? []).map((h) => html`<li><span class="ops-muted">${String(h.at).slice(0, 10)}</span> ${h.what}</li>`)}</ol>` })}
      </div>`);
    return 0;
  });
  const act = async (fn, done) => {
    try {
      const r = await fn();
      await redraw();
      say(view, done(r), 'success');
    } catch (err) {
      if (!isAbort(err)) say(view, err.message, 'error');
    }
  };
  view.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'approval') act(() => ctx.api.post(`releases/${id}/approval`, {}), (r) => `${r.id} waits for two approvers.`);
    if (action === 'advance') act(() => ctx.api.post(`releases/${id}/advance`, {}), (r) => `${r.id} is at ${r.percent}% of ${r.production}.`);
  }, { signal: ctx.signal });
  view.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form="rollback"]');
    if (!form) return;
    e.preventDefault();
    act(() => ctx.api.post(`releases/${id}/rollback`, { reason: new FormData(form).get('reason') }), (r) => `${r.id} is rolled back.`);
  }, { signal: ctx.signal });
}
