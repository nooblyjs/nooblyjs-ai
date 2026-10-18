// Phase F26: the pieces the factory's pages share: icons, the role avatars, pills, the page
// head, "run this in a terminal" dialogs and the inbox card. They came from the F17 dashboard
// (public/dashboard/app.js) unchanged, except that links go through p.href().
//
// NooblyJS Phase 7: the page head, the status pills, the number tiles and the empty states are the NooblyJS UI
// kit's components. What is still drawn here is what the kit lacks: the role avatars, the station strip's
// job cards, the terminal, and the inbox card.
import { pageHead as kitPageHead, statusPill as kitPill, statCard, notice } from '/ui/js/components/index.js';
import { h, s, kit, cap, human, money, shortId, since, ACTIVE, DELIVERED } from './lib.js';

const ICONS = {
  flag: 'M5 21V4 M5 4h11l-2.5 4L16 12H5',
  chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M7 7l10 10 M17 7L7 17',
  retry: 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v4h4',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4-4',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  file: 'M14 3H6v18h12V7z M14 3v4h4',
  warn: 'M12 3.5L2.5 20h19z M12 10v4 M12 17h.01',
  stop: 'M6 6h12v12H6z',
  cpu: 'M8 8h8v8H8z M10 3v3 M14 3v3 M10 18v3 M14 18v3 M3 10h3 M3 14h3 M18 10h3 M18 14h3',
  book: 'M6 3h12v18H6z M9 3v18',
  branch: 'M6 3v12 M6 21a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4z M18 9c0 6-12 3-12 8',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 5l12 7-12 7z',
};
export const icon = (name) => s('svg', { class: 'i', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: ICONS[name] }));

