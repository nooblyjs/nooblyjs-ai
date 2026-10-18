// The lifecycle engine (NooblyJS product.md §4): items move through the seven stages, and a person approves each gate.
// Agents propose, people decide: every decision here refuses an agent before anything else, whatever its access
// role, and checks the person's access role against the rule's permission (never their work role).
//
// Every change is written to its file and emitted as an event in the same operation; NooblyJS's Activity, the event
// stream and the other apps read the events. Business time comes from the host's clock (the dev clock moves it).
import { HttpError, badRequest, forbidden, notFound, conflict, refused } from '../errors.js';
import { STAGE_KEYS, stageKey, stageLabel, stageIndex, nextStage } from '../stages.js';
import { addWorkingDays, dueFrom } from '../working-days.js';
import { loadRules, loadReadiness } from '../config.js';
import { newId } from '../ids.js';

const DECISIONS = new Set(['approve', 'request-changes']);
const MAX_TEXT = 2000;
const NUDGE_EVERY_MS = 4 * 3_600_000;

/** What an approved approval does to its item, by rule key. Rules not listed (adr, deploy) don't move the item. */
const MOVES = { spec: 'architect', 'ui-handoff': 'build', stage: null, merge: 'complete' };

/**
 * Approvals another NooblyJS app asks for, on its own artefact. The app named in the approval's `ref.app` carries the
 * decision out (its `decideApproval` service) before it is recorded here, so its rules refuse the same way on
 * Home · Approvals as on its own screen. They move no stage.
 */
const APP_TYPES = new Set(['infra-design', 'devtools-write']);
const sameRef = (a, b) => a && b && a.app === b.app && a.designId === b.designId && a.kind === b.kind;

const text = (value, max = MAX_TEXT) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('Text fields must be strings.');
  const t = value.trim();
  if (t.length > max) throw badRequest(`Keep it under ${max} characters.`);
  return t || null;
};

