// Policies: the deployer (the mock, said so), the rollout every release follows, the risk threshold, who approves, and the
// feature-flag tool. Read-only here; every value is a default to confirm. Data: GET /policies.
import { html } from '/ui/js/html.js';
import { pageHead, card, notice } from '/ui/js/components/index.js';
import { errorCard, isAbort, reloadable } from '../lib.js';

export async function render(view, { ctx }) {
  await reloadable(view, ctx, async () => {
    let p;
    try {
      p = await ctx.api.get('policies');
    } catch (err) {
      if (!isAbort(err)) view.innerHTML = String(errorCard(err, 'the policies'));
      return 0;
    }
    if (!ctx.isCurrent()) return 0;
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Operations · Govern', title: 'Policies', lead: 'Defaults taken in Phase 22, to confirm.' })}
      ${notice({ title: p.deployer.real ? `Deployer: ${p.deployer.name}` : 'Deployer: mock', text: p.deployer.text, tone: p.deployer.real ? 'info' : 'warning' })}
      ${p.monitor ? notice({ title: p.monitor.real ? `Monitoring: ${p.monitor.name}` : 'Monitoring: mock', text: `${p.monitor.text} The monitoring platform is ${p.monitoring?.platform ?? '[PLACEHOLDER]'}.`, tone: p.monitor.real ? 'info' : 'warning' }) : ''}
      <div class="ops-columns">
        ${card({ title: 'Rollout', body: html`<p>${p.rollout.text}</p><p class="ops-muted">Feature flags: ${p.featureFlags?.tool ?? 'none'}</p>` })}
        ${card({ title: 'Who approves', body: html`<p>${p.approvers}</p>` })}
        ${card({ title: 'Open findings', body: html`<p>${p.riskText}</p>` })}
        ${card({ title: 'Outcome reviews', body: html`<p>${p.outcomeText}</p>` })}
      </div>`);
    return 0;
  });
}
