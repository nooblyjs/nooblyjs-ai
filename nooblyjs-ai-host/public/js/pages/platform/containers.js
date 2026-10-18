// Platform · Containers (product.md §5.7 item 15, mockup noobly-platform-containers): "Every agent works in its own
// sandbox. This is where they run." Tiles, pools, what is running now (Logs, Open, Stop) and the base images. The
// runtime is simulated until a hosting target is chosen (product.md §12 Q3): the page says so. Stop and Stop all need
// change-guardrails (Owner) and a reason; the server checks.
import { html } from '/ui/js/html.js';
import { button, dataTable, meter, statusPill } from '/ui/js/components/index.js';
import { head, flash, errorText, money, reasonForm, onChange } from './lib.js';

const LEAD = 'Every agent works in its own sandbox. This is where they run.';

const tile = (label, value, note) => html`<div class="tile"><span class="tile__label">${label}</span><span class="tile__value">${value}</span>${note ? html`<span class="tile__note">${note}</span>` : ''}</div>`;

function tiles(t) {
  const compute = t.compute.capUsd ? meter({ label: 'Compute today', value: `${money(t.compute.todayUsd)} of ${money(t.compute.capUsd)} daily cap`, ratio: t.compute.todayUsd / t.compute.capUsd }) : `${money(t.compute.todayUsd)} today`;
  return html`<section class="tiles" aria-label="Right now">
    ${tile('Running', t.running, `${t.queued} queued · ${t.failed} failed`)}
    ${tile('vCPU', html`${t.vcpu.used} <small>/ ${t.vcpu.total}</small>`, 'used / total')}
    ${tile('Memory', html`${t.memoryGb.used} <small>/ ${t.memoryGb.total} GB</small>`, 'used / total')}
    <div class="tile"><span class="tile__label">Compute</span>${compute}<span class="tile__note">Sample figure until a cluster reports cost</span></div>
  </section>`;
}

const pools = (list) => html`<ul class="pools">${list.map((p) => html`<li class="pool">
  <div class="pool__head"><span class="pool__name">${p.name}</span>${p.full ? statusPill({ text: 'Full', tone: 'warning' }) : statusPill({ text: p.stateText, tone: 'neutral', dot: false })}</div>
  ${meter({ label: 'Slots', value: `${p.used} of ${p.slots}`, ratio: p.slots ? p.used / p.slots : 0, tone: p.full ? 'warning' : undefined })}
  <span class="note">${p.note}${p.queued ? ` · ${p.queued} queued` : ''}${p.href ? html` · <a href="${p.href}">Open</a>` : ''}</span>
</li>`)}</ul>`;

function running(list, { canStop, openLogs }) {
  return dataTable({
    caption: 'Running now',
    empty: 'Nothing is running.',
    rows: list,
    columns: [
      { key: 'title', label: 'Workload', render: (w) => html`<span class="strong">${w.title}</span>${w.sample ? html` <span class="note">(sample)</span>` : ''}` },
      { key: 'kindText', label: 'Kind' },
      { key: 'repo', label: 'Repository', render: (w) => w.repo ?? '—' },
      { key: 'image', label: 'Image', render: (w) => html`<span class="mono">${w.image ?? '—'}</span>` },
      { key: 'cpu', label: 'CPU', numeric: true },
      { key: 'uptimeText', label: 'Uptime' },
      { key: 'actions', label: 'Actions', render: (w) => html`<span class="actions">${w.action === 'open'
        ? button({ label: 'Open', kind: 'secondary', small: true, href: w.href ?? '#', disabled: !w.href })
        : html`<button class="link-button" type="button" data-logs="${w.id}" aria-expanded="${openLogs === w.id ? 'true' : 'false'}">Logs<span class="visually-hidden"> for ${w.title}</span></button>`}${canStop ? html`<button class="link-button" type="button" data-stop="${w.id}">Stop<span class="visually-hidden"> ${w.title}</span></button>` : ''}</span>` },
    ],
  });
}

const images = (img) => dataTable({
  caption: 'Base images',
  rows: img.list,
  columns: [
    { key: 'image', label: 'Image', render: (i) => html`<span class="mono">${i.image}</span>` },
    { key: 'repos', label: 'Used by', render: (i) => `${i.repos} repo${i.repos === 1 ? '' : 's'}` },
    { key: 'rolled', label: 'Rolled', render: (i) => i.rolled || '—' },
    { key: 'cveText', label: 'CVEs', render: (i) => statusPill({ text: i.cveText, tone: i.worst === 'none' ? 'success' : i.worst === 'low' ? 'info' : i.worst === 'medium' ? 'warning' : 'danger' }) },
  ],
});