export function createEngine({ repos, host, log, clock }) {
  const now = () => new Date(clock.now()).toISOString();
  const rules = () => loadRules(repos, log);
  const emit = (type, payload, actorId) => host.events.emit(type, payload, { actor: actorId ?? null });
  const audit = (entry) => host.audit.record(entry).catch((err) => log.error(`audit write failed: ${err.message}`));

  async function itemOr404(id) {
    const item = await repos.items.get(id);
    if (!item) throw notFound(`There is no item ${id}.`);
    return item;
  }

  async function approvalOr404(id) {
    const approval = await repos.approvals.get(id);
    if (!approval) throw notFound(`There is no approval ${id}.`);
    return approval;
  }

  async function ruleOr500(key) {
    const rule = (await rules()).get(key);
    if (!rule) throw new HttpError(500, 'no_rule', `There is no approval rule "${key}" in approval-rules.yaml.`);
    return rule;
  }

  /**
   * The person taking a decision. An agent is refused before anything else (and the refusal is audited): agents
   * propose, people decide (product.md §3). `actor` is the signed-in person, or { id, kind } from another app.
   */
  async function personFor(actor, doing) {
    if (!actor?.id) throw forbidden('unauthenticated', 'Sign in to continue.');
    if (actor.kind === 'agent') {
      await audit({ actor: actor.id, action: 'access.refused', target: doing.target ?? null, reason: `agents propose, people decide: an agent can't ${doing.what}` });
      throw forbidden('people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${doing.what}.`);
    }
    const person = await host.people.get(actor.id);
    if (!person?.active) throw forbidden('unknown_person', 'Only people with a NooblyJS record can take decisions.');
    return { id: person.id, name: person.name, accessRole: person.accessRole, kind: 'person' };
  }

  async function requirePermission(person, rule, what) {
    if (await host.can(person.accessRole, rule.permission)) return;
    throw forbidden('forbidden', `You can't ${what}: it needs the "${rule.permission}" permission, and your access role is ${person.accessRole}.`, { permission: rule.permission, accessRole: person.accessRole });
  }

  // ---------------------------------------------------------------------------- readiness

  /** Readiness for the item's current stage: n of m, each check in words, the failing ones named. */
  async function readinessOf(item) {
    const checks = await loadReadiness(repos, item.stage);
    if (!checks.length) return { passed: 0, total: 0, checks: [], failing: [], source: 'none' };
    let results = item.readiness?.results ?? {};
    let source = 'recorded';
    const product = item.system === 'product' ? host.service('product') : null;
    if (typeof product?.readinessFacts === 'function') {
      try {
        const facts = (await product.readinessFacts(item.id))?.facts;
        if (facts) {
          results = Object.fromEntries(Object.entries(facts).map(([key, fact]) => [key, fact?.value ?? null]));
          source = 'product';
        }
      } catch (err) {
        log.warn(`readinessFacts(${item.id}) failed, using the recorded result: ${err.message}`);
      }
    }
    const view = checks.map((c) => {
      const result = results[c.key];
      return { key: c.key, passed: result === true, text: result === true ? c.passed : result === false ? c.failed : `${c.passed}: not checked yet` };
    });
    const failing = view.filter((c) => !c.passed);
    return { passed: view.length - failing.length, total: view.length, checks: view, failing, source };
  }

  /** Refuses (422) when readiness fails, unless a person gives an override reason. Returns the override, if any. */
  async function readinessGate(item, override, person, approvalId) {
    const readiness = await readinessOf(item);
    if (!readiness.failing.length) return null;
    const reason = text(override?.reason ?? (typeof override === 'string' ? override : null));
    if (!reason) {
      throw refused('readiness_failed', `${item.ref ?? item.id} isn't ready: ${readiness.passed} of ${readiness.total} checks pass (${readiness.failing.map((c) => c.text).join(', ')}). Fix it first, or override with a reason.`, {
        passed: readiness.passed, total: readiness.total, failing: readiness.failing.map(({ key, text: t }) => ({ key, text: t })),
      });
    }
    const record = { by: person.id, reason, at: now(), failing: readiness.failing.map((c) => c.key) };
    await audit({ actor: person.id, action: 'readiness.overridden', target: item.id, approvalId, failing: record.failing, reason });
    await emit('readiness.overridden', {
      itemId: item.id, approvalId, system: item.system, failing: record.failing, reason,
      summary: `overrode readiness on ${item.ref ?? item.id} (${readiness.failing.map((c) => c.text).join(', ')}): ${reason}`,
    }, person.id);
    return record;
  }

  // ---------------------------------------------------------------------------- stage moves

  async function moveStage(itemId, to, actor, { kind = 'forward', reason = null } = {}) {
    const at = now();
    let from;
    const item = await repos.items.update(itemId, (current) => {
      if (current.status !== 'active') throw conflict('not_active', `${current.ref ?? itemId} is ${current.status}, so it can't move.`);
      from = current.stage;
      const history = (current.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      history.push({ stage: to, enteredAt: at, by: actor.id, ...(kind === 'sent-back' ? { kind, from, reason } : {}) });
      return { ...current, stage: to, stageEnteredAt: at, waitingSince: undefined, work: undefined, history, version: (current.version ?? 0) + 1, updatedAt: at };
    });
    if (!item) throw notFound(`There is no item ${itemId}.`);
    if (kind === 'forward') {
      await emit('item.stage_changed', { itemId, system: item.system, from, to, summary: `moved ${item.ref ?? itemId} · ${item.title} to ${stageLabel(to)}` }, actor.id);
    }
    return { item, from };
  }

  async function complete(itemId, actor, summary) {
    const at = now();
    const item = await repos.items.update(itemId, (current) => {
      if (current.status !== 'active') return null;
      const history = (current.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      return { ...current, status: 'completed', completedAt: at, waitingSince: undefined, work: undefined, history, version: (current.version ?? 0) + 1, updatedAt: at };
    });
    if (item) await emit('item.completed', { itemId, system: item.system, summary }, actor.id);
    return item;
  }

  async function createHandoff(item, approval, actor) {
    const at = now();
    const id = newId('hof');
    const workItems = (approval.workItems ?? []).map((w, i) => ({ id: `WI-${item.id}-${i + 1}`, repo: w.repo, title: w.title, status: 'new' }));
    const repoCount = new Set(workItems.map((w) => w.repo)).size;
    await repos.handoffs.create({
      id, itemId: item.id, from: 'ui', to: 'build', approvalId: approval.id, createdBy: actor.id, createdAt: at,
      workItems, repoCount, estimate: approval.estimate ?? null, openChecks: approval.openChecks ?? [],
      // Where the item may be built (Phase 11): the Software Factory starts runs only in these. None: any.
      ...(approval.repositories?.length ? { repositories: approval.repositories } : {}),
      body: `Handed to the Software Factory by ${actor.name}. The work items sync to Jira in NooblyJS Phase 13.`,
    });
    await emit('handoff.created', {
      handoffId: id, itemId: item.id, system: item.system, from: 'ui', to: 'build', workItemIds: workItems.map((w) => w.id),
      summary: `created ${workItems.length} work item${workItems.length === 1 ? '' : 's'} for ${item.ref ?? item.id} across ${repoCount} repo${repoCount === 1 ? '' : 's'}`,
    }, actor.id);
    return { id, workItems, repoCount };
  }

  // ---------------------------------------------------------------------------- approvals

  const waitingReviewer = (approval, personId) => (approval.reviewers ?? []).find((r) => r.id === personId && r.status === 'waiting');
  const approvedCount = (approval) => (approval.reviewers ?? []).filter((r) => r.status === 'approved').length;
  const quorumMet = (approval, rule) => {
    const n = approvedCount(approval);
    if (rule.quorum === 'all') return n === (approval.reviewers ?? []).length;
    if (rule.quorum === 'any') return n >= 1;
    return n >= rule.quorum;
  };

  const DECIDED_WORDS = {
    spec: (i) => `approved ${i.ref ?? i.id} · ${i.title}`,
    adr: (i, a) => `accepted ${a.subject ?? 'the decision'} · ${a.title}`,
    'ui-handoff': (i) => `approved the handoff of ${i.title} to the Software Factory`,
    merge: (i) => `approved the merge of ${i.ref ?? i.id} · ${i.title}`,
    stage: (i, a) => `approved moving ${i.ref ?? i.id} · ${i.title} to ${stageLabel(a.to)}`,
    'infra-design': (i, a) => `approved ${a.subject ?? 'an infrastructure design'} for ${a.ref?.kindLabel ?? a.ref?.kind ?? 'an environment'}`,
    'devtools-write': (i, a) => `approved a write to ${a.ref?.kindLabel ?? 'Jira or Bitbucket'}: ${a.title}`,
  };

  /**
   * A person's decision on an approval: approve, or request changes (with a reason). Only a named reviewer who is
   * still waiting, whose access role has the rule's permission, may decide. An approval the rule says needs
   * readiness is refused while checks fail, unless the person overrides with a reason.
   */
  async function decideApproval(approvalId, input = {}, actor) {
    const target = `approval ${approvalId}`;
    const person = await personFor(actor, { what: 'approve anything', target });
    const decision = input.decision;
    if (!DECISIONS.has(decision)) throw badRequest('decision must be "approve" or "request-changes".', { decision: 'approve | request-changes' });
    const comment = text(input.comment);
    const reason = text(input.reason) ?? (decision === 'request-changes' ? comment : null);
    if (decision === 'request-changes' && !reason) throw badRequest('Say what needs to change: a reason is required to request changes.', { reason: 'required' });

    const approval = await approvalOr404(approvalId);
    if (approval.status !== 'open') throw conflict('already_decided', `This approval was already ${approval.status === 'approved' ? 'approved' : approval.status === 'withdrawn' ? 'withdrawn' : 'sent back for changes'}.`);
    const rule = await ruleOr500(approval.type);
    await requirePermission(person, rule, `${rule.verb ?? 'approve'} this`);
    if (!waitingReviewer(approval, person.id)) {
      const waiting = (approval.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => r.id);
      throw forbidden('not_a_reviewer', `You aren't a reviewer still waiting on this approval${waiting.length ? `. It is waiting on ${waiting.join(', ')}` : ''}. Ask a reviewer to reassign it to you.`, { waitingOn: waiting });
    }
    const item = await itemOr404(approval.itemId);
    if (approval.from && item.stage !== approval.from && item.status === 'active') {
      throw conflict('stage_changed', `${item.ref ?? item.id} is in ${stageLabel(item.stage)} now, so this ${rule.label ?? 'approval'} no longer applies.`);
    }

    const override = decision === 'approve' && rule.needsReadiness ? await readinessGate(item, input.override, person, approvalId) : null;

    // An app's approval: the app carries the decision out first (and refuses with its own reason), then it is recorded.
    let carried = null;
    if (APP_TYPES.has(approval.type)) {
      const app = host.service?.(approval.ref?.app);
      if (typeof app?.decideApproval !== 'function') {
        throw conflict('app_unavailable', `${rule.label ?? 'This approval'} is decided by ${approval.ref?.app ?? 'another app'}, which is not running here. Nothing was decided.`);
      }
      carried = await app.decideApproval({ ...approval.ref, approvalId, decision, comment: reason ?? comment, person });
    }

    const at = now();
    const updated = await repos.approvals.update(approvalId, (current) => {
      if (current.status !== 'open') throw conflict('already_decided', 'Someone decided this approval a moment ago. Reload to see it.');
      if (!waitingReviewer(current, person.id)) throw conflict('already_decided', 'You already decided this approval.');
      const reviewers = current.reviewers.map((r) => (r.id === person.id && r.status === 'waiting'
        ? { ...r, status: decision === 'approve' ? 'approved' : 'changes-requested', at, ...(comment ? { comment } : {}), ...(reason && decision !== 'approve' ? { reason } : {}) }
        : r));
      const next = { ...current, reviewers, updatedAt: at, ...(override ? { override } : {}) };
      if (decision === 'request-changes') return { ...next, status: 'changes-requested', decidedAt: at, decidedBy: person.id };
      if (quorumMet(next, rule)) return { ...next, status: 'approved', decidedAt: at, decidedBy: person.id };
      return next;
    });
    const outcome = updated.status === 'approved' ? 'approved' : updated.status === 'changes-requested' ? 'changes-requested' : 'pending';
    const reviewer = updated.reviewers.find((r) => r.id === person.id);
    const words = decision === 'approve'
      ? (DECIDED_WORDS[approval.type] ?? DECIDED_WORDS.spec)(item, approval) + (outcome === 'pending' ? ` (${approvedCount(updated)} of ${updated.reviewers.length} reviewers)` : '') + (override ? ' with a readiness override' : '')
      : `asked for changes to ${approval.subject ?? item.ref ?? item.id} · ${approval.title}`;
    await emit('approval.decided', {
      approvalId, itemId: item.id, type: approval.type, subject: approval.subject ?? null, system: item.system,
      decision, outcome, role: reviewer?.role ?? null, reason: reason ?? comment ?? null, version: input.version ?? approval.artefactVersion ?? null, summary: words,
      ...(approval.ref ? { ref: approval.ref } : {}),
    }, person.id);

    let moved = null;
    let handoff = null;
    if (outcome === 'approved') {
      const move = approval.type === 'stage' ? approval.to : MOVES[approval.type];
      if (approval.type === 'ui-handoff') handoff = await createHandoff(item, updated, person);
      if (move === 'complete') await complete(item.id, person, `completed ${item.ref ?? item.id} · ${item.title}`);
      else if (move) moved = (await moveStage(item.id, move, person)).item;
    }
    return {
      approval: updated, outcome, item: moved ?? await repos.items.get(item.id), handoff, ...(carried ? { carried } : {}),
      text: carried?.text ? carried.text : outcome === 'approved'
        ? (moved ? `Approved. ${item.ref ?? item.id} moved to ${stageLabel(moved.stage)}.` : 'Approved.')
        : outcome === 'pending' ? `Your approval is recorded. Still waiting on ${updated.reviewers.filter((r) => r.status === 'waiting').map((r) => r.id).join(', ')}.`
          : 'Changes requested. The requester has been told why.',
    };
  }

  /** Reassign: a waiting reviewer hands their place to someone else whose access role has the rule's permission. */
  async function reassign(approvalId, input = {}, actor) {
    const person = await personFor(actor, { what: 'reassign an approval', target: `approval ${approvalId}` });
    const toId = typeof input.to === 'string' ? input.to : '';
    const reason = text(input.reason);
    const approval = await approvalOr404(approvalId);
    if (approval.status !== 'open') throw conflict('already_decided', 'This approval is already decided, so it can\'t be reassigned.');
    const rule = await ruleOr500(approval.type);
    if (!waitingReviewer(approval, person.id)) throw forbidden('not_a_reviewer', 'Only a reviewer still waiting on this approval can reassign it.');
    const to = await host.people.get(toId);
    if (!to?.active) throw badRequest('Pick a person to hand this to.', { to: 'required' });
    if ((approval.reviewers ?? []).some((r) => r.id === to.id)) throw conflict('already_reviewer', `${to.name} is already a reviewer of this approval.`);
    if (!(await host.can(to.accessRole, rule.permission))) {
      throw refused('cannot_approve', `${to.name} can't take this: it needs the "${rule.permission}" permission, and their access role is ${to.accessRole}.`);
    }
    const at = now();
    const updated = await repos.approvals.update(approvalId, (current) => {
      if (current.status !== 'open' || !waitingReviewer(current, person.id)) throw conflict('already_decided', 'This approval changed a moment ago. Reload to see it.');
      return {
        ...current,
        reviewers: current.reviewers.map((r) => (r.id === person.id && r.status === 'waiting' ? { id: to.id, role: r.role, status: 'waiting', reassignedFrom: person.id, at } : r)),
        reassignments: [...(current.reassignments ?? []), { from: person.id, to: to.id, at, reason }],
        updatedAt: at,
      };
    });
    await emit('approval.reassigned', {
      approvalId, itemId: approval.itemId, type: approval.type, from: person.id, to: to.id, reason,
      summary: `handed ${approval.subject ?? approval.itemId}'s ${rule.label?.toLowerCase() ?? 'approval'} to ${to.name}`,
    }, person.id);
    return { approval: updated, text: `Reassigned to ${to.name}.` };
  }

  async function withdrawOpenApprovals(item, actor, why) {
    const open = (await repos.approvals.list()).filter((a) => a.itemId === item.id && a.status === 'open');
    const at = now();
    for (const a of open) {
      await repos.approvals.update(a.id, (current) => (current.status === 'open' ? { ...current, status: 'withdrawn', decidedAt: at, withdrawnReason: why, updatedAt: at } : null));
      await emit('approval.withdrawn', { approvalId: a.id, itemId: item.id, type: a.type, reason: why, summary: `withdrew the ${a.subject ?? item.ref ?? item.id} approval: ${why}` }, actor.id);
    }
    return open.length;
  }

  // ---------------------------------------------------------------------------- item actions

  /** Send an item back to an earlier stage with a reason (a person with the approve permission). */
  async function sendBack(itemId, input = {}, actor) {
    const person = await personFor(actor, { what: 'send work back', target: `item ${itemId}` });
    await requirePermission(person, { permission: 'approve' }, 'send work back');
    const reason = text(input.reason);
    if (!reason) throw badRequest('Say why it is going back: a reason is required.', { reason: 'required' });
    const to = stageKey(input.to);
    if (!to) throw badRequest(`"to" must be one of ${STAGE_KEYS.join(', ')}.`, { to: 'a stage' });
    const item = await itemOr404(itemId);
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    if (stageIndex(to) >= stageIndex(item.stage)) {
      throw refused('not_earlier', `Send back goes to an earlier stage. ${item.ref ?? item.id} is in ${stageLabel(item.stage)}.`, { to: `before ${item.stage}` });
    }
    await withdrawOpenApprovals(item, person, `${item.ref ?? item.id} was sent back to ${stageLabel(to)}`);
    const { item: moved, from } = await moveStage(item.id, to, person, { kind: 'sent-back', reason });
    await emit('item.sent_back', {
      itemId: item.id, system: item.system, from, to, reason,
      summary: `sent ${item.ref ?? item.id} · ${item.title} back to ${stageLabel(to)}: ${reason}`,
    }, person.id);
    return { item: moved, from, to, text: `${item.ref ?? item.id} is back in ${stageLabel(to)}.` };
  }

  /**
   * Nudge: a person reminds whoever an item is waiting on (the PM home's Nudge). It changes nothing but the record
   * of the nudge, and is refused when nothing is waiting or the item was nudged in the last four hours.
   */
  async function nudge(itemId, actor) {
    const person = await personFor(actor, { what: 'nudge a reviewer', target: `item ${itemId}` });
    await requirePermission(person, { permission: 'draft' }, 'nudge a reviewer');
    const item = await itemOr404(itemId);
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    const open = (await repos.approvals.list()).filter((a) => a.itemId === item.id && a.status === 'open');
    const to = [...new Set(open.flatMap((a) => (a.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => r.id)))].filter((id) => id !== person.id);
    if (!to.length && !item.waitingSince) throw conflict('nothing_waiting', `${item.ref ?? item.id} isn't waiting on anyone, so there is no one to nudge.`);
    const at = now();
    const last = (item.nudges ?? []).at(-1);
    if (last && new Date(at).getTime() - new Date(last.at).getTime() < NUDGE_EVERY_MS) {
      throw conflict('recently_nudged', `${item.ref ?? item.id} was nudged less than four hours ago. Give it a little longer.`);
    }
    await repos.items.update(item.id, (current) => ({ ...current, nudges: [...(current.nudges ?? []).slice(-9), { by: person.id, at, to }] }));
    await emit('item.nudged', {
      itemId: item.id, system: item.system, to,
      summary: `nudged ${to.length ? to.join(', ') : `the ${stageLabel(item.stage)} stage`} about ${item.ref ?? item.id} · ${item.title}`,
    }, person.id);
    return { itemId: item.id, to, text: to.length ? `Nudged ${to.join(', ')}.` : `Nudged the ${stageLabel(item.stage)} stage.` };
  }

  /**
   * Opens an approval with this person as its only reviewer and decides it at once: how a person moves an item on
   * when no approval is waiting ("Approve & move to …"), and how the Product Factory's Send to Software Factory
   * lands. The rule still applies (permission, readiness), and the decision is on record like any other.
   */
  async function openAndDecide({ item, type, to, person, input, extra = {} }) {
    const rule = await ruleOr500(type);
    await requirePermission(person, rule, `${rule.verb ?? 'approve'} this`);
    const at = now();
    const approval = await repos.approvals.create({
      id: newId('apr'), type, itemId: item.id, subject: extra.subject ?? null, title: item.title,
      from: item.stage, to, requestedBy: { id: person.id, name: person.name, kind: 'person' }, requestedAt: at,
      dueAt: dueFrom(at, rule.target), reviewers: [{ id: person.id, role: rule.selfRole ?? 'Approver', status: 'waiting' }],
      status: 'open', ...extra,
    });
    try {
      return await decideApproval(approval.id, { decision: 'approve', comment: input.comment, override: input.override }, person);
    } catch (err) {
      // Refused (readiness, a stage that moved): nothing was decided, so the approval is not left open.
      await repos.approvals.update(approval.id, (a) => (a.status === 'open' ? { ...a, status: 'withdrawn', decidedAt: now(), withdrawnReason: err.message } : null));
      throw err;
    }
  }

  /** "Approve & move to <next stage>" for an item with no approval waiting for that move. */
  async function advance(itemId, input = {}, actor) {
    const person = await personFor(actor, { what: 'move work on', target: `item ${itemId}` });
    const item = await itemOr404(itemId);
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    const open = (await repos.approvals.list()).filter((a) => a.itemId === item.id && a.status === 'open' && a.from === item.stage);
    if (open.length) throw conflict('approval_open', `${item.ref ?? item.id} already has an approval waiting for this step. Decide it in Approvals.`, { approvalIds: open.map((a) => a.id) });
    if (item.stage === 'ship') return openAndDecide({ item, type: 'merge', to: null, person, input, extra: { subject: item.ref ?? item.id } });
    if (item.stage === 'ui') return openAndDecide({ item, type: 'ui-handoff', to: 'build', person, input, extra: { workItems: [] } });
    if (item.stage === 'specify') return openAndDecide({ item, type: 'spec', to: 'architect', person, input });
    return openAndDecide({ item, type: 'stage', to: nextStage(item.stage), person, input });
  }

  // ---------------------------------------------------------------------------- services for other apps

  /** nooblyjs-ai-product's Approve / Request changes on a spec: the open spec approval this person is waiting on. */
  async function decide({ itemId, decision, reason, version, override = null, actor } = {}) {
    const open = (await repos.approvals.list()).filter((a) => a.itemId === itemId && a.type === 'spec' && a.status === 'open');
    if (!open.length) throw conflict('no_open_approval', `${itemId} has no spec approval waiting, so there is nothing to decide.`);
    const mine = open.find((a) => waitingReviewer(a, actor?.id)) ?? open[0];
    return decideApproval(mine.id, { decision, reason, comment: reason, version, ...(override ? { override } : {}) }, actor);
  }

  /**
   * The reviewers for a new approval: the people on the item's team whose access role has the rule's permission
   * and, when that leaves nobody but the person asking, the Owners. Agents are never reviewers.
   */
  async function reviewersFor(rule, team, requesterId) {
    const everyone = (await host.people.list()).filter((p) => p.active !== false && p.kind !== 'agent');
    const may = [];
    for (const p of everyone) if (await host.can(p.accessRole, rule.permission)) may.push(p);
    let picked = may.filter((p) => team && (p.teams ?? []).includes(team));
    if (!picked.some((p) => p.id !== requesterId)) {
      const owners = may.filter((p) => p.accessRole === 'Owner');
      picked = [...picked, ...owners.filter((o) => !picked.some((p) => p.id === o.id))];
    }
    return picked.map((p) => ({ id: p.id, role: p.jobTitle ?? p.accessRole, status: 'waiting' }));
  }

  /**
   * nooblyjs-ai-product's Send for review: opens the spec approval for an item, and the item itself when the lifecycle
   * doesn't know it yet (a spec drafted from a new idea). Asking for review is a proposal, not a decision,
   * so it needs `draft`; who decides is the rule's business. Refused while another spec approval is open.
   */
  async function requestApproval({ itemId, type = 'spec', title, team = null, version = null, cost = null, actor } = {}) {
    const person = await personFor(actor, { what: 'ask for an approval', target: `item ${itemId}` });
    if (!(await host.can(person.accessRole, 'draft'))) {
      throw forbidden('forbidden', `You can't ask for a review: it needs the "draft" permission, and your access role is ${person.accessRole}.`, { permission: 'draft', accessRole: person.accessRole });
    }
    if (type !== 'spec') throw badRequest('Only a spec approval can be requested this way.', { type: 'spec' });
    const rule = await ruleOr500(type);
    const at = now();
    let item = await repos.items.get(itemId);
    if (!item) {
      const cleanTitle = text(title, 200);
      if (!cleanTitle) throw badRequest('A new item needs a title.', { title: 'required' });
      const full = await host.people.get(person.id);
      item = await repos.items.create({
        id: itemId, type: 'spec', ref: itemId, title: cleanTitle, system: 'product', stage: 'specify', status: 'active',
        owner: person.id, team: team ?? full?.teams?.[0] ?? null, createdAt: at, stageEnteredAt: at,
        history: [{ stage: 'specify', enteredAt: at, by: person.id }], version: 1, updatedAt: at,
      });
      await emit('item.created', { itemId, system: 'product', stage: 'specify', summary: `opened ${itemId} · ${cleanTitle}` }, person.id);
    }
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    if (item.stage !== 'specify') throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}, so its spec isn't up for review.`);
    const open = (await repos.approvals.list()).find((a) => a.itemId === item.id && a.type === type && a.status === 'open');
    if (open) throw conflict('approval_open', `${item.ref ?? item.id} already has a spec approval waiting.`, { approvalIds: [open.id] });
    const reviewers = await reviewersFor(rule, item.team, person.id);
    if (!reviewers.length) throw conflict('no_reviewers', `Nobody has the "${rule.permission}" permission to review this. Ask an Owner to give someone the Approver role.`);
    const approval = await repos.approvals.create({
      id: newId('apr'), type, itemId: item.id, title: item.title, from: item.stage, to: MOVES[type],
      requestedBy: { id: person.id, name: person.name, kind: 'person' }, requestedAt: at, dueAt: dueFrom(at, rule.target),
      artefactVersion: version, reviewers, status: 'open', ...(cost ? { cost } : {}),
    });
    await emit('approval.requested', {
      approvalId: approval.id, itemId: item.id, type, system: item.system, reviewerIds: reviewers.map((r) => r.id), version,
      summary: `asked for review of ${item.ref ?? item.id} · ${item.title}`,
    }, person.id);
    return { approvalId: approval.id, itemId: item.id, reviewers, dueAt: approval.dueAt };
  }

  /** nooblyjs-ai-product's Send to Software Factory: the UI handoff decision, which creates the work items. */
  async function handoff({ itemId, workItems = [], repositories = [], estimate = null, repoCount, openChecks = [], note = null, actor } = {}) {
    const person = await personFor(actor, { what: 'send work to the Software Factory', target: `item ${itemId}` });
    const item = await itemOr404(itemId);
    if (item.stage !== 'ui') {
      throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}, so it can't go to the Software Factory yet: handoffs leave from UI design.`);
    }
    const items = (Array.isArray(workItems) ? workItems : []).filter((w) => w?.repo && w?.title).map((w) => ({ repo: String(w.repo), title: String(w.title) }));
    const where = (Array.isArray(repositories) ? repositories : []).map(String).filter(Boolean);
    const outside = where.length ? items.filter((w) => !where.some((r) => r === w.repo || r.split('/').pop() === w.repo)) : [];
    if (outside.length) throw refused('outside_repositories', `${outside.map((w) => w.repo).join(', ')} is not among the item's repositories.`, { outside: outside.map((w) => w.repo) });
    const open = (await repos.approvals.list()).find((a) => a.itemId === item.id && a.type === 'ui-handoff' && a.status === 'open');
    if (open) {
      await repos.approvals.update(open.id, (a) => ({ ...a, workItems: items.length ? items : a.workItems, ...(where.length ? { repositories: where } : {}), estimate: estimate ?? a.estimate ?? null, openChecks }));
      return decideApproval(open.id, { decision: 'approve', comment: note }, person);
    }
    return openAndDecide({ item, type: 'ui-handoff', to: 'build', person, input: { comment: note }, extra: { workItems: items, ...(where.length ? { repositories: where } : {}), estimate, openChecks, repoCount: repoCount ?? null } });
  }

  /** adr.accepted from the Product Factory (Accept on the Architecture screen): the open ADR approval is done. */
  async function onAdrAccepted(event) {
    const p = event?.payload ?? {};
    if (!p.adrId) return;
    try {
      const open = (await repos.approvals.list()).find((a) => a.type === 'adr' && a.subject === p.adrId && a.status === 'open');
      if (!open) return;
      const at = event.at ?? now();
      const updated = await repos.approvals.update(open.id, (a) => (a.status === 'open' ? {
        ...a,
        status: 'approved', decidedAt: at, decidedBy: event.actor ?? null, updatedAt: at,
        reviewers: a.reviewers.map((r) => (r.id === event.actor && r.status === 'waiting' ? { ...r, status: 'approved', at } : r)),
        closedBy: 'adr.accepted',
      } : null));
      if (updated) log.info(`${open.id} closed: ${p.adrId} was accepted in the Product Factory`);
    } catch (err) {
      log.error(`adr.accepted for ${p.adrId}: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------- reminders and escalation

  let sweeping = Promise.resolve();

  /**
   * Reminds the waiting reviewers of every open approval past its due time, and escalates to the Owners those whose
   * rule says so, one working day after that (product.md §4). Each happens once per approval. Runs on a timer and
   * straight after the dev clock moves; calls are serialised.
   */
  function sweep(at = now()) {
    const run = sweeping.then(async () => {
      const done = { reminded: [], escalated: [] };
      const all = await rules();
      const owners = (await host.people.list()).filter((p) => p.active);
      for (const a of await repos.approvals.list()) {
        if (a.status !== 'open' || !a.dueAt) continue;
        const rule = all.get(a.type);
        if (!rule) continue;
        const waiting = (a.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => r.id);
        if (rule.remind !== false && at >= a.dueAt && !(a.reminders ?? []).length) {
          await repos.approvals.update(a.id, (cur) => (cur.status === 'open' && !(cur.reminders ?? []).length ? { ...cur, reminders: [{ at, to: waiting }] } : null));
          await audit({ actor: 'system', action: 'approval.reminded', target: a.id, itemId: a.itemId, to: waiting });
          await emit('approval.reminded', {
            approvalId: a.id, itemId: a.itemId, type: a.type, to: waiting, actorName: 'Lifecycle',
            summary: `reminded ${waiting.join(', ')} that ${a.subject ?? a.itemId}'s ${rule.label?.toLowerCase() ?? 'approval'} is past its target (${rule.targetText})`,
          }, 'system');
          done.reminded.push(a.id);
        }
        const escalateAt = rule.escalate ? addWorkingDays(a.dueAt, rule.escalate.afterWorkingDays ?? 1) : null;
        if (escalateAt && at >= escalateAt && !a.escalated) {
          const role = rule.escalate.to ?? 'Owner';
          const to = owners.filter((p) => p.accessRole === role).map((p) => p.id);
          await repos.approvals.update(a.id, (cur) => (cur.status === 'open' && !cur.escalated ? { ...cur, escalated: { at, to } } : null));
          await audit({ actor: 'system', action: 'approval.escalated', target: a.id, itemId: a.itemId, to });
          await emit('approval.escalated', {
            approvalId: a.id, itemId: a.itemId, type: a.type, to, actorName: 'Lifecycle',
            summary: `escalated ${a.subject ?? a.itemId}'s ${rule.label?.toLowerCase() ?? 'approval'} to ${to.join(', ') || `the ${role}s`}: still waiting on ${waiting.join(', ')}`,
          }, 'system');
          done.escalated.push(a.id);
        }
      }
      return done;
    });
    sweeping = run.catch((err) => log.error(`sweep failed: ${err.message}`));
    return run;
  }

  /**
   * Another app asks for an approval on its own artefact (NooblyJS Infrastructure: a design version for one kind of
   * environment). `ref` says what it is ({ app, designId, version, kind, kindLabel }); the reviewers are the
   * people with the rule's permission. An open approval for the same artefact and kind is returned, not doubled.
   */
  async function requestAppApproval({ type, itemId, title, subject = null, ref, link = null, line = null, context = null, requestedBy } = {}) {
    if (!APP_TYPES.has(type)) throw badRequest(`${type} is not an approval another app may open.`);
    if (!ref?.app) throw badRequest('An app approval needs ref.app: the app that carries the decision out.');
    const rule = await ruleOr500(type);
    const item = await itemOr404(itemId);
    const open = (await repos.approvals.list()).find((a) => a.type === type && a.status === 'open' && sameRef(a.ref, ref));
    if (open) {
      if ((open.ref?.version ?? null) === (ref.version ?? null)) return { approvalId: open.id, existing: true };
      await withdrawApp(open, `version ${ref.version} replaced version ${open.ref?.version}`);
    }
    const at = now();
    const reviewers = await reviewersFor(rule, item.team, requestedBy?.id ?? null);
    if (!reviewers.length) throw conflict('no_reviewers', `Nobody has the "${rule.permission}" permission to decide this.`);
    const approval = await repos.approvals.create({
      id: newId('apr'), type, itemId: item.id, title: text(title, 200) ?? item.title, subject: text(subject, 120), from: null, to: null,
      requestedBy: requestedBy ?? { id: ref.app, name: ref.app, kind: 'app' }, requestedAt: at, dueAt: dueFrom(at, rule.target),
      artefactVersion: ref.version ?? null, reviewers, status: 'open', ref, link, line, context,
      // What the reviewer is approving, in a sentence (Home · Approvals shows it with the link to the artefact).
      ...(context ? { body: text(context) } : {}),
    });
    await emit('approval.requested', {
      approvalId: approval.id, itemId: item.id, type, system: ref.app, reviewerIds: reviewers.map((r) => r.id), version: ref.version ?? null, ref,
      summary: `asked for approval of ${approval.subject ?? approval.title}${ref.kindLabel ? ` for ${ref.kindLabel}` : ''}`,
    }, requestedBy?.id ?? null);
    return { approvalId: approval.id, reviewers, dueAt: approval.dueAt };
  }

  /**
   * The app decided on its own screen: the open approval for that artefact is closed with the same decision, by the
   * same person, without asking the app again. Returns the approval, or null when none was open.
   */
  async function closeAppApproval({ type, ref, decision, reason = null, actor } = {}) {
    if (!APP_TYPES.has(type) || !DECISIONS.has(decision)) throw badRequest('closeAppApproval needs an app approval type and a decision.');
    const person = await personFor(actor, { what: 'approve anything', target: `${type} ${ref?.designId ?? ''}` });
    const open = (await repos.approvals.list()).find((a) => a.type === type && a.status === 'open' && sameRef(a.ref, ref));
    if (!open) return null;
    const at = now();
    const status = decision === 'approve' ? 'approved' : 'changes-requested';
    const updated = await repos.approvals.update(open.id, (current) => (current.status !== 'open' ? null : {
      ...current, status, decidedAt: at, decidedBy: person.id, decidedVia: ref.app, updatedAt: at,
      reviewers: current.reviewers.map((r) => (r.status === 'waiting' ? { ...r, status: r.id === person.id ? status : 'not-needed', at } : r)),
    }));
    if (!updated) return null;
    const item = await repos.items.get(open.itemId);
    await emit('approval.decided', {
      approvalId: open.id, itemId: open.itemId, type, subject: open.subject ?? null, system: ref.app, decision, outcome: status, reason: text(reason), ref: open.ref, via: ref.app,
      summary: decision === 'approve' ? DECIDED_WORDS[type](item ?? {}, open) : `asked for changes to ${open.subject ?? open.title}`,
    }, person.id);
    return updated;
  }

  async function withdrawApp(approval, why) {
    const at = now();
    await repos.approvals.update(approval.id, (current) => (current.status === 'open' ? { ...current, status: 'withdrawn', decidedAt: at, withdrawnReason: why, updatedAt: at } : null));
    await emit('approval.withdrawn', { approvalId: approval.id, itemId: approval.itemId, type: approval.type, reason: why, ref: approval.ref, summary: `withdrew the approval of ${approval.subject ?? approval.title}: ${why}` }, null);
  }

  /** The app's artefact no longer waits (a newer version, or it was decided elsewhere): its open approvals go. */
  async function withdrawAppApprovals({ type, ref, reason }) {
    const open = (await repos.approvals.list()).filter((a) => a.type === type && a.status === 'open' && a.ref?.app === ref?.app && a.ref?.designId === ref?.designId && (!ref?.kind || a.ref?.kind === ref.kind));
    for (const a of open) await withdrawApp(a, reason ?? 'no longer needed');
    return open.length;
  }

  /**
   * The item's pull requests were merged in Bitbucket by people (NooblyJS Phase 13): the item moves Build → Ship. The
   * decision is the merge, taken by a person in Bitbucket under Bitbucket's own rules, so it is recorded as theirs
   * ("merged in Bitbucket by …") and no NooblyJS approval is opened. NooblyJS itself never merges: the caller passes who
   * merged, and a merge with nobody named, or by an agent, is refused here as well.
   */
  async function movedByMerge({ itemId, mergedBy = [], pullRequests = [] } = {}) {
    const names = mergedBy.map((m) => text(m?.name ?? m, 120)).filter(Boolean);
    if (!names.length || mergedBy.some((m) => m?.kind === 'agent')) {
      await audit({ actor: 'system', action: 'access.refused', target: `item ${itemId}`, reason: 'agents propose, people decide: only a person\'s merge moves an item to Ship' });
      throw forbidden('people_only', 'Only a person\'s merge in Bitbucket moves an item to Ship.');
    }
    const item = await itemOr404(itemId);
    if (item.status !== 'active' || item.stage !== 'build') return { moved: false, item, reason: item.stage === 'ship' ? 'already in Ship' : `${item.ref ?? item.id} is not in Build` };
    const by = { id: 'bitbucket', name: `Bitbucket (merged by ${[...new Set(names)].join(', ')})`, kind: 'system' };
    const open = (await repos.approvals.list()).filter((a) => a.itemId === item.id && a.status === 'open' && a.from === 'build');
    const at = now();
    for (const a of open) {
      await repos.approvals.update(a.id, (current) => (current.status === 'open' ? { ...current, status: 'withdrawn', decidedAt: at, withdrawnReason: 'merged in Bitbucket', updatedAt: at } : null));
      await emit('approval.withdrawn', { approvalId: a.id, itemId: item.id, type: a.type, reason: 'merged in Bitbucket', summary: `withdrew the ${a.subject ?? item.ref ?? item.id} approval: merged in Bitbucket` }, by.id);
    }
    await audit({ actor: by.id, action: 'item.moved_by_merge', target: item.id, itemId: item.id, mergedBy: [...new Set(names)], pullRequests });
    const moved = (await moveStage(item.id, 'ship', by)).item;
    await emit('item.merged', {
      itemId: item.id, system: item.system, mergedBy: [...new Set(names)], pullRequests, actorName: by.name,
      summary: `${item.ref ?? item.id} · ${item.title} moved to Ship: its pull request${pullRequests.length === 1 ? ' was' : 's were'} merged in Bitbucket by ${[...new Set(names)].join(', ')}`,
    }, by.id);
    return { moved: true, item: moved };
  }

  return { readinessOf, decideApproval, reassign, sendBack, advance, nudge, decide, requestApproval, handoff, sweep, onAdrAccepted, rules, now, requestAppApproval, closeAppApproval, withdrawAppApprovals, movedByMerge };
}
