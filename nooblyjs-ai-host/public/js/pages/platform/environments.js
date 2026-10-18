// Platform · Environments: a read-only summary. Infrastructure (nooblyjs-ai-infrastructure) owns environments and previews
// (decided 2026-10-10); when it is hosted this lists its environments and links there. When it is switched off
// this lists data/platform/environments.yaml. Which secrets scope each environment gets is shown, because agents and previews
// only ever get staging values (product.md §3.8).
import { html } from '/ui/js/html.js';
import { button, dataTable, statusPill } from '/ui/js/components/index.js';
import { head } from './lib.js';

export async function render(view, { ctx }) {
  const data = await ctx.hostApi.get('platform/environments');
  if (!ctx.isCurrent()) return;
  const fromInfra = data.source === 'infrastructure';
  view.innerHTML = String(html`${head('Environments', 'Where builds are deployed, and which secrets each environment gets.', fromInfra ? button({ label: 'Open Infrastructure', kind: 'secondary', href: data.href ?? '/infrastructure' }) : '')}
  <p class="note">${fromInfra
    ? 'Infrastructure owns environments and previews: this is its list. Designs, provisioning, drift and cost are there.'
    : `Infrastructure owns environments and previews, but it is not running here, so this is Platform's own list (data/platform/environments.yaml) · ${data.cloud} · ${data.region}.`}</p>
  <section class="card card--flush" aria-label="Environments">${dataTable({
    caption: 'Environments',
    rows: data.environments,
    columns: [
      { key: 'name', label: 'Environment', render: (e) => html`${e.href ? html`<a class="repo-link" href="${e.href}">${e.name}</a>` : html`<span class="strong">${e.name}</span>`}${e.note ? html`<span class="repo-sub">${e.note}</span>` : ''}` },
      { key: 'kind', label: 'Kind' },
      { key: 'deployed', label: 'Deployed', render: (e) => e.deployed ?? '—' },
      { key: 'approvals', label: 'Approvals to change', numeric: true, render: (e) => (e.approvals ? `${e.approvals}` : 'None') },
      { key: 'secretsScope', label: 'Secrets', render: (e) => statusPill({ text: `${e.secretsScope} values`, tone: e.secretsScope === 'production' ? 'navy' : 'neutral', dot: false }) },
      { key: 'agentsMayDeploy', label: 'Agents may deploy', render: (e) => (e.agentsMayDeploy ? 'Yes' : 'No: a person approves') },
    ],
  })}</section>`);
}
