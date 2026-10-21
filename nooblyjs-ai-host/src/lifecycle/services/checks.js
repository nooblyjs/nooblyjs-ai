// The lifecycle's checks and its part of the trace (Phase 16f, root design.md §4–§5).
//
//   checksFor(itemId)    the item's, its stories' and their pull requests' checks in the one shape: each one's readiness
//                        for its current stage (Design's and Engineering's are worked out by those sections; the spec's
//                        are the Product section's own, so they are left to it) and the Build and Test approvals
//   overrideCheck        a person overrides one failing readiness check with a reason: it holds for that stage
//   trace(itemId)        the stories, work items and pull requests of an item, and the links items keep in their front
//                        matter (`links: [{ rel, to }]`)
import { badRequest, conflict, notFound, refused } from '../errors.js';
import { stageLabel } from '../stages.js';

const APPROVALS = { 'build-approval': 'Build approval', 'test-approval': 'Test approval' };
const short = (repo) => String(repo ?? '').split('/').pop();

export function createLifecycleChecks({ repos, host, now, emit, audit, personFor, requireApprover, readinessOf, storiesOf }) {
  const nameOf = async (id) => (id ? (await host.people.get(id))?.name ?? id : null);

  /** An item with its stories and their pull requests (a story: itself and its pull requests). */
  async function familyOf(itemId) {
    const all = await repos.items.list();
    const item = all.find((i) => i.id === itemId);
    if (!item) throw notFound(`There is no item ${itemId}.`);
    const stories = all.filter((i) => i.type === 'story' && i.parentId === item.id && i.status !== 'withdrawn');
    const parents = new Set([item.id, ...stories.map((s) => s.id)]);
    const prs = all.filter((i) => i.type === 'pr' && parents.has(i.parentId) && i.status !== 'withdrawn');
    return { item, stories, prs, all, members: [item, ...stories, ...prs] };
  }

  async function approvalChecks(member, approvals) {
    const out = [];
    for (const type of Object.keys(APPROVALS)) {
      const a = approvals.filter((x) => x.itemId === member.id && x.type === type && !['withdrawn', 'cleared'].includes(x.status))
        .sort((x, y) => String(y.requestedAt).localeCompare(String(x.requestedAt)))[0];
      if (!a) continue;
      const r = (a.reviewers ?? []).find((x) => x.status === 'approved' || x.status === 'changes-requested');
      const by = await nameOf(r?.by ?? r?.id ?? a.decidedBy);
      const forName = r?.by && r.by !== r.id ? await nameOf(r.id) : null;
      const waiting = await Promise.all((a.reviewers ?? []).filter((x) => x.status === 'waiting').map((x) => nameOf(x.id)));
      const [result, words] = a.status === 'approved' ? ['passed', `${APPROVALS[type]} given by ${by}${forName ? ` for ${forName}` : ''}`]
        : a.status === 'changes-requested' ? ['failed', `${APPROVALS[type]}: ${type === 'test-approval' ? 'sent back' : 'changes asked for'} by ${by}${r?.reason ? `: ${r.reason}` : ''}`]
          : ['not-run', `${APPROVALS[type]}: waiting on ${waiting.join(', ') || 'nobody'}`];
      out.push({
        key: type, kind: 'approval', subject: { item: member.id, ref: member.ref ?? member.id },
        definedBy: { system: 'workflows', ref: `approval-rules.yaml#${type}` }, verifiedBy: 'person', severity: 'blocking',
        result, text: words, evidence: { system: 'workflows', ref: a.id, summary: a.sha ? `${words} on ${String(a.sha).slice(0, 7)}` : words },
        at: a.decidedAt ?? a.requestedAt ?? null,
      });
    }
    return out;
  }

  /** The checks of an item, its stories and their pull requests (each in the one shape, without its id). */
  async function checksFor(itemId) {
    const { members } = await familyOf(itemId);
    const approvals = await repos.approvals.list();
    const out = [];
    for (const member of members.filter((m) => m.status === 'active')) {
      const readiness = await readinessOf(member);
      // The spec's readiness is the Product section's to report (its checksFor), with the same facts.
      if (readiness.total && readiness.source !== 'product') {
        for (const c of readiness.checks) {
          out.push({
            key: c.key, kind: 'readiness', stage: member.stage, subject: { item: member.id, ref: member.ref ?? member.id },
            definedBy: { system: 'workflows', ref: `readiness.yaml#${member.type === 'pr' && member.stage === 'test' ? 'pull-request' : member.stage}.${c.key}` },
            verifiedBy: readiness.source === 'recorded' ? 'person' : `${readiness.source} facts`, severity: 'blocking',
            result: c.passed ? 'passed' : /not checked yet$/.test(c.text) ? 'not-run' : 'failed', text: c.text,
            evidence: { system: readiness.source === 'recorded' ? 'workflows' : readiness.source, summary: `${stageLabel(member.stage)} readiness: ${c.text}` },
            ...(c.overridden ? { override: c.overridden } : {}),
            overridable: !c.passed || Boolean(c.overridden), at: member.stageEnteredAt ?? null,
          });
        }
      }
      out.push(...await approvalChecks(member, approvals));
    }
    return out;
  }

  /**
   * A person overrides one failing readiness check of an item's current stage, with a reason. It holds while the item
   * is in that stage: the check shows it, the stage's decision no longer waits on it, and the audit log has it.
   */
  async function overrideCheck({ itemId, key, reason, actor } = {}) {
    const person = await personFor(actor, { what: 'override a check', target: `item ${itemId}` });
    await requireApprover(person, `item ${itemId}`);
    const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (why.length < 3) throw badRequest('Say why it can go on anyway: a reason is required to override a check.', { reason: 'required' });
    const item = await repos.items.get(itemId);
    if (!item) throw notFound(`There is no item ${itemId}.`);
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    const readiness = await readinessOf(item);
    const check = readiness.checks.find((c) => c.key === key);
    if (!check) throw notFound(`${item.ref ?? item.id} has no readiness check "${key}" in ${stageLabel(item.stage)}.`);
    if (check.passed) throw refused('not_failing', `"${check.text}" passes: there is nothing to override.`);
    const at = now();
    const record = { by: person.id, byName: person.name, reason: why, at, text: check.text };
    await repos.items.update(item.id, (cur) => ({ ...cur, checkOverrides: { ...(cur.checkOverrides ?? {}), [`${cur.stage}:${key}`]: record }, updatedAt: at }));
    await audit({ actor: person.id, action: 'check.overridden', target: item.id, itemId: item.id, stage: item.stage, key, reason: why });
    await emit('check.overridden', {
      itemId: item.id, system: item.system, stage: item.stage, key, reason: why,
      summary: `overrode "${check.text}" on ${item.ref ?? item.id} (${stageLabel(item.stage)}): ${why}`,
    }, person.id);
    return { itemId: item.id, key, override: record, text: `Overridden: ${check.text}. ${item.ref ?? item.id}'s ${stageLabel(item.stage)} decision no longer waits on it.` };
  }

  /** The lifecycle's part of an item's trace: its stories, work items, pull requests, and the links in front matter. */
  async function trace(itemId) {
    const { item, stories, prs, all } = await familyOf(itemId);
    const nodes = [];
    const links = [];
    const node = (i, type) => nodes.push({ id: i.id, type, title: i.title, system: 'workflows', stage: i.stage, status: i.status, href: `/home/lifecycle/${encodeURIComponent(i.id)}` });
    node(item, item.type === 'story' ? 'story' : 'item');
    for (const st of stories) {
      node(st, 'story');
      links.push({ from: st.id, rel: 'story-of', to: item.id });
    }
    // Work items: those of each handoff of the item or a story.
    const handoffs = (await repos.handoffs.list()).filter((h) => h.itemId === item.id || stories.some((s) => s.id === h.itemId));
    for (const h of handoffs) {
      for (const w of h.workItems ?? []) {
        nodes.push({ id: w.id, type: 'work-item', title: `${w.title} (${short(w.repo)})`, system: 'workflows', status: w.status ?? null });
        links.push({ from: w.id, rel: 'implements', to: h.itemId });
      }
    }
    for (const p of prs) {
      nodes.push({ id: p.id, type: 'pull-request', title: `${p.ref ?? p.id} · ${p.title}`, system: 'workflows', stage: p.stage, status: p.status, href: p.pr ? `/factory/pull-requests/${encodeURIComponent(p.id)}` : `/home/lifecycle/${encodeURIComponent(p.id)}` });
      links.push(p.pr?.workItemId ? { from: p.id, rel: 'delivers', to: p.pr.workItemId } : { from: p.id, rel: 'pull-request-of', to: p.parentId });
      if (p.pr?.runId) links.push({ from: p.id, rel: 'opened-by', to: p.pr.runId });
    }
    // Links in front matter: from the family, and from any item that links into it (a pull request from before 16e).
    const inFamily = new Set([item.id, ...stories.map((s) => s.id), ...prs.map((p) => p.id)]);
    for (const i of all) {
      const own = (i.links ?? []).filter((l) => l?.rel && l?.to);
      if (!own.length || (!inFamily.has(i.id) && !own.some((l) => inFamily.has(l.to)))) continue;
      if (!inFamily.has(i.id)) node(i, i.type === 'pr' ? 'pull-request' : i.type ?? 'item');
      for (const l of own) links.push({ from: i.id, rel: String(l.rel), to: String(l.to) });
    }
    return { nodes, links };
  }

  return { checksFor, overrideCheck, trace, familyOf };
}