const HAIR = {
  bob: 'M15 31 C15 18 22 12 32 12 C42 12 49 18 49 31 L49 40 L44 40 L44 26 C40 23 24 23 20 26 L20 40 L15 40 Z',
  antenna: 'M17 27 C18 18 25 14 32 14 C39 14 46 18 47 27 C40 22 24 22 17 27 Z M31 14 L31 7 L33 7 L33 14 Z M29.5 5 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0 Z',
  bun: 'M18 26 C19 18 25 15 32 15 C39 15 45 18 46 26 C39 21 25 21 18 26 Z M27 10 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 Z',
  quiff: 'M16 29 C15 18 24 12 34 13 C43 14 49 21 48 29 C42 21 30 19 22 25 C20 26 18 28 16 29 Z',
  crop: 'M17 28 C17 19 24 14 32 14 C40 14 47 19 47 28 C44 22 38 20 32 20 C26 20 20 22 17 28 Z',
};
const PAIRS = [['#FFD7C2', '#7A2E14'], ['#CDE7E4', '#1E5E63'], ['#E5DAF5', '#4B2E83'], ['#FBE6A6', '#6B4E00'], ['#F6CFD8', '#8A2440'], ['#D6E4FA', '#1F4A8A'], ['#DCE8C8', '#3D5A1E'], ['#EED9C4', '#6A3F1F']];
/** Each built-in role has its own face; any other role gets one from its name. */
const ROLE_LOOK = { triager: [1, 'crop'], 'spec-writer': [3, 'bun'], builder: [0, 'quiff'], reviewer: [2, 'bob'], 'security-reviewer': [6, 'antenna'], integrator: [5, 'crop'], fixer: [4, 'bun'], retro: [7, 'antenna'] };
function lookOf(role) {
  if (ROLE_LOOK[role]) return ROLE_LOOK[role];
  let n = 0;
  for (const ch of String(role)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return [n % PAIRS.length, Object.keys(HAIR)[n % 5]];
}
function avatar(role, size = 32) {
  const [pair, hair] = lookOf(role);
  const [bg, deep] = PAIRS[pair];
  const face = [
    s('path', { d: 'M10 64 C12 51 21 46 32 46 C43 46 52 51 54 64 Z', fill: deep }),
    s('circle', { cx: 32, cy: 31, r: 15, fill: '#FFF8F2' }),
    s('path', { d: HAIR[hair], fill: deep }),
    s('circle', { cx: 27, cy: 32, r: 1.8, fill: '#241C1A' }),
    s('circle', { cx: 37, cy: 32, r: 1.8, fill: '#241C1A' }),
    size >= 40 && s('circle', { cx: 23.5, cy: 36.5, r: 2.4, fill: bg }),
    size >= 40 && s('circle', { cx: 40.5, cy: 36.5, r: 2.4, fill: bg }),
    s('path', { d: 'M27.5 37.5 Q32 41 36.5 37.5', stroke: '#241C1A', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }),
  ];
  return h('span.avatar', { style: `width:${size}px;height:${size}px;background:${bg}`, 'aria-hidden': 'true' }, s('svg', { viewBox: '0 0 64 64' }, face));
}

/** claude-sonnet-5-5 → Sonnet 5.5, coloured by tier (light / balanced / premium). */
function modelOf(route) {
  const id = String(route?.model ?? '');
  const m = /(haiku|sonnet|opus|fable)-?(\d+)?-?(\d+)?/i.exec(id);
  const name = m ? `${cap(m[1].toLowerCase())}${m[2] ? ` ${m[2]}${m[3] && m[3].length < 3 ? `.${m[3]}` : ''}` : ''}` : id || 'Default model';
  const tier = route?.tier ?? (/haiku/i.test(id) ? 'light' : /opus|fable/i.test(id) ? 'premium' : 'balanced');
  const colour = { light: 'var(--tier-light)', balanced: 'var(--tier-balanced)', premium: 'var(--tier-premium)' }[tier] ?? 'var(--tier-balanced)';
  return { name, colour };
}
const modelChip = (route) => {
  const m = modelOf(route);
  return h('span.chip', {}, icon('cpu'), h('i.dot', { style: `background:${m.colour}`, 'aria-hidden': 'true' }), m.name);
};
export const who = (route, size = 32) => route && h('span.who', {}, avatar(route.role, size), human(route.role), modelChip(route));

const VERB = { triage: 'Triaging', spec: 'Writing the spec', approve: 'Approving', build: 'Building', verify: 'Verifying', review: 'Reviewing', security: 'Security check', repair: 'Repairing', deliver: 'Delivering', merge: 'Merging' };
/** A run's status as a person would say it, and its colour. */
export function statusOf(r) {
  switch (r.status) {
    case 'running': return [VERB[r.station] ?? 'Running', 'accent'];
    case 'parked': return ['Needs you', 'warn'];
    case 'paused': return ['Paused', ''];
    case 'queued': return ['Waiting', ''];
    case 'delivered': return ['Delivered', 'teal'];
    case 'merged': return ['Merged', 'teal'];
    case 'cancelled': return ['Cancelled', ''];
    case 'no_changes': return ['No changes', ''];
    case 'agent_failed': return ['Agent failed', 'danger'];
    case 'gate_failed': return ['Checks failed', 'danger'];
    default: return [human(r.status), 'danger'];
  }
}
const TONE = { teal: 'success', accent: 'info', warn: 'warning', danger: 'danger' };
/** The kit's status pill. `extra`: 'plain' (no dot) or 'big' (beside a page title). */
export function pill(label, tone = '', extra = '') {
  const el = kit(kitPill({ text: label, tone: TONE[tone] ?? 'neutral', dot: extra !== 'plain' }));
  el.classList.add('fx-pill');
  if (extra === 'big') el.classList.add('fx-pill-big');
  return el;
}
export const statusPill = (r, extra) => pill(...statusOf(r), extra);
export const where = (r) => (ACTIVE.includes(r.status) ? `At ${r.station ?? 'queued'}` : DELIVERED.includes(r.status) ? human(r.station ?? 'deliver') : (r.station ? `Stopped at ${r.station}` : 'Stopped before triage'));
export const meter = (fraction, label) => h('div.meter', { role: 'img', 'aria-label': label }, h('i', { style: `width:${Math.min(100, Math.max(0, fraction * 100)).toFixed(1)}%` }));

/** The kit's page head, with this page's buttons as its actions. */
export function pageHead(title, sub, ...actions) {
  const head = kit(kitPageHead({ title, lead: sub || undefined }));
  if (actions.some(Boolean)) head.append(h('div.actions', {}, actions.filter(Boolean)));
  return h('div.fx-head', {}, head);
}
/** A number with its label and a line that explains it (the kit's stat card). */
export function tile(label, value, note) {
  const el = kit(statCard({ label, value, note: note || undefined }));
  el.classList.add('fx-tile');
  return el;
}
/** An empty state or a message, in the kit's notice card. */
export const empty = (title, text, tone = 'muted') => kit(notice({ title, text, tone }));
/** A table that scrolls sideways on a narrow screen: a keyboard can reach and scroll it. */
export const tableWrap = (label, props, ...children) => h('div.table-wrap', { tabindex: 0, role: 'region', 'aria-label': label, ...props }, children);

export function codeBlock(command) {
  const btn = h('button.icon-btn', { 'aria-label': 'Copy command', onclick: () => copy(command, btn) }, icon('copy'));
  return h('div.code', {}, h('code', {}, command), btn);
}
export async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.setAttribute('aria-label', 'Copied');
    btn.replaceChildren(icon('check'));
    setTimeout(() => (btn.setAttribute('aria-label', 'Copy'), btn.replaceChildren(icon('copy'))), 1500);
  } catch {
    alert('Copy failed: select the text and copy it yourself.');
  }
}
/** Starting work happens in the terminal: show the command, with a copy button. */
const showCommand = (p, title, text, command) => p.dialog(h('h2', {}, title), h('p', {}, text), codeBlock(command));
export const CAMPAIGN_CMD = 'factory campaign create --name <name> --spec campaign.md --repos a,b';
export const newRun = (p) => () => showCommand(p, 'Start a run', 'Runs start from an issue file. Queue one from a terminal and factory serve picks it up.', 'factory submit issue.md --repo <path>');
export const newCampaign = (p) => () => showCommand(p, 'Start a campaign', 'Write the change once as a spec, then open a run for each repo from a terminal.', CAMPAIGN_CMD);

