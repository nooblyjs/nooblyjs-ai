// Build's Pull requests and the Test group (CHG-008; Phase 16e): each pull request with its Build and Test approvals and
// its evidence; a pull request's page, where an engineer gives the Build approval or asks for changes, a tester gives the
// Test approval or sends it back (for themselves or on someone's behalf), and a person merges it after both; the Test
// approvals (waiting on a tester, in Test, given). The pull requests and approvals are the lifecycle engine's. Since
// Phase 20 the test runs, coverage and defects are the Test section's (recorded from the line; defects are lifecycle
// items), with the seed story's sample after them, marked as such.
// Data: GET /pull-requests, /pull-requests/:id, /test/approvals, /test/runs, /test/coverage, /test/defects;
// POST /pull-requests/:id/decision, /pull-requests/:id/merge, /test/runs/:id/defects, /test/defects/:id/decision.
import { h, page, ago, fmtDur } from '../lib.js';
import { pill, pageHead, tableWrap, empty, tile } from '../parts.js';

const SAMPLE = 'The rows marked sample are the seed story\'s sample data (CHG-008); the others are recorded from the Factory\'s line (Phase 20). Environment runs join in Phase 21.';
const SEVERITY = { S1: 'S1 Critical', S2: 'S2 Major', S3: 'S3 Minor', S4: 'S4 Trivial' };
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
  const { runs, text, recorded } = await p.get('test/runs');
  return [pageHead('Test runs', `Each verify of a commit by the Factory's line (Build level), against the story's test cases and requirements; then the suites run in an environment. ${text}.`),
    table('Test runs', ['Run', 'Story and commit', 'Suite', 'Where', 'Result', 'Took', 'When'], runs.map((r) => h('tr', {},
      h('td.mono', {}, r.id),
      h('td.title', {}, r.storyId ? h('div', {}, r.storyId) : null, r.ref ?? 'All journeys', r.requirements?.length ? h('div.muted', {}, `For ${r.requirements.join(', ')}`) : null),
      h('td', {}, r.suite, r.failures?.length ? h('ul', {}, r.failures.map((f) => h('li.muted', {}, f))) : null, r.note ? h('div.muted', {}, r.note) : null,
        r.recorded && r.text ? h('div.muted', {}, r.text) : null,
        r.defects?.length ? h('div', {}, 'Defects: ', r.defects.map((id) => h('a.mono', { href: `/home/lifecycle/${enc(id)}` }, `${id} `))) : null,
        r.recorded && r.status !== 'passed' && r.storyId && p.can('draft') ? raiseForm(p, r) : null),
      h('td', {}, r.environment),
      h('td', {}, pill(r.status === 'running' ? `Running · ${r.passed} passed so far` : `${r.status === 'passed' ? 'Passed' : r.status === 'error' ? 'Could not run' : 'Failed'} · ${r.passed} passed, ${r.failed} failed${r.skipped ? `, ${r.skipped} skipped` : ''}`, RUN_TONE[r.status] ?? '', 'plain')),
      h('td.muted', {}, r.durationS ? fmtDur(r.durationS * 1000) : '—'),
      h('td.muted', {}, ago(r.at), r.sample ? ' · sample' : ''))), 'No test runs yet.'),
    recorded < runs.length ? h('p.note', {}, SAMPLE) : null];
}

/** Raise a defect from a failing run: what goes wrong (it defaults to the failing case) and how bad. */
function raiseForm(p, r) {
  const failing = r.cases?.find((c) => c.status === 'failing');
  const title = h('input', { type: 'text', placeholder: failing ? `${failing.id} fails: ${failing.title}` : 'What goes wrong', 'aria-label': 'What goes wrong' });
  const severity = h('select', { 'aria-label': 'Severity' }, Object.entries(SEVERITY).map(([k, v]) => h('option', { value: k, ...(k === 'S2' ? { selected: true } : {}) }, v)));
  return h('details', {}, h('summary', {}, 'Raise a defect'),
    h('div.btns', {}, title, severity, h('button.primary', { onclick: p.act(() => p.post(`test/runs/${enc(r.id)}/defects`, { title: title.value.trim() || undefined, severity: severity.value })) }, 'Raise')));
}

