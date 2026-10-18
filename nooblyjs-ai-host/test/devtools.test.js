// Phase 11 through the API: Jira and Bitbucket on Platform · Settings · Integrations, the repository list from
// Bitbucket, and Jira issues. Offline: the whole app runs with a fake `fetch` for the development tools, which
// records every request, so the test also proves NooblyJS only ever sent GET. Nothing here reaches Jira or Bitbucket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

const CLOUD = '11111111-2222-3333-4444-555555555555';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const scopeError = (required, granted) => json({ type: 'error', error: { message: 'Your credentials lack one or more required privilege scopes.', detail: { required: [required], granted } } }, 403);
const GRANTED = ['read:repository:bitbucket', 'read:pullrequest:bitbucket'];

const calls = [];
const state = { harnessCommit: 'First commit', harnessExists: true, issueStatus: 'In Progress' };
const repo = (slug, project = { key: 'DT', name: 'Digital Technologies' }) => ({
  slug, project, mainbranch: { name: 'main' }, language: 'javascript', description: `The ${slug} repository`, is_private: true, updated_on: '2026-10-09T10:00:00+00:00',
});
const issue = (key, over = {}) => ({
  key,
  fields: {
    summary: `Summary of ${key}`, issuetype: { name: 'Task' }, status: { name: state.issueStatus, statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Sample Engineer' }, project: { key: key.split('-')[0] }, labels: [], updated: '2026-10-09T08:00:00.000+0000', ...over,
  },
});
const ROUTES = [
  // Jira
  [/^\/_edge\/tenant_info$/, () => json({ cloudId: CLOUD })],
  [/\/rest\/api\/3\/myself$/, () => json({ code: 401, message: 'Unauthorized; scope does not match' }, 401)],
  [/\/rest\/api\/3\/mypermissions$/, () => json({ permissions: { BROWSE_PROJECTS: { havePermission: true }, EDIT_ISSUES: { havePermission: true } } })],
  [/\/rest\/agile\/1\.0\/board$/, () => json({ code: 401, message: 'Unauthorized; scope does not match' }, 401)],
  [/\/rest\/api\/3\/project\/DTE$/, () => json({ key: 'DTE', name: 'TSS - Engineering', issueTypes: [{ name: 'Story' }, { name: 'Task' }] })],
  [/\/rest\/api\/3\/project\/[A-Z]+$/, () => json({ errorMessages: ['No project could be found with that key.'] }, 404)],
  [/\/rest\/api\/3\/project\/search$/, () => json({ total: 1, values: [{ key: 'DTE', name: 'TSS - Engineering' }] })],
  [/\/rest\/api\/3\/field$/, () => json([{ id: 'customfield_10020', name: 'Sprint' }])],
  [/\/rest\/api\/3\/search\/jql$/, () => json({ issues: [issue('DTE-60'), issue('DTE-61', { assignee: null }), issue('OTHER-1')] })],
  [/\/rest\/api\/3\/issue\/DTE-6\d$/, (url) => json(issue(url.pathname.split('/').pop()))],
  // Bitbucket
  [/^\/2\.0\/user$/, () => scopeError('read:user:bitbucket', GRANTED)],
  [/^\/2\.0\/repositories\/acme$/, (url) => json({ pagelen: 100, values: url.searchParams.get('q') === 'project.key="STEC"' ? [repo('knowledge-repository-enterprise-standards', { key: 'STEC', name: 'STECH-Knowledge-Repository' })] : [repo('nooblyjs-ai-harness')] })],
  [/^\/2\.0\/repositories\/acme\/nooblyjs-ai-harness$/, () => (state.harnessExists ? json(repo('nooblyjs-ai-harness')) : json({ type: 'error', error: { message: 'Repository not found' } }, 404))],
  [/^\/2\.0\/repositories\/acme\/no-such-repo$/, () => json({ type: 'error', error: { message: 'Repository not found' } }, 404)],
  [/\/refs\/branches$/, () => json({ values: [{ name: 'main', target: { hash: 'abc123def4567890', date: '2026-10-09T09:00:00+00:00', message: state.harnessCommit, author: { raw: 'Sample Dev <dev@example.com>' } } }] })],
  [/\/commits$/, () => json({ values: [{ hash: 'abc123def4567890', date: '2026-10-09T09:00:00+00:00', message: state.harnessCommit, author: { raw: 'Sample Dev <dev@example.com>' } }] })],
  [/\/pullrequests$/, () => json({ size: 1, values: [{ id: 7, title: 'Slash command autocomplete', state: 'OPEN', author: { display_name: 'Sample Dev' }, source: { branch: { name: 'feature/slash' } }, destination: { branch: { name: 'main' } }, updated_on: '2026-10-09T09:30:00+00:00' }] })],
  [/\/pipelines$/, () => scopeError('read:pipeline:bitbucket', GRANTED)],
];
async function devtoolsFetch(href, init = {}) {
  calls.push({ href, method: init.method, body: init.body, authorization: init.headers?.authorization });
  const url = new URL(href);
  for (const [pattern, answer] of ROUTES) if (pattern.test(url.pathname)) return answer(url);
  return json({ message: `not in the test: ${url.pathname}` }, 404);
}

let env;
let stevie;
let priya;
before(async () => {
  env = await startApp({
    devtoolsFetch,
    // Teammates answers in chat (step 6); its replies are scripted and instant here.
    hostedApps: [{ package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }],
    env: { CHAT_MOCK_REPLY_MS: '0', JIRA_SITE: 'example.atlassian.net', JIRA_USERNAME: 'owner@example.com', JIRA_API_TOKEN: 'jira-secret-token', BITBUCKET_USERNAME: 'someuser', BITBUCKET_API_TOKEN: 'bitbucket-secret-token' },
  });
  [stevie, priya] = [env.client(), env.client()];
  await stevie.signIn('stevie');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

const send = (c, method, url, body = {}) => c.request(url, { method, json: body });

test('step 1: Integrations shows Jira and Bitbucket connected, read only, with what each token can and cannot read', async () => {
  const { body } = await priya.json('/api/v1/platform/settings');
  const [bitbucket, jira] = body.integrations;
  assert.deepEqual([bitbucket.label, bitbucket.state, bitbucket.stateText], ['Bitbucket', 'connected', 'Connected · read only']);
  assert.equal(bitbucket.detail, 'workspace acme; nooblyjs-ai-harness');
  assert.deepEqual(bitbucket.reads, ['repositories, branches, commits and files', 'pull requests']);
  assert.deepEqual(bitbucket.cannotRead, ['pipelines (needs read:pipeline:bitbucket)']);
  assert.deepEqual([bitbucket.scopes, bitbucket.warning], [GRANTED, null]);

  assert.deepEqual([jira.label, jira.state], ['Jira', 'connected']);
  assert.equal(jira.detail, 'example.atlassian.net; projects DTE (TSS - Engineering)');
  assert.deepEqual([jira.reads, jira.cannotRead], [['issues'], ['boards and sprints']]);
  assert.match(jira.warning, /NooblyJS never writes with it: writing has its own token and is off until an Owner switches it on/);

  // A token is never part of an answer.
  const text = JSON.stringify([body, (await priya.json('/api/v1/devtools/status')).body]);
  assert.ok(!/secret-token|Basic /.test(text));
  // The Bitbucket user is the Atlassian email (the Jira account) when BITBUCKET_USERNAME is not an email.
  const bb = calls.find((c) => c.href.startsWith('https://api.bitbucket.org'));
  assert.equal(Buffer.from(bb.authorization.replace('Basic ', ''), 'base64').toString(), 'owner@example.com:bitbucket-secret-token');
});

test('step 2: Repositories lists nooblyjs-ai-harness from Bitbucket with its branch and last commit; agent access stays NooblyJS\'s', async () => {
  assert.equal((await send(priya, 'POST', '/api/v1/platform/repositories/import')).status, 403);
  const first = await (await send(stevie, 'POST', '/api/v1/platform/repositories/import')).json();
  assert.deepEqual([first.added, first.updated, first.gone, first.missing], [['acme/nooblyjs-ai-harness'], [], [], []]);

  const { body } = await priya.json('/api/v1/platform/repositories');
  assert.equal(body.counts.all, 8, 'the seven samples stay');
  const harness = body.repositories.find((r) => r.shortName === 'nooblyjs-ai-harness');
  assert.deepEqual([harness.name, harness.source, harness.branch, harness.stack, harness.project, harness.url], ['acme/nooblyjs-ai-harness', 'bitbucket', 'main', 'javascript', 'DT', 'https://bitbucket.org/acme/nooblyjs-ai-harness']);
  assert.deepEqual([harness.lastCommit.hash, harness.lastCommit.message, harness.lastActivity], ['abc123def456', 'First commit', '2026-10-09 · Sample Dev']);
  assert.deepEqual([harness.access, harness.may.openPrs, harness.may.merge, harness.sampleData], ['read', false, false, false]);
  assert.equal(body.repositories.filter((r) => r.sampleData).length, 7);

  const detail = (await priya.json('/api/v1/platform/repositories/acme__nooblyjs-ai-harness')).body;
  assert.deepEqual([detail.live.ok, detail.live.branches[0].name, detail.live.commits[0].message], [true, 'main', 'First commit']);
  assert.deepEqual([detail.live.pullRequests.total, detail.live.pullRequests.list[0].title, detail.live.pullRequests.list[0].url], [1, 'Slash command autocomplete', 'https://bitbucket.org/acme/nooblyjs-ai-harness/pull-requests/7']);
  assert.equal((await priya.json('/api/v1/platform/repositories/acme__slots-api')).body.live, undefined, 'a sample repository asks Bitbucket nothing');

  // An Owner gives agents more; the next import refreshes what Bitbucket owns and keeps what NooblyJS owns.
  await send(stevie, 'PATCH', '/api/v1/platform/repositories/acme__nooblyjs-ai-harness', { access: 'read-prs' });
  state.harnessCommit = 'Slash commands: complete on /';
  const second = await (await send(stevie, 'POST', '/api/v1/platform/repositories/import')).json();
  assert.deepEqual([second.added, second.updated], [[], ['acme/nooblyjs-ai-harness']]);
  const after = (await priya.json('/api/v1/platform/repositories/acme__nooblyjs-ai-harness')).body.repository;
  assert.deepEqual([after.access, after.may.openPrs, after.lastCommit.message], ['read-prs', true, 'Slash commands: complete on /']);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'repo.imported' && a.actor === 'stevie')));
});

