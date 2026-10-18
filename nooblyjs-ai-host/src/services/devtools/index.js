// Development tools: what NooblyJS reads from Bitbucket and Jira (Phase 11) and what it writes to them (Phase 13), as
// host.service('devtools'). No hosted app holds a token or calls Atlassian itself; they ask here. Reading goes through
// transport.js, which can only GET. Every write goes through the write gate (writes.js): off until a deployment, an
// Owner and a write credential all allow it, and until then recorded in the outbox instead of sent.
//
// Which repositories and Jira projects NooblyJS may see is data/config/devtools.yaml (an Owner changes it in Platform ·
// Settings · Integrations). Credentials come from the environment and never leave this folder. Answers are kept in
// memory for five minutes, so a screen that shows the same issue to ten people asks Jira once.
import crypto from 'node:crypto';
import { HttpError } from '../../util/errors.js';
import { createJira } from './jira.js';
import { createBitbucket } from './bitbucket.js';
import { createGitPush, FACTORY_BRANCH, headOf } from './git-push.js';
import { createWrites, MODES, RULES } from './writes.js';
import { createSync } from './sync.js';
import { KINDS } from './writer.js';

const FILE = ['config', 'devtools.yaml'];
// Which Jira issues are linked to what in NooblyJS: an item (PRD-031), an idea (IDEA-020) or a work item
// (WI-PRD-031-1). NooblyJS points at Jira; nothing is stored in Jira. { <target>: [{ key, by, at }] }
const LINKS = ['devtools', 'links.yaml'];
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,19}-\d{1,9}$/;
const CACHE_MS = 5 * 60_000;
const JIRA_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const BB_PROJECT = /^[A-Z][A-Z0-9_]{0,19}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// The first slice (roadmap Phase 11): NooblyJS's own harness repository and the TSS - Engineering Jira project.
const DEFAULTS = { bitbucket: { projects: [], repositories: ['nooblyjs-ai-harness'] }, jira: { projects: ['DTE'] } };

const unique = (list) => [...new Set(list)];
const why = (r) => ({ ok: false, reason: r.reason, message: r.message, ...(r.scope ? { scope: r.scope } : {}) });

/**
 * @param {object} deps
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} deps.store
 * @param {object} deps.settings  config.devtools: { jira: { site, email, token }, bitbucket: { workspace, email, token } }
 * @param {typeof fetch} [deps.fetch]  replaced in tests
 */
