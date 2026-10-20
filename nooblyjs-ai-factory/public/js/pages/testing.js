// Build's Pull requests and the Test group (CHG-008): each pull request with its Build and Test approvals, the Test
// approvals (waiting on a tester, in Test, given), the test runs, coverage and defects. The pull requests and approvals
// come from the lifecycle engine; the runs, coverage and defects are the seed story's sample until Phases 16e and 20
// record them from the line and the environments, and the pages say so.
// Data: GET /pull-requests, /test/approvals, /test/runs, /test/coverage, /test/defects.
import { h, page, ago, fmtDur } from '../lib.js';
import { pill, pageHead, tableWrap, empty, tile } from '../parts.js';

const SAMPLE = 'Phase 20 records test runs, coverage and defects from the line and the environments; until then these are sample data of the seed story.';
const RUN_TONE = { passed: 'teal', failed: 'danger', running: 'accent' };
const APPROVAL_TONE = { approved: 'teal', waiting: 'warn', none: '' };
const STAGE = { build: 'Build', test: 'Test', release: 'Release', operate: 'Operate' };
const table = (label, heads, rows, emptyText) => tableWrap(label, {}, h('table', {},
  h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.length ? rows : h('tr.empty-row', {}, h('td', { colspan: heads.length }, emptyText)))));

async function pullRequestsView(p) {
  const { live, pullRequests } = await p.get('pull-requests');
  const head = pageHead('Pull requests', 'Each pull request the AI opens waits on an engineer\'s Build approval, then a tester\'s Test approval; then a person merges it. Decide them in Lifecycle or Approvals.');
  if (!live) return [head, empty('The lifecycle engine is not running here', 'The pull requests come from it.')];
  return [head,
    table('Pull requests', ['Pull request', 'Stage', 'Build approval', 'Test approval', 'Last test run'], pullRequests.map((r) => h('tr', {},
      h('td.title', {}, h('a', { href: r.href }, `${r.ref} · ${r.title}`), h('br'), h('span.muted', {}, r.owner ? `Owner ${r.owner}` : '')),
      h('td', {}, r.status === 'completed' ? 'Merged' : STAGE[r.stage] ?? r.stage),
      h('td', {}, pill(r.build.text, APPROVAL_TONE[r.build.status] ?? '', 'plain')),
      h('td', {}, pill(r.test.text, APPROVAL_TONE[r.test.status] ?? '', 'plain')),
      h('td', {}, r.lastRun ? pill(r.lastRun.text, RUN_TONE[r.lastRun.status] ?? '', 'plain') : h('span.muted', {}, 'None yet')))), 'No pull requests yet.'),
    h('p.note', {}, 'The approvals are live; the last test run is sample data until Phase 20 records runs.')];
}

async function approvalsView(p) {
  const { live, waiting, inTest, given } = await p.get('test/approvals');
  const head = pageHead('Test approvals', 'A tester verifies each pull request after its Build approval: the AI\'s test evidence against the test cases, and what the test analysis says a person checks. Then it may merge.');
  if (!live) return [head, empty('The lifecycle engine is not running here', 'The approvals come from it.')];
  return [head,
    h('section.card', { 'aria-label': 'Waiting on a tester' }, h('h2', {}, 'Waiting on a tester'),
      table('Waiting on a tester', ['Pull request', 'Waiting on', ''], waiting.map((a) => h('tr', {}, h('td.title', {}, `${a.ref} · ${a.title}`), h('td', {}, a.waitingOn.join(', ')), h('td.r', {}, h('a.btn', { href: a.href }, 'Decide')))), 'No Test approval is waiting.')),
    h('section.card', { 'aria-label': 'In Test' }, h('h2', {}, 'In Test'),
      table('In Test', ['Pull request', 'Where it is'], inTest.map((i) => h('tr', {}, h('td.title', {}, h('a', { href: i.href }, `${i.ref} · ${i.title}`)), h('td', {}, i.text))), 'Nothing is in Test.')),
    h('section.card', { 'aria-label': 'Given' }, h('h2', {}, 'Given'),
      table('Test approvals given', ['Pull request', 'Given by', 'When'], given.map((a) => h('tr', {}, h('td.title', {}, `${a.ref} · ${a.title}`), h('td', {}, a.status === 'approved' ? a.decidedBy : `${a.status} · ${a.decidedBy ?? ''}`), h('td.muted', {}, ago(a.decidedAt)))), 'None given yet.'))];
}