test('an Owner chooses what NooblyJS may see; a repository that leaves Bitbucket is marked gone, not deleted', async () => {
  assert.equal((await send(priya, 'PATCH', '/api/v1/devtools/config', { jira: { projects: ['DTE', 'SECRET'] } })).status, 403);
  assert.equal((await send(stevie, 'PATCH', '/api/v1/devtools/config', { bitbucket: { repositories: ['../other'] } })).status, 400);
  const changed = await (await send(stevie, 'PATCH', '/api/v1/devtools/config', { bitbucket: { projects: ['stec'], repositories: ['nooblyjs-ai-harness', 'no-such-repo'] } })).json();
  assert.deepEqual(changed.config, { bitbucket: { projects: ['STEC'], repositories: ['nooblyjs-ai-harness', 'no-such-repo'] }, jira: { projects: ['DTE'] } });
  assert.deepEqual(await env.store.readYaml(['config', 'devtools.yaml']), changed.config);

  const imported = await (await send(stevie, 'POST', '/api/v1/platform/repositories/import')).json();
  assert.deepEqual([imported.added, imported.missing], [['acme/knowledge-repository-enterprise-standards'], ['no-such-repo']]);

  state.harnessExists = false;
  await send(stevie, 'PATCH', '/api/v1/devtools/config', { bitbucket: { projects: [], repositories: ['nooblyjs-ai-harness'] } });
  const gone = await (await send(stevie, 'POST', '/api/v1/platform/repositories/import')).json();
  assert.deepEqual(gone.gone.sort(), ['acme/knowledge-repository-enterprise-standards', 'acme/nooblyjs-ai-harness']);
  const harness = (await priya.json('/api/v1/platform/repositories/acme__nooblyjs-ai-harness')).body;
  assert.deepEqual([harness.repository.gone, harness.repository.access, harness.live], [true, 'read-prs', undefined]);
  state.harnessExists = true;
  await send(stevie, 'POST', '/api/v1/platform/repositories/import');
  assert.equal((await priya.json('/api/v1/platform/repositories/acme__nooblyjs-ai-harness')).body.repository.gone, false);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'devtools.config_changed' && a.actor === 'stevie')));
});

