// Bitbucket Cloud. Reading (Phase 11) goes through a reader from transport.js, which can only GET. Writing (Phase
// 13) is the two calls under `writes` at the end (open and update a pull request), through a writer from writer.js
// that can only send those kinds, with its own credential (BITBUCKET_WRITE_API_TOKEN). There is no call to merge,
// decline or delete. Only the write gate (writes.js) calls `writes`.
// A scoped API token is used with the Atlassian account email (a Bitbucket username is refused). What the token's
// scopes do not allow (pull requests, pipelines) comes back as { ok: false, reason: 'scope' }, and the callers say
// so instead of failing.
import { createReader, basicAuth, failure } from './transport.js';
import { createWriter } from './writer.js';

const ORIGIN = 'https://api.bitbucket.org';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const PROJECT = /^[A-Z][A-Z0-9_]{0,19}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;
const MAX_PAGES = 10;
const MAX_FILE_BYTES = 200_000;

/**
 * @param {object} options
 * @param {string} [options.workspace]  BITBUCKET_WORKSPACE
 * @param {string} [options.email]      the Atlassian account email
 * @param {string} [options.token]      BITBUCKET_API_TOKEN
 */
export function createBitbucket({ workspace, email, token, writeToken = '', fetch } = {}) {
  const configured = Boolean(workspace && SLUG.test(workspace) && email && token);
  const canWrite = Boolean(configured && writeToken);
  const writer = canWrite ? createWriter({ origin: ORIGIN, authorization: basicAuth(email, writeToken), system: 'bitbucket', fetch }) : null;
  const noWriter = () => failure('not-configured', 'Set BITBUCKET_WRITE_API_TOKEN to let NooblyJS open pull requests.');
  const reader = configured ? createReader({ origin: ORIGIN, authorization: basicAuth(email, token), fetch }) : null;
  const notConfigured = () => failure('not-configured', 'Set BITBUCKET_WORKSPACE, BITBUCKET_API_TOKEN and the Atlassian account email (BITBUCKET_EMAIL) to read Bitbucket.');
  const read = (path, query) => (configured ? reader.read(path, query) : Promise.resolve(notConfigured()));
  const repoPath = (slug) => `/2.0/repositories/${workspace}/${slug}`;
  const badSlug = (slug) => failure('not-found', `"${String(slug).slice(0, 60)}" is not a repository name.`);

  /** Every page of a list, up to MAX_PAGES. A "next" link is only followed on Bitbucket's own origin. */
  async function pages(path, query) {
    let r = await read(path, query);
    const values = [];
    for (let page = 1; r.ok; page++) {
      values.push(...(r.body?.values ?? []));
      if (!r.body?.next || page >= MAX_PAGES) return { ok: true, values, more: Boolean(r.body?.next) };
      r = await reader.readUrl(r.body.next);
    }
    return r;
  }

  const repositoryOf = (r) => ({
    name: `${workspace}/${r.slug}`,
    slug: r.slug,
    project: r.project ? { key: r.project.key, name: r.project.name } : null,
    branch: r.mainbranch?.name ?? null,
    language: r.language || null,
    description: r.description || '',
    private: r.is_private !== false,
    updated: r.updated_on ? new Date(r.updated_on).toISOString() : null,
    url: `https://bitbucket.org/${workspace}/${r.slug}`,
  });
  const commitOf = (c) => ({
    hash: c.hash,
    at: c.date ? new Date(c.date).toISOString() : null,
    message: String(c.message ?? '').split('\n')[0].slice(0, 200),
    author: c.author?.user?.display_name ?? String(c.author?.raw ?? '').replace(/\s*<.*>$/, '') ?? null,
  });

  /** A pull request as NooblyJS shows it. `mergedBy` and `author` carry the account's uuid, to tell a person from NooblyJS. */
  const pullRequestOf = (slug, p) => ({
    id: p.id,
    title: p.title ?? '',
    state: p.state ?? null, // OPEN | MERGED | DECLINED | SUPERSEDED
    draft: p.draft === true,
    source: p.source?.branch?.name ?? null,
    destination: p.destination?.branch?.name ?? null,
    head: p.source?.commit?.hash ?? null,
    author: p.author ? { name: p.author.display_name ?? null, uuid: p.author.uuid ?? null } : null,
    mergedBy: p.closed_by && p.state === 'MERGED' ? { name: p.closed_by.display_name ?? null, uuid: p.closed_by.uuid ?? null } : null,
    reviewers: (p.participants ?? p.reviewers ?? []).filter((r) => r.role === 'REVIEWER' || !r.role).map((r) => ({
      name: r.user?.display_name ?? r.display_name ?? null, uuid: r.user?.uuid ?? r.uuid ?? null,
      state: r.approved === true ? 'approved' : r.state === 'changes_requested' ? 'changes-requested' : 'waiting',
    })),
    updated: p.updated_on ? new Date(p.updated_on).toISOString() : null,
    url: p.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/pull-requests/${p.id}`,
  });

  return {
    configured,
    canWrite,
    workspace: configured ? workspace : null,

    /** The account the read token belongs to: { uuid, name }. A merge by this account is NooblyJS's own, not a person's. */
    async account() {
      const r = await read('/2.0/user');
      return r.ok ? { ok: true, uuid: r.body?.uuid ?? null, name: r.body?.display_name ?? null } : r;
    },

    /** One pull request: its state, who merged it, its reviewers and its head commit. */
    async pullRequest(slug, id) {
      if (!SLUG.test(String(slug)) || !/^\d{1,9}$/.test(String(id))) return badSlug(slug);
      const r = await read(`${repoPath(slug)}/pullrequests/${id}`);
      return r.ok ? { ok: true, pullRequest: pullRequestOf(slug, r.body) } : r;
    },

    /** The open pull request from a branch, if there is one. */
    async findPullRequest(slug, branch) {
      if (!SLUG.test(String(slug)) || !REF.test(String(branch))) return badSlug(slug);
      const r = await read(`${repoPath(slug)}/pullrequests`, { q: `source.branch.name = "${String(branch).replace(/["\\]/g, '')}" AND state = "OPEN"`, pagelen: 5 });
      if (!r.ok) return r;
      const found = (r.body?.values ?? []).find((p) => p.source?.branch?.name === branch) ?? null;
      return { ok: true, pullRequest: found ? pullRequestOf(slug, found) : null };
    },

    /** The build statuses on a pull request (Pipelines and anything else that reports): [{ name, state, url }]. */
    async statuses(slug, id) {
      if (!SLUG.test(String(slug)) || !/^\d{1,9}$/.test(String(id))) return badSlug(slug);
      const r = await pages(`${repoPath(slug)}/pullrequests/${id}/statuses`, { pagelen: 50 });
      if (!r.ok) return r;
      return { ok: true, statuses: r.values.map((s) => ({ name: s.name ?? s.key ?? 'build', state: String(s.state ?? '').toLowerCase(), url: s.url ?? null, at: s.updated_on ? new Date(s.updated_on).toISOString() : null })) };
    },

    /** The people Bitbucket adds to every pull request on this repository: [{ uuid, name }]. */
    async defaultReviewers(slug) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      const r = await pages(`${repoPath(slug)}/effective-default-reviewers`, { pagelen: 50 });
      if (!r.ok) return r;
      return { ok: true, reviewers: r.values.map((v) => v.user ?? v).filter((u) => u?.uuid).map((u) => ({ uuid: u.uuid, name: u.display_name ?? null })) };
    },

    /**
     * The writes (Phase 13), called by the write gate only. A pull request goes from a factory branch to the
     * repository's branch; there is no call that merges, declines or deletes one.
     */
    writes: {
      /** result { id, url } */
      async openPullRequest({ slug, title, description = '', source, destination, reviewers = [], draft = false } = {}) {
        if (!writer) return noWriter();
        if (!SLUG.test(String(slug)) || !REF.test(String(source)) || !REF.test(String(destination))) return failure('refused', 'A pull request needs a repository, a source branch and a destination branch.');
        const r = await writer.write('bitbucket.open-pr', `${repoPath(slug)}/pullrequests`, {
          title: String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 250) || source,
          description: String(description).slice(0, 30_000),
          source: { branch: { name: source } },
          destination: { branch: { name: destination } },
          reviewers: reviewers.filter((u) => /^\{[0-9a-fA-F-]{36}\}$/.test(String(u))).slice(0, 20).map((uuid) => ({ uuid })),
          close_source_branch: false,
          ...(draft ? { draft: true } : {}),
        });
        if (!r.ok) return r;
        if (!Number.isInteger(r.body?.id)) return failure('failed', 'Bitbucket did not say which pull request it made.');
        return { ok: true, result: { id: r.body.id, url: r.body.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/pull-requests/${r.body.id}` } };
      },
      /** Phase 22: a release's tag on a commit of the main branch: result { name, url }. */
      async createTag({ slug, name, sha } = {}) {
        if (!writer) return noWriter();
        if (!SLUG.test(String(slug)) || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(String(name)) || !/^[0-9a-f]{7,40}$/.test(String(sha))) return failure('refused', 'A tag needs a repository, a name and a commit.');
        const r = await writer.write('bitbucket.tag', `${repoPath(slug)}/refs/tags`, { name: String(name), target: { hash: String(sha) } });
        return r.ok ? { ok: true, result: { name: String(name), url: r.body?.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/src/${name}` } } : r;
      },
      /** The title and description of a pull request NooblyJS opened. */
      async updatePullRequest({ slug, id, title, description = '' } = {}) {
        if (!writer) return noWriter();
        if (!SLUG.test(String(slug)) || !/^\d{1,9}$/.test(String(id))) return failure('refused', 'That is not a pull request.');
        const r = await writer.write('bitbucket.update-pr', `${repoPath(slug)}/pullrequests/${id}`, {
          title: String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 250), description: String(description).slice(0, 30_000),
        });
        return r.ok ? { ok: true, result: { id: Number(id), url: r.body?.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/pull-requests/${id}` } } : r;
      },
    },

    /** Whether the token works, by reading one repository of the workspace. */
    async check() {
      const r = await read(`/2.0/repositories/${workspace}`, { pagelen: 1 });
      return r.ok ? { ok: true } : r;
    },

    /**
     * Whose token this is, or, when it may not read that, the scopes it was granted (Bitbucket lists them in the
     * refusal): { account } or { scopes: ['read:repository:bitbucket', …] }.
     */
    async token() {
      const r = await read('/2.0/user');
      if (r.ok) return { account: r.body?.display_name ?? null, scopes: null };
      return { account: null, scopes: r.granted ?? null };
    },

    /** What else the token may read: { pullRequests, pipelines }, each { ok } or the reason. Needs any repository. */
    async scopes(slug) {
      if (!SLUG.test(String(slug))) return { pullRequests: badSlug(slug), pipelines: badSlug(slug) };
      const [prs, pipes] = await Promise.all([read(`${repoPath(slug)}/pullrequests`, { pagelen: 1 }), read(`${repoPath(slug)}/pipelines`, { pagelen: 1 })]);
      const say = (r) => (r.ok ? { ok: true } : { ok: false, reason: r.reason, scope: r.scope ?? null, message: r.message });
      return { pullRequests: say(prs), pipelines: say(pipes) };
    },

    /** The repositories of a Bitbucket project (by key), or of the whole workspace, most recently updated first. */
    async repositories({ project = null } = {}) {
      if (project !== null && !PROJECT.test(String(project))) return failure('not-found', `"${String(project).slice(0, 40)}" is not a Bitbucket project key.`);
      const r = await pages(`/2.0/repositories/${workspace}`, { pagelen: 100, sort: '-updated_on', ...(project ? { q: `project.key="${project}"` } : {}) });
      return r.ok ? { ok: true, repositories: r.values.map(repositoryOf), more: r.more } : r;
    },

    async repository(slug) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      const r = await read(repoPath(slug));
      return r.ok ? { ok: true, repository: repositoryOf(r.body) } : r;
    },

    async branches(slug, { limit = 25 } = {}) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      const r = await read(`${repoPath(slug)}/refs/branches`, { pagelen: Math.min(Math.max(Number(limit) || 25, 1), 100), sort: '-target.date' });
      return r.ok ? { ok: true, branches: (r.body?.values ?? []).map((b) => ({ name: b.name, commit: b.target ? commitOf(b.target) : null })) } : r;
    },

    /** The latest commits, on a branch when given. */
    async commits(slug, { branch = null, limit = 10 } = {}) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      if (branch !== null && !REF.test(String(branch))) return failure('not-found', 'Not a branch name.');
      const r = await read(`${repoPath(slug)}/commits${branch ? `/${String(branch).split('/').map(encodeURIComponent).join('/')}` : ''}`, { pagelen: Math.min(Math.max(Number(limit) || 10, 1), 50) });
      return r.ok ? { ok: true, commits: (r.body?.values ?? []).map(commitOf) } : r;
    },

    /** Pull requests in a state (OPEN, MERGED, DECLINED). Needs read:pullrequest. */
    async pullRequests(slug, { state = 'OPEN', limit = 25 } = {}) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      const wanted = ['OPEN', 'MERGED', 'DECLINED'].includes(String(state).toUpperCase()) ? String(state).toUpperCase() : 'OPEN';
      const r = await read(`${repoPath(slug)}/pullrequests`, { state: wanted, pagelen: Math.min(Math.max(Number(limit) || 25, 1), 50) });
      if (!r.ok) return r;
      return {
        ok: true,
        total: r.body?.size ?? null,
        pullRequests: (r.body?.values ?? []).map((p) => ({
          id: p.id, title: p.title, state: p.state, author: p.author?.display_name ?? null,
          from: p.source?.branch?.name ?? null, to: p.destination?.branch?.name ?? null,
          updated: p.updated_on ? new Date(p.updated_on).toISOString() : null,
          url: p.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/pull-requests/${p.id}`,
        })),
      };
    },

    /** A text file at a commit or branch. Large and binary files are not returned. */
    async file(slug, filePath, { ref } = {}) {
      if (!SLUG.test(String(slug))) return badSlug(slug);
      const parts = String(filePath ?? '').split('/').filter(Boolean);
      if (!parts.length || parts.some((p) => p === '..' || p === '.' || /[\\\s]/.test(p)) || !REF.test(String(ref ?? ''))) return failure('not-found', 'A file is a path in the repository at a branch or commit.');
      const r = await read(`${repoPath(slug)}/src/${String(ref).split('/').map(encodeURIComponent).join('/')}/${parts.map(encodeURIComponent).join('/')}`);
      if (!r.ok) return r;
      // A folder answers with JSON (a listing); a file with its text.
      if (r.body && Array.isArray(r.body.values) && typeof r.body.pagelen === 'number') return { ok: true, kind: 'folder', entries: r.body.values.map((e) => ({ path: e.path, type: e.type === 'commit_directory' ? 'folder' : 'file', size: e.size ?? null })) };
      const text = r.text ?? '';
      if (text.length > MAX_FILE_BYTES) return failure('failed', `${parts.join('/')} is larger than NooblyJS reads (${MAX_FILE_BYTES / 1000} kB).`);
      if (text.includes('\u0000')) return failure('failed', `${parts.join('/')} is not a text file.`);
      return { ok: true, kind: 'file', path: parts.join('/'), ref: String(ref), text };
    },
  };
}
