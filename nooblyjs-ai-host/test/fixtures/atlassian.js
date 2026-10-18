// A fake Jira and Bitbucket for tests (Phase 13): a `fetch` that answers with the shapes the real APIs give and keeps
// every request, so a test can say exactly what would have left NooblyJS. Nothing here reaches a network, and the
// content is made up. Jira and Bitbucket are production systems: no test ever uses the real fetch for a write.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const CLOUD = '11111111-2222-3333-4444-555555555555';
export const NOOBLY_ACCOUNT = '{00000000-0000-4000-8000-00000000e09c}';
export const READ_TOKEN = 'read-token';
export const WRITE_TOKEN = 'write-token';
export const SETTINGS = Object.freeze({
  jira: { site: 'example.atlassian.net', email: 'noobly@example.com', token: READ_TOKEN, writeToken: WRITE_TOKEN },
  bitbucket: { workspace: 'examplews', email: 'noobly@example.com', token: READ_TOKEN, writeToken: WRITE_TOKEN },
});
const basic = (token) => `Basic ${Buffer.from(`noobly@example.com:${token}`).toString('base64')}`;

/**
 * @param {object} [seed]
 * @param {Record<string, object>} [seed.issues]   key → { summary, status, category }
 * @param {string[]} [seed.repositories]           repository slugs in the workspace
 */