async function coverageView(p) {
  const { items = [], stories, pullRequests } = await p.get('test/coverage');
  const all = items.flatMap((i) => i.stories.flatMap((s) => s.rows));
  const passing = all.filter((r) => r.passing).length;
  return [pageHead('Coverage', 'Every acceptance criterion of an item, across its features and stories: with a ready test case, with an automated test, with a passing test (Build). Test runs in environments join in Phase 21.'),
    h('div.tiles', {},
      tile('Criteria with a passing test', `${passing} of ${all.length}`, `across ${items.length} ${items.length === 1 ? 'item' : 'items'} past Design`),
      tile('Criteria with a ready test case', `${all.filter((r) => r.ready).length} of ${all.length}`, `${all.filter((r) => r.changed).length} with a changed criterion`),
      tile('Criteria with an automated test', `${all.filter((r) => r.automated).length} of ${all.length}`, 'found in the latest run\'s commit')),
    ...items.map((i) => h('section.card', { 'aria-label': `${i.ref} coverage` },
      h('div.card-head', {}, h('h2', {}, `${i.ref} · ${i.title}`), pill(i.text, i.passing === i.criteria && i.criteria ? 'teal' : 'warn', 'plain')),
      h('p.muted', {}, i.detail),
      i.features.length ? table(`${i.ref} per feature`, ['Feature', 'Stories', 'Coverage'], i.features.map((f) => h('tr', {},
        h('td.title', {}, `${f.id} · ${f.title}`), h('td', {}, f.stories.join(', ')), h('td', {}, f.text, h('div.muted', {}, f.detail)))), '') : null,
      table(`${i.ref} per story`, ['Story', 'Criterion', 'Ready case', 'Automated', 'Passing (Build)'], i.stories.flatMap((st) => st.rows.map((row, k) => h('tr', {},
        h('td.title', {}, k === 0 ? h('a', { href: st.href }, `${st.id} · ${st.title}`) : '', k === 0 && st.latestRun ? h('div.muted', {}, `Latest run ${st.latestRun.id}: ${st.latestRun.text}`) : null),
        h('td', {}, h('span.mono', {}, row.ref), ` ${row.text}`, row.changed ? h('div', {}, pill('Criterion changed: its cases need a look', 'warn', 'plain')) : null),
        h('td', {}, yesNo(row.ready)), h('td', {}, yesNo(row.automated)), h('td', {}, yesNo(row.passing))))), 'No acceptance criteria yet.'))),
    h('section.card', { 'aria-label': 'Stories in Engineer' }, h('h2', {}, 'Test analysis in Engineer'),
      table('Coverage per story in Engineer', ['Story', 'Criteria', 'Test cases', ''], stories.map((s) => h('tr', {},
        h('td.title', {}, `${s.id} · ${s.title}`), h('td', {}, s.text, s.changedText ? h('div.muted', {}, s.changedText) : null), h('td', {}, `${s.cases} (${s.automated} automated)`), h('td.r', {}, h('a.btn', { href: s.href }, 'Test analysis')))), 'No story is in Engineer.')),
    pullRequests.length ? h('section.card', { 'aria-label': 'Sample pull requests' }, h('h2', {}, 'Sample pull requests'),
      table('Coverage per pull request (sample)', ['Pull request', 'Runs', 'Last run', 'Open defects'], pullRequests.map((r) => h('tr', {},
        h('td.title', {}, r.ref), h('td', {}, r.runs), h('td', {}, pill(`${r.last.suite}: ${r.last.status}`, RUN_TONE[r.last.status] ?? '', 'plain')), h('td', {}, r.openDefects ? pill(String(r.openDefects), 'danger', 'plain') : 'None'))), 'No runs yet.'), h('p.note', {}, SAMPLE)) : null];
}
const yesNo = (v) => pill(v ? 'Yes' : 'No', v ? 'teal' : 'warn', 'plain');

async function defectsView(p) {
  const { defects, text, recorded } = await p.get('test/defects');
  const SEV = { S1: 'danger', S2: 'warn', S3: '', S4: '' };
  const STATUS = { open: 'Open', fixed: 'Fixed, not yet closed', closed: 'Closed', rejected: 'Rejected' };
  return [pageHead('Defects', `Each defect with the story and requirement it breaks, and the run that found it. A passing run of its story marks it fixed; a person closes it. ${text}.`),
    table('Defects', ['Defect', 'Severity', 'Status', 'Story', 'Breaks', 'Found'], defects.map((d) => h('tr', {},
      h('td.title', {}, d.recorded ? h('a.mono', { href: d.href }, d.id) : h('span.mono', {}, d.id), ' ', d.title, d.sample ? h('div.muted', {}, 'sample') : null,
        (d.body || d.text) ? h('div.muted', {}, d.body || d.text) : null, d.recorded && p.can('draft') ? decideForm(p, d) : null),
      h('td', {}, pill(d.severityLabel ?? d.severity, SEV[d.severity] ?? '', 'plain')),
      h('td', {}, pill(STATUS[d.status] ?? d.status, d.status === 'open' ? 'danger' : 'teal', 'plain'), d.fixedBy ? h('div.muted', {}, `${d.fixedBy.testRunId} passes`) : null),
      h('td', {}, d.recorded ? d.storyId : d.ref ?? ''),
      h('td', {}, d.recorded ? d.breaksText : d.breaks ?? ''),
      h('td.muted', {}, d.recorded ? `${d.foundIn?.testRunId ?? 'by hand'} · ${ago(d.createdAt)}` : `${d.foundIn} · ${ago(d.foundAt)}`))), 'No defects recorded.'),
    recorded < defects.length ? h('p.note', {}, SAMPLE) : null];
}

/** A person's decision on a defect: close a fixed one; mark fixed, reject or reopen with a reason. */
function decideForm(p, d) {
  const choices = { open: [['fixed', 'Mark fixed'], ['reject', 'Not a defect']], fixed: [['close', 'Close'], ['reopen', 'Reopen'], ['reject', 'Not a defect']], closed: [['reopen', 'Reopen']], rejected: [] }[d.status] ?? [];
  if (!choices.length) return null;
  const reason = h('input', { type: 'text', placeholder: 'Why (needed to mark fixed, reject or reopen)', 'aria-label': `Why, for ${d.id}` });
  return h('div.btns', {}, reason, choices.map(([decision, label]) => h('button', { onclick: p.act(() => p.post(`test/defects/${enc(d.id)}/decision`, { decision, reason: reason.value.trim() })) }, label)));
}

const VIEWS = { 'pull-requests': pullRequestsView, 'pull-request': pullRequestView, approvals: approvalsView, runs: runsView, coverage: coverageView, defects: defectsView };
const pages = Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, page(v)]));

export function render(view, args) {
  return pages[args.route?.meta?.view ?? 'approvals'](view, args);
}