export async function render(view, { ctx }) {
  const api = ctx.hostApi;
  let message = null;
  let asking = null; // { kind: 'stop', id, title } | { kind: 'all' }
  let logs = null; // { id, lines }

  async function draw() {
    const data = await api.get('platform/containers');
    if (!ctx.isCurrent()) return;
    const canStop = ctx.can('change-guardrails');
    if (logs && !data.workloads.some((w) => w.id === logs.id)) logs = null;
    view.innerHTML = String(html`${head('Containers', LEAD, canStop ? button({ label: 'Stop all containers', kind: 'danger', icon: 'x', attrs: { 'data-action': 'stop-all' } }) : '')}
    <p class="note">${data.cluster.healthText} · ${data.cluster.name} · ${data.cluster.region}. The hosting target is not decided yet, so this runtime is simulated: real teammate tasks and Software Factory runs appear here while they run, beside sample workloads.</p>
    ${flash(message)}
    ${asking?.kind === 'all' ? html`<section class="card card--flush">${reasonForm({ id: 'stop-all', title: 'Stop all containers?', text: `Every running workload (${data.tiles.running}) stops, and the Software Factory starts no new runs until it is resumed in the Factory.`, confirm: 'Stop all containers', danger: true })}</section>` : ''}
    ${tiles(data.tiles)}
    <section class="card card--flush" aria-label="Pools"><div class="card__head"><h2 class="card__title">Pools</h2></div>${pools(data.pools)}</section>
    <section class="card card--flush" aria-label="Running now">
      <div class="card__head"><h2 class="card__title">Running now</h2><span class="card__meta">Sorted by uptime</span></div>
      ${asking?.kind === 'stop' ? reasonForm({ id: 'stop', title: `Stop ${asking.title}?`, text: 'A teammate task is cancelled; a Software Factory run stops at its next heartbeat.', confirm: 'Stop', danger: true }) : ''}
      ${running(data.workloads, { canStop, openLogs: logs?.id })}
      ${logs ? html`<div class="card__pad"><h3 class="strong">Logs · ${data.workloads.find((w) => w.id === logs.id)?.title ?? logs.id}</h3><pre class="log" tabindex="0">${logs.lines.join('\n')}</pre></div>` : ''}
    </section>
    <section class="card card--flush" aria-label="Base images">
      <div class="card__head"><h2 class="card__title">Base images</h2><span class="card__meta">Image registry: ${data.images.registry}</span></div>
      ${images(data.images)}
    </section>`);
  }

  view.addEventListener('click', async (event) => {
    const t = event.target;
    if (t.closest('[data-action="stop-all"]')) { asking = { kind: 'all' }; message = null; await draw(); view.querySelector('[data-form="stop-all"] textarea')?.focus(); return; }
    if (t.closest('[data-action="cancel"]')) { asking = null; return draw(); }
    const stop = t.closest('[data-stop]');
    if (stop) {
      const title = stop.closest('tr')?.querySelector('.strong')?.textContent ?? 'this workload';
      asking = { kind: 'stop', id: stop.dataset.stop, title };
      message = null;
      await draw();
      view.querySelector('[data-form="stop"] textarea')?.focus();
      return;
    }
    const open = t.closest('[data-logs]');
    if (open) {
      if (logs?.id === open.dataset.logs) logs = null;
      else {
        try {
          logs = { id: open.dataset.logs, lines: (await api.get(`platform/containers/${encodeURIComponent(open.dataset.logs)}/logs`)).lines };
        } catch (err) {
          if (err?.name === 'AbortError') return;
          message = { tone: 'error', text: errorText(err) };
        }
      }
      await draw();
    }
  }, { signal: ctx.signal });

  view.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form="stop"], [data-form="stop-all"]');
    if (!form) return;
    event.preventDefault();
    const reason = new FormData(form).get('reason');
    try {
      if (form.dataset.form === 'stop-all') {
        const result = await api.post('platform/containers/stop-all', { reason });
        message = { tone: 'ok', text: `Stopped ${result.stopped.length} workload${result.stopped.length === 1 ? '' : 's'}${result.factoryStopped ? ', and the Software Factory starts no new runs until it is resumed' : ''}. ${result.usage.running} running.` };
      } else {
        const { stopped } = await api.post(`platform/containers/${encodeURIComponent(asking.id)}/stop`, { reason });
        message = { tone: 'ok', text: `Stopped ${stopped.title}.` };
      }
      asking = null;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      message = { tone: 'error', text: errorText(err) };
    }
    await draw();
  }, { signal: ctx.signal });

  // A live refresh would wipe a reason being typed, so it waits while one is asked for.
  onChange(ctx, () => (asking ? null : draw()), { types: ['container', 'teammate.task_', 'run.'] });
  await draw();
}
