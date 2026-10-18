// Phase F26: one run. Its stations as a stepper, why it stopped, the story, the agent's
// output, the checks and the artifacts.
import { h, page, cap, human, money, ago, secs, time, shortId, ACTIVE, isStopped } from '../lib.js';
import { icon, pill, statusOf, who, copy, whyStopped, entryCard } from '../parts.js';

const outFilter = { run: null, step: 'all' };

/** "└ build: agent success · 1 commit(s) · gates passed · $0.0383" → "Agent success · 1 commit · gates passed" */
function summaryOf(line, step) {
  if (!line) return '';
  return cap(line.replace(/^└\s*/, '').replace(new RegExp(`^${step}:?\\s*`), '').replace(/\s*·\s*\$\d+\.\d+/, '').replace(/(\d+) commit\(s\)/, (_, n) => `${n} commit${n === '1' ? '' : 's'}`).replace(/\(s\)/g, 's').trim());
}

async function runView(p) {
  const id = p.params.id;
  await p.system();
  const d = await p.get(`runs/${encodeURIComponent(id)}`);
  const r = d.run;
  p.ctx.setTitle(r.title);
  const post = (action, body) => p.post(`runs/${encodeURIComponent(id)}/${action}`, body);
  const active = ACTIVE.includes(r.status);
  const lastDone = d.steps.findLastIndex((st) => st.status === 'done');
  const stateOf = (st, i) => (st.status === 'pending' && i < lastDone ? 'skipped' : st.status === 'failed' || (st.status === 'running' && !active) ? 'failed' : st.status);
  const stopStep = isStopped(r) ? d.steps.find((st, i) => stateOf(st, i) === 'failed') ?? d.steps.find((st) => st.id === r.station) : null;

  // The headline: what happened, in a few words.
  const [label, tone] = statusOf(r);
  const headline = isStopped(r) && stopStep && r.status !== 'cancelled' ? `${label} at ${stopStep.id}` : label;

  // Retry from, Pause, Resume, Cancel.
  const mayAct = p.can('draft');
  const firstOpen = d.steps.find((st) => st.status !== 'done')?.id;
  const from = h('select', { id: 'factory-retry-from' }, h('option', { value: '' }, `${human(firstOpen ?? 'start')} (first unfinished)`), d.steps.map((st) => h('option', { value: st.id }, human(st.id))));
  const actions = mayAct && h('div.run-actions', {},
    !active && [h('label', { for: 'factory-retry-from' }, 'Retry from'), from, h('button.primary', { onclick: p.act(() => post('retry', { from: from.value || undefined })) }, icon('retry'), 'Retry run')],
    r.status === 'running' && h('button', { onclick: p.act(() => post('pause')) }, icon('pause'), 'Pause'),
    ['paused', 'parked'].includes(r.status) && h('button.primary', { onclick: p.act(() => post('resume')) }, icon('play'), 'Resume'),
    active && h('button.ghost.danger', { onclick: p.act(() => confirm('Cancel this run?') && post('cancel')) }, 'Cancel run'));

  // The stations, as a stepper.
  const subOf = (st, state) => {
    if (state === 'skipped') return 'skipped';
    if (state === 'failed') return r.status === 'interrupted' ? 'interrupted' : 'failed';
    if (state === 'running') return `running · ${secs(st.startedAt)}`;
    if (state !== 'done') return '';
    if (st.result?.passed === true) return 'gates passed';
    if (st.result?.passed === false) return 'gates failed';
    if (st.kind === 'approval' || st.id === 'approve') {
      const line = d.story.find((e) => e.type === 'step.finished' && e.line.startsWith(`└ ${st.id}:`))?.line ?? '';
      const level = /autonomy (\w+)/.exec(line)?.[1];
      return /by auto|automatic/.test(line) || level ? `auto${level ? ` · ${level}` : ''}` : 'approved';
    }
    return money(st.costUsd);
  };
  const stepper = h('div.card', { style: 'padding:0;margin-top:20px' }, h('ol.stepper', { style: `--n:${d.steps.length}`, 'aria-label': 'Stations', tabindex: 0 }, d.steps.map((st, i) => {
    const state = stateOf(st, i);
    return h(`li.${state}`, {}, h('span.node', { 'aria-hidden': 'true' }, state === 'done' ? icon('check') : state === 'failed' ? icon('x') : null), h('span.name', {}, human(st.id)), h('span.sub', {}, subOf(st, state) || ' '), h('span.sr', {}, state));
  })));

  // Why it stopped: the station's error, or the agent's last refusal.
  const agentOf = (step) => d.agent.filter((e) => e.step === step);
  let alertBox = null;
  if (stopStep && r.status !== 'cancelled') {
    const roleName = stopStep.route?.role ? `The ${human(stopStep.route.role).toLowerCase()}` : `The ${stopStep.id} station`;
    const title = r.status === 'interrupted' ? `${roleName} was interrupted` : `${roleName} stopped`;
    alertBox = h('div.alert', { role: 'status' }, icon('warn'), h('div', {}, h('strong', {}, title), h('p.body', {}, whyStopped(r, stopStep, d.agent))), mayAct && h('button.small', { onclick: p.act(() => post('retry', { from: stopStep.id })) }, `Retry from ${stopStep.id}`));
  }
  const openAsks = d.inbox.filter((e) => e.status === 'open');

  // The story: one entry per station that started.
  const started = d.steps.filter((st) => st.startedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const story = h('ol.story', {}, started.map((st) => {
    const state = stateOf(st, d.steps.indexOf(st));
    const finished = d.story.findLast((e) => (e.type === 'step.finished' || e.type === 'step.failed') && e.line.startsWith(`└ ${st.id}`));
    const turn = agentOf(st.id).findLast((e) => /turn end/.test(e.line));
    const text = state === 'running' ? 'Working on it now.' : state === 'failed' && (!finished || r.status === 'interrupted') ? `${r.status === 'interrupted' ? 'Interrupted' : 'Stopped'}${turn ? ` after ${/turn end: (.*?)(, interrupted)?$/.exec(turn.line)?.[1].replace(/\(s\)/g, 's') ?? ''}` : ''}` : summaryOf(finished?.line, st.id);
    return h(`li.${state}`, {}, h('span.dot', { 'aria-hidden': 'true' }), h('time', { datetime: st.startedAt }, time(st.startedAt)),
      h('div.what', {}, h('b', {}, human(st.id)), text && h('p', {}, text), st.route && h('div', {}, who(st.route, 30))),
      h('div.nums', {}, h('span.num', {}, state === 'failed' && !st.costUsd ? '—' : money(st.costUsd)), h('span.muted.num', {}, secs(st.startedAt, st.endedAt))));
  }));
  const ran = r.startedAt ? secs(r.startedAt, r.endedAt) : '';

  // Agent output, filterable by station.
  if (outFilter.run !== id) Object.assign(outFilter, { run: id, step: 'all' });
  const stepsWithOutput = [...new Set(d.agent.map((e) => e.step))];
  const lines = d.agent.filter((e) => outFilter.step === 'all' || e.step === outFilter.step);
  const terminal = h('div.terminal', { tabindex: 0, role: 'region', 'aria-label': 'Agent output' }, lines.length
    ? lines.map((e) => {
      const text = e.line.replace(/^│\s?/, '').replace(/^● /, '• ').replace(/⎿/, '└');
      return h('div', { className: /denied|error/i.test(text) ? 'err' : /^turn end|^notice/.test(text) ? 'dim' : '' }, h('span.tag', {}, `[${e.step}] `), text);
    })
    : h('span.dim', {}, 'No agent output yet.'));
  const outPills = h('div.filters', { role: 'group', 'aria-label': 'Show output from' }, ['all', ...stepsWithOutput].map((st) => h('button.small', { 'aria-pressed': outFilter.step === st ? 'true' : 'false', onclick: () => ((outFilter.step = st), p.redraw({ force: true })) }, st === 'all' ? 'All' : human(st))));
  const copyBtn = h('button.small.icon-btn', { 'aria-label': 'Copy output', onclick: () => copy(lines.map((e) => `[${e.step}] ${e.line}`).join('\n'), copyBtn) }, icon('copy'));

  // Checks and review findings.
  const gates = d.steps.flatMap((st) => st.result?.gates ?? []);
  const findings = d.steps.flatMap((st) => st.result?.findings?.map((f) => ({ ...f, step: st.id })) ?? []);
  const passed = (g) => /^pass/.test(g.status);
  const checks = h('div.card', {}, h('h2', {}, 'Checks'),
    gates.length
      ? gates.map((g) => h('div.check', {}, h('span', { className: passed(g) ? 'ok' : 'bad' }, icon(passed(g) ? 'check' : 'x')), h('div.grow', {}, h('span.mono', {}, g.command ?? g.name), ' ', h('span.muted', {}, g.summary ?? (passed(g) ? 'passed on a clean checkout' : 'failed on a clean checkout'))), pill(passed(g) ? 'Passed' : human(g.status), passed(g) ? 'teal' : 'danger')))
      : h('p.muted', {}, active ? 'Checks run at verify.' : 'No checks ran on this run.'),
    findings.length > 0 && [h('h3', { style: 'margin:24px 0 12px;font-size:15px' }, 'Review findings'), findings.map((f) => h('div.check', {}, pill(human(f.severity), /block|high|critical/i.test(f.severity) ? 'danger' : 'warn'), h('div.grow', {}, f.title, f.file && h('div.muted.mono', { style: 'font-size:12px' }, f.file))))]);

  const download = async (a, btn) => {
    btn.disabled = true;
    try {
      const file = await p.get(`runs/${encodeURIComponent(id)}/artifacts/${a.sha}`);
      const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain' }));
      h('a', { href: url, download: file.name.replace(/[\\/]/g, '_') }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (error.name !== 'AbortError') alert(error.message);
    } finally {
      btn.disabled = false;
    }
  };
  const size = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
  const artifacts = h('div.card', {}, h('h2', {}, 'Artifacts'),
    d.artifacts.length
      ? d.artifacts.map((a) => {
        const btn = h('button.small.icon-btn', { 'aria-label': `Download ${a.name}` }, icon('download'));
        btn.addEventListener('click', () => download(a, btn));
        return h('div.artifact', {}, icon('file'), h('div.grow', {}, h('div.name', {}, a.kind === a.name ? a.name : `${a.kind} · ${a.name}`), h('div.sub', {}, `${size(a.bytes)} · ${a.sha}`)), btn);
      })
      : h('p.muted', {}, 'Nothing stored yet.'));

  return [
    h('div.crumbs', {}, h('a', { href: p.href('/runs') }, 'Runs'), ' / ', h('span.mono', {}, shortId(r.id))),
    h('div.title-row', {}, h('h1', {}, r.title), pill(headline, tone, 'big')),
    h('div.meta', {}, h('span.mono', {}, r.id), h('span', {}, `line ${r.line}`), h('span', {}, h('b.num', {}, money(r.costUsd))), h('span', {}, `queued ${ago(r.queuedAt)}`), ran && h('span', {}, `ran ${ran}`), r.attempt > 1 && h('span', {}, `attempt ${r.attempt}`), r.pr && h('span', {}, /^https?:/.test(r.pr) ? h('a', { href: r.pr, target: '_blank', rel: 'noopener' }, 'Pull request') : h('span', { title: r.pr }, `PR ${r.pr.split(/[\\/]/).pop()}`))),
    actions,
    stepper,
    alertBox,
    openAsks.length > 0 && h('div.entries', { style: 'margin-top:20px;max-width:none' }, openAsks.map((e) => entryCard(p, e, r))),
    h('div.grid2', {},
      h('div.card', {}, h('div.card-head', {}, h('h2', {}, 'Story'), h('span.muted', { style: 'font-size:13px' }, `${started.length} station${started.length === 1 ? '' : 's'}${ran ? ` · ${ran}` : ''}`)), started.length ? story : h('p.muted', {}, 'No station has started yet.')),
      h('div.card', {}, h('div.card-head', {}, h('h2', {}, 'Agent output'), h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, outPills, copyBtn)), terminal)),
    h('div.grid2', {}, checks, artifacts),
    d.evidence && h('div.card', { style: 'margin-top:20px' }, h('details.evidence', {}, h('summary', {}, 'Evidence (the PR body)'), h('pre', {}, d.evidence))),
  ];
}

export const render = page(runView);
