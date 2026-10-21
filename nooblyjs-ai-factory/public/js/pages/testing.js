// Build's Pull requests and the Test group (CHG-008; Phase 16e): each pull request with its Build and Test approvals and
// its evidence; a pull request's page, where an engineer gives the Build approval or asks for changes, a tester gives the
// Test approval or sends it back (for themselves or on someone's behalf), and a person merges it after both; the Test
// approvals (waiting on a tester, in Test, given). The pull requests and approvals are the lifecycle engine's; the test
// runs, coverage and defects are the seed story's sample until Phase 20 records them, and the pages say so.
// Data: GET /pull-requests, /pull-requests/:id, /test/approvals, /test/runs, /test/coverage, /test/defects;
// POST /pull-requests/:id/decision, /pull-requests/:id/merge.
import { h, page, ago, fmtDur } from '../lib.js';
import { pill, pageHead, tableWrap, empty, tile } from '../parts.js';

const SAMPLE = 'Phase 20 records test runs, coverage and defects from the line and the environments; until then these are sample data of the seed story.';
const RUN_TONE = { passed: 'teal', failed: 'danger', running: 'accent' };
const APPROVAL_TONE = { approved: 'teal', waiting: 'warn', 'changes-requested': 'danger', cleared: '', none: '' };
const TEST_TONE = { passing: 'teal', failing: 'danger', unproven: 'warn', missing: 'danger' };
const TEST_WORDS = { passing: 'Passing', failing: 'Failing', unproven: 'Present, not proven', missing: 'Missing' };
const enc = encodeURIComponent;
const STAGE = { build: 'Build', test: 'Test', release: 'Release', operate: 'Operate' };
const table = (label, heads, rows, emptyText) => tableWrap(label, {}, h('table', {},
  h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.length ? rows : h('tr.empty-row', {}, h('td', { colspan: heads.length }, emptyText)))));

async function pullRequestsView(p) {
  const { live, pullRequests } = await p.get('pull-requests');
  const head = pageHead('Pull requests', 'Each pull request the AI opens waits on an engineer\'s Build approval, then a tester\'s Test approval; then a person merges it. Open one to decide.');
  if (!live) return [head, empty('The lifecycle engine is not running here', 'The pull requests come from it.')];
  return [head,
    table('Pull requests', ['Pull request', 'Stage', 'Build approval', 'Test approval', 'Evidence'], pullRequests.map((r) => h('tr', {},
      h('td.title', {}, h('a', { href: r.href }, `${r.ref} · ${r.title}`), h('br'), h('span.muted', {}, r.story ? `${r.story.ref} · ${r.story.title}` : r.owner ? `Owner ${r.owner}` : '')),
      h('td', {}, r.status === 'completed' ? 'Merged' : STAGE[r.stage] ?? r.stage),
      h('td', {}, pill(r.build.text, APPROVAL_TONE[r.build.status] ?? '', 'plain')),
      h('td', {}, pill(r.test.text, APPROVAL_TONE[r.test.status] ?? '', 'plain')),
      h('td', {}, r.mergedEarly ? pill(r.mergedEarly, 'danger', 'plain') : r.evidence ?? (r.lastRun ? pill(`${r.lastRun.text} (sample)`, RUN_TONE[r.lastRun.status] ?? '', 'plain') : h('span.muted', {}, 'None yet'))))), 'No pull requests yet.'),
    h('p.note', {}, 'The approvals are live. A pull request from before Phase 16e shows its sample test run.')];
}

/** One approval's place: who decided it (and for whom), or whom it waits on. */
function reviewerText(a) {
  return a.reviewers.map((r) => (r.status === 'waiting' ? `waiting on ${r.name}` : `${r.byName ? `${r.byName} for ${r.name}` : r.name}: ${r.status === 'approved' ? 'approved' : r.status === 'changes-requested' ? 'asked for changes' : r.status}`)).join(' · ');
}

