// Repositories and what agents may do in each (product.md §5.7, Platform · Repositories): one Markdown file per
// repository, data/platform/repositories/<owner>__<repo>.md, read fresh on every check. Agents can only touch what
// is granted here, and they never merge to main (product.md §3.1), whatever the file says.
import { HttpError } from '../../util/errors.js';

export const ACCESS = ['none', 'read', 'read-prs'];
export const ACCESS_TEXT = { none: 'No agent access', read: 'Read only', 'read-prs': 'Read + open PRs' };
export const TOGGLES = ['readCode', 'pushAgentBranches', 'openPrs', 'merge', 'indexKnowledge'];
const NAME = /^[a-z0-9][a-z0-9._-]{0,62}\/[a-z0-9][a-z0-9._-]{0,99}$/i;
const SHORT = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const DIR = ['platform', 'repositories'];

/** acme/slots-api → acme__slots-api (the file name and the id in URLs). */
export const idOf = (name) => String(name).replace('/', '__');

/**
 * What a repository's access level allows, whatever its toggles say: no access turns everything off, read only
 * allows reading and indexing, and merging is never allowed.
 */
export function normalise(data) {
  const access = ACCESS.includes(data.access) ? data.access : 'read';
  const t = Object.fromEntries(TOGGLES.map((k) => [k, data[k] === true]));
  if (access === 'none') for (const k of TOGGLES) t[k] = false;
  if (access === 'read') Object.assign(t, { pushAgentBranches: false, openPrs: false });
  t.merge = false;
  return { ...data, access, ...t };
}

function view(doc, fileName) {
  const r = normalise(doc.data);
  const name = String(r.name ?? fileName.replace(/\.md$/, '').replace('__', '/'));
  return {
    id: idOf(name),
    name,
    shortName: name.split('/').pop(),
    branch: r.branch ?? 'main',
    stack: r.stack ?? '',
    notes: r.notes ?? '',
    access: r.access,
    accessText: ACCESS_TEXT[r.access],
    may: Object.fromEntries(TOGGLES.map((k) => [k, r[k]])),
    build: { install: r.build?.install ?? '', test: r.build?.test ?? '', image: r.build?.image ?? '' },
    // Gates only mean something where agents open PRs (the mockup leaves them blank otherwise).
    gates: r.openPrs ? (r.gates || '') : '',
    lastActivity: r.lastActivity ?? '',
    factoryEnabled: r.openPrs,
    indexed: r.indexKnowledge,
    sampleData: r.sampleData === true,
    // 'bitbucket' for a repository imported from Bitbucket (Phase 11); none for NooblyJS's own records and the samples.
    source: r.source === 'bitbucket' ? 'bitbucket' : null,
    url: r.source === 'bitbucket' ? r.url ?? null : null,
    project: r.project ?? null,
    lastCommit: r.lastCommit ?? null,
    gone: r.gone === true,
    body: doc.body ?? '',
  };
}