test('Jira issues: searched inside the configured project only, read by key, and fresh on request', async () => {
  const found = (await priya.json('/api/v1/devtools/jira/issues?q=slash&open=1')).body;
  assert.deepEqual(found.issues.map((i) => [i.key, i.type, i.status, i.assignee]), [['DTE-60', 'Task', 'In Progress', 'Sample Engineer'], ['DTE-61', 'Task', 'In Progress', null]]);
  assert.equal(found.issues[0].url, 'https://example.atlassian.net/browse/DTE-60');
  const jql = new URL(calls.findLast((c) => c.href.includes('/search/jql')).href).searchParams.get('jql');
  assert.equal(jql, 'project in ("DTE") AND text ~ "slash" AND statusCategory != Done ORDER BY updated DESC');

  assert.equal((await priya.json('/api/v1/devtools/jira/issues/DTE-60')).body.issue.status, 'In Progress');
  // It changes in Jira: the cached answer stays for five minutes, a refresh asks again.
  state.issueStatus = 'Review';
  assert.equal((await priya.json('/api/v1/devtools/jira/issues/DTE-60')).body.issue.status, 'In Progress');
  assert.equal((await priya.json('/api/v1/devtools/jira/issues/DTE-60?fresh=1')).body.issue.status, 'Review');

  const other = await priya.json('/api/v1/devtools/jira/issues/OTHER-1');
  assert.deepEqual([other.status, other.body.error.code], [404, 'jira_not_found']);
  assert.equal((await priya.json('/api/v1/devtools/jira/issues?project=OTHER')).status, 503);
  assert.equal((await env.client().request('/api/v1/devtools/status')).status, 401);
});