export function createDevtools({ store, settings = {}, fetch, clock = Date, log, services = null, auditLog = null, events = null, publicBaseUrl = '', gitRemote = null }) {
  const cache = new Map();

  /** How writes are set (Phase 13). Anything the file does not say is the safe value: record only, automatic. */
  function writeSettings(file) {
    const w = file?.writes ?? {};
    const modes = {};
    for (const system of ['jira', 'bitbucket']) modes[system] = MODES.includes(w.modes?.[system]) ? w.modes[system] : 'record';
    const rules = {};
    for (const kind of Object.keys(KINDS)) rules[kind] = RULES.includes(w.rules?.[kind]) ? w.rules[kind] : 'automatic';
    const issueType = typeof w.issueType === 'string' && /^[\w .-]{1,40}$/.test(w.issueType) ? w.issueType : 'Story';
    return { modes, rules, issueType };
  }

  async function config() {
    const file = (await store.readYaml(FILE)) ?? {};
    return {
      writes: writeSettings(file),
      bitbucket: {
        projects: unique((file.bitbucket?.projects ?? DEFAULTS.bitbucket.projects).map(String).filter((k) => BB_PROJECT.test(k))),
        repositories: unique((file.bitbucket?.repositories ?? DEFAULTS.bitbucket.repositories).map(String).filter((s) => SLUG.test(s))),
      },
      jira: { projects: unique((file.jira?.projects ?? DEFAULTS.jira.projects).map((k) => String(k).toUpperCase()).filter((k) => JIRA_KEY.test(k))) },
    };
  }

  const jira = createJira({ ...settings.jira, fetch, projects: async () => (await config()).jira.projects });
  const bitbucket = createBitbucket({ ...settings.bitbucket, fetch });
  const gitPush = createGitPush({ workspace: settings.bitbucket?.workspace, token: settings.bitbucket?.writeToken, remote: gitRemote });

  /** `load()`'s answer, kept for five minutes when it succeeded. `fresh` asks again. */
  async function cached(key, load, { fresh = false } = {}) {
    const hit = cache.get(key);
    if (!fresh && hit && clock.now() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    if (value?.ok !== false) cache.set(key, { at: clock.now(), value });
    return value;
  }

  /** Changes which projects and repositories NooblyJS may see. Lists replace the old ones; unknown shapes are refused. */
  async function setConfig(patch = {}) {
    const current = await config();
    const list = (value, pattern, what, upper = false) => {
      if (value === undefined) return null;
      if (!Array.isArray(value) || value.length > 200) throw new HttpError(400, 'invalid_devtools_config', `${what} is a list of up to 200 names.`);
      const names = value.map((v) => (upper ? String(v).trim().toUpperCase() : String(v).trim())).filter(Boolean);
      const bad = names.find((n) => !pattern.test(n));
      if (bad) throw new HttpError(400, 'invalid_devtools_config', `"${bad.slice(0, 40)}" is not a valid name for ${what}.`);
      return unique(names);
    };
    const next = {
      bitbucket: {
        projects: list(patch.bitbucket?.projects, BB_PROJECT, 'Bitbucket projects', true) ?? current.bitbucket.projects,
        repositories: list(patch.bitbucket?.repositories, SLUG, 'Bitbucket repositories') ?? current.bitbucket.repositories,
      },
      jira: { projects: list(patch.jira?.projects, JIRA_KEY, 'Jira projects', true) ?? current.jira.projects },
    };
    // The write settings live in the same file and are changed only through the write gate.
    await store.withLock(FILE, async () => {
      const kept = ((await store.readYaml(FILE)) ?? {}).writes;
      await store.writeYaml(FILE, kept ? { ...next, writes: kept } : next);
    });
    cache.clear();
    return { before: { bitbucket: current.bitbucket, jira: current.jira }, after: next };
  }

  /** What each tool is connected as and what its token can read, for Platform · Settings · Integrations. */
  function status(options) {
    return cached('status', async () => {
      const cfg = await config();
      const [jiraPart, bitbucketPart] = await Promise.all([jiraStatus(cfg), bitbucketStatus(cfg)]);
      return { checkedAt: new Date(clock.now()).toISOString(), jira: jiraPart, bitbucket: bitbucketPart };
    }, options);
  }

  async function jiraStatus(cfg) {
    const base = { label: 'Jira', site: jira.site, projects: cfg.jira.projects.map((key) => ({ key })) };
    if (!jira.configured) return { ...base, connected: false, reason: 'not-configured', text: 'Not connected: set JIRA_SITE, JIRA_USERNAME and JIRA_API_TOKEN.' };
    const [account, permissions, sprints, ...projects] = await Promise.all([
      jira.account(), jira.permissions(), jira.canReadSprints(), ...cfg.jira.projects.map((key) => jira.project(key)),
    ]);
    // The account's own name needs a scope a read-only token may not have; issues are what matters.
    const first = projects.find((p) => !p.ok) ?? permissions;
    if (!permissions.ok && !projects.some((p) => p.ok)) return { ...base, connected: false, reason: first.reason, text: `Not connected: ${first.message}` };
    return {
      ...base,
      connected: true,
      account: account.ok ? account.name : null,
      projects: cfg.jira.projects.map((key, i) => (projects[i].ok ? { key, name: projects[i].project.name, readable: true } : { key, readable: false, why: projects[i].message })),
      reads: { issues: { ok: true }, sprints: sprints.ok ? { ok: true } : why(sprints) },
      // What the account may do in Jira. NooblyJS has no code that writes, whatever this says.
      accountMayWrite: permissions.ok ? permissions.canWrite : null,
      text: `Connected to ${jira.site}`,
    };
  }

  async function bitbucketStatus(cfg) {
    const base = { label: 'Bitbucket', workspace: settings.bitbucket?.workspace ?? null, projects: cfg.bitbucket.projects, repositories: cfg.bitbucket.repositories };
    if (!bitbucket.configured) return { ...base, connected: false, reason: 'not-configured', text: 'Not connected: set BITBUCKET_API_TOKEN and the Atlassian account email (BITBUCKET_EMAIL).' };
    const check = await bitbucket.check();
    if (!check.ok) return { ...base, connected: false, reason: check.reason, text: `Not connected: ${check.message}` };
    const probe = cfg.bitbucket.repositories[0] ?? null;
    const [token, scopes] = await Promise.all([bitbucket.token(), probe ? bitbucket.scopes(probe) : null]);
    return {
      ...base,
      connected: true,
      account: token.account ?? null,
      scopes: token.scopes ?? null,
      reads: { repositories: { ok: true }, pullRequests: scopes?.pullRequests ?? null, pipelines: scopes?.pipelines ?? null },
      tokenCanWrite: token.scopes ? token.scopes.some((s) => /^(write|admin|delete):/.test(s)) : null,
      text: `Connected to the workspace ${base.workspace}`,
    };
  }

  /**
   * The Bitbucket repositories NooblyJS is configured to see: the named ones and those of the configured projects, each
   * with its last commit. Used by Platform's import. Resolves { ok, repositories, missing } or the reason.
   */
  async function repositories(options) {
    return cached('repositories', async () => {
      if (!bitbucket.configured) return { ok: false, reason: 'not-configured', message: 'Bitbucket is not connected.' };
      const cfg = await config();
      const found = new Map();
      const missing = [];
      for (const project of cfg.bitbucket.projects) {
        const r = await bitbucket.repositories({ project });
        if (!r.ok) return why(r);
        for (const repo of r.repositories) found.set(repo.slug, repo);
      }
      for (const slug of cfg.bitbucket.repositories) {
        if (found.has(slug)) continue;
        const r = await bitbucket.repository(slug);
        if (r.ok) found.set(slug, r.repository);
        else if (r.reason === 'not-found') missing.push(slug);
        else return why(r);
      }
      const list = await Promise.all([...found.values()].map(async (repo) => {
        const commits = await bitbucket.commits(repo.slug, { limit: 1 });
        return { ...repo, lastCommit: commits.ok ? commits.commits[0] ?? null : null };
      }));
      return { ok: true, workspace: bitbucket.workspace, repositories: list.sort((a, b) => a.name.localeCompare(b.name)), missing };
    }, options);
  }

  /** One repository's live detail for its panel: branches, latest commits, open pull requests (when readable). */
  function repository(slug, options) {
    return cached(`repository:${slug}`, async () => {
      const repo = await bitbucket.repository(slug);
      if (!repo.ok) return why(repo);
      const [branches, commits, pullRequests] = await Promise.all([bitbucket.branches(slug, { limit: 10 }), bitbucket.commits(slug, { limit: 5 }), bitbucket.pullRequests(slug, { state: 'OPEN' })]);
      return {
        ok: true,
        repository: repo.repository,
        branches: branches.ok ? branches.branches : [],
        commits: commits.ok ? commits.commits : [],
        pullRequests: pullRequests.ok ? { ok: true, total: pullRequests.total ?? pullRequests.pullRequests.length, list: pullRequests.pullRequests } : why(pullRequests),
      };
    }, options);
  }

  /** True when the repository (its short name) is one NooblyJS is configured to see. */
  async function sees(slug) {
    const list = await repositories();
    return list.ok && list.repositories.some((r) => r.slug === slug);
  }

  // ---------- links: Jira issues linked to NooblyJS's items ----------

  const linksOf = async () => (await store.readYaml(LINKS)) ?? {};
  /** Read-modify-write of the links file under its lock, so two people linking at once both land. */
  const updateLinks = (fn) => store.withLock(LINKS, async () => store.writeYaml(LINKS, fn(await linksOf())));
  const checkTarget = (target) => {
    if (!TARGET.test(String(target ?? ''))) throw new HttpError(400, 'invalid_target', `"${String(target).slice(0, 40)}" is not an item, idea or work item id.`);
    return String(target);
  };

  /** The issues linked to a target, live from Jira: [{ key, … }], or { key, unreadable: reason } for one Jira did not give. */
  async function linked(target, options) {
    const keys = ((await linksOf())[checkTarget(target)] ?? []).map((l) => l.key);
    if (!keys.length) return { ok: true, target, issues: [] };
    const r = await api.jira.issues(keys, options);
    if (!r.ok) return { ok: true, target, issues: keys.map((key) => ({ key, unreadable: r.message })), jira: { ok: false, reason: r.reason, message: r.message } };
    const by = new Map(r.issues.map((i) => [i.key, i]));
    return { ok: true, target, issues: keys.map((key) => by.get(key) ?? { key, unreadable: 'Jira did not return it (moved, deleted, or in a project NooblyJS does not read).' }) };
  }

  /** Links an issue to a target. The issue must be readable in a project NooblyJS reads. Returns { added, issue }. */
  async function link(target, key, actor) {
    const t = checkTarget(target);
    const id = String(key ?? '').trim().toUpperCase();
    if (!ISSUE_KEY.test(id)) throw new HttpError(400, 'invalid_issue', `"${String(key).slice(0, 30)}" is not a Jira issue key, like DTE-60.`);
    const found = await api.jira.issue(id, { fresh: true });
    if (!found.ok) {
      // Not connected, or this issue is not one NooblyJS may read, is the person's to fix, not a failure of NooblyJS's.
      const status = { 'not-found': 404, 'not-configured': 409, scope: 403, 'rate-limited': 429 }[found.reason] ?? 502;
      throw new HttpError(status, `jira_${found.reason.replace(/-/g, '_')}`, found.reason === 'not-configured' ? `Jira is not connected. ${found.message}` : found.message);
    }
    let added = false;
    await updateLinks((doc) => {
      const next = { ...(doc ?? {}) };
      const list = [...(next[t] ?? [])];
      if (!list.some((l) => l.key === id)) {
        list.push({ key: id, by: actor?.id ?? null, at: new Date(clock.now()).toISOString() });
        added = true;
      }
      next[t] = list;
      return next;
    });
    return { added, issue: found.issue };
  }

  async function unlink(target, key) {
    const t = checkTarget(target);
    const id = String(key ?? '').toUpperCase();
    let removed = false;
    await updateLinks((doc) => {
      const next = { ...(doc ?? {}) };
      const list = (next[t] ?? []).filter((l) => l.key !== id);
      removed = list.length !== (next[t] ?? []).length;
      if (list.length) next[t] = list;
      else delete next[t];
      return next;
    });
    return { removed };
  }

  /** A spec made from an idea is linked to the idea's issues too. */
  async function inherit(from, to, actor) {
    const t = checkTarget(to);
    const source = (await linksOf())[checkTarget(from)] ?? [];
    if (!source.length) return { inherited: 0 };
    let inherited = 0;
    await updateLinks((doc) => {
      const next = { ...(doc ?? {}) };
      const list = [...(next[t] ?? [])];
      for (const l of source) {
        if (list.some((x) => x.key === l.key)) continue;
        list.push({ key: l.key, by: actor?.id ?? l.by ?? null, at: new Date(clock.now()).toISOString(), from });
        inherited += 1;
      }
      next[t] = list;
      return next;
    });
    return { inherited };
  }

  /** NooblyJS made this issue for this target itself (a work item's issue from a handoff): linked without reading it back. */
  async function linkMade(target, key) {
    const t = checkTarget(target);
    const id = String(key ?? '').toUpperCase();
    if (!ISSUE_KEY.test(id)) return { added: false };
    let added = false;
    await updateLinks((doc) => {
      const next = { ...(doc ?? {}) };
      const list = [...(next[t] ?? [])];
      if (!list.some((l) => l.key === id)) { list.push({ key: id, by: 'noobly', at: new Date(clock.now()).toISOString(), made: true }); added = true; }
      next[t] = list;
      return next;
    });
    cache.clear();
    return { added };
  }

  /** Is this issue one NooblyJS linked to something of its own? NooblyJS only ever moves or comments on those. */
  async function isLinked(key) {
    const id = String(key ?? '').toUpperCase();
    return Object.values(await linksOf()).some((list) => (list ?? []).some((l) => l.key === id));
  }

  // ---------- writes (Phase 13): the gate, what must hold for each kind, and how each is sent ----------

  const no = (message) => ({ ok: false, message });
  /** A Bitbucket write is for a repository NooblyJS sees, where Platform lets agents do that, on a factory branch. */
  async function repositoryFact(payload, toggle, what) {
    const slug = String(payload?.slug ?? '');
    const seen = (await repositories()).repositories?.find((r) => r.slug === slug) ?? null;
    if (!seen) return no(`NooblyJS does not work on the repository ${slug.slice(0, 60) || '(none)'}.`);
    const record = await services?.get?.('platform')?.repository?.(seen.name);
    if (!record) return no(`${seen.name} is not connected in Platform · Repositories.`);
    // Platform keeps the agent toggles under `may`: what the access level and the switches allow together.
    if (!(record.may?.[toggle] ?? record[toggle])) return no(`Agents may not ${what} on ${seen.name} (Platform · Repositories: ${record.accessText ?? record.access}).`);
    return { ok: true, repository: seen };
  }
  const facts = {
    // An issue is created for a work item of a handoff a person approved, in a project NooblyJS is configured for.
    async 'jira.create-issue'({ cause, payload, itemId }) {
      const handoff = cause?.handoffId ? await services?.get?.('workflows')?.handoffOf?.({ handoffId: cause.handoffId }) : null;
      if (!handoff || (itemId && handoff.itemId !== itemId)) return no('There is no approved handoff behind this issue.');
      if (!(handoff.workItems ?? []).some((w) => w.id === cause.workItemId)) return no(`${cause.workItemId ?? 'That work item'} is not part of the handoff.`);
      if (!(await config()).jira.projects.includes(String(payload?.project ?? '').toUpperCase())) return no(`NooblyJS does not create issues in the Jira project ${String(payload?.project ?? '').slice(0, 20)}.`);
      return { ok: true };
    },
    'jira.transition': async ({ payload }) => ((await isLinked(payload?.key)) ? { ok: true } : no(`${String(payload?.key ?? 'That issue').slice(0, 30)} is not linked to anything in NooblyJS, so NooblyJS does not move it.`)),
    'jira.comment': async ({ payload }) => ((await isLinked(payload?.key)) ? { ok: true } : no(`${String(payload?.key ?? 'That issue').slice(0, 30)} is not linked to anything in NooblyJS, so NooblyJS does not comment on it.`)),
    async 'bitbucket.push-branch'({ payload }) {
      if (!FACTORY_BRANCH.test(String(payload?.toBranch ?? ''))) return no('NooblyJS only pushes branches called factory/….');
      return repositoryFact(payload, 'pushAgentBranches', 'push branches');
    },
    async 'bitbucket.open-pr'({ payload }) {
      if (!FACTORY_BRANCH.test(String(payload?.source ?? ''))) return no('A pull request from NooblyJS comes from a factory/… branch.');
      const fact = await repositoryFact(payload, 'openPrs', 'open pull requests');
      if (!fact.ok) return fact;
      if (fact.repository.branch && payload.destination !== fact.repository.branch) return no(`A pull request on ${fact.repository.name} goes to ${fact.repository.branch}, not ${String(payload.destination).slice(0, 60)}.`);
      return { ok: true };
    },
    'bitbucket.update-pr': async ({ payload }) => {
      const fact = await repositoryFact(payload, 'openPrs', 'open pull requests');
      if (!fact.ok) return fact;
      const pr = await bitbucket.pullRequest(payload.slug, payload.id);
      if (!pr.ok) return no(pr.message);
      if (!FACTORY_BRANCH.test(String(pr.pullRequest.source ?? '')) || pr.pullRequest.state !== 'OPEN') return no('NooblyJS only updates an open pull request from a factory/… branch.');
      return { ok: true };
    },
  };
  const performers = {
    'jira.create-issue': (p) => jira.writes.createIssue(p),
    'jira.transition': (p) => jira.writes.transition(p),
    'jira.comment': (p) => jira.writes.comment(p),
    'bitbucket.push-branch': (p) => gitPush.push(p),
    'bitbucket.open-pr': (p) => bitbucket.writes.openPullRequest(p),
    'bitbucket.update-pr': (p) => bitbucket.writes.updatePullRequest(p),
  };
  const writes = createWrites({
    store, enabled: settings.writes === true, services, auditLog, events, clock, log, performers, facts,
    settings: async () => (await config()).writes,
    saveSettings: (patch) => store.withLock(FILE, async () => {
      const file = (await store.readYaml(FILE)) ?? {};
      const w = file.writes ?? {};
      await store.writeYaml(FILE, { ...file, writes: { ...w, modes: { ...(w.modes ?? {}), ...(patch.modes ?? {}) }, rules: { ...(w.rules ?? {}), ...(patch.rules ?? {}) } } });
    }),
    credential: (system) => (system === 'jira' ? jira.canWrite : bitbucket.canWrite && gitPush.configured),
  });
  const sync = createSync({
    store, config, jira, bitbucket, writes, services, events, auditLog, clock, log, publicBaseUrl,
    links: { keys: async (target) => ((await linksOf())[checkTarget(target)] ?? []).map((l) => l.key), made: linkMade },
  });

  /**
   * What the Software Factory's Bitbucket forge asks for (it holds no token). Each goes through the gate as the
   * Factory's control plane: only a factory/… branch, only where Platform lets agents push and open pull requests.
   * With writes recorded and not sent, the answers say so ({ recorded: true }) and nothing leaves NooblyJS.
   */
  const forge = {
    async pushBranch({ slug, dir, fromBranch, toBranch, itemId = null, workItemId = null, runId = null } = {}) {
      const r = await writes.send({
        kind: 'bitbucket.push-branch', key: `run:${runId ?? 'none'}:${slug}:push:${toBranch}:${await headOf(dir, fromBranch)}`, actor: { type: 'system', id: 'factory' }, itemId,
        target: `${bitbucket.workspace ?? settings.bitbucket?.workspace}/${slug}`, summary: `push the branch ${toBranch} to ${slug}`, cause: { workItemId, runId }, payload: { slug, dir, fromBranch, toBranch },
      });
      return { ok: r.ok, sent: r.sent === true, recorded: r.state === 'recorded', state: r.state, sha: r.result?.sha ?? null, message: r.message ?? null, writeId: r.entry?.id ?? null };
    },
    async openOrUpdatePullRequest({ slug, pr, itemId = null, workItemId = null, runId = null } = {}) {
      const target = `${bitbucket.workspace ?? settings.bitbucket?.workspace}/${slug}`;
      const base = { actor: { type: 'system', id: 'factory' }, itemId, target, cause: { workItemId, runId } };
      const found = bitbucket.configured ? await bitbucket.findPullRequest(slug, pr.head) : { ok: false };
      const existing = found.ok ? found.pullRequest : null;
      let r;
      if (existing) {
        if (existing.title === pr.title) return { ok: true, sent: false, action: 'unchanged', id: existing.id, url: existing.url };
        r = await writes.send({ ...base, kind: 'bitbucket.update-pr', key: `run:${runId ?? 'none'}:${slug}:pr:${existing.id}:update:${crypto.createHash('sha256').update(String(pr.title)).digest('hex').slice(0, 16)}`, summary: `update pull request #${existing.id} on ${slug}`, payload: { slug, id: existing.id, title: pr.title, description: pr.body ?? '' } });
      } else {
        const reviewers = bitbucket.configured ? await bitbucket.defaultReviewers(slug) : { ok: false };
        r = await writes.send({
          ...base, kind: 'bitbucket.open-pr', key: `workitem:${workItemId ?? runId ?? 'none'}:${slug}:pr:${pr.head}`, summary: `open a${pr.status === 'draft' ? ' draft' : ''} pull request on ${slug}: "${String(pr.title).slice(0, 120)}"`,
          payload: { slug, title: pr.title, description: pr.body ?? '', source: pr.head, destination: pr.base, draft: pr.status === 'draft', reviewers: reviewers.ok ? reviewers.reviewers.map((u) => u.uuid) : [] },
        });
      }
      const id = r.result?.id ?? existing?.id ?? null;
      const url = r.result?.url ?? existing?.url ?? null;
      if (workItemId) await sync.onPullRequest({ workItemId, itemId, slug, id, url, title: pr.title, recorded: !r.sent }).catch((err) => log?.warn?.(`devtools: following the pull request: ${err.message}`));
      cache.clear();
      return { ok: r.ok, sent: r.sent === true, recorded: r.state === 'recorded', state: r.state, action: r.sent ? (existing ? 'updated' : 'created') : 'none', id, url, message: r.message ?? null, writeId: r.entry?.id ?? null };
    },
    findPullRequest: async (slug, head) => { const r = await bitbucket.findPullRequest(slug, head); return r.ok ? r.pullRequest : null; },
    listPullRequests: async (slug) => { const r = await bitbucket.pullRequests(slug, { state: 'OPEN' }); return r.ok ? r.pullRequests : []; },
  };


  // ---------- what an agent reads (Phase 11) ----------

  /**
   * An agent's reads for a question in a chat thread: the item's linked Jira issues when it asks about Jira, and a
   * repository's branches, commits and pull requests when it asks about the code. A repository is read only when
   * Platform lets this agent read it (checkAgentWork). Every read is audited with actor, item and system, at no cost.
   * Returns { lines, citations, jira: [issues], repository } for the agent's context; nothing when nothing applies.
   */
  async function agentReads({ agentId, itemId = null, repo = null, question = '', system = 'lifecycle' } = {}) {
    const wantsJira = /\b(jira|issues?|tickets?|stor(y|ies)|tasks?|sprint|backlog)\b/i.test(question);
    const wantsCode = /\b(bitbucket|repo(sitory)?|commits?|branch(es)?|pull requests?|prs?|code)\b/i.test(question);
    const out = { lines: [], citations: [], jira: [], repository: null };
    const audit = (what, extra = {}) => auditLog?.record?.({ actor: agentId, action: 'agent.devtools_read', target: what, itemId, system, teammateId: agentId, costUsd: 0, ...extra })
      .catch((err) => log?.warn?.(`devtools: audit of a read failed: ${err.message}`));

    if (wantsJira && itemId && TARGET.test(String(itemId)) && jira.configured) {
      const r = await linked(itemId);
      const readable = r.issues.filter((i) => !i.unreadable);
      out.jira = readable;
      if (readable.length) {
        out.lines.push(...readable.map((i) => `Jira ${i.key} · ${i.summary}: ${i.type}, ${i.status}, ${i.assignee ?? 'unassigned'}${i.sprint ? `, ${i.sprint.name}` : ''}`));
        out.citations.push(...readable.map((i) => ({ title: `${i.key} · ${i.summary}`, type: 'Jira issue', where: `${i.status}${i.assignee ? ` · ${i.assignee}` : ''}`, freshness: 'read just now', url: i.url })));
      } else {
        out.lines.push(`Jira: no issue is linked to ${itemId} in NooblyJS.`);
      }
      await audit(`jira:${itemId}`, { issues: readable.map((i) => i.key) });
    }

    if (wantsCode && repo) {
      const platform = services?.get?.('platform');
      const check = platform?.checkAgentWork ? await platform.checkAgentWork({ system, workType: 'chat.reply', repo, needs: 'read', teammateId: agentId, itemId }) : { ok: true };
      const slug = String(repo).split('/').pop();
      if (!check.ok) {
        out.lines.push(`Bitbucket: ${check.message}`);
      } else {
        const r = await (await sees(slug) ? repository(slug) : Promise.resolve({ ok: false, message: `NooblyJS does not read ${repo}.` }));
        if (r.ok) {
          out.repository = r;
          const last = r.commits[0];
          out.lines.push(`Bitbucket ${r.repository.name}: main branch ${r.repository.branch}; ${r.branches.length} branch${r.branches.length === 1 ? '' : 'es'}${last ? `; last commit ${last.hash.slice(0, 7)} "${last.message}" by ${last.author} on ${last.at.slice(0, 10)}` : ''}; ${r.pullRequests.ok ? `${r.pullRequests.total} open pull request${r.pullRequests.total === 1 ? '' : 's'}` : 'pull requests not readable'}`);
          out.citations.push({ title: r.repository.name, type: 'Repository', where: `Bitbucket · ${r.repository.branch}`, freshness: 'read just now', url: r.repository.url });
          await audit(`bitbucket:${r.repository.name}`);
        } else {
          out.lines.push(`Bitbucket: ${r.message}`);
        }
      }
    }
    return out.lines.length ? out : null;
  }

  const api = {
    agentReads,
    config,
    setConfig,
    status,
    repositories,
    repository: async (slug, options) => ((await sees(String(slug))) ? repository(String(slug), options) : { ok: false, reason: 'not-found', message: `NooblyJS does not read the repository ${String(slug).slice(0, 60)}.` }),
    /** A file or folder of a repository NooblyJS sees, at a branch or commit. */
    file: async (slug, filePath, { ref } = {}) => ((await sees(String(slug))) ? bitbucket.file(String(slug), filePath, { ref }) : { ok: false, reason: 'not-found', message: `NooblyJS does not read the repository ${String(slug).slice(0, 60)}.` }),
    jira: {
      configured: jira.configured,
      search: (filter = {}, options) => cached(`jira:search:${JSON.stringify(filter)}`, () => jira.search(filter), options),
      issue: (key, options) => cached(`jira:issue:${String(key).toUpperCase()}`, () => jira.issue(key), options),
      /** Several issues by key in one search, in the order asked. Keys outside the configured projects are left out. */
      async issues(keys, options) {
        const wanted = unique((keys ?? []).map((k) => String(k).toUpperCase()));
        if (!wanted.length) return { ok: true, issues: [] };
        const r = await cached(`jira:keys:${wanted.join(',')}`, () => jira.search({ keys: wanted, limit: 100 }), options);
        if (!r.ok) return r;
        const by = new Map(r.issues.map((i) => [i.key, i]));
        return { ok: true, issues: wanted.map((k) => by.get(k)).filter(Boolean) };
      },
      projects: (filter) => jira.projects(filter),
    },
    links: { linked, link, unlink, inherit, keys: async (target) => ((await linksOf())[checkTarget(target)] ?? []).map((l) => l.key) },
    /** Writes (Phase 13): what people see and decide. Nothing here lets a caller make up a write. */
    writes: {
      status: () => writes.status(),
      outbox: (filter) => writes.outbox(filter),
      get: (id) => writes.get(id),
      retry: (id, person) => writes.retry(id, person),
      discard: (id, person) => writes.discard(id, person),
      setMode: (system, mode, person) => writes.setMode(system, mode, person),
      setRule: (kind, rule, person) => writes.setRule(kind, rule, person),
    },
    /** The lifecycle engine carries out an Approver's decision on a write that needed one. */
    decideApproval: (input) => writes.decideApproval(input),
    /** Work items in step with Jira and Bitbucket: called on NooblyJS's events and on a timer (src/noobly.js). */
    sync: {
      onHandoff: (payload) => sync.onHandoff(payload),
      onRunStarted: (payload) => sync.onRunStarted(payload),
      poll: () => sync.poll(),
      workFor: (itemId) => sync.workFor(checkTarget(itemId)),
    },
    /** For the Software Factory's Bitbucket forge. */
    forge,
    /** Forgets every cached answer (after a config change, or "Refresh" on a screen). */
    forget: () => cache.clear(),
    log,
  };
  return api;
}