/** Approve, or ask for changes with a reason, for yourself or on someone's behalf. */
function decisionForm(p, d, kind, can) {
  const label = kind === 'build' ? 'Build approval' : 'Test approval';
  const reason = h('textarea', { rows: 2, maxlength: 2000, 'aria-label': `Why (${label})`, placeholder: kind === 'build' ? 'What needs to change' : 'Why it goes back to Build' });
  const override = h('input', { maxlength: 500, 'aria-label': `Override reason (${label})`, placeholder: 'Only if a readiness check fails: why it can go on' });
  const forSelect = can.for.length > 1 ? h('select', { 'aria-label': 'On behalf of' }, can.for.map((r) => h('option', { value: r.id }, r.name))) : null;
  const forId = () => (forSelect ? forSelect.value : can.for[0]?.id);
  const send = (decision) => p.act(() => p.post(`pull-requests/${enc(d.item.id)}/decision`, {
    approval: kind, decision, for: forId(), ...(decision === 'request-changes' ? { reason: reason.value.trim() } : {}),
    ...(override.value.trim() ? { override: { reason: override.value.trim() } } : {}),
  }));
  return h('section.card', { 'aria-label': `Decide the ${label}` },
    h('h2', {}, `Decide the ${label}`),
    can.mine ? null : h('p.note', {}, can.for.length === 1 ? `You decide on behalf of ${can.for[0].name}; the record says you gave it, for them.` : 'You decide on behalf of one of the people it waits on: pick whom.'),
    forSelect ? h('label', {}, 'On behalf of ', forSelect) : null,
    kind === 'test' ? h('label', {}, 'Override ', override) : null,
    h('label', {}, kind === 'build' ? 'Ask for changes: what needs to change ' : 'Send it back to Build: why ', reason),
    h('div.btns', {},
      h('button.primary', { onclick: send('approve') }, kind === 'build' ? 'Give the Build approval' : 'Give the Test approval'),
      h('button', { onclick: send('request-changes') }, kind === 'build' ? 'Ask for changes' : 'Send back to Build')));
}

async function pullRequestView(p) {
  const d = await p.get(`pull-requests/${enc(p.params.id)}`);
  const ev = d.pr?.evidence;
  const where = d.item.status === 'completed' ? `Merged${d.item.mergedBy ? ` by ${d.item.mergedBy}` : ''}` : `In ${STAGE[d.item.stage] ?? d.item.stage}`;
  const manual = ev?.manual ?? (d.run?.cases ?? []).filter((c) => c.automate === false);
  return [
    pageHead(`${d.item.ref} · ${d.item.title}`, `${where}${d.story ? ` · ${d.story.ref} · ${d.story.title}` : ''}. ${d.pr?.checking ? 'The Factory is checking a new commit.' : ev?.text ? `${ev.text}.` : ''}`,
      h('a.btn', { href: d.item.href }, 'Open in Lifecycle'), d.run ? h('a.btn', { href: d.run.href }, 'Its run') : null),
    d.item.mergedEarly ? empty('Merged in Bitbucket before its approvals', `${d.item.mergedEarly.by} merged it before ${d.item.mergedEarly.missing.join(' and ')}: it is not counted as done.`, 'error') : null,
    h('section.card', { 'aria-label': 'Evidence' },
      h('div.card-head', {}, h('h2', {}, 'Evidence'), pill(d.pr?.gates === 'passed' ? 'Checks passed' : d.pr?.gates === 'failed' ? 'Checks failed' : 'No checks ran', d.pr?.gates === 'passed' ? 'teal' : 'warn')),
      h('p.muted', {}, `Commit ${String(d.pr?.sha ?? '').slice(0, 7)} on ${d.pr?.head ?? ''} · ${d.pr?.repo ?? ''}`),
      ev ? table('Required tests', ['Test case', 'Level', 'What it proves', 'Found in', 'Result'], ev.cases.map((c) => h('tr', {},
        h('td.mono', {}, c.id), h('td', {}, c.level), h('td', {}, c.title), h('td.mono', {}, c.found.slice(0, 2).join(', ') || '—'),
        h('td', {}, pill(TEST_WORDS[c.status] ?? c.status, TEST_TONE[c.status] ?? '', 'plain')))), 'The test analysis asks the AI to automate nothing here.') : h('p.muted', {}, d.pr?.checking ? 'The Factory is checking the new commit: the evidence follows.' : 'No evidence recorded.'),
      manual.length ? h('div', {}, h('h3', {}, 'What a person checks'), h('ul', {}, manual.map((c) => h('li', {}, h('span.mono', {}, c.id), `: ${c.title}`)))) : null),
    h('section.card', { 'aria-label': 'Approvals' },
      h('h2', {}, 'Approvals'),
      d.given.length ? h('ul', {}, d.given.map((g) => h('li', {}, `${g.label} given by ${g.byName}${g.forName ? ` for ${g.forName}` : ''}`))) : h('p.muted', {}, 'None given for this commit yet.'),
      table('Approvals, newest first', ['Approval', 'Where it is', 'Who'], d.approvals.map((a) => h('tr', {},
        h('td', {}, a.label, a.sha ? h('span.muted', {}, ` · ${a.sha.slice(0, 7)}`) : null),
        h('td', {}, pill(a.status === 'cleared' ? 'Cleared by a new commit' : a.status === 'changes-requested' ? (a.type === 'test-approval' ? 'Sent back' : 'Changes asked for') : a.status === 'open' ? 'Waiting' : a.status === 'approved' ? 'Given' : 'Withdrawn', APPROVAL_TONE[a.status === 'open' ? 'waiting' : a.status] ?? '', 'plain'), a.reason ? h('div.muted', {}, a.reason) : null),
        h('td', {}, reviewerText(a)))), 'No approval yet.')),
    d.can.build ? decisionForm(p, d, 'build', d.can.build) : null,
    d.can.test ? decisionForm(p, d, 'test', d.can.test) : null,
    h('section.card', { 'aria-label': 'Merge' },
      h('h2', {}, 'Merge'), h('p', {}, d.mergeText),
      d.can.merge ? h('div.btns', {}, h('button.primary', { onclick: p.act(() => p.post(`pull-requests/${enc(d.item.id)}/merge`)) }, 'Merge')) : null),
  ];
}