test('step 5: a Jira issue is linked to an item; its status and assignee show, and change when they change in Jira; unlinking touches nothing in Jira', async () => {
  const naledi = env.client();
  await naledi.signIn('naledi-k');
  assert.equal((await send(naledi, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'DTE-60' })).status, 403, 'a Viewer may not link');
  assert.equal((await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'not a key' })).status, 400);
  assert.equal((await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'OTHER-1' })).status, 404, 'not in a project NooblyJS reads');
  assert.equal((await send(priya, 'POST', '/api/v1/devtools/links/..%2F..%2Fetc', { key: 'DTE-60' })).status, 400);

  state.issueStatus = 'In Progress';
  const linked = await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'dte-60' });
  const body = await linked.json();
  assert.deepEqual([linked.status, body.added, body.issues.map((i) => [i.key, i.status, i.assignee])], [201, true, [['DTE-60', 'In Progress', 'Sample Engineer']]]);
  assert.equal((await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'DTE-60' })).status, 200, 'linking twice keeps one link');
  assert.deepEqual(await env.store.readYaml(['devtools', 'links.yaml']).then((d) => d['PRD-031'].map((l) => [l.key, l.by])), [['DTE-60', 'priya-s']]);

  state.issueStatus = 'Done';
  assert.equal((await priya.json('/api/v1/devtools/links/PRD-031?fresh=1')).body.issues[0].status, 'Done');

  // A spec made from an idea is linked to the idea's issues (the Product Factory asks for this).
  assert.equal((await send(priya, 'POST', '/api/v1/devtools/links/IDEA-020', { key: 'DTE-61' })).status, 201);
  assert.deepEqual(await env.noobly.devtools.links.inherit('IDEA-020', 'PRD-099', { id: 'priya-s' }), { inherited: 1 });
  assert.deepEqual(await env.noobly.devtools.links.keys('PRD-099'), ['DTE-61']);

  const unlinked = await (await send(priya, 'DELETE', '/api/v1/devtools/links/PRD-031/DTE-60')).json();
  assert.deepEqual([unlinked.removed, unlinked.issues], [true, []]);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((a) => a.action === 'jira.issue_linked' && a.issue === 'DTE-60' && a.actor === 'priya-s'));
    assert.ok(audit.some((a) => a.action === 'jira.issue_unlinked' && a.issue === 'DTE-60'));
  });
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'jira.issue_linked' && e.payload.summary === 'linked DTE-60 · Summary of DTE-60 to PRD-031'));
});

