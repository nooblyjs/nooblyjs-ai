// Keeping NooblyJS's work items in step with Jira and Bitbucket (Phase 13).
//
// Who owns what: NooblyJS owns the lifecycle (the item, its stage, the handoff). Jira owns each issue once it exists
// (its status, assignee, sprint). So NooblyJS
//   - creates one issue per work item when a handoff is approved, and links it
//   - READS the linked issues on a schedule and shows each work item's Jira status
//   - moves an issue forward only for a fact it knows and Jira doesn't: a run started, a pull request merged.
//     It never moves one backwards, and when a person moved the issue back in Jira it leaves it (a conflict)
//   - READS the pull requests the Factory opened: state, reviewers, build statuses
//   - moves the item Build → Ship when people merged every work item's pull request in Bitbucket
//
// Every write goes through the write gate (writes.js). This file reads Jira and Bitbucket and asks the gate; it
// never calls a writer. What it knows is kept in data/devtools/work.yaml, one entry per work item.
import { KINDS } from './writer.js';

const WORK = ['devtools', 'work.yaml'];
const ORDER = { new: 0, indeterminate: 1, done: 2 };
const CATEGORY_WORDS = { new: 'To do', indeterminate: 'In progress', done: 'Done' };
const ACTOR = Object.freeze({ type: 'system', id: 'devtools-sync' });
const clip = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @param {object} deps
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} deps.store
 * @param {() => Promise<object>} deps.config        devtools config (jira.projects, writes.issueType)
 * @param {object} deps.jira                         the Jira client (reads) from jira.js
 * @param {object} deps.bitbucket                    the Bitbucket client (reads) from bitbucket.js
 * @param {object} deps.writes                       the write gate
 * @param {{ keys: Function, made: Function }} deps.links
 */
