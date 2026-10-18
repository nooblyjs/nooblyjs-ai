// /dev/styleguide: every component of the UI kit in every state, the colour tokens, the type scale and the icons
// (roadmap Phase 1). Compare it with the mockups in .claude/steering/brief/.
import { html } from '/ui/js/html.js';
import { icon, ICONS } from '/ui/js/icons.js';
import {
  pageHead, card, notice, button, statusPill, statCard, listRow, dataTable, kanbanColumn, timelineRow, timelineDay,
  meter, processChevron, stageStrip, STAGES, swimlane, checklist, chips,
} from '/ui/js/components/index.js';

const TOKENS = [
  'navy-900', 'navy-800', 'blue-600', 'blue-700', 'blue-100', 'blue-50', 'text', 'text-muted', 'text-subtle',
  'surface-page', 'surface-sidebar', 'surface-card', 'surface-inset', 'border', 'border-strong', 'divider',
  'success-100', 'success-700', 'warning-100', 'warning-600', 'warning-700', 'danger-700',
];

const section = (title, body, meta) => card({ title, meta, body });

export async function render(view, { ctx }) {
  ctx.chat.scope({ kind: 'page', id: 'Styleguide' });
  view.innerHTML = String(html`
${pageHead({ eyebrow: 'NooblyJS · Development', title: 'Styleguide', lead: 'Every component in every state. Compare with the mockups in .claude/steering/brief/.' })}

${section('Colour', html`<div class="swatches">${TOKENS.map((t) => html`<div class="swatch"><span class="swatch__chip" data-token="${t}"></span><code>--${t}</code></div>`)}</div>`, 'build brief §7')}

${section('Type', html`<span class="eyebrow">Eyebrow · 12px · 0.08em</span><p class="page-title">Page title 52px</p><h3 class="card__title">Card title 20px</h3><p>Body 15px. Lexend for the interface.</p><p class="lead">Lead 17px, text-muted.</p><p class="card__meta">Caption 13–14px, text-subtle (the minimum contrast).</p><p><code>PRD-031 · slots-api #482 · npm run seed</code> in JetBrains Mono.</p>`)}

${section('Buttons', html`<div class="actions">${button({ label: 'Approve & send', kind: 'primary', icon: 'check' })}${button({ label: 'New idea', kind: 'accent', icon: 'plus' })}${button({ label: 'Request changes', kind: 'secondary' })}${button({ label: 'Stop all runs', kind: 'danger' })}</div>
<div class="actions">${button({ label: 'Small primary', kind: 'primary', small: true })}${button({ label: 'Small secondary', kind: 'secondary', small: true })}${button({ label: 'Disabled', kind: 'primary', disabled: true })}${button({ label: 'A link styled as a button', kind: 'secondary', href: '/home/approvals' })}</div>`, 'primary · accent · secondary · danger')}

${section('Status pills', html`<div class="actions">${statusPill({ text: 'In review', tone: 'info' })}${statusPill({ text: 'Approved', tone: 'success' })}${statusPill({ text: 'Rollout plan missing', tone: 'warning' })}${statusPill({ text: 'Failed', tone: 'danger' })}${statusPill({ text: 'Live', tone: 'navy' })}${statusPill({ text: 'Draft', tone: 'neutral' })}${statusPill({ text: 'No dot', tone: 'info', dot: false })}</div>`)}

${section('Stat cards', html`<div class="grid">${statCard({ label: 'Idea → merge', value: '9.1 d', note: '1.8 d faster than last period' })}${statCard({ label: 'First-pass gates', value: '71%', note: '27 of 38 passed first time' })}${statCard({ label: 'Build', value: '5', note: 'runs on the line', highlight: true })}${statCard({ label: 'Linked stat', value: '4', note: 'waiting on you', href: '/home/approvals' })}</div>`)}

${section('List rows', html`<div class="rows">${listRow({ title: 'Same-day delivery slots — PRD-031', meta: 'Drafted by Ada Quill · readiness 6 of 7 checks', who: 'Lerato M.', pill: { text: 'Spec', tone: 'info' }, action: button({ label: 'Review', kind: 'secondary', small: true }) })}${listRow({ title: 'Ada Quill clustered 412 support tickets into 5 themes', meta: 'Product · 12 min ago · $0.84', who: 'Ada Quill', agent: true })}${listRow({ title: 'Selected row', meta: 'blue-50 fill', who: 'Thabo N.', selected: true, href: '/home/lifecycle' })}</div>`, 'people round · agents square')}

${section('Data table', html`${dataTable({ caption: 'Repositories', columns: [{ key: 'repo', label: 'Repository', render: (r) => html`<code>${r.repo}</code>` }, { key: 'stack', label: 'Stack' }, { key: 'access', label: 'Agent access', render: (r) => statusPill(r.access) }, { key: 'gates', label: 'Gates', numeric: true }], rows: [{ repo: 'acme/slots-api', stack: 'Node 22', access: { text: 'Read + open PRs', tone: 'info' }, gates: '5 of 5' }, { repo: 'acme/payments-gateway', stack: 'Java 21', access: { text: 'No agent access', tone: 'warning' }, gates: '' }] })}${dataTable({ caption: 'Empty', columns: [{ key: 'a', label: 'Station' }, { key: 'b', label: 'Runs', numeric: true }], rows: [], empty: 'No station has run in this period.' })}`, 'with rows · empty')}

${section('Kanban columns', html`<div class="kanban">${kanbanColumn({ title: 'Signals', cards: [{ title: 'Slots sell out before 10:00', meta: '412 tickets · Zendesk' }, { title: 'Substitutions feel random', meta: '188 app reviews' }] })}${kanbanColumn({ title: 'Spec drafting', cards: [{ title: 'Mobile promo code fix', meta: 'Ada Quill drafting · 64%', pill: { text: 'Agent working', tone: 'info' } }, { title: 'Loyalty points at checkout', meta: 'Awaiting your brief', pill: { text: 'Waiting on you', tone: 'warning' } }] })}${kanbanColumn({ title: 'To architecture', cards: [] })}</div>`, 'cards · empty')}

${section('Timeline', html`<div class="timeline">${timelineDay({ day: 'Today', rows: [
    { actor: 'Ada Quill', kind: 'agent', action: 'Ada Quill clustered 412 support tickets into 5 themes', system: 'Product', time: '12 min ago', cost: '$0.84' },
    { kind: 'system', action: 'Run 213 failed the contract-test gate on slots-api and retried', system: 'Factory', time: '52 min ago', outcome: 'passed on retry' },
    { actor: 'Lerato M.', kind: 'person', action: 'Lerato M. approved PRD-031 and left 2 comments', system: 'Product', time: '3 h ago' },
  ] })}</div>`, 'person · agent · system')}

${section('Chips', html`${chips({ label: 'Which approvals', name: 'tab', current: 'mine', items: [{ value: 'mine', label: 'Waiting on you', count: 4 }, { value: 'others', label: 'Waiting on others', count: 6 }, { value: 'done', label: 'Done this week', count: 11 }] })}${chips({ label: 'Filter activity', name: 'filter', current: 'everything', small: true, items: [{ value: 'everything', label: 'Everything' }, { value: 'people', label: 'People' }, { value: 'agents', label: 'Agents' }, { value: 'product', label: 'Product', divider: true }, { value: 'factory', label: 'Factory' }] })}`, 'pressed · with counts · small with a divider')}

${section('Meters', html`<div class="grid">${meter({ label: 'Spent today', value: '$142 of $400', ratio: 0.355 })}${meter({ label: 'October budget', value: '82% used', ratio: 0.82, tone: 'warning' })}${meter({ label: 'Budget reached', value: '$1,500 of $1,500', ratio: 1, tone: 'danger' })}${meter({ label: 'Ada is drafting', value: '64%', ratio: 0.64, tone: 'live' })}${meter({ label: 'Nothing yet', value: '$0', ratio: 0 })}</div>`, 'default · warning · danger · live · empty')}

${section('Process chevrons', html`<div class="chevrons">${processChevron({ code: 'PL', name: 'Plan', meta: 'L1 · 7 L2', tone: 'value' })}${processChevron({ code: 'PR', name: 'Procure', meta: 'L1 · 6 L2', tone: 'value' })}${processChevron({ code: 'SU', name: 'Supply', meta: '2 active specs', tone: 'active', href: '/dev/styleguide' })}${processChevron({ code: 'SE', name: 'Sell', meta: '3 active specs', tone: 'value' })}</div><div class="chevrons">${processChevron({ code: 'EM', name: 'Enterprise Management', meta: 'L1 · 6 L2' })}${processChevron({ code: '[HC]', name: 'Develop and Manage Human Capital', meta: 'L1' })}</div>`, 'value chain · active · enterprise/support')}

${section('Stage strip', stageStrip({ current: 'Build', stages: STAGES.map((name, i) => ({ name, count: [6, 4, 3, 3, 2, 5, 2][i], note: ['ideas', 'specs · 2 in review', 'ADRs proposed', 'flows in progress', 'ready for handoff', 'runs on the line', 'PRs awaiting merge'][i], href: '/home/lifecycle' })) }), 'current: Build')}

${section('Swimlane', swimlane({ rows: [
    { title: 'Same-day delivery slots', id: 'PRD-031', age: '6 d', cells: { Discover: { state: 'done' }, Specify: { state: 'now', text: 'Your review' } } },
    { title: 'Store pickup lockers', id: 'PRD-025', age: '13 d', cells: { Discover: { state: 'done' }, Specify: { state: 'done' }, Architect: { state: 'waiting', text: 'Waiting 4 d' } } },
    { title: 'Slot capacity endpoint', id: 'slots-api #482', age: '9 d', cells: { Discover: { state: 'done' }, Specify: { state: 'done' }, Architect: { state: 'done' }, 'UX design': { state: 'done' }, 'UI design': { state: 'done' }, Build: { state: 'done' }, Ship: { state: 'now', text: 'Your merge' } } },
  ] }), 'done · now · waiting too long')}

${section('Checklist', checklist({ label: 'Readiness', items: [
    { text: 'Problem backed by evidence', state: 'done' },
    { text: 'Goals are measurable', state: 'done' },
    { text: 'Rollout plan', state: 'failed', note: 'Missing · Ask Ada to draft rollout' },
    { text: 'Privacy reviewed', state: 'todo' },
  ] }), 'done · missing · to do')}

${section('Notices', html`<div class="grid">${notice({ title: 'Not built yet: Phase 2', text: 'A placeholder names its phase and mockup.', tone: 'muted', iconName: 'clock' })}${notice({ title: 'Factory isn’t installed yet', text: 'The rail item says so too.', tone: 'info' })}${notice({ title: 'Teammates couldn’t load this page', text: 'The rest of NooblyJS keeps working.', tone: 'error', actions: button({ label: 'Retry', kind: 'primary', icon: 'refresh', small: true }) })}</div>`, 'muted · info · error')}

${section('Icons', html`<div class="swatches">${ICONS.map((n) => html`<div class="swatch">${icon(n, { size: 24 })}<code>${n}</code></div>`)}</div>`, '24px grid · stroke 1.7–1.8 · round caps')}
`);
}