/** Why a run stopped at a station: the agent's last refusal or error says more than a bare "interrupted". */
export function whyStopped(r, step, agent) {
  const refusal = agent.findLast((e) => e.step === step?.id && /denied|error|refused/i.test(e.line))?.line.replace(/^│\s*(⎿\s*)?/, '').replace(/^└\s*/, '');
  const generic = !step?.error || /^interrupted/i.test(step.error);
  if (refusal && generic) return refusal;
  if (step?.error && !generic) return cap(step.error);
  if (r.status === 'interrupted') return `The run was interrupted ${step ? `at ${step.id}` : 'before triage'}. Retry it: the stations that finished are kept.`;
  return `It stopped ${step ? `at ${step.id}` : 'before triage'} (${human(r.status).toLowerCase()}).`;
}

const KIND = { approval: ['Approve', 'warn'], question: ['Question', 'warn'], policy: ['Permission', 'warn'], escalation: ['Needs a person', 'danger'] };
const GATE = { spec: 'Approve the spec', security: 'Security hold', scope: 'Allow more files' };
const reply = new Map(); // inbox id → 'reject' while the feedback box is open

/** One inbox entry: what's asked, the detail, and the buttons that answer it. */
export function entryCard(p, e, run) {
  const [kindLabel, tone] = KIND[e.kind] ?? [human(e.kind), 'warn'];
  const label = GATE[e.gate] ?? (e.kind === 'approval' && e.gate ? `Approve ${e.gate}` : kindLabel);
  // A question or an escalation is answered in words, by anyone who may draft (NooblyJS Phase 7). An approval or a
  // policy change decides something, so it needs the approve permission. The API enforces both.
  const asks = e.kind === 'question' || e.kind === 'escalation';
  const text = h('textarea', { id: `reply-${e.id}`, placeholder: e.kind === 'escalation' ? 'Tell the run what to do. It goes back to be repaired with your answer.' : asks ? 'Your answer' : 'What should change?', 'aria-label': asks ? 'Your answer' : 'Feedback' });
  const rejecting = reply.get(e.id) === 'reject';
  const answer = (body) => p.post(`inbox/${e.id}`, body);
  const cancel = p.can('draft') && h('button.ghost.danger', { onclick: p.act(() => confirm('Cancel this run?') && p.post(`runs/${e.runId}/cancel`)) }, 'Cancel run');
  let buttons;
  if (!p.can(asks ? 'draft' : 'approve')) {
    buttons = [h('p.fx-note', {}, asks ? 'Answering this needs the Contributor role (or higher).' : 'Deciding this needs the Approver role (or higher).')];
  } else if (asks) {
    buttons = [text, e.detail?.options?.length > 0 && h('div.options', {}, e.detail.options.map((o) => h('button.small', { onclick: () => ((text.value = o), text.focus()) }, o))), h('div.btns', {}, h('button.primary', { onclick: p.act(() => answer({ decision: 'answered', answer: text.value })) }, 'Send answer'), cancel)];
  } else if (rejecting) {
    buttons = [text, h('div.btns', {}, h('button.primary', { onclick: p.act(async () => (await answer({ decision: 'rejected', feedback: text.value }), reply.delete(e.id))) }, 'Send feedback'), h('button', { onclick: () => (reply.delete(e.id), p.redraw({ force: true })) }, 'Back'))];
  } else {
    const verb = e.gate === 'spec' ? 'Approve and build' : 'Approve';
    const ask = () => (reply.set(e.id, 'reject'), p.redraw({ force: true }).then(() => p.root.querySelector(`#${CSS.escape(`reply-${e.id}`)}`)?.focus()));
    buttons = [h('div.btns', {}, h('button.primary', { onclick: p.act(() => answer({ decision: 'approved' })) }, icon('check'), verb), h('button', { onclick: ask }, 'Ask for changes'), cancel)];
  }
  const facts = [e.detail?.paths?.length && ['Files', e.detail.paths.length], e.detail?.attempts && ['Repair attempts', e.detail.attempts], run && ['Cost so far', money(run.costUsd)], run?.station && ['Station', human(run.station)]].filter(Boolean);
  return h('article.card.entry', { 'aria-label': e.title },
    h('div.top', {}, pill(label, tone), h('a.mono', { href: p.href(`/runs/${e.runId}`), style: 'color:var(--muted)' }, shortId(e.runId)), h('span.waiting', {}, `waiting ${since(e.openedAt)}`)),
    h('h2', {}, run?.title ?? e.title),
    run && h('p.fx-lead', {}, e.title),
    facts.length > 0 && h('dl.facts', {}, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd.num', {}, v)))),
    e.body && h('div.sunken', {}, h('div.eyebrow', {}, e.gate === 'spec' ? 'Spec' : 'Details'), h('div.body', { tabindex: 0, role: 'region', 'aria-label': 'Details' }, e.body)),
    buttons);
}
