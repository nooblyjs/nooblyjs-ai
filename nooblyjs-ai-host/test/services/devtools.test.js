// The Jira and Bitbucket connectors (src/services/devtools/, Phase 11): they can only read. Offline: `fetch` is a
// fake that records every request and answers with the shapes the real APIs give (no company content).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReader, basicAuth } from '../../src/services/devtools/transport.js';
import { createJira } from '../../src/services/devtools/jira.js';
import { createBitbucket } from '../../src/services/devtools/bitbucket.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'services', 'devtools');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers from `routes` ([[/regex/, (url) => Response]]) and keeps what it was asked. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (href, init = {}) => {
    calls.push({ href, ...init });
    const url = new URL(href);
    for (const [pattern, answer] of routes) if (pattern.test(url.pathname)) return answer(url);
    return json({ message: 'no such route in the test' }, 404);
  };
  return Object.assign(fn, { calls });
}

test('step 7: a reader can only GET its own origin; anything else is refused before a request leaves', async () => {
  const fetch = fakeFetch([[/.*/, () => json({ fine: true })]]);
  const reader = createReader({ origin: 'https://api.bitbucket.org', authorization: 'Basic abc', fetch });

  const ok = await reader.read('/2.0/repositories/ws', { pagelen: 1, q: undefined });
  assert.deepEqual([ok.ok, ok.body], [true, { fine: true }]);
  assert.deepEqual(Object.keys(reader).sort(), ['origin', 'read', 'readUrl'], 'there is no way to ask for another method');
  // Extra arguments are not a back door: the request is still a GET with no body.
  await reader.read('/2.0/repositories/ws/repo/pullrequests', {}, { method: 'POST', body: '{"title":"x"}' });
  for (const call of fetch.calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error', 'a redirect to another host is not followed');
    assert.equal(new URL(call.href).origin, 'https://api.bitbucket.org');
  }
  const sent = fetch.calls.length;

  for (const bad of ['https://evil.example/2.0/x', '//evil.example/x', 'relative', '/a/../../b', '/a b', '/a\\b', null, 42]) {
    const r = await reader.read(bad);
    assert.deepEqual([r.ok, r.reason], [false, 'refused'], `read(${JSON.stringify(bad)})`);
  }
  for (const bad of ['https://evil.example/2.0/repositories?page=2', 'https://user:pw@api.bitbucket.org/2.0/x', 'http://api.bitbucket.org/2.0/x', 'not a url']) {
    assert.equal((await reader.readUrl(bad)).reason, 'refused', bad);
  }
  assert.equal(fetch.calls.length, sent, 'none of the refused reads reached the network');
  assert.equal((await reader.readUrl('https://api.bitbucket.org/2.0/repositories/ws?page=2')).ok, true);
  assert.throws(() => createReader({ origin: 'http://api.bitbucket.org' }), /https/);
  assert.throws(() => createReader({ origin: 'https://api.bitbucket.org/2.0' }), /https/);
});