async function approvalsView(p) {
  const { live, waiting, inTest, given } = await p.get('test/approvals');
  const head = pageHead('Test approvals', 'A tester verifies each pull request after its Build approval: the AI\'s test evidence against the test cases, and what the test analysis says a person checks. Then it may merge.');
  if (!live) return [head, empty('The lifecycle engine is not running here', 'The approvals come from it.')];
  return [head,
    h('section.card', { 'aria-label': 'Waiting on a tester' }, h('h2', {}, 'Waiting on a tester'),
      table('Waiting on a tester', ['Pull request', 'Waiting on', ''], waiting.map((a) => h('tr', {}, h('td.title', {}, `${a.ref} · ${a.title}`, a.body ? h('div.muted', {}, a.body) : null), h('td', {}, a.waitingOn.join(', ')), h('td.r', {}, h('a.btn', { href: a.href }, 'Decide')))), 'No Test approval is waiting.')),
    h('section.card', { 'aria-label': 'In Test' }, h('h2', {}, 'In Test'),
      table('In Test', ['Pull request', 'Where it is'], inTest.map((i) => h('tr', {}, h('td.title', {}, h('a', { href: i.href }, `${i.ref} · ${i.title}`)), h('td', {}, i.text))), 'Nothing is in Test.')),
    h('section.card', { 'aria-label': 'Given' }, h('h2', {}, 'Given'),
      table('Test approvals given', ['Pull request', 'Given by', 'When'], given.map((a) => h('tr', {}, h('td.title', {}, h('a', { href: a.href }, `${a.ref} · ${a.title}`)),
        h('td', {}, a.status === 'approved' ? `${a.decidedBy}${a.decidedFor ? ` for ${a.decidedFor}` : ''}` : a.status === 'changes-requested' ? `Sent back by ${a.decidedBy}${a.decidedFor ? ` for ${a.decidedFor}` : ''}${a.reason ? `: ${a.reason}` : ''}` : a.status === 'cleared' ? 'Cleared by a new commit' : `${a.status} · ${a.decidedBy ?? ''}`),
        h('td.muted', {}, ago(a.decidedAt)))), 'None given yet.'))];
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

const VIEWS = { 'pull-requests': pullRequestsView, 'pull-request': pullRequestView, approvals: approvalsView, runs: runsView, coverage: coverageView, defects: defectsView };
const pages = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, page(v)]));

export function render(view, args) {
  return pages[args.route?.meta?.view ?? 'approvals'](view, args);
}
