// A fake GitHub API for offline tests: the REST endpoints and the GraphQL mutations the
// factory uses, in memory, with the same response shapes (the fields the factory reads).
// It checks the bearer token, records every request, and can pretend to be rate limited.
import http from 'node:http';

export async function startFakeGitHub({ token = 'test-token', owner = 'acme', name = 'calc' } = {}) {
  const state = { issues: new Map(), comments: new Map(), pulls: [], statuses: [], graphql: [], merges: [], requests: [], rateLimited: 0 };
  let nextPr = 100;
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const prJson = (p) => ({ ...p, html_url: `https://github.com/${owner}/${name}/pull/${p.number}`, node_id: `PR_${p.number}` });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, base());
      const body = raw ? JSON.parse(raw) : undefined;
      state.requests.push({ method: req.method, path: url.pathname + url.search, body });
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(data === undefined ? '' : JSON.stringify(data));
      };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Bad credentials' });
      if (state.rateLimited > 0) {
        state.rateLimited--;
        return send(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 2) });
      }
      const p = url.pathname;
      const repo = `/repos/${owner}/${name}`;
      let m;
      if (req.method === 'GET' && p === `${repo}/issues`) {
        const label = url.searchParams.get('labels');
        return send(200, [...state.issues.values()].filter((i) => !label || i.labels.some((l) => l.name === label)));
      }
      if ((m = p.match(new RegExp(`^${repo}/issues/(\\d+)$`))) && req.method === 'GET') return state.issues.has(+m[1]) ? send(200, state.issues.get(+m[1])) : send(404, { message: 'Not Found' });
      if ((m = p.match(new RegExp(`^${repo}/issues/(\\d+)/comments$`)))) {
        const list = state.comments.get(+m[1]) ?? [];
        if (req.method === 'GET') return send(200, list);
        const c = { id: list.length + 1, body: body.body, user: { login: 'factory-bot' }, html_url: `https://github.com/${owner}/${name}/issues/${m[1]}#c${list.length + 1}` };
        state.comments.set(+m[1], [...list, c]);
        return send(201, c);
      }
      if (p === `${repo}/pulls` && req.method === 'GET') {
        const head = url.searchParams.get('head');
        const st = url.searchParams.get('state') ?? 'open';
        return send(200, state.pulls.filter((x) => (!head || `${owner}:${x.head.ref}` === head) && (st === 'all' || x.state === st)).map(prJson));
      }
      if (p === `${repo}/pulls` && req.method === 'POST') {
        if (state.pulls.some((x) => x.head.ref === body.head && x.state === 'open')) return send(422, { message: 'A pull request already exists' });
        const pr = { number: nextPr++, title: body.title, body: body.body, draft: Boolean(body.draft), state: 'open', head: { ref: body.head }, base: { ref: body.base }, merged_at: null };
        state.pulls.push(pr);
        return send(201, prJson(pr));
      }
      if ((m = p.match(new RegExp(`^${repo}/pulls/(\\d+)$`))) && req.method === 'PATCH') {
        const pr = state.pulls.find((x) => x.number === +m[1]);
        Object.assign(pr, { title: body.title ?? pr.title, body: body.body ?? pr.body });
        return send(200, prJson(pr));
      }
      if ((m = p.match(new RegExp(`^${repo}/pulls/(\\d+)/merge$`))) && req.method === 'PUT') {
        const pr = state.pulls.find((x) => x.number === +m[1]);
        Object.assign(pr, { state: 'closed', merged_at: new Date().toISOString(), merge_commit_sha: 'f'.repeat(40) });
        state.merges.push({ number: pr.number, ...body });
        return send(200, { merged: true, sha: pr.merge_commit_sha });
      }
      if ((m = p.match(new RegExp(`^${repo}/statuses/(\\w+)$`))) && req.method === 'POST') {
        state.statuses.push({ sha: m[1], ...body });
        return send(201, body);
      }
      if (p === '/graphql' && req.method === 'POST') {
        state.graphql.push(body);
        const pr = state.pulls.find((x) => `PR_${x.number}` === body.variables.id);
        if (!pr) return send(200, { errors: [{ message: 'Could not resolve to a node' }] });
        if (body.query.includes('markPullRequestReadyForReview')) pr.draft = false;
        if (body.query.includes('convertPullRequestToDraft')) pr.draft = true;
        return send(200, { data: { pr: { isDraft: pr.draft } } });
      }
      send(404, { message: `Not Found: ${req.method} ${p}` });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: base(),
    state,
    token,
    owner,
    name,
    /** Add an issue as GitHub would have it. */
    addIssue(number, title, body, labels = ['factory']) {
      const issue = { number, title, body, labels: labels.map((l) => ({ name: l })), html_url: `https://github.com/${owner}/${name}/issues/${number}`, user: { login: 'sam' } };
      state.issues.set(number, issue);
      return issue;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