test('the devtools folder has two ways to the network and no more: a reader that can only GET, and a writer for the listed kinds', async () => {
  const files = (await fs.readdir(DIR)).filter((n) => n.endsWith('.js'));
  for (const name of ['transport.js', 'writer.js', 'writes.js', 'git-push.js', 'jira.js', 'bitbucket.js', 'sync.js']) assert.ok(files.includes(name), name);
  for (const name of files) {
    const source = (await fs.readFile(path.join(DIR, name), 'utf8')).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // Only the writer names a writing method, and no file names one that removes or patches.
    assert.doesNotMatch(source, /['"`](PATCH|DELETE)['"`]/, `${name} names a method NooblyJS never sends`);
    if (name !== 'writer.js') assert.doesNotMatch(source, /['"`](POST|PUT)['"`]/, `${name} names a writing method`);
    // One fetch in the reader, one in the writer, none anywhere else.
    const calls = source.match(/\bfetchFn\(|\bglobalThis\.fetch\(|(?<![.\w])fetch\(/g) ?? [];
    assert.equal(calls.length, ['transport.js', 'writer.js'].includes(name) ? 1 : 0, `${name} calls fetch ${calls.length} times`);
    // git is run in one file only; nothing else has another way out.
    assert.doesNotMatch(source, /node:https?|node:net|XMLHttpRequest|WebSocket|\bimport\(/, `${name} has another way out`);
    if (name !== 'git-push.js') assert.doesNotMatch(source, /node:child_process|execFile|spawn\(/, `${name} runs a program`);
    // Nothing merges, declines, deletes or forces, by any spelling.
    assert.doesNotMatch(source, /\/merge\b|\/decline\b|--force|--delete|--mirror|\+refs|:refs\/heads\/(main|master)\b/, `${name} can do more than NooblyJS may`);
  }
  const transport = await fs.readFile(path.join(DIR, 'transport.js'), 'utf8');
  assert.match(transport, /fetchFn\(url\.href, \{\s*method: 'GET',/);
  // The writer's method comes from its list of kinds, and every kind is a POST or a PUT to one shape of path.
  const { KINDS } = await import('../../src/services/devtools/writer.js');
  assert.deepEqual(Object.keys(KINDS).sort(), ['bitbucket.open-pr', 'bitbucket.push-branch', 'bitbucket.update-pr', 'jira.comment', 'jira.create-issue', 'jira.transition']);
  for (const [kind, k] of Object.entries(KINDS)) assert.ok(k.method === null ? kind === 'bitbucket.push-branch' : ['POST', 'PUT'].includes(k.method), kind);
  // The clients' write calls are reached from one place: the gate's performers in index.js.
  for (const name of files.filter((n) => !['index.js', 'jira.js', 'bitbucket.js'].includes(n))) {
    const source = await fs.readFile(path.join(DIR, name), 'utf8');
    assert.doesNotMatch(source, /\b(jira|bitbucket)\.writes\.|gitPush\.push\(/, `${name} calls a client's write without the gate`);
  }
});

test('what the other side says becomes a reason, never an exception', async () => {
  const answers = {
    '/401': json({ message: 'Unauthorized' }, 401),
    '/scope': json({ type: 'error', error: { message: 'Your credentials lack one or more required privilege scopes.', detail: { required: ['read:pullrequest:bitbucket'], granted: ['read:repository:bitbucket'] } } }, 403),
    '/jira-scope': json({ code: 401, message: 'Unauthorized; scope does not match' }, 401),
    '/404': json({ errorMessages: ['Issue does not exist'] }, 404),
    '/429': json({}, 429),
    '/500': new Response('<html>proxy</html>', { status: 502 }),
  };
  const fetch = async (href) => {
    const p = new URL(href).pathname;
    if (p === '/down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return answers[p].clone();
  };
  const reader = createReader({ origin: 'https://api.example.com', fetch });
  const reason = async (p) => { const r = await reader.read(p); return [r.ok, r.reason, r.scope ?? null]; };
  assert.deepEqual(await reason('/401'), [false, 'unauthorised', null]);
  assert.deepEqual(await reason('/scope'), [false, 'scope', 'read:pullrequest:bitbucket']);
  assert.deepEqual(await reason('/jira-scope'), [false, 'scope', null]);
  assert.deepEqual(await reason('/404'), [false, 'not-found', null]);
  assert.deepEqual(await reason('/429'), [false, 'rate-limited', null]);
  assert.deepEqual(await reason('/500'), [false, 'failed', null]);
  const down = await reader.read('/down');
  assert.deepEqual([down.reason, down.message], ['unreachable', 'api.example.com did not answer: ECONNREFUSED']);
});

// ---------- Jira ----------

const CLOUD = '11111111-2222-3333-4444-555555555555';
const jiraIssue = (key, over = {}) => ({
  key,
  fields: {
    summary: `Summary of ${key}`, issuetype: { name: 'Story' }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    assignee: { displayName: 'Sample Person' }, parent: { key: 'DCPB-1' }, project: { key: key.split('-')[0] }, labels: ['slots'], priority: { name: 'Medium' },
    updated: '2026-10-09T08:00:00.000+0200', customfield_10020: [{ name: 'Sprint 41', state: 'closed' }, { name: 'Sprint 42', state: 'active' }], customfield_10016: 5, ...over,
  },
});
function jiraFetch(extra = []) {
  return fakeFetch([
    ...extra,
    [/^\/_edge\/tenant_info$/, () => json({ cloudId: CLOUD })],
    [/\/rest\/api\/3\/myself$/, () => json({ displayName: 'Sample Owner', emailAddress: 'owner@example.com', active: true })],
    [/\/rest\/api\/3\/mypermissions$/, () => json({ permissions: { BROWSE_PROJECTS: { havePermission: true }, CREATE_ISSUES: { havePermission: true }, EDIT_ISSUES: { havePermission: false } } })],
    [/\/rest\/api\/3\/field$/, () => json([{ id: 'customfield_10020', name: 'Sprint' }, { id: 'customfield_10016', name: 'Story Points' }, { id: 'summary', name: 'Summary' }])],
    [/\/rest\/api\/3\/project\/search$/, () => json({ total: 2, values: [{ key: 'DCPB', name: 'DC - Last Mile Backend' }, { key: 'DCD', name: 'DC - Last Mile Driver' }] })],
    [/\/rest\/agile\/1\.0\/board$/, () => json({ code: 401, message: 'Unauthorized; scope does not match' }, 401)],
    // The search answers with an issue from another project too, as a wrong or widened query would.
    [/\/rest\/api\/3\/search\/jql$/, () => json({ issues: [jiraIssue('DCPB-12'), jiraIssue('SECRET-9'), jiraIssue('DCPB-14', { assignee: null, customfield_10020: null, customfield_10016: null })] })],
    [/\/rest\/api\/3\/issue\/DCPB-12$/, () => json({ ...jiraIssue('DCPB-12'), fields: { ...jiraIssue('DCPB-12').fields, reporter: { displayName: 'Sample Reporter' }, created: '2026-10-01T08:00:00.000+0200' } })],
  ]);
}
const jiraWith = (fetch, projects = ['DCPB']) => createJira({ site: 'example.atlassian.net', email: 'owner@example.com', token: 'tok', projects: () => projects, fetch });

test('Jira: the scoped token is used at api.atlassian.com with the site\'s cloud id, read once', async () => {
  const fetch = jiraFetch();
  const jira = jiraWith(fetch);
  assert.deepEqual([jira.configured, jira.site], [true, 'example.atlassian.net']);
  assert.deepEqual(await jira.account(), { ok: true, name: 'Sample Owner', email: 'owner@example.com', active: true });
  assert.deepEqual(await jira.permissions(), { ok: true, canRead: true, canWrite: true });
  assert.equal((await jira.canReadSprints()).reason, 'scope');
  assert.deepEqual((await jira.projects()).projects.map((p) => p.key), ['DCPB', 'DCD']);

  const hrefs = fetch.calls.map((c) => c.href);
  assert.equal(hrefs.filter((h) => h === 'https://example.atlassian.net/_edge/tenant_info').length, 1);
  assert.ok(hrefs.slice(1).every((h) => h.startsWith(`https://api.atlassian.com/ex/jira/${CLOUD}/rest/`)));
  // The token goes to Atlassian's API only: the tenant lookup on the site carries no credential.
  assert.equal(fetch.calls[0].headers.authorization, undefined);
  assert.equal(fetch.calls[1].headers.authorization, basicAuth('owner@example.com', 'tok'));
  assert.ok(fetch.calls.every((c) => c.method === 'GET' && c.body === undefined));
});

test('Jira: a search is always inside the configured projects, takes a filter and never JQL, and drops anything else that comes back', async () => {
  const fetch = jiraFetch();
  const jira = jiraWith(fetch, ['DCPB', 'dcd', 'not a key', 'DCPB']);
  const found = await jira.search({ text: 'slots" OR project = SECRET OR text ~ "x', types: ['Story', 'Defect'], open: true, limit: 500 });
  assert.equal(found.ok, true);
  assert.deepEqual(found.issues.map((i) => i.key), ['DCPB-12', 'DCPB-14'], 'the issue of another project is dropped');
  assert.deepEqual(found.issues[0], {
    key: 'DCPB-12', url: 'https://example.atlassian.net/browse/DCPB-12', project: 'DCPB', type: 'Story', summary: 'Summary of DCPB-12',
    status: 'In Progress', statusCategory: 'indeterminate', assignee: 'Sample Person', parent: 'DCPB-1', labels: ['slots'], priority: 'Medium',
    sprint: { name: 'Sprint 42', state: 'active' }, storyPoints: 5, updated: '2026-10-09T06:00:00.000Z',
  });
  assert.deepEqual([found.issues[1].assignee, found.issues[1].sprint, found.issues[1].storyPoints], [null, null, null]);

  const sent = new URL(fetch.calls.find((c) => c.href.includes('/search/jql')).href).searchParams;
  assert.equal(sent.get('jql'), 'project in ("DCPB", "DCD") AND text ~ "slots\\" OR project = SECRET OR text ~ \\"x" AND issuetype in ("Story", "Defect") AND statusCategory != Done ORDER BY updated DESC');
  assert.equal(sent.get('maxResults'), '100');
  assert.match(sent.get('fields'), /customfield_10020,customfield_10016$/);

  assert.equal((await jira.search({ project: 'SECRET' })).reason, 'not-configured');
  assert.equal((await jiraWith(jiraFetch(), []).search({ text: 'x' })).reason, 'not-configured');
});

test('Jira: one issue by key, only in a configured project', async () => {
  const fetch = jiraFetch();
  const jira = jiraWith(fetch);
  const { issue } = await jira.issue('dcpb-12');
  assert.deepEqual([issue.key, issue.reporter, issue.created, issue.sprint.name], ['DCPB-12', 'Sample Reporter', '2026-10-01T06:00:00.000Z', 'Sprint 42']);
  const before = fetch.calls.length;
  assert.equal((await jira.issue('SECRET-9')).reason, 'not-found');
  assert.equal((await jira.issue('DCPB-12/../../myself')).reason, 'not-found');
  assert.equal(fetch.calls.length, before, 'neither was asked of Jira');
});

test('Jira and Bitbucket say "not configured" without a credential, and call nothing', async () => {
  const fetch = fakeFetch([]);
  const jira = createJira({ site: 'example.atlassian.net', email: '', token: '', fetch });
  assert.equal(jira.configured, false);
  for (const r of [await jira.account(), await jira.search({ text: 'x' }), await jira.issue('DCPB-1'), await jira.projects()]) assert.equal(r.reason, 'not-configured');
  assert.equal(createJira({ site: 'http://example.atlassian.net', email: 'a@b.c', token: 't', fetch }).configured, false, 'a site that is not https is not used');
  const bitbucket = createBitbucket({ workspace: 'ws', email: 'a@b.c', token: '', fetch });
  for (const r of [await bitbucket.check(), await bitbucket.repositories(), await bitbucket.commits('repo')]) assert.equal(r.reason, 'not-configured');
  assert.equal(fetch.calls.length, 0);
});

// ---------- Bitbucket ----------

const bbRepo = (slug, project = 'DT') => ({
  slug, project: { key: project, name: 'Digital Technologies' }, mainbranch: { name: 'main' }, language: 'javascript', description: '', is_private: true,
  updated_on: '2026-10-09T10:00:00.000000+00:00',
});
const bbCommit = { hash: 'abc123def456', date: '2026-10-09T09:00:00+00:00', message: 'Steering updates\n\nlonger text', author: { raw: 'Sample Dev <dev@example.com>' } };
const scopeError = (scope) => json({ type: 'error', error: { message: 'Your credentials lack one or more required privilege scopes.', detail: { required: [scope], granted: ['read:repository:bitbucket'] } } }, 403);
function bbFetch() {
  return fakeFetch([
    [/^\/2\.0\/repositories\/ws$/, (url) => (url.searchParams.get('page') === '2'
      ? json({ pagelen: 100, values: [bbRepo('nooblyjs-core')] })
      : json({ pagelen: 100, values: [bbRepo('nooblyjs-ai-harness'), bbRepo('noobly')], next: 'https://api.bitbucket.org/2.0/repositories/ws?page=2' }))],
    [/^\/2\.0\/repositories\/ws\/nooblyjs-ai-harness$/, () => json(bbRepo('nooblyjs-ai-harness'))],
    [/\/refs\/branches$/, () => json({ values: [{ name: 'main', target: bbCommit }] })],
    [/\/commits(\/.*)?$/, () => json({ values: [bbCommit] })],
    [/\/pullrequests$/, () => scopeError('read:pullrequest:bitbucket')],
    [/\/pipelines$/, () => scopeError('read:pipeline:bitbucket')],
    [/\/src\/main\/package\.json$/, () => new Response('{\n  "name": "nooblyjs-learn-harness",\n  "values": []\n}\n', { status: 200 })],
    [/\/src\/main\/src$/, () => json({ pagelen: 10, values: [{ path: 'src/cli.js', type: 'commit_file', size: 120 }, { path: 'src/tools', type: 'commit_directory' }] })],
    [/\/src\/main\/logo\.png$/, () => new Response('\u0089PNG\u0000\u0000', { status: 200 })],
  ]);
}
const bitbucketWith = (fetch) => createBitbucket({ workspace: 'ws', email: 'owner@example.com', token: 'tok', fetch });

test('Bitbucket: repositories of a project (every page), one repository, its branches and commits', async () => {
  const fetch = bbFetch();
  const bitbucket = bitbucketWith(fetch);
  assert.deepEqual([bitbucket.configured, bitbucket.workspace], [true, 'ws']);
  const list = await bitbucket.repositories({ project: 'DT' });
  assert.deepEqual(list.repositories.map((r) => r.name), ['ws/nooblyjs-ai-harness', 'ws/noobly', 'ws/nooblyjs-core']);
  assert.equal(new URL(fetch.calls[0].href).searchParams.get('q'), 'project.key="DT"');
  assert.equal(fetch.calls[0].headers.authorization, basicAuth('owner@example.com', 'tok'));
  assert.equal((await bitbucket.repositories({ project: 'DT" OR 1=1' })).reason, 'not-found');

  assert.deepEqual((await bitbucket.repository('nooblyjs-ai-harness')).repository, {
    name: 'ws/nooblyjs-ai-harness', slug: 'nooblyjs-ai-harness', project: { key: 'DT', name: 'Digital Technologies' }, branch: 'main', language: 'javascript',
    description: '', private: true, updated: '2026-10-09T10:00:00.000Z', url: 'https://bitbucket.org/ws/nooblyjs-ai-harness',
  });
  const commit = { hash: 'abc123def456', at: '2026-10-09T09:00:00.000Z', message: 'Steering updates', author: 'Sample Dev' };
  assert.deepEqual((await bitbucket.branches('nooblyjs-ai-harness')).branches, [{ name: 'main', commit }]);
  assert.deepEqual((await bitbucket.commits('nooblyjs-ai-harness', { branch: 'feature/x' })).commits, [commit]);
  assert.match(fetch.calls.at(-1).href, /\/commits\/feature\/x\?pagelen=10$/);

  const before = fetch.calls.length;
  for (const bad of ['../other-workspace/repo', 'a/b', '', 'repo?x=1']) assert.equal((await bitbucket.repository(bad)).reason, 'not-found', bad);
  assert.equal(fetch.calls.length, before);
  assert.ok(fetch.calls.every((c) => c.method === 'GET' && new URL(c.href).origin === 'https://api.bitbucket.org'));
});

test('Bitbucket: what the token may not read is said, with the scope it needs', async () => {
  const bitbucket = bitbucketWith(bbFetch());
  const prs = await bitbucket.pullRequests('nooblyjs-ai-harness');
  assert.deepEqual([prs.ok, prs.reason, prs.scope], [false, 'scope', 'read:pullrequest:bitbucket']);
  const scopes = await bitbucket.scopes('nooblyjs-ai-harness');
  assert.deepEqual([scopes.pullRequests.scope, scopes.pipelines.scope], ['read:pullrequest:bitbucket', 'read:pipeline:bitbucket']);
});

test('Bitbucket: a text file, a folder listing, and no binary or path tricks', async () => {
  const fetch = bbFetch();
  const bitbucket = bitbucketWith(fetch);
  const file = await bitbucket.file('nooblyjs-ai-harness', 'package.json', { ref: 'main' });
  assert.deepEqual([file.kind, file.path, file.ref], ['file', 'package.json', 'main']);
  assert.match(file.text, /"name": "nooblyjs-learn-harness"/);
  const folder = await bitbucket.file('nooblyjs-ai-harness', 'src', { ref: 'main' });
  assert.deepEqual(folder.entries, [{ path: 'src/cli.js', type: 'file', size: 120 }, { path: 'src/tools', type: 'folder', size: null }]);
  assert.match((await bitbucket.file('nooblyjs-ai-harness', 'logo.png', { ref: 'main' })).message, /not a text file/);
  const before = fetch.calls.length;
  for (const [p, ref] of [['../../other/src/main/x', 'main'], ['a b.txt', 'main'], ['', 'main'], ['package.json', undefined], ['package.json', '../x y']]) {
    assert.equal((await bitbucket.file('nooblyjs-ai-harness', p, { ref })).reason, 'not-found', `${p} @ ${ref}`);
  }
  assert.equal(fetch.calls.length, before);
});
