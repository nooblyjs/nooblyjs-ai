// Policies: the scanner (the mock, said so), fix-by days per severity, the scans each run gets and when each blocks, who
// may accept which risk, the approved packages and the licences not allowed. Read-only here; every value is a default
// to confirm. Data: GET /policies.
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
    view.innerHTML = String(html`${pageHead({ eyebrow: 'Security · Govern', title: 'Policies', lead: p.confirm })}
      ${notice({ title: p.scanner.real ? `Scanner: ${p.scanner.name}` : 'Scanner: mock', text: p.scanner.text, tone: p.scanner.real ? 'info' : 'warning' })}
      <div class="sec-columns">
        ${card({ title: 'Fix-by days', body: html`<ul>${p.fixBy.map((f) => html`<li>${f.text}</li>`)}</ul>` })}
        ${card({ title: 'Scans on every Software Factory run', body: html`<ul>${p.gates.map((g) => html`<li>${g.text}</li>`)}</ul>` })}
        ${card({ title: 'Accepting a risk', body: html`<p>${p.riskAcceptance.text}</p>` })}
        ${card({ title: 'Approved packages', body: html`<p>${p.approved.join(', ') || 'None'}</p><p class="sec-muted">Licences not allowed: ${p.deniedLicences.join(', ') || 'none'}</p>` })}
      </div>`);
    return 0;
  });
}