async function runsView(p) {
  const { runs, text } = await p.get('test/runs');
  return [pageHead('Test runs', `The Factory's gates on each pull request, and the suites run in an environment. ${text}.`),
    table('Test runs', ['Run', 'Pull request', 'Suite', 'Where', 'Result', 'Took', 'When'], runs.map((r) => h('tr', {},
      h('td.mono', {}, r.id),
      h('td.title', {}, r.ref ?? 'All journeys'),
      h('td', {}, r.suite, r.failures?.length ? h('ul', {}, r.failures.map((f) => h('li.muted', {}, f))) : null, r.note ? h('div.muted', {}, r.note) : null),
      h('td', {}, r.environment),
      h('td', {}, pill(r.status === 'running' ? `Running · ${r.passed} passed so far` : `${r.status === 'passed' ? 'Passed' : 'Failed'} · ${r.passed} passed, ${r.failed} failed${r.skipped ? `, ${r.skipped} skipped` : ''}`, RUN_TONE[r.status] ?? '', 'plain')),
      h('td.muted', {}, r.durationS ? fmtDur(r.durationS * 1000) : '—'),
      h('td.muted', {}, ago(r.at)))), 'No test runs yet.'),
    h('p.note', {}, SAMPLE)];
}

async function coverageView(p) {
  const { stories, pullRequests } = await p.get('test/coverage');
  return [pageHead('Coverage', 'Per story, the acceptance criteria with a ready test case and what the AI automates; per pull request, its runs and open defects.'),
    h('div.tiles', {},
      tile('Criteria with a ready test case', `${stories.reduce((n, s) => n + s.ready, 0)} of ${stories.reduce((n, s) => n + s.criteria, 0)}`, `across ${stories.length} ${stories.length === 1 ? 'story' : 'stories'} in Engineer`),
      tile('Test cases the AI automates', `${stories.reduce((n, s) => n + s.automated, 0)} of ${stories.reduce((n, s) => n + s.cases, 0)}`, 'the rest a person checks'),
      tile('Open defects', pullRequests.reduce((n, r) => n + r.openDefects, 0), 'on pull requests in flight')),
    h('section.card', { 'aria-label': 'Stories' }, h('h2', {}, 'Stories'),
      table('Coverage per story', ['Story', 'Criteria', 'Test cases', ''], stories.map((s) => h('tr', {},
        h('td.title', {}, `${s.id} · ${s.title}`), h('td', {}, s.text), h('td', {}, `${s.cases} (${s.automated} automated)`), h('td.r', {}, h('a.btn', { href: s.href }, 'Test analysis')))), 'No story has a test analysis yet.')),
    h('section.card', { 'aria-label': 'Pull requests' }, h('h2', {}, 'Pull requests'),
      table('Coverage per pull request', ['Pull request', 'Runs', 'Last run', 'Open defects'], pullRequests.map((r) => h('tr', {},
        h('td.title', {}, r.ref), h('td', {}, r.runs), h('td', {}, pill(`${r.last.suite}: ${r.last.status}`, RUN_TONE[r.last.status] ?? '', 'plain')), h('td', {}, r.openDefects ? pill(String(r.openDefects), 'danger', 'plain') : 'None'))), 'No runs yet.')),
    h('p.note', {}, SAMPLE)];
}

async function defectsView(p) {
  const { defects, text } = await p.get('test/defects');
  const SEV = { S1: 'danger', S2: 'warn', S3: '' };
  const STATUS = { open: 'Open', fixed: 'Fixed, not yet closed', closed: 'Closed' };
  return [pageHead('Defects', `Each defect with the pull request and requirement it breaks, and the run that found it. ${text}.`),
    table('Defects', ['Defect', 'Severity', 'Status', 'Pull request', 'Breaks', 'Found'], defects.map((d) => h('tr', {},
      h('td.title', {}, h('span.mono', {}, d.id), ' ', d.title, d.body ? h('div.muted', {}, d.body) : null),
      h('td', {}, pill(d.severity, SEV[d.severity] ?? '', 'plain')),
      h('td', {}, pill(STATUS[d.status] ?? d.status, d.status === 'open' ? 'danger' : 'teal', 'plain')),
      h('td', {}, d.ref ?? ''),
      h('td', {}, d.breaks ?? ''),
      h('td.muted', {}, `${d.foundIn} · ${ago(d.foundAt)}`))), 'No defects recorded.'),
    h('p.note', {}, SAMPLE)];
}

const VIEWS = { 'pull-requests': pullRequestsView, approvals: approvalsView, runs: runsView, coverage: coverageView, defects: defectsView };
const pages = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, page(v)]));

export function render(view, args) {
  return pages[args.route?.meta?.view ?? 'approvals'](view, args);
}