export function fakeAtlassian({ issues = {}, repositories = ['web-storefront'] } = {}) {
  const state = {
    issues: new Map(Object.entries(issues).map(([key, i]) => [key, { summary: 'An issue', status: 'To Do', category: 'new', assignee: null, ...i }])),
    nextIssue: 500,
    pullRequests: new Map(), // `${slug}#${id}` → pr
    nextPr: 7,
    statuses: new Map(),     // `${slug}#${id}` → [{ name, state }]
    defaultReviewers: [{ uuid: '{aaaaaaaa-0000-4000-8000-000000000001}', display_name: 'Thabo Reviewer' }],
    readOnlyWriteToken: false, // a write token that turns out to have no write scope
  };
  const calls = [];
  const TRANSITIONS = [
    { id: '11', name: 'To Do', to: { name: 'To Do', statusCategory: { key: 'new' } } },
    { id: '21', name: 'Start', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
    { id: '31', name: 'Finish', to: { name: 'Done', statusCategory: { key: 'done' } } },
  ];
  const issueBody = (key) => {
    const i = state.issues.get(key);
    return {
      key, fields: {
        summary: i.summary, project: { key: key.split('-')[0] }, issuetype: { name: i.type ?? 'Story' },
        status: { name: i.status, statusCategory: { key: i.category } }, assignee: i.assignee ? { displayName: i.assignee } : null, labels: i.labels ?? [], updated: '2026-10-11T08:00:00.000Z',
      },
    };
  };
  const prBody = (slug, pr) => ({
    id: pr.id, title: pr.title, state: pr.state, draft: pr.draft === true,
    source: { branch: { name: pr.source }, commit: { hash: pr.head ?? 'abc123' } }, destination: { branch: { name: pr.destination } },
    author: { display_name: 'NooblyJS', uuid: NOOBLY_ACCOUNT },
    closed_by: pr.closedBy ?? null,
    participants: (pr.reviewers ?? []).map((r) => ({ role: 'REVIEWER', approved: r.approved === true, user: { display_name: r.name, uuid: r.uuid } })),
    links: { html: { href: `https://bitbucket.org/examplews/${slug}/pull-requests/${pr.id}` } }, updated_on: '2026-10-11T08:00:00.000Z',
  });

  async function fetch(href, init = {}) {
    const url = new URL(href);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ href, method, body, authorization: init.headers?.authorization ?? null, path: url.pathname });
    const p = url.pathname;
    const writing = method !== 'GET';
    if (writing && init.headers?.authorization !== basic(WRITE_TOKEN)) return json({ message: 'Unauthorized: this credential may not write' }, 401);
    if (writing && state.readOnlyWriteToken) return json({ error: { message: 'Your credentials lack one or more required privilege scopes.' } }, 403);

    // ---- Jira
    if (url.host === 'example.atlassian.net' && p === '/_edge/tenant_info') return json({ cloudId: CLOUD });
    const jira = p.startsWith(`/ex/jira/${CLOUD}`) ? p.slice(`/ex/jira/${CLOUD}`.length) : null;
    if (jira !== null) {
      if (jira === '/rest/api/3/field') return json([{ id: 'customfield_10020', name: 'Sprint' }]);
      if (jira === '/rest/api/3/myself') return json({ displayName: 'NooblyJS', emailAddress: 'noobly@example.com', active: true });
      if (jira === '/rest/api/3/mypermissions') return json({ permissions: { BROWSE_PROJECTS: { havePermission: true }, CREATE_ISSUES: { havePermission: true } } });
      if (jira === '/rest/agile/1.0/board') return json({ values: [] });
      if (/^\/rest\/api\/3\/project\/[A-Z]+$/.test(jira)) return json({ key: jira.split('/').pop(), name: 'TSS - Engineering', issueTypes: [{ name: 'Story' }, { name: 'Task' }] });
      if (jira === '/rest/api/3/search/jql') {
        const jql = url.searchParams.get('jql') ?? '';
        const wanted = /key in \(([^)]*)\)/.exec(jql)?.[1].split(',').map((k) => k.trim().replace(/"/g, '')) ?? [...state.issues.keys()];
        return json({ issues: wanted.filter((k) => state.issues.has(k)).map(issueBody) });
      }
      if (jira === '/rest/api/3/issue' && method === 'POST') {
        const key = `${body.fields.project.key}-${state.nextIssue++}`;
        state.issues.set(key, { summary: body.fields.summary, status: 'To Do', category: 'new', labels: body.fields.labels ?? [], type: body.fields.issuetype?.name });
        return json({ id: '9001', key, self: `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/issue/9001` }, 201);
      }
      const one = /^\/rest\/api\/3\/issue\/([A-Z]+-\d+)(\/transitions|\/comment)?$/.exec(jira);
      if (one && !state.issues.has(one[1])) return json({ errorMessages: ['Issue does not exist'] }, 404);
      if (one && !one[2] && method === 'GET') return json(issueBody(one[1]));
      if (one?.[2] === '/transitions' && method === 'GET') return json({ transitions: TRANSITIONS });
      if (one?.[2] === '/transitions' && method === 'POST') {
        const t = TRANSITIONS.find((x) => x.id === body.transition.id);
        if (!t) return json({ errorMessages: ['No such transition'] }, 400);
        Object.assign(state.issues.get(one[1]), { status: t.to.name, category: t.to.statusCategory.key });
        return new Response(null, { status: 204 });
      }
      if (one?.[2] === '/comment' && method === 'POST') {
        const issue = state.issues.get(one[1]);
        issue.comments = [...(issue.comments ?? []), body.body];
        return json({ id: '7001' }, 201);
      }
    }

    // ---- Bitbucket
    if (url.host === 'api.bitbucket.org') {
      if (p === '/2.0/user') return json({ uuid: NOOBLY_ACCOUNT, display_name: 'NooblyJS' });
      const repo = /^\/2\.0\/repositories\/examplews\/([\w.-]+)(\/.*)?$/.exec(p);
      if (repo && !repositories.includes(repo[1])) return json({ error: { message: 'Repository not found' } }, 404);
      if (repo) {
        const [, slug, rest = ''] = repo;
        if (rest === '') return json({ slug, mainbranch: { name: 'main' }, is_private: true, project: { key: 'WEB', name: 'Web' }, updated_on: '2026-10-11T08:00:00.000Z' });
        if (rest === '/commits' || rest.startsWith('/commits/')) return json({ values: [{ hash: 'abc1234', date: '2026-10-11T08:00:00.000Z', message: 'A commit', author: { raw: 'A Person <a@example.com>' } }] });
        if (rest === '/refs/branches') return json({ values: [{ name: 'main', target: { hash: 'abc1234' } }] });
        if (rest === '/effective-default-reviewers') return json({ values: state.defaultReviewers.map((user) => ({ user })) });
        if (rest === '/pullrequests' && method === 'GET') {
          const q = url.searchParams.get('q') ?? '';
          const branch = /source\.branch\.name = "([^"]+)"/.exec(q)?.[1] ?? null;
          const list = [...state.pullRequests.entries()].filter(([k, pr]) => k.startsWith(`${slug}#`) && pr.state === 'OPEN' && (!branch || pr.source === branch)).map(([, pr]) => prBody(slug, pr));
          return json({ values: list, size: list.length });
        }
        if (rest === '/pullrequests' && method === 'POST') {
          const id = state.nextPr++;
          const pr = { id, title: body.title, description: body.description, source: body.source.branch.name, destination: body.destination.branch.name, state: 'OPEN', draft: body.draft === true, reviewers: (body.reviewers ?? []).map((r) => ({ uuid: r.uuid, name: state.defaultReviewers.find((d) => d.uuid === r.uuid)?.display_name ?? 'A reviewer' })) };
          state.pullRequests.set(`${slug}#${id}`, pr);
          return json(prBody(slug, pr), 201);
        }
        const one = /^\/pullrequests\/(\d+)(\/statuses)?$/.exec(rest);
        const pr = one ? state.pullRequests.get(`${slug}#${one[1]}`) : null;
        if (one && !pr) return json({ error: { message: 'Not found' } }, 404);
        if (one && !one[2] && method === 'GET') return json(prBody(slug, pr));
        if (one && !one[2] && method === 'PUT') { Object.assign(pr, { title: body.title, description: body.description }); return json(prBody(slug, pr)); }
        if (one?.[2] && method === 'GET') return json({ values: state.statuses.get(`${slug}#${one[1]}`) ?? [] });
      }
    }
    return json({ message: `no such route in the fake: ${method} ${p}` }, 404);
  }

  return Object.assign(fetch, {
    calls,
    state,
    /** Every request that was not a GET: what NooblyJS actually wrote. */
    writes: () => calls.filter((c) => c.method !== 'GET'),
    /** A person moves an issue in Jira. */
    moveIssue(key, status, category) { Object.assign(state.issues.get(key), { status, category }); },
    /** Someone merges a pull request in Bitbucket. */
    merge(slug, id, by = { display_name: 'Thabo Reviewer', uuid: '{aaaaaaaa-0000-4000-8000-000000000001}' }) { Object.assign(state.pullRequests.get(`${slug}#${id}`), { state: 'MERGED', closedBy: by }); },
    setStatuses(slug, id, list) { state.statuses.set(`${slug}#${id}`, list); },
    approve(slug, id, uuid) { const r = state.pullRequests.get(`${slug}#${id}`).reviewers.find((x) => x.uuid === uuid); if (r) r.approved = true; },
  });
}
