// Jira Cloud. Reading (Phase 11) goes through a reader from transport.js, which can only GET. Writing (Phase 13) is
// the three calls under `writes` at the end, through a writer from writer.js that can only send those kinds, with
// its own credential (JIRA_WRITE_API_TOKEN): the read token is never used to write. Only the write gate (writes.js)
// calls `writes`.
// A scoped Atlassian API token works at https://api.atlassian.com/ex/jira/<cloudId>, not at the site's own address;
// the cloud id is read once from the site's public tenant_info. A search is always inside the configured projects:
// callers give a filter, never JQL, and results outside those projects are dropped.
import { createReader, basicAuth, failure } from './transport.js';
import { createWriter } from './writer.js';

const API = 'https://api.atlassian.com';
const KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const ISSUE = /^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/;
const SEARCH_FIELDS = 'summary,issuetype,status,assignee,parent,project,labels,updated,priority';

/** A JQL string literal: quotes and backslashes escaped, control characters removed. */
const quote = (text) => `"${String(text).replace(/[\u0000-\u001f]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Plain text as an Atlassian Document (one paragraph per line; no markup is interpreted). */
export function documentOf(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, 2000));
  const content = lines.slice(0, 200).map((line) => ({ type: 'paragraph', content: line.trim() ? [{ type: 'text', text: line }] : [] }));
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] };
}

/** The site as an origin: "acme.atlassian.net" or a full URL → "https://acme.atlassian.net". */
function siteOrigin(site) {
  try {
    const url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} options
 * @param {string} [options.site]   JIRA_SITE
 * @param {string} [options.email]  JIRA_USERNAME (the Atlassian account email)
 * @param {string} [options.token]  JIRA_API_TOKEN
 * @param {() => string[] | Promise<string[]>} [options.projects]  the project keys NooblyJS may search
 */
export function createJira({ site, email, token, writeToken = '', projects = () => [], fetch } = {}) {
  const origin = site ? siteOrigin(site) : null;
  const configured = Boolean(origin && email && token);
  const api = configured ? createReader({ origin: API, authorization: basicAuth(email, token), fetch }) : null;
  // Writing has its own credential. Without it there is no writer, whatever the read token could do.
  const canWrite = Boolean(configured && writeToken);
  const writer = canWrite ? createWriter({ origin: API, authorization: basicAuth(email, writeToken), system: 'jira', fetch }) : null;
  let cloud = null; // the promise of the cloud id
  let fieldIds = null;

  const notConfigured = () => failure('not-configured', 'Set JIRA_SITE, JIRA_USERNAME and JIRA_API_TOKEN to read Jira.');

  async function cloudId() {
    cloud ??= createReader({ origin, fetch }).read('/_edge/tenant_info').then((r) => (r.ok && /^[0-9a-f-]{8,64}$/i.test(r.body?.cloudId ?? '') ? r.body.cloudId : null));
    const id = await cloud;
    if (!id) cloud = null; // try again next time
    return id;
  }

  /** GET a Jira REST path ("/rest/api/3/myself"). */
  async function read(path, query) {
    if (!configured) return notConfigured();
    const id = await cloudId();
    if (!id) return failure('unreachable', `The Jira site ${new URL(origin).host} did not say which cloud it is.`);
    return api.read(`/ex/jira/${id}${path}`, query);
  }

  /** Send one listed kind to this site's Jira. Only `writes` below calls it. */
  async function write(kind, path, body) {
    if (!writer) return failure('not-configured', 'Set JIRA_WRITE_API_TOKEN to let NooblyJS write to Jira.');
    const id = await cloudId();
    if (!id) return failure('unreachable', `The Jira site ${new URL(origin).host} did not say which cloud it is.`);
    return writer.write(kind, path, body, { prefix: `/ex/jira/${id}` });
  }

  const allowed = async () => [...new Set((await projects() ?? []).map((k) => String(k).toUpperCase()).filter((k) => KEY.test(k)))];
  const browseUrl = (key) => `${origin}/browse/${key}`;

  /** The custom field ids NooblyJS reads by name (they differ per site). */
  async function fields() {
    if (fieldIds) return fieldIds;
    const r = await read('/rest/api/3/field');
    if (!r.ok || !Array.isArray(r.body)) return {};
    const byName = (name) => r.body.find((f) => f.name === name)?.id ?? null;
    fieldIds = { sprint: byName('Sprint'), storyPoints: byName('Story Points') ?? byName('Story point estimate'), team: byName('Team') };
    return fieldIds;
  }

  function issueOf(raw, ids = {}) {
    const f = raw.fields ?? {};
    const sprints = Array.isArray(f[ids.sprint]) ? f[ids.sprint] : [];
    const sprint = sprints.find((s) => s.state === 'active') ?? sprints.at(-1) ?? null;
    return {
      key: raw.key,
      url: browseUrl(raw.key),
      project: f.project?.key ?? raw.key.split('-')[0],
      type: f.issuetype?.name ?? null,
      summary: f.summary ?? '',
      status: f.status?.name ?? null,
      statusCategory: f.status?.statusCategory?.key ?? null, // new | indeterminate | done
      assignee: f.assignee?.displayName ?? null,
      parent: f.parent?.key ?? null,
      labels: f.labels ?? [],
      priority: f.priority?.name ?? null,
      sprint: sprint ? { name: sprint.name, state: sprint.state } : null,
      storyPoints: typeof f[ids.storyPoints] === 'number' ? f[ids.storyPoints] : null,
      updated: f.updated ? new Date(f.updated).toISOString() : null,
    };
  }

  return {
    configured,
    canWrite,
    site: origin ? new URL(origin).host : null,

    /** The moves an issue can make now: [{ id, name, to, category }] (category: new | indeterminate | done). */
    async transitions(key) {
      const id = String(key ?? '').toUpperCase();
      if (!ISSUE.test(id)) return failure('not-found', `"${String(key).slice(0, 40)}" is not a Jira issue key.`);
      if (!(await allowed()).includes(id.split('-')[0])) return failure('not-found', `NooblyJS does not read the Jira project ${id.split('-')[0]}.`);
      const r = await read(`/rest/api/3/issue/${id}/transitions`);
      if (!r.ok) return r;
      return { ok: true, transitions: (r.body?.transitions ?? []).map((t) => ({ id: String(t.id), name: t.name, to: t.to?.name ?? null, category: t.to?.statusCategory?.key ?? null })) };
    },

    /**
     * The writes (Phase 13). Each resolves with { ok: true, result } or { ok: false, reason, message }. They are
     * called by the write gate only, which has already decided the write may be sent.
     */
    writes: {
      /** A new issue in a project NooblyJS is configured for: result { key, url }. */
      async createIssue({ project, type = 'Story', summary, description = '', labels = [] } = {}) {
        const key = String(project ?? '').toUpperCase();
        if (!KEY.test(key) || !(await allowed()).includes(key)) return failure('refused', `NooblyJS does not create issues in the Jira project ${String(project).slice(0, 20)}.`);
        const title = String(summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 250);
        if (!title) return failure('refused', 'An issue needs a summary.');
        const r = await write('jira.create-issue', '/rest/api/3/issue', {
          fields: {
            project: { key }, issuetype: { name: String(type).slice(0, 60) }, summary: title, description: documentOf(description),
            labels: labels.map((l) => String(l).replace(/\s+/g, '-').slice(0, 60)).filter(Boolean).slice(0, 10),
          },
        });
        if (!r.ok) return r;
        const made = String(r.body?.key ?? '');
        if (!ISSUE.test(made)) return failure('failed', 'Jira did not say which issue it made.');
        return { ok: true, result: { key: made, url: browseUrl(made) } };
      },
      /** Move an issue by one of its transitions' ids (from transitions()). */
      async transition({ key, transitionId } = {}) {
        const id = String(key ?? '').toUpperCase();
        if (!ISSUE.test(id) || !(await allowed()).includes(id.split('-')[0])) return failure('refused', 'NooblyJS does not move that issue.');
        if (!/^\d{1,9}$/.test(String(transitionId))) return failure('refused', 'That is not a transition.');
        const r = await write('jira.transition', `/rest/api/3/issue/${id}/transitions`, { transition: { id: String(transitionId) } });
        return r.ok ? { ok: true, result: { key: id, url: browseUrl(id) } } : r;
      },
      /** Phase 22: a fix version (a release's) in a project NooblyJS is configured for: result { id, name }. */
      async createVersion({ project, name, description = '', released = true } = {}) {
        const key = String(project ?? '').toUpperCase();
        if (!KEY.test(key) || !(await allowed()).includes(key)) return failure('refused', `NooblyJS does not make versions in the Jira project ${String(project).slice(0, 20)}.`);
        const title = String(name ?? '').trim().slice(0, 255);
        if (!title) return failure('refused', 'A version needs a name.');
        const r = await write('jira.fix-version', '/rest/api/3/version', { project: key, name: title, description: String(description).slice(0, 1000), released: released === true });
        return r.ok ? { ok: true, result: { id: r.body?.id ?? null, name: title } } : r;
      },
      /** A plain-text comment on an issue. */
      async comment({ key, text } = {}) {
        const id = String(key ?? '').toUpperCase();
        if (!ISSUE.test(id) || !(await allowed()).includes(id.split('-')[0])) return failure('refused', 'NooblyJS does not comment on that issue.');
        if (!String(text ?? '').trim()) return failure('refused', 'A comment needs text.');
        const r = await write('jira.comment', `/rest/api/3/issue/${id}/comment`, { body: documentOf(String(text).slice(0, 4000)) });
        return r.ok ? { ok: true, result: { key: id, url: browseUrl(id), commentId: r.body?.id ?? null } } : r;
      },
    },

    /** Who the token is, and whether it can see anything. */
    async account() {
      const r = await read('/rest/api/3/myself');
      return r.ok ? { ok: true, name: r.body.displayName, email: r.body.emailAddress ?? email, active: r.body.active !== false } : r;
    },

    /** What this account may do. NooblyJS only reads, but says so when the account could write. */
    async permissions() {
      const r = await read('/rest/api/3/mypermissions', { permissions: 'BROWSE_PROJECTS,CREATE_ISSUES,EDIT_ISSUES,TRANSITION_ISSUES,ADD_COMMENTS' });
      if (!r.ok) return r;
      const have = (k) => r.body?.permissions?.[k]?.havePermission === true;
      return { ok: true, canRead: have('BROWSE_PROJECTS'), canWrite: ['CREATE_ISSUES', 'EDIT_ISSUES', 'TRANSITION_ISSUES', 'ADD_COMMENTS'].some(have) };
    },

    /** Projects the account can see, for choosing which ones NooblyJS searches: [{ key, name }]. `q` narrows by name or key. */
    async projects({ q = '', limit = 50 } = {}) {
      const r = await read('/rest/api/3/project/search', { maxResults: Math.min(Math.max(Number(limit) || 50, 1), 100), orderBy: 'name', query: String(q).slice(0, 80) || undefined });
      return r.ok ? { ok: true, total: r.body.total ?? r.body.values.length, projects: (r.body.values ?? []).map((p) => ({ key: p.key, name: p.name })) } : r;
    },

    /** One project by key: { key, name }. */
    async project(key) {
      const id = String(key ?? '').toUpperCase();
      if (!KEY.test(id)) return failure('not-found', `"${String(key).slice(0, 40)}" is not a Jira project key.`);
      const r = await read(`/rest/api/3/project/${id}`);
      return r.ok ? { ok: true, project: { key: r.body.key, name: r.body.name, issueTypes: (r.body.issueTypes ?? []).map((t) => t.name) } } : r;
    },

    /** Whether boards and sprints are readable (the Jira Software scope). */
    async canReadSprints() {
      const r = await read('/rest/agile/1.0/board', { maxResults: 1 });
      return r.ok ? { ok: true } : r;
    },

    /**
     * Issues in the configured projects. `text` is searched in the summary and description; `types`, `project` and
     * `open` narrow it. Never takes JQL.
     */
    async search({ text = '', types = [], project = null, open = false, keys = [], limit = 20 } = {}) {
      if (!configured) return notConfigured();
      const all = await allowed();
      const within = project ? all.filter((k) => k === String(project).toUpperCase()) : all;
      if (!within.length) return failure('not-configured', project ? `NooblyJS does not search the Jira project ${project}.` : 'No Jira project is configured for NooblyJS to search.');
      const clauses = [`project in (${within.map(quote).join(', ')})`];
      const wanted = keys.map((k) => String(k).toUpperCase()).filter((k) => ISSUE.test(k));
      if (wanted.length) clauses.push(`key in (${wanted.map(quote).join(', ')})`);
      if (String(text).trim()) clauses.push(`text ~ ${quote(String(text).trim().slice(0, 200))}`);
      if (types.length) clauses.push(`issuetype in (${types.map(quote).join(', ')})`);
      if (open) clauses.push('statusCategory != Done');
      const ids = await fields();
      const r = await read('/rest/api/3/search/jql', {
        jql: `${clauses.join(' AND ')} ORDER BY updated DESC`,
        maxResults: Math.min(Math.max(Number(limit) || 20, 1), 100),
        fields: [SEARCH_FIELDS, ids.sprint, ids.storyPoints].filter(Boolean).join(','),
      });
      if (!r.ok) return r;
      // The second check: whatever came back, only issues of the projects we asked for leave this function.
      const issues = (r.body?.issues ?? []).map((i) => issueOf(i, ids)).filter((i) => within.includes(i.project));
      return { ok: true, issues, more: Boolean(r.body?.nextPageToken) };
    },

    /** One issue by key, when its project is one NooblyJS searches. */
    async issue(key) {
      const id = String(key ?? '').toUpperCase();
      if (!ISSUE.test(id)) return failure('not-found', `"${String(key).slice(0, 40)}" is not a Jira issue key.`);
      if (!configured) return notConfigured();
      if (!(await allowed()).includes(id.split('-')[0])) return failure('not-found', `NooblyJS does not read the Jira project ${id.split('-')[0]}.`);
      const ids = await fields();
      const r = await read(`/rest/api/3/issue/${id}`, { fields: [SEARCH_FIELDS, 'description,created,reporter', ids.sprint, ids.storyPoints].filter(Boolean).join(',') });
      if (!r.ok) return r;
      return { ok: true, issue: { ...issueOf(r.body, ids), reporter: r.body.fields?.reporter?.displayName ?? null, created: r.body.fields?.created ? new Date(r.body.fields.created).toISOString() : null } };
    },
  };
}
