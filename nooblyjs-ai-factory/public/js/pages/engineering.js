// The Engineering group (CHG-008): the stories in Engineer, each with its application architecture and its test analysis,
// and what the Engineering sign-off still needs. The stories come from the lifecycle engine; the architecture and test
// analysis are the seed story's sample until Phase 16d drafts them from the code, and the pages say so.
// Data: GET /engineering, /engineering/architecture/:id, /engineering/test-analysis/:id.
import { h, page, ago } from '../lib.js';
import { pill, pageHead, tableWrap, empty } from '../parts.js';

const PHASE = 'Phase 16d drafts these from the code and the acceptance criteria, lets people edit them, and gates the Engineering sign-off on them.';
const sampleNote = (text) => h('p.note', {}, `${text} ${PHASE}`);
const tone = (ok) => (ok ? 'teal' : 'warn');
const list = (items) => h('ul', {}, items.map((x) => h('li', {}, x)));

function storyCell(p, s) {
  return h('td.title', {}, h('strong', {}, `${s.ref} · ${s.title}`), h('br'),
    h('span.muted', {}, s.parent ? `${s.parent.ref} · ${s.parent.title}` : 'No item'), ' · ', h('a', { href: s.href }, 'Lifecycle'));
}

async function listView(p, kind) {
  const data = await p.get('engineering');
  const titles = { architecture: 'Application architecture', tests: 'Test analysis', signoff: 'Engineering sign-off' };
  const leads = {
    architecture: 'Each story in Engineer, its application flow, objects, NFRs per component and the changes it proposes, per impacted system, drawn from the code.',
    tests: 'Each story in Engineer, its test cases from the acceptance criteria, what the AI must automate and at which level, and what a person checks by hand.',
    signoff: 'Nothing is built before an Application Architect and a test lead sign a story off, in one approval. What each story still needs.',
  };
  const rows = data.stories;
  const head = pageHead(titles[kind], rows.length ? `${rows.length} ${rows.length === 1 ? 'story is' : 'stories are'} in Engineer. ${leads[kind]}` : leads[kind]);
  if (!data.live) return [head, empty('The lifecycle engine is not running here', 'The stories in Engineer come from it.')];
  if (!rows.length) return [head, empty('Nothing is in Engineer', 'A story comes here with its Design handoff, from the Design section.')];
  const cells = {
    architecture: (s) => [
      h('td', {}, pill(s.architecture.text, s.architecture.systems && s.architecture.accepted === s.architecture.systems ? 'teal' : 'warn', 'plain')),
      h('td.r', {}, s.architecture.systems ? h('a.btn', { href: p.href(`/engineering/architecture/${encodeURIComponent(s.id)}`) }, 'Open') : h('span.muted', {}, 'None yet')),
    ],
    tests: (s) => [
      h('td', {}, pill(s.testAnalysis.text, s.testAnalysis.criteria && s.testAnalysis.ready === s.testAnalysis.criteria ? 'teal' : 'warn', 'plain')),
      h('td.r', {}, s.testAnalysis.cases ? h('a.btn', { href: p.href(`/engineering/test-analysis/${encodeURIComponent(s.id)}`) }, 'Open') : h('span.muted', {}, 'None yet')),
    ],
    signoff: (s) => [
      h('td', {}, pill(s.signOff.ready ? 'Ready to sign off' : 'Not ready', tone(s.signOff.ready), 'plain'), s.signOff.missing.length ? list(s.signOff.missing) : null),
      h('td.r', {}, h('a.btn', { href: s.href }, s.signOff.waitingOn.length ? `Waiting on ${s.signOff.waitingOn.join(', ')}` : 'Sign off in Lifecycle')),
    ],
  };
  const colHead = { architecture: 'Architecture', tests: 'Test analysis', signoff: 'What the sign-off needs' };
  return [
    head,
    tableWrap(titles[kind], {}, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Story'), h('th', {}, colHead[kind]), h('th', {}, h('span.sr', {}, 'Actions')))),
      h('tbody', {}, rows.map((s) => h('tr', {}, storyCell(p, s), ...cells[kind](s)))))),
    rows.some((s) => s.sample) ? sampleNote('The architecture and test analysis shown are sample data of the seed story.') : h('p.note', {}, PHASE),
  ];
}