export function createRepositories({ store }) {
  async function list() {
    const names = (await store.list(DIR)).filter((n) => n.endsWith('.md'));
    const docs = await Promise.all(names.map(async (n) => [n, await store.readDoc([...DIR, n])]));
    return docs.filter(([, d]) => d).map(([n, d]) => view(d, n)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * One repository by id (owner__repo), full name (owner/repo) or short name (repo, as the Software Factory names
   * its repositories). Null when none matches; a short name that matches two owners matches neither.
   */
  async function get(ref) {
    const wanted = String(ref ?? '').trim();
    if (!wanted) return null;
    if (NAME.test(wanted) || /__/.test(wanted)) {
      const fileName = `${idOf(wanted)}.md`;
      if (!/^[a-z0-9][a-z0-9._-]*__[a-z0-9][a-z0-9._-]*\.md$/i.test(fileName)) return null;
      const doc = await store.readDoc([...DIR, fileName]);
      return doc ? view(doc, fileName) : null;
    }
    if (!SHORT.test(wanted)) return null;
    const matches = (await list()).filter((r) => r.shortName.toLowerCase() === wanted.toLowerCase());
    return matches.length === 1 ? matches[0] : null;
  }

  /** Connects a repository by hand, as NooblyJS's own record (Bitbucket ones are imported). Agents start with read-only access. */
  async function connect({ name, branch = 'main', stack = '', notes = '', build = {} }, { now }) {
    const n = String(name ?? '').trim();
    if (!NAME.test(n)) throw new HttpError(400, 'invalid_repository', 'Name the repository as owner/repo, e.g. acme/slots-api.');
    const fileName = `${idOf(n)}.md`;
    if (await store.exists([...DIR, fileName])) throw new HttpError(409, 'repository_exists', `${n} is already connected.`);
    const data = normalise({
      name: n, branch: text(branch, 100) || 'main', stack: text(stack, 60), notes: text(notes, 120), access: 'read',
      readCode: true, indexKnowledge: true,
      build: { install: text(build.install, 200), test: text(build.test, 200), image: text(build.image, 100) },
      gates: '', lastActivity: '', connectedAt: now,
    });
    await store.writeDoc([...DIR, fileName], data, 'Connected in Platform · Repositories.');
    return get(n);
  }

  /**
   * Changes access, toggles or build settings. Returns { before, after }. Turning on a toggle the access level
   * doesn't allow is refused, so nobody is told it is on when it isn't.
   */
  async function update(ref, patch) {
    const current = await get(ref);
    if (!current) throw new HttpError(404, 'repository_not_found', `No connected repository "${ref}".`);
    const fileName = `${current.id}.md`;
    let after;
    await store.updateDoc([...DIR, fileName], (doc) => {
      const data = { ...doc.data };
      if (patch.access !== undefined) {
        if (!ACCESS.includes(patch.access)) throw new HttpError(400, 'invalid_access', `Agent access is one of: ${ACCESS.join(', ')}.`);
        data.access = patch.access;
        // Raising access to read-prs turns on what it is for, unless the same change says otherwise.
        if (patch.access === 'read-prs' && current.access !== 'read-prs') Object.assign(data, { readCode: true, pushAgentBranches: true, openPrs: true });
        if (patch.access === 'read' && current.access === 'none') data.readCode = true;
      }
      for (const k of TOGGLES) {
        if (patch.may?.[k] === undefined) continue;
        if (typeof patch.may[k] !== 'boolean') throw new HttpError(400, 'invalid_toggle', `${k} is true or false.`);
        if (k === 'merge' && patch.may[k]) throw new HttpError(422, 'merge_not_allowed', 'Agents never merge to main (governance). People merge.');
        data[k] = patch.may[k];
      }
      const n = normalise(data);
      for (const k of TOGGLES) {
        if (patch.may?.[k] === true && n[k] !== true) {
          throw new HttpError(422, 'toggle_not_allowed', `"${ACCESS_TEXT[n.access]}" does not allow ${k}. Change the agent access first.`);
        }
      }
      if (patch.build) {
        n.build = { ...(n.build ?? {}) };
        for (const k of ['install', 'test', 'image']) if (patch.build[k] !== undefined) n.build[k] = text(patch.build[k], k === 'image' ? 100 : 200);
      }
      for (const k of ['branch', 'stack', 'notes']) if (patch[k] !== undefined) n[k] = text(patch[k], k === 'branch' ? 100 : 120);
      after = n;
      return { data: n, body: doc.body };
    });
    return { before: current, after: await get(current.id), changed: after };
  }

  /**
   * Brings Platform's files in line with what Bitbucket has (devtools.repositories()). A new repository starts with
   * read-only agent access; one already here keeps its access, toggles and build settings, and only what Bitbucket
   * owns is refreshed (branch, project, language, last commit). One that Bitbucket no longer has is marked gone,
   * never deleted. Returns { added, updated, gone } as repository names.
   */
  async function importBitbucket({ workspace, repositories }, { now }) {
    const result = { added: [], updated: [], gone: [] };
    const seen = new Set();
    for (const repo of repositories) {
      const name = `${workspace}/${repo.slug}`;
      if (!NAME.test(name)) continue;
      seen.add(name.toLowerCase());
      const fileName = `${idOf(name)}.md`;
      const fromBitbucket = {
        source: 'bitbucket', url: repo.url, branch: repo.branch ?? 'main', project: repo.project?.key ?? null, gone: undefined,
        lastCommit: repo.lastCommit ? { hash: String(repo.lastCommit.hash).slice(0, 12), at: repo.lastCommit.at, message: text(repo.lastCommit.message, 120), author: text(repo.lastCommit.author, 80) } : null,
        lastActivity: repo.lastCommit?.at ? `${repo.lastCommit.at.slice(0, 10)} · ${text(repo.lastCommit.author, 40)}` : '',
        syncedAt: now,
      };
      if (await store.exists([...DIR, fileName])) {
        await store.updateDoc([...DIR, fileName], (doc) => ({ data: { ...doc.data, ...fromBitbucket, stack: doc.data.stack || text(repo.language, 60) }, body: doc.body }));
        result.updated.push(name);
      } else {
        const data = normalise({
          name, stack: text(repo.language, 60), notes: text(repo.description, 120), access: 'read', readCode: true, indexKnowledge: false,
          build: { install: '', test: '', image: '' }, gates: '', connectedAt: now, ...fromBitbucket,
        });
        await store.writeDoc([...DIR, fileName], data, 'Imported from Bitbucket. Agent access is NooblyJS\'s own record: Platform · Repositories.');
        result.added.push(name);
      }
    }
    for (const repo of await list()) {
      if (repo.source !== 'bitbucket' || repo.gone || seen.has(repo.name.toLowerCase()) || !repo.name.toLowerCase().startsWith(`${String(workspace).toLowerCase()}/`)) continue;
      await store.updateDoc([...DIR, `${repo.id}.md`], (doc) => ({ data: { ...doc.data, gone: true, syncedAt: now }, body: doc.body }));
      result.gone.push(repo.name);
    }
    return result;
  }

  return { list, get, connect, update, importBitbucket };
}

const text = (v, max) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