export function createSync({ store, config, jira, bitbucket, writes, links, services = null, events = null, auditLog = null, clock = Date, log = null, publicBaseUrl = '' }) {
  const now = () => new Date(clock.now()).toISOString();
  const workflows = () => services?.get?.('workflows') ?? null;
  const read = async () => (await store.readYaml(WORK)) ?? {};
  /** Read-modify-write of one work item's entry under the file's lock. */
  const update = (id, fn) => store.withLock(WORK, async () => {
    const doc = await read();
    const next = fn(doc[id] ?? null);
    if (next === null) return doc[id] ?? null;
    await store.writeYaml(WORK, { ...doc, [id]: { ...next, updatedAt: now() } });
    return next;
  });
  const tell = (type, payload) => events?.emit?.(type, { actorName: 'NooblyJS', system: 'lifecycle', ...payload }, { actor: 'system' })
    .catch((err) => log?.warn?.(`devtools sync: ${type}: ${err.message}`));
  let ownAccount; // the Bitbucket account NooblyJS's token belongs to (its merges are not a person's)
  let polling = null;

  /** The Jira project a new issue for this item goes in: where its linked issues are, else the first configured one. */
  async function projectFor(itemId) {
    const allowed = (await config()).jira.projects;
    const linked = itemId ? await links.keys(itemId).catch(() => []) : [];
    const fromLinks = linked.map((k) => k.split('-')[0]).find((p) => allowed.includes(p));
    return fromLinks ?? allowed[0] ?? null;
  }

  // ------------------------------------------------------------------ NooblyJS → Jira: issues from a handoff

  /** An approved handoff: one Jira issue per work item, once. Safe to call again for the same handoff. */
  async function onHandoff({ handoffId } = {}) {
    const handoff = await workflows()?.handoffOf?.({ handoffId });
    if (!handoff?.workItems?.length) return [];
    const project = await projectFor(handoff.itemId);
    const item = await workflows()?.item?.({ itemId: handoff.itemId });
    const cfg = await config();
    const out = [];
    for (const w of handoff.workItems) {
      await update(w.id, (cur) => ({ ...(cur ?? {}), id: w.id, itemId: handoff.itemId, handoffId: handoff.id, title: w.title, repo: w.repo }));
      if ((await links.keys(w.id)).length) { out.push({ workItemId: w.id, state: 'linked' }); continue; }
      if (!project) { out.push({ workItemId: w.id, state: 'no-project' }); continue; }
      const link = publicBaseUrl ? `${publicBaseUrl}/home/items/${encodeURIComponent(handoff.itemId)}` : null;
      const r = await writes.send({
        kind: 'jira.create-issue', key: `handoff:${handoff.id}:${w.id}:issue`, actor: { type: 'system', id: 'lifecycle' }, itemId: handoff.itemId,
        target: project, summary: `create the Jira issue "${clip(w.title, 120)}" in ${project} for ${w.id}`,
        cause: { handoffId: handoff.id, workItemId: w.id },
        payload: {
          project, type: cfg.writes.issueType, summary: clip(w.title, 250), labels: ['noobly', handoff.itemId],
          description: [`Work item ${w.id} of ${item?.ref ?? handoff.itemId}${item?.title ? ` · ${item.title}` : ''}, handed over to the Software Factory in NooblyJS.`, `Repository: ${w.repo}`, link ? `NooblyJS: ${link}` : null].filter(Boolean).join('\n'),
        },
      });
      await update(w.id, (cur) => ({ ...cur, issueWrite: { id: r.entry?.id ?? null, state: r.state, reason: r.message ?? null } }));
      out.push({ workItemId: w.id, state: r.state });
    }
    return out;
  }

  // The gate tells us when an issue was really made (at once, after an approval, or sent again by a person).
  writes.onSent('jira.create-issue', async (entry) => {
    const workItemId = entry.cause?.workItemId;
    const key = entry.result?.key;
    if (!workItemId || !key) return;
    await links.made(workItemId, key);
    await update(workItemId, (cur) => ({ ...(cur ?? { id: workItemId, itemId: entry.itemId }), issue: { key, url: entry.result.url ?? null, status: null, category: 'new', seenAt: now() }, issueWrite: { id: entry.id, state: 'sent', reason: null } }));
    await tell('workitem.issue_created', { itemId: entry.itemId, workItemId, issue: key, summary: `created Jira issue ${key} for ${workItemId}` });
  });

  // ------------------------------------------------------------------ NooblyJS → Jira: moving an issue forward

  /**
   * Move a work item's issue forward to a status category, for a fact NooblyJS knows. Nothing is sent when the issue is
   * already there or further, or when a person moved it back in Jira since NooblyJS last looked (Jira wins: a conflict).
   */
  async function moveIssue(workItemId, want, why) {
    const entry = (await read())[workItemId];
    const key = (await links.keys(workItemId).catch(() => []))[0] ?? entry?.issue?.key;
    if (!key) return { state: 'no-issue' };
    const live = await jira.issue(key);
    if (!live.ok) return { state: 'unreadable', message: live.message };
    const current = live.issue.statusCategory ?? 'new';
    const seen = entry?.issue?.category ?? null;
    await update(workItemId, (cur) => ({ ...(cur ?? { id: workItemId }), issue: { ...(cur?.issue ?? {}), key, url: live.issue.url, status: live.issue.status, category: current, seenAt: now() } }));
    if (ORDER[current] >= ORDER[want]) return { state: 'already', category: current };
    if (seen && ORDER[current] < ORDER[seen]) {
      await auditLog?.record?.({ actor: 'system', action: 'devtools.sync_conflict', target: key, itemId: entry?.itemId ?? null, system: 'devtools', workItemId, jira: live.issue.status, wanted: CATEGORY_WORDS[want], reason: why });
      await tell('devtools.sync_conflict', { itemId: entry?.itemId ?? null, workItemId, issue: key, summary: `left ${key} at "${live.issue.status}": someone moved it back in Jira, so NooblyJS did not move it to ${CATEGORY_WORDS[want]} (${why})` });
      return { state: 'conflict', category: current };
    }
    const moves = await jira.transitions(key);
    if (!moves.ok) return { state: 'unreadable', message: moves.message };
    const move = moves.transitions.find((t) => t.category === want);
    if (!move) return { state: 'no-transition', message: `${key} has no move to ${CATEGORY_WORDS[want]} from "${live.issue.status}".` };
    const r = await writes.send({
      kind: 'jira.transition', key: `workitem:${workItemId}:issue:${key}:to:${want}`, actor: ACTOR, itemId: entry?.itemId ?? null, target: key,
      summary: `move ${key} to "${move.to ?? move.name}" (${why})`, cause: { workItemId, why }, payload: { key, transitionId: move.id, to: move.to ?? move.name },
    });
    return { state: r.state, message: r.message ?? null };
  }

  /** The Factory started a run for a work item: its issue moves to In progress. */
  async function onRunStarted({ workItemId, runId = null } = {}) {
    if (!workItemId) return null;
    await update(workItemId, (cur) => (cur ? { ...cur, run: { id: runId, startedAt: cur.run?.startedAt ?? now() } } : null));
    return moveIssue(workItemId, 'indeterminate', 'the Software Factory started work');
  }

  /** A pull request was opened for a work item (the Factory's forge tells us): follow it, and say so on the issue. */
  async function onPullRequest({ workItemId, itemId = null, slug, id, url = null, title = null, state = 'OPEN', recorded = false } = {}) {
    if (!workItemId || !slug) return null;
    await update(workItemId, (cur) => ({ ...(cur ?? { id: workItemId, itemId }), itemId: cur?.itemId ?? itemId, pr: { ...(cur?.pr ?? {}), slug, id: id ?? null, url, title, state: recorded ? 'RECORDED' : state, openedAt: cur?.pr?.openedAt ?? now() } }));
    if (recorded || !id) return { state: 'recorded' };
    const key = (await links.keys(workItemId).catch(() => []))[0];
    if (!key) return { state: 'no-issue' };
    const r = await writes.send({
      kind: 'jira.comment', key: `workitem:${workItemId}:issue:${key}:pr:${slug}:${id}`, actor: ACTOR, itemId, target: key,
      summary: `comment on ${key} that pull request #${id} is open`, cause: { workItemId, pr: `${slug}#${id}` },
      payload: { key, text: `NooblyJS: the Software Factory opened pull request #${id}${title ? ` "${clip(title, 160)}"` : ''} on ${slug}.${url ? `\n${url}` : ''}\nA person reviews and merges it; NooblyJS never merges.` },
    });
    return { state: r.state };
  }

  // ------------------------------------------------------------------ Jira → NooblyJS and Bitbucket → NooblyJS: the poll

  async function pollIssues(doc) {
    const withIssue = [];
    for (const [id, e] of Object.entries(doc)) {
      const key = (await links.keys(id).catch(() => []))[0] ?? e.issue?.key;
      if (key) withIssue.push([id, e, key]);
    }
    if (!withIssue.length || !jira.configured) return 0;
    const r = await jira.search({ keys: withIssue.map(([, , key]) => key), limit: 100 });
    if (!r.ok) { log?.warn?.(`devtools sync: Jira did not answer: ${r.message}`); return 0; }
    const by = new Map(r.issues.map((i) => [i.key, i]));
    let changed = 0;
    for (const [id, e, key] of withIssue) {
      const live = by.get(key);
      if (!live) continue;
      const was = e.issue?.status ?? null;
      const category = live.statusCategory ?? 'new';
      if (was === live.status && e.issue?.assignee === live.assignee && e.issue?.key === key) continue;
      await update(id, (cur) => ({ ...cur, issue: { ...(cur?.issue ?? {}), key, url: live.url, status: live.status, category, assignee: live.assignee ?? null, sprint: live.sprint?.name ?? null, seenAt: now() } }));
      // A change is a new status name, or, for an issue NooblyJS made and has not read yet, a new category.
      if (was !== null ? was !== live.status : category !== (e.issue?.category ?? category)) {
        changed += 1;
        await tell('workitem.status_changed', { itemId: e.itemId ?? null, workItemId: id, issue: key, from: was ?? 'To do', to: live.status, category, source: 'jira', actorName: 'Jira', summary: `${key} (${id}) moved to "${live.status}" in Jira` });
      }
    }
    return changed;
  }

  async function pollPullRequests(doc) {
    const open = Object.entries(doc).filter(([, e]) => e.pr?.id && e.pr.state === 'OPEN');
    if (!open.length || !bitbucket.configured) return 0;
    if (ownAccount === undefined) ownAccount = (await bitbucket.account().then((a) => (a.ok ? a.uuid : null)).catch(() => null)) ?? null;
    let changed = 0;
    for (const [id, e] of open) {
      const [pr, st] = await Promise.all([bitbucket.pullRequest(e.pr.slug, e.pr.id), bitbucket.statuses(e.pr.slug, e.pr.id)]);
      if (!pr.ok) continue;
      const p = pr.pullRequest;
      const statuses = st.ok ? st.statuses : (e.pr.statuses ?? []);
      const checks = {
        total: statuses.length, passed: statuses.filter((s) => s.state === 'successful').length,
        failed: statuses.filter((s) => s.state === 'failed' || s.state === 'stopped').length, running: statuses.filter((s) => s.state === 'inprogress').length,
        readable: st.ok, ...(st.ok ? {} : { why: st.message }),
      };
      const next = { ...e.pr, state: p.state, head: p.head, title: p.title, url: p.url, reviewers: p.reviewers.map((r) => ({ name: r.name, state: r.state })), statuses, checks, mergedBy: p.mergedBy?.name ?? null, seenAt: now() };
      const moved = p.state !== e.pr.state;
      if (moved || JSON.stringify(next.checks) !== JSON.stringify(e.pr.checks) || JSON.stringify(next.reviewers) !== JSON.stringify(e.pr.reviewers)) {
        await update(id, (cur) => ({ ...cur, pr: { ...next, ...(p.state === 'MERGED' ? { mergedAt: now() } : {}) } }));
        changed += 1;
      }
      if (moved && p.state === 'MERGED') await onMerged(id, { ...e, pr: next }, p);
      else if (moved) await tell('pr.closed', { itemId: e.itemId ?? null, workItemId: id, pr: { slug: e.pr.slug, id: e.pr.id, url: p.url }, state: p.state, summary: `pull request #${e.pr.id} on ${e.pr.slug} was ${String(p.state).toLowerCase()} in Bitbucket` });
    }
    return changed;
  }

  /** A pull request was merged in Bitbucket. A person's merge closes the work item; NooblyJS's own account's does not count. */
  async function onMerged(workItemId, entry, pr) {
    const ours = Boolean(ownAccount && pr.mergedBy?.uuid && pr.mergedBy.uuid === ownAccount);
    if (ours || !pr.mergedBy?.name) {
      const reason = ours ? 'it was merged with NooblyJS\'s own Bitbucket account, and NooblyJS never merges' : 'Bitbucket did not say who merged it';
      await update(workItemId, (cur) => ({ ...cur, pr: { ...cur.pr, mergeIgnored: reason } }));
      await auditLog?.record?.({ actor: 'system', action: 'devtools.merge_ignored', target: `${entry.pr.slug}#${entry.pr.id}`, itemId: entry.itemId ?? null, system: 'devtools', workItemId, status: 'refused', reason });
      await tell('merge.refused', { itemId: entry.itemId ?? null, workItemId, reason, summary: `did not count the merge of pull request #${entry.pr.id} on ${entry.pr.slug}: ${reason}` });
      return;
    }
    await tell('pr.merged', {
      itemId: entry.itemId ?? null, workItemId, system: 'factory', pr: { slug: entry.pr.slug, id: entry.pr.id, url: pr.url }, mergedBy: pr.mergedBy.name, actorName: pr.mergedBy.name,
      summary: `merged pull request #${entry.pr.id} on ${entry.pr.slug} in Bitbucket`,
    });
    await moveIssue(workItemId, 'done', `pull request #${entry.pr.id} was merged`).catch((err) => log?.warn?.(`devtools sync: ${workItemId}: ${err.message}`));
    await maybeShip(entry.itemId);
  }

  /**
   * When people merged every work item's pull request for an item still in Build or Test, the lifecycle engine is told
   * (since Phase 16b it flags a merge made before the Build and Test approvals; those approvals move the item).
   */
  async function maybeShip(itemId) {
    if (!itemId) return { moved: false };
    const doc = await read();
    const mine = Object.values(doc).filter((e) => e.itemId === itemId);
    const item = await workflows()?.item?.({ itemId });
    if (!item || !['build', 'test'].includes(item.stage) || item.status !== 'active') return { moved: false };
    // Every work item of the item's latest handoff must have a pull request a person merged.
    const latest = mine.reduce((h, e) => (!h || String(e.handoffId) > String(h) ? e.handoffId : h), null);
    const scope = mine.filter((e) => e.handoffId === latest);
    if (!scope.length || !scope.every((e) => e.pr?.state === 'MERGED' && e.pr.mergedBy && !e.pr.mergeIgnored)) return { moved: false, waiting: scope.filter((e) => e.pr?.state !== 'MERGED').map((e) => e.id) };
    const moved = await workflows()?.movedByMerge?.({
      itemId, mergedBy: scope.map((e) => ({ name: e.pr.mergedBy, kind: 'person' })), pullRequests: scope.map((e) => ({ repo: e.pr.slug, id: e.pr.id, url: e.pr.url ?? null })),
    }).catch((err) => { log?.warn?.(`devtools sync: ${itemId}: the merge was not recorded: ${err.message}`); return null; });
    return { moved: Boolean(moved?.moved), flagged: Boolean(moved?.flagged) };
  }

  /** One pass: read the linked issues and the open pull requests. Two passes never overlap. */
  function poll() {
    polling ??= (async () => {
      try {
        const doc = await read();
        const issues = await pollIssues(doc);
        const prs = await pollPullRequests(await read());
        return { at: now(), issues, pullRequests: prs };
      } finally {
        polling = null;
      }
    })();
    return polling;
  }

  /** The item's work items, each with its Jira issue, its pull request and what NooblyJS wrote or would write. */
  async function workFor(itemId) {
    const doc = await read();
    const outbox = (await writes.outbox({ itemId, limit: 200 })).entries;
    const items = Object.values(doc).filter((e) => e.itemId === itemId).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    const allDone = items.length > 0 && items.every((e) => e.issue?.category === 'done');
    return {
      itemId,
      workItems: items.map((e) => ({
        id: e.id, title: e.title ?? null, repo: e.repo ?? null,
        issue: e.issue ? { key: e.issue.key, url: e.issue.url ?? null, status: e.issue.status ?? null, category: e.issue.category ?? null, categoryText: CATEGORY_WORDS[e.issue.category] ?? null, assignee: e.issue.assignee ?? null, seenAt: e.issue.seenAt ?? null } : null,
        issueWrite: e.issue ? null : e.issueWrite ?? null,
        pr: e.pr ? { slug: e.pr.slug, id: e.pr.id, url: e.pr.url ?? null, state: e.pr.state, title: e.pr.title ?? null, reviewers: e.pr.reviewers ?? [], checks: e.pr.checks ?? null, mergedBy: e.pr.mergedBy ?? null, mergeIgnored: e.pr.mergeIgnored ?? null } : null,
      })),
      allDoneInJira: allDone,
      writes: outbox.map((w) => ({ id: w.id, kind: w.kind, kindLabel: KINDS[w.kind]?.label ?? w.kind, state: w.state, stateText: w.stateText, summary: w.summary, reason: w.reason, at: w.at })),
    };
  }

  return { onHandoff, onRunStarted, onPullRequest, moveIssue, maybeShip, poll, workFor, entry: async (id) => (await read())[id] ?? null };
}