async function architectureView(p) {
  const d = await p.get(`engineering/architecture/${encodeURIComponent(p.params.id)}`);
  return [
    pageHead(`Application architecture: ${d.storyId}`, `${d.title} · ${d.summary.text}. Drafted by ${d.draftedBy?.name ?? 'an agent'} ${ago(d.draftedAt)}.`,
      h('a.btn', { href: d.href }, 'Open in Lifecycle'), h('a.btn', { href: d.designHref }, 'Its design')),
    d.systems.map((s) => h('section.card', { 'aria-label': `${s.name}'s architecture` },
      h('div.card-head', {}, h('h2', {}, s.name), pill(s.status === 'accepted' ? `Accepted by ${s.acceptedBy?.name ?? 'a person'}` : 'Proposed: an Application Architect accepts it', s.status === 'accepted' ? 'teal' : 'warn')),
      h('p.muted', {}, `Read from ${s.readAt?.branch ?? 'main'} at ${s.readAt?.commit ?? 'its latest commit'}${s.stale ? ' · stale: main has moved since' : ' · up to date with main'}`),
      h('h3', {}, 'Application flow'), h('ol', {}, (s.flow ?? []).map((step) => h('li', {}, step))),
      h('h3', {}, 'Objects'),
      tableWrap(`${s.name}'s objects`, {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Object'), h('th', {}, 'Kind'), h('th', {}, 'Fields'), h('th', {}, 'Note'))),
        h('tbody', {}, (s.objects ?? []).map((o) => h('tr', {}, h('td', {}, h('strong', {}, o.name)), h('td', {}, o.kind), h('td', {}, (o.fields ?? []).join(', ')), h('td.muted', {}, o.note ?? '')))))),
      h('h3', {}, 'NFRs per component'),
      tableWrap(`${s.name}'s NFRs`, {}, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Component'), h('th', {}, 'Requirement'), h('th', {}, 'Target'), h('th', {}, 'From'))),
        h('tbody', {}, (s.nfrs ?? []).map((n) => h('tr', {}, h('td', {}, n.component), h('td', {}, n.requirement), h('td', {}, n.target), h('td.mono', {}, n.from ?? '')))))),
      h('h3', {}, 'Changes it proposes'),
      h('ul', {}, (s.changes ?? []).map((c) => h('li', {}, h('span.mono', {}, c.path), ` (${c.kind}): ${c.what}`))))),
    sampleNote(d.sample),
  ];
}

async function analysisView(p) {
  const d = await p.get(`engineering/test-analysis/${encodeURIComponent(p.params.id)}`);
  const level = { unit: 'Unit', contract: 'Contract', integration: 'Integration', e2e: 'E2E', manual: 'By a person' };
  return [
    pageHead(`Test analysis: ${d.storyId}`, `${d.title} · ${d.summary.text}. ${d.summary.automated} of ${d.summary.cases} test cases are for the AI to automate.`,
      h('a.btn', { href: d.href }, 'Open in Lifecycle'), h('a.btn', { href: d.designHref }, 'Its design')),
    h('section.card', { 'aria-label': 'Acceptance criteria' }, h('h2', {}, 'Acceptance criteria and their test cases'),
      h('ol', {}, d.criteria.map((c) => h('li', {}, c.text, h('br'), h('span.muted', {}, c.cases.length ? c.cases.join(', ') : 'No test case yet'))))),
    h('section.card', { 'aria-label': 'Test cases' }, h('h2', {}, 'Test cases'),
      tableWrap('Test cases', {}, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Id'), h('th', {}, 'Test'), h('th', {}, 'Level'), h('th', {}, 'Automated by the AI'), h('th', {}, 'Status'))),
        h('tbody', {}, d.cases.map((c) => h('tr', {},
          h('td.mono', {}, c.id),
          h('td.title', {}, c.title, c.interface ? h('span.muted', {}, ` · ${c.interface}`) : null, c.journey ? h('span.muted', {}, ` · ${c.journey}`) : null, c.why ? h('span.muted', {}, ` · ${c.why}`) : null),
          h('td', {}, level[c.level] ?? c.level),
          h('td', {}, c.automate ? 'Yes' : 'No: a person checks it'),
          h('td', {}, pill(c.status === 'ready' ? `Ready · ${c.readyBy?.name ?? ''}`.trim() : 'Draft', c.status === 'ready' ? 'teal' : 'warn', 'plain')))))))),
    h('section.card', { 'aria-label': 'Integration and E2E tests' }, h('h2', {}, 'Integration tests per interface, and E2E tests per journey'),
      h('ul', {},
        (d.interfaces ?? []).map((i) => h('li', {}, h('span.mono', {}, i.id), i.cases.length ? `: ${i.cases.join(', ')}` : ': no integration test yet')),
        (d.journeys ?? []).map((j) => h('li', {}, `${j.name}: ${j.cases.join(', ')}`)))),
    d.summary.missing.length ? h('p.note', {}, `Before the sign-off: ${d.summary.missing.join('; ')}.`) : null,
    sampleNote(d.sample),
  ];
}

const VIEWS = {
  architecture: (p) => listView(p, 'architecture'),
  tests: (p) => listView(p, 'tests'),
  signoff: (p) => listView(p, 'signoff'),
  'architecture-detail': architectureView,
  'tests-detail': analysisView,
};
const pages = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, page(v)]));

export function render(view, args) {
  return pages[args.route?.meta?.view ?? 'architecture'](view, args);
}