test('step 6: asked in chat what is open in Jira, a teammate answers from the linked issues, cites them, and the read is audited', async () => {
  state.issueStatus = 'In Progress';
  await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'DTE-60' });
  await send(priya, 'POST', '/api/v1/devtools/links/PRD-031', { key: 'DTE-61' });
  const res = await send(priya, 'POST', '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Ada what is open in Jira for this item?' });
  assert.equal(res.status, 201);
  await env.noobly.chat.settled();
  const { messages } = (await priya.json('/api/v1/chat/thread?kind=item&id=PRD-031')).body;
  const reply = messages.at(-1);
  assert.equal(reply.author.id, 'ada-quill');
  assert.equal(reply.text, '2 of the 2 Jira issues linked to PRD-031 are open. I read them from Jira just now; NooblyJS only reads Jira.');
  assert.deepEqual(reply.cards[0].rows.map((r) => r.label), ['DTE-60', 'DTE-61']);
  assert.deepEqual(reply.citations.map((c) => [c.n, c.title, c.type]), [[1, 'DTE-60 · Summary of DTE-60', 'Jira issue'], [2, 'DTE-61 · Summary of DTE-61', 'Jira issue']]);
  await eventually(async () => {
    const read = (await today(env.store, 'audit')).find((a) => a.action === 'agent.devtools_read' && a.target === 'jira:PRD-031');
    assert.deepEqual([read.actor, read.itemId, read.issues, read.costUsd], ['ada-quill', 'PRD-031', ['DTE-60', 'DTE-61'], 0]);
  });

  // On the repository's thread, a question about the code reads Bitbucket, as Platform allows the agent to.
  await send(priya, 'POST', '/api/v1/chat/threads/thr_repo-acme__nooblyjs-ai-harness/messages', { text: '@Ada what was the last commit?' });
  await env.noobly.chat.settled();
  const repoThread = (await priya.json('/api/v1/chat/thread?kind=repo&id=acme__nooblyjs-ai-harness')).body.messages.at(-1);
  assert.match(repoThread.text, /Bitbucket acme\/nooblyjs-ai-harness: main branch main; 1 branch; last commit abc123d/);
  assert.equal(repoThread.citations[0].type, 'Repository');
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'agent.devtools_read' && a.target === 'bitbucket:acme/nooblyjs-ai-harness')));

  // A question about neither reads nothing.
  const before = calls.length;
  await send(priya, 'POST', '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Ada draft a rollout plan' });
  await env.noobly.chat.settled();
  assert.equal(calls.length, before);
});

test('step 7: in all of this NooblyJS only sent GET, with no body, to the Jira site (for its cloud id), api.atlassian.com and api.bitbucket.org', () => {
  assert.ok(calls.length > 20);
  for (const call of calls) {
    assert.equal(call.method, 'GET', call.href);
    assert.equal(call.body, undefined, call.href);
  }
  assert.deepEqual([...new Set(calls.map((c) => new URL(c.href).origin))].sort(), ['https://api.atlassian.com', 'https://api.bitbucket.org', 'https://example.atlassian.net']);
  // The site itself is only asked which cloud it is, and never given the token.
  const site = calls.filter((c) => c.href.startsWith('https://example.atlassian.net'));
  assert.ok(site.every((c) => c.href === 'https://example.atlassian.net/_edge/tenant_info' && c.authorization === undefined));
});
