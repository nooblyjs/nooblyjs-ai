// The lifecycle engine (NooblyJS product.md §4): items move through the eight stages (lifecycle v3, root product.md
// §3.2), and a person approves each gate. Agents propose, people decide: every decision here refuses an agent before
// anything else, whatever its access role. A rule's permission says whom an approval waits on (never a work role);
// since Phase 16b any person but a Viewer may give it on behalf of one of them, and who gave it, for whom, is recorded.
//
// Every change is written to its file and emitted as an event in the same operation; NooblyJS's Activity, the event
// stream and the other apps read the events. Business time comes from the host's clock (the dev clock moves it).
import { HttpError, badRequest, forbidden, notFound, conflict, refused } from '../errors.js';
import { STAGE_KEYS, LEGACY, stageKey, stageLabel, stageIndex, nextStage, currentStage } from '../stages.js';
import { addWorkingDays, dueFrom } from '../working-days.js';
import { loadRules, loadReadiness, loadPullRequestReadiness } from '../config.js';
import { newId } from '../ids.js';
import { ITEM_ID } from '../repos.js';
import { createPullRequests } from './pull-requests.js';
import { createLifecycleChecks } from './checks.js';

const DECISIONS = new Set(['approve', 'request-changes']);
const MAX_TEXT = 2000;
const NUDGE_EVERY_MS = 4 * 3_600_000;

/**
 * What an approved approval does to its item, by rule key. Rules not listed (adr, the app approvals) don't move it.
 * Lifecycle v3 (Phase 16b): the Product handoff (spec) → Design → Engineer → Build → Test → Release → Operate, and the
 * item is done after its outcome review. `merge` is the Build approval's key from before (an older open one moves too).
 */
const MOVES = {
  idea: 'product', spec: 'design', 'design-handoff': 'engineer', 'engineering-signoff': 'build', 'build-approval': 'test', merge: 'test',
  'test-approval': 'release', deploy: 'operate', 'outcome-review': 'complete', stage: null,
};

/** The approval that leaves each stage when a person presses Approve & move (any other stage: a plain stage move). */
const LEAVES_BY = {
  discover: 'idea', product: 'spec', design: 'design-handoff', engineer: 'engineering-signoff', build: 'build-approval', test: 'test-approval',
  release: 'deploy', operate: 'outcome-review',
};

/** Open approvals of retired rules, withdrawn when the stages move (Phase 16b), and why. */
const RETIRED_APPROVALS = {
  'ui-handoff': 'the UI handoff is replaced by the Design handoff (lifecycle v3)',
  'release-candidate': 'the release candidate is replaced by the Test approval (lifecycle v3)',
};

/**
 * Approvals another NooblyJS app asks for, on its own artefact. The app named in the approval's `ref.app` carries the
 * decision out (its `decideApproval` service) before it is recorded here, so its rules refuse the same way on
 * Home · Approvals as on its own screen. They move no stage.
 */
const APP_TYPES = new Set(['infra-design', 'devtools-write', 'threat-model', 'risk-acceptance']);
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

  /**
   * Any person may give an approval, for themselves or on someone's behalf, except a Viewer (Phase 16b). The refusal is
   * audited, like an agent's.
   */
  async function requireApprover(person, target) {
    if (person.accessRole !== 'Viewer') return;
    await audit({ actor: person.id, action: 'access.refused', target: target ?? null, reason: 'viewers can\'t approve' });
    throw forbidden('viewers_cannot_approve', `Viewers can't approve, for themselves or on anyone's behalf. Your access role is ${person.accessRole}.`, { accessRole: person.accessRole });
  }

  async function requirePermission(person, rule, what) {
    if (await host.can(person.accessRole, rule.permission)) return;
    throw forbidden('forbidden', `You can't ${what}: it needs the "${rule.permission}" permission, and your access role is ${person.accessRole}.`, { permission: rule.permission, accessRole: person.accessRole });
  }

  // ---------------------------------------------------------------------------- readiness

  const NO_CHECKS = { passed: 0, total: 0, checks: [], failing: [], source: 'none' };
  const factsOf = (facts) => ({
    results: Object.fromEntries(Object.entries(facts).map(([key, fact]) => [key, fact?.value ?? null])),
    details: Object.fromEntries(Object.entries(facts).filter(([, fact]) => fact?.detail).map(([key, fact]) => [key, fact.detail])),
  });

  /**
   * Readiness for the item's current stage: n of m, each check in words, the failing ones named. In Design (Phase 16c)
   * the Design section works the checks out, for a story from its item's design; an item with no Design work (handed off
   * before 16c, or with the Design section not running here) has no Design checks. In Engineer (Phase 16d) the Software
   * Factory works them out from the story's application architecture and test analysis, the same way.
   */
  /**
   * Readiness, with the checks a person overrode one by one for this stage (Phase 16f): an overridden check no longer
   * holds the decision, and says who overrode it and why.
   */
  async function readinessOf(item) {
    const readiness = await stageReadiness(item);
    const overrides = item.checkOverrides ?? {};
    if (!readiness.total || !Object.keys(overrides).length) return readiness;
    const checks = readiness.checks.map((c) => {
      const o = overrides[`${item.stage}:${c.key}`];
      return o && !c.passed ? { ...c, passed: true, overridden: o, text: `${c.text} · overridden by ${o.byName ?? o.by}: ${o.reason}` } : c;
    });
    const failing = checks.filter((c) => !c.passed);
    return { ...readiness, passed: checks.length - failing.length, checks, failing };
  }

  async function stageReadiness(item) {
    // A pull request's Test approval (Phase 16e): worked out from the evidence of its commit.
    if (item.stage === 'test' && item.type === 'pr' && item.pr) return pullRequestReadiness(item);
    const checks = await loadReadiness(repos, item.stage);
    if (!checks.length) return NO_CHECKS;
    let results = item.readiness?.results ?? {};
    let details = {};
    let extraChecks = {};
    let source = 'recorded';
    if (item.stage === 'design') {
      const design = host.service('design');
      if (typeof design?.readinessFacts !== 'function') return NO_CHECKS;
      try {
        const facts = (await design.readinessFacts(item.parentId ?? item.id))?.facts;
        if (!facts) return NO_CHECKS;
        ({ results, details } = factsOf(facts));
        source = 'design';
      } catch (err) {
        log.warn(`design readinessFacts(${item.id}) failed: ${err.message}`);
        return NO_CHECKS;
      }
    }
    if (item.stage === 'engineer') {
      const factory = host.service('factory');
      if (typeof factory?.engineeringReadiness !== 'function') return NO_CHECKS;
      try {
        const facts = (await factory.engineeringReadiness(item.id))?.facts;
        if (!facts) return NO_CHECKS;
        ({ results, details } = factsOf(facts));
        source = 'factory';
      } catch (err) {
        log.warn(`engineering readiness(${item.id}) failed: ${err.message}`);
        return NO_CHECKS;
      }
    }
    const product = item.system === 'product' && !['design', 'engineer'].includes(item.stage) ? host.service('product') : null;
    if (typeof product?.readinessFacts === 'function') {
      try {
        const facts = (await product.readinessFacts(item.id))?.facts;
        if (facts) {
          ({ results, details } = factsOf(facts));
          extraChecks = Object.fromEntries(Object.entries(facts).filter(([, f]) => f?.check?.passed && f?.check?.failed).map(([k, f]) => [k, { passed: f.check.passed, failed: f.check.failed }]));
          source = 'product';
        } else if (item.stage === 'discover') return NO_CHECKS; // Phase 17: only an idea has a business case to check
      } catch (err) {
        log.warn(`readinessFacts(${item.id}) failed, using the recorded result: ${err.message}`);
      }
    } else if (item.stage === 'discover') return NO_CHECKS;
    // A fact that carries its own words (Phase 18: a spec's open questions) is a check of that item only.
    const extra = Object.entries(extraChecks).filter(([key]) => !checks.some((c) => c.key === key)).map(([key, words]) => ({ key, ...words }));
    const view = [...checks, ...extra].map((c) => {
      const result = results[c.key];
      const failed = details[c.key] ? `${c.failed}: ${details[c.key]}` : c.failed;
      return { key: c.key, passed: result === true, text: result === true ? c.passed : result === false ? failed : `${c.passed}: not checked yet` };
    });
    const failing = view.filter((c) => !c.passed);
    return { passed: view.length - failing.length, total: view.length, checks: view, failing, source };
  }

  /**
   * A pull request's Test readiness (Phase 16e), from the evidence the Software Factory recorded for its commit: every
   * required test present and passing, and the gates passed on that commit.
   */
  async function pullRequestReadiness(item) {
    const checks = await loadPullRequestReadiness(repos);
    const ev = item.pr.evidence ?? null;
    const sha = String(item.pr.sha ?? '').slice(0, 7);
    const facts = {
      'required-tests': ev && !ev.missing?.length && !ev.failing?.length && !ev.unproven?.length
        ? { value: true }
        : { value: false, detail: ev ? ev.text : 'no evidence was recorded for this commit' },
      'gates-passed': item.pr.gates === 'passed' ? { value: true } : { value: false, detail: item.pr.checking ? `the Factory is still checking ${sha}` : item.pr.gates === 'failed' ? `they failed on ${sha}` : `none ran on ${sha}` },
    };
    const { results, details } = factsOf(facts);
    const view = checks.map((c) => ({ key: c.key, passed: results[c.key] === true, text: results[c.key] === true ? c.passed : details[c.key] ? `${c.failed}: ${details[c.key]}` : c.failed }));
    const failing = view.filter((c) => !c.passed);
    return { passed: view.length - failing.length, total: view.length, checks: view, failing, source: 'factory' };
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
      await emit('item.stage_changed', { itemId, system: item.system, from, to, ...(item.type === 'pr' ? { itemType: 'pr', parentId: item.parentId } : {}), summary: `moved ${item.ref ?? itemId} · ${item.title} to ${stageLabel(to)}` }, actor.id);
    }
    // A story follows its pull requests (Phase 16e); an item its stories (Phase 16c).
    if (item.parentId) await (item.type === 'pr' ? prs.followPullRequests(item.parentId) : followStories(item.parentId));
    return { item, from };
  }

  // ---------------------------------------------------------------------------- stories (Phase 16c)

  /** The stories of an item (lifecycle items of type story whose parentId it is), withdrawn ones left out. */
  async function storiesOf(parentId) {
    return (await repos.items.list()).filter((i) => i.type === 'story' && i.parentId === parentId && i.status !== 'withdrawn')
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  }

  /** Refuses a decision on an item as a whole once it has stories: from Design on it goes story by story. */
  async function refuseWithStories(item, what) {
    if (item.type === 'story') return;
    const stories = await storiesOf(item.id);
    if (!stories.length) return;
    throw refused('per_story', `${item.ref ?? item.id} goes on story by story: ${what} each of its ${stories.length} stories (${stories.map((st) => st.ref ?? st.id).join(', ')}) instead.`, { stories: stories.map((st) => st.id) });
  }

  /**
   * Refuses a Build or Test decision on a story as a whole once the Factory has delivered pull requests for it, and on a
   * pull request outside its own approvals: from Phase 16e it goes pull request by pull request.
   */
  async function refuseWithPullRequests(item, what) {
    if (item.type === 'pr' && item.pr) {
      throw refused('per_pull_request', `${item.ref ?? item.id} moves on with its own Build and Test approvals: decide them in Approvals or on its page.`);
    }
    if (item.type !== 'story' || !['build', 'test'].includes(item.stage)) return;
    const list = (await prs.prsOf(item.id)).filter((p) => p.pr);
    if (!list.length) return;
    throw refused('per_pull_request', `${item.ref ?? item.id} goes on pull request by pull request: ${what} each of ${list.map((p) => p.ref ?? p.id).join(', ')} with its Build and Test approvals instead.`, { pullRequests: list.map((p) => p.id) });
  }

  /**
   * The item follows its stories (Phase 16c): it stays in Design while any of them is there, then its stage is the
   * earliest of its active stories'. Nobody decided this, so it is on record (history and audit) but no stage event is
   * emitted, and Metrics counts no handoff.
   */
  async function followStories(parentId) {
    const stories = (await storiesOf(parentId)).filter((st) => st.status === 'active');
    if (!stories.length) return null;
    const to = stories.some((st) => st.stage === 'design') ? 'design' : stories.map((st) => st.stage).sort((a, b) => stageIndex(a) - stageIndex(b))[0];
    const at = now();
    let from = null;
    const parent = await repos.items.update(parentId, (current) => {
      if (current.status !== 'active' || current.stage === to) return null;
      from = current.stage;
      const history = (current.history ?? []).map((h) => ({ ...h }));
      const open = history.at(-1);
      if (open && !open.leftAt) open.leftAt = at;
      history.push({ stage: to, enteredAt: at, by: 'system', kind: 'stories' });
      return { ...current, stage: to, stageEnteredAt: at, history, version: (current.version ?? 0) + 1, updatedAt: at };
    });
    if (parent) await audit({ actor: 'system', action: 'item.followed_stories', target: parentId, itemId: parentId, from, to, stories: stories.map((st) => st.id) });
    return parent;
  }

  /**
   * The Design section's stories for an item in Design (Phase 16c): each one the lifecycle doesn't have becomes an item
   * of its own in Design (type story, linked to its item and its feature); those still in Design take the new title and
   * feature; those in Design that are no longer listed (merged away, removed) are withdrawn, with the reason said. A
   * story already handed off is left as it is. Changing the stories is drafting, so it needs `draft`.
   */
  async function syncStories({ itemId, stories = [], reason = null, actor } = {}) {
    const person = await personFor(actor, { what: 'change the stories', target: `item ${itemId}` });
    await requirePermission(person, { permission: 'draft' }, 'change the stories');
    const parent = await itemOr404(itemId);
    if (parent.type === 'story') throw badRequest('A story has no stories of its own.');
    if (parent.status !== 'active' || parent.stage !== 'design') {
      throw conflict('wrong_stage', `${parent.ref ?? parent.id} is in ${stageLabel(parent.stage)}, so its stories can't change: stories are written in Design.`);
    }
    const listed = (Array.isArray(stories) ? stories : []).map((st) => ({
      id: String(st?.id ?? ''), title: text(st?.title, 200),
      feature: st?.feature?.id ? { id: String(st.feature.id).slice(0, 40), title: text(st.feature.title, 200) } : null,
    }));
    const bad = listed.find((st) => !ITEM_ID.test(st.id) || !st.id.startsWith('STORY-') || !st.title);
    if (bad) throw badRequest(`Each story needs an id like STORY-031-1 and a title (${bad.id || 'no id'}).`);
    const at = now();
    const existing = (await repos.items.list()).filter((i) => i.type === 'story' && i.parentId === parent.id);
    const done = { created: [], updated: [], withdrawn: [] };
    for (const st of listed) {
      const found = existing.find((i) => i.id === st.id);
      if (!found) {
        if (await repos.items.get(st.id)) throw conflict('exists', `${st.id} is already an item of another item.`);
        await repos.items.create({
          id: st.id, type: 'story', ref: st.id, title: st.title, system: 'factory', parentId: parent.id, feature: st.feature,
          stage: 'design', status: 'active', owner: parent.owner ?? null, team: parent.team ?? null, createdAt: at, stageEnteredAt: at,
          history: [{ stage: 'design', enteredAt: at, by: person.id }], version: 1, updatedAt: at,
        });
        await emit('item.created', { itemId: st.id, parentId: parent.id, system: 'factory', stage: 'design', summary: `opened ${st.id} · ${st.title}, a story of ${parent.ref ?? parent.id}` }, person.id);
        done.created.push(st.id);
      } else if (found.status === 'active' && found.stage === 'design' && (found.title !== st.title || found.feature?.id !== st.feature?.id || found.feature?.title !== st.feature?.title)) {
        await repos.items.update(found.id, (current) => ({ ...current, title: st.title, feature: st.feature, version: (current.version ?? 0) + 1, updatedAt: at }));
        done.updated.push(found.id);
      }
    }
    for (const found of existing.filter((i) => i.status === 'active' && i.stage === 'design' && !listed.some((st) => st.id === i.id))) {
      const why = reason ?? `${found.ref ?? found.id} is no longer one of ${parent.ref ?? parent.id}'s stories`;
      await withdrawOpenApprovals(found, person, why);
      await repos.items.update(found.id, (current) => ({ ...current, status: 'withdrawn', withdrawnAt: at, withdrawnReason: why, version: (current.version ?? 0) + 1, updatedAt: at }));
      await emit('item.withdrawn', { itemId: found.id, parentId: parent.id, system: 'factory', reason: why, summary: `withdrew ${found.ref ?? found.id} · ${found.title}: ${why}` }, person.id);
      done.withdrawn.push(found.id);
    }
    return done;
  }

  /**
   * One story's Design handoff (Phase 16c): the person gives the story's `design-handoff` approval, with Design's
   * readiness checks (or an override with a reason), and the story moves to Engineer with its work items (one per
   * impacted system it touches). Its item stays in Design until its last story goes.
   */
  async function handoffStory({ storyId, workItems = [], note = null, override = null, actor } = {}) {
    const person = await personFor(actor, { what: 'hand work on to Engineering', target: `item ${storyId}` });
    const story = await itemOr404(storyId);
    if (story.type !== 'story') throw badRequest(`${story.ref ?? story.id} is not a story: hand it off from its own page.`);
    if (story.status !== 'active' || story.stage !== 'design') {
      throw conflict('wrong_stage', `${story.ref ?? story.id} is ${story.status !== 'active' ? story.status : `in ${stageLabel(story.stage)}`}, so it can't be handed to Engineering: the Design handoff leaves from Design.`);
    }
    const items = (Array.isArray(workItems) ? workItems : []).filter((w) => w?.repo && w?.title).map((w) => ({ repo: String(w.repo), title: String(w.title) }));
    const input = { comment: note, ...(override ? { override } : {}) };
    const open = (await repos.approvals.list()).find((a) => a.itemId === story.id && a.type === 'design-handoff' && a.status === 'open');
    if (open) {
      await repos.approvals.update(open.id, (a) => ({ ...a, workItems: items.length ? items : a.workItems }));
      return decideApproval(open.id, { decision: 'approve', ...input }, person);
    }
    return openAndDecide({ item: story, type: 'design-handoff', to: 'engineer', person, input, extra: { subject: story.ref ?? story.id, workItems: items, repoCount: new Set(items.map((w) => w.repo)).size } });
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

  /**
   * The work planned for an item: the work items, repositories, estimate and open checks of its latest approved Design
   * handoff (Phase 16b), or of `approval` itself when it carries them.
   */
  async function plannedWork(item, approval) {
    if (approval.workItems?.length) return approval;
    const handed = (await repos.approvals.list())
      .filter((a) => a.itemId === item.id && a.type === 'design-handoff' && a.status === 'approved')
      .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));
    return handed.at(-1) ?? approval;
  }

  /**
   * The work goes to the Software Factory: the handoff record and its work items, and handoff.created, which the
   * Factory's intake turns into runs. Since Phase 16b this happens on the Engineering sign-off, never before it.
   */
  async function createHandoff(item, approval, actor) {
    const at = now();
    const id = newId('hof');
    const plan = await plannedWork(item, approval);
    const workItems = (plan.workItems ?? []).map((w, i) => ({ id: `WI-${item.id}-${i + 1}`, repo: w.repo, title: w.title, status: 'new' }));
    const repoCount = new Set(workItems.map((w) => w.repo)).size;
    await repos.handoffs.create({
      id, itemId: item.id, from: 'engineer', to: 'build', approvalId: approval.id, createdBy: actor.id, createdAt: at,
      workItems, repoCount, estimate: plan.estimate ?? null, openChecks: plan.openChecks ?? [],
      // Where the item may be built (Phase 11): the Software Factory starts runs only in these. None: any.
      ...(plan.repositories?.length ? { repositories: plan.repositories } : {}),
      body: `Signed off for the Software Factory by ${actor.name}. The work items sync to Jira in NooblyJS Phase 13.`,
    });
    await emit('handoff.created', {
      handoffId: id, itemId: item.id, system: item.system, from: 'engineer', to: 'build', workItemIds: workItems.map((w) => w.id),
      summary: `created ${workItems.length} work item${workItems.length === 1 ? '' : 's'} for ${item.ref ?? item.id} across ${repoCount} repo${repoCount === 1 ? '' : 's'}`,
    }, actor.id);
    return { id, workItems, repoCount };
  }

  // ---------------------------------------------------------------------------- approvals

  const waitingReviewer = (approval, personId) => (approval.reviewers ?? []).find((r) => r.id === personId && r.status === 'waiting');
  /** Who gave a reviewer's decision: themselves, or the person who gave it on their behalf. */
  const givenBy = (r) => r.by ?? r.id;

  /**
   * Which waiting reviewer a decision is for: the one named in `forId`, else the person's own place, else the only one
   * still waiting. With several waiting and none of them the person, they must say whom they decide for.
   */
  function slotFor(approval, person, forId) {
    const waiting = (approval.reviewers ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.status === 'waiting');
    const ids = waiting.map(({ r }) => r.id);
    if (forId) {
      const named = waiting.find(({ r }) => r.id === forId);
      if (!named) throw forbidden('not_waiting', `This approval isn't waiting on ${forId}${ids.length ? `: it is waiting on ${ids.join(', ')}` : ''}.`, { waitingOn: ids });
      return named.i;
    }
    const own = waiting.find(({ r }) => r.id === person.id);
    if (own) return own.i;
    if (waiting.length === 1) return waiting[0].i;
    if (!waiting.length) throw conflict('already_decided', 'Nobody is still waiting on this approval.');
    throw badRequest(`Say whom you are deciding for: this approval is waiting on ${ids.join(', ')}.`, { for: ids.join(' | ') });
  }
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
    idea: (i) => `accepted the idea ${i.ref ?? i.id} · ${i.title}`,
    'design-handoff': (i) => `approved the Design handoff of ${i.ref ?? i.id} · ${i.title} to Engineering`,
    'engineering-signoff': (i, a, r) => `signed off ${r?.role ? `the ${r.role}'s part of ` : ''}the engineering of ${i.ref ?? i.id} · ${i.title}`,
    'build-approval': (i) => `gave the Build approval on ${i.ref ?? i.id} · ${i.title}`,
    'test-approval': (i) => `gave the Test approval on ${i.ref ?? i.id} · ${i.title}`,
    stage: (i, a) => `approved moving ${i.ref ?? i.id} · ${i.title} to ${stageLabel(a.to)}`,
    'infra-design': (i, a) => `approved ${a.subject ?? 'an infrastructure design'} for ${a.ref?.kindLabel ?? a.ref?.kind ?? 'an environment'}`,
    'devtools-write': (i, a) => `approved a write to ${a.ref?.kindLabel ?? 'Jira or Bitbucket'}: ${a.title}`,
    'release-candidate': (i) => `accepted the release candidate of ${i.ref ?? i.id} · ${i.title}`,
    deploy: (i) => `approved the production deploy of ${i.ref ?? i.id} · ${i.title}`,
    'outcome-review': (i) => `closed ${i.ref ?? i.id} · ${i.title} with its outcome review`,
    'threat-model': (i, a) => `accepted the threat model${a.subject ? ` ${a.subject}` : ''} for ${i.ref ?? i.id}`,
    'risk-acceptance': (i, a) => `accepted the risk${a.subject ? ` ${a.subject}` : ''} on ${i.ref ?? i.id}`,
  };

  /**
   * A person's decision on an approval: approve, or request changes (with a reason). The approval waits on its
   * reviewers (the people its rule's permission names); any person but a Viewer may decide for one of them: their own
   * place, or another's on their behalf (`input.for`), recorded as given by them for that reviewer. A rule that needs a
   * number of people (the production deploy needs two) needs that many different givers. An approval the rule says
   * needs readiness is refused while checks fail, unless the person overrides with a reason.
   */
  async function decideApproval(approvalId, input = {}, actor) {
    const target = `approval ${approvalId}`;
    const person = await personFor(actor, { what: 'approve anything', target });
    await requireApprover(person, target);
    const decision = input.decision;
    if (!DECISIONS.has(decision)) throw badRequest('decision must be "approve" or "request-changes".', { decision: 'approve | request-changes' });
    const comment = text(input.comment);
    const reason = text(input.reason) ?? (decision === 'request-changes' ? comment : null);
    if (decision === 'request-changes' && !reason) throw badRequest('Say what needs to change: a reason is required to request changes.', { reason: 'required' });
    const forId = typeof input.for === 'string' && input.for ? input.for : null;

    const approval = await approvalOr404(approvalId);
    if (approval.status !== 'open') throw conflict('already_decided', `This approval was already ${approval.status === 'approved' ? 'approved' : approval.status === 'withdrawn' ? 'withdrawn' : 'sent back for changes'}.`);
    const rule = await ruleOr500(approval.type);
    const slot = slotFor(approval, person, forId);
    const multi = Number.isInteger(rule.quorum) && rule.quorum > 1;
    if (decision === 'approve' && multi && (approval.reviewers ?? []).some((r) => r.status === 'approved' && givenBy(r) === person.id)) {
      throw forbidden('already_given', `You already gave one of the ${rule.quorum} approvals ${rule.label ?? 'this'} needs: another person must give the next.`);
    }
    const item = await itemOr404(approval.itemId);
    if (approval.from && currentStage(approval.from) !== item.stage && item.status === 'active') {
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

    const forReviewer = approval.reviewers[slot];
    const onBehalf = forReviewer.id !== person.id;
    const at = now();
    const updated = await repos.approvals.update(approvalId, (current) => {
      if (current.status !== 'open') throw conflict('already_decided', 'Someone decided this approval a moment ago. Reload to see it.');
      const r = current.reviewers[slot];
      if (!r || r.id !== forReviewer.id || r.status !== 'waiting') throw conflict('already_decided', 'This place was decided a moment ago. Reload to see it.');
      const reviewers = current.reviewers.map((x, i) => (i === slot
        ? { ...x, status: decision === 'approve' ? 'approved' : 'changes-requested', at, ...(onBehalf ? { by: person.id } : {}), ...(comment ? { comment } : {}), ...(reason && decision !== 'approve' ? { reason } : {}) }
        : x));
      const next = { ...current, reviewers, updatedAt: at, ...(override ? { override } : {}) };
      if (decision === 'request-changes') return { ...next, status: 'changes-requested', decidedAt: at, decidedBy: person.id };
      if (quorumMet(next, rule)) return { ...next, status: 'approved', decidedAt: at, decidedBy: person.id };
      return next;
    });
    const outcome = updated.status === 'approved' ? 'approved' : updated.status === 'changes-requested' ? 'changes-requested' : 'pending';
    const reviewer = updated.reviewers[slot];
    const forName = onBehalf ? (await host.people.get(forReviewer.id))?.name ?? forReviewer.id : null;
    const words = (decision === 'approve'
      ? (DECIDED_WORDS[approval.type] ?? DECIDED_WORDS.spec)(item, approval, reviewer) + (outcome === 'pending' ? ` (${approvedCount(updated)} of ${updated.reviewers.length} reviewers)` : '') + (override ? ' with a readiness override' : '')
      : `asked for changes to ${approval.subject ?? item.ref ?? item.id} · ${approval.title}`) + (onBehalf ? `, for ${forName}` : '');
    await emit('approval.decided', {
      approvalId, itemId: item.id, type: approval.type, subject: approval.subject ?? null, system: item.system,
      decision, outcome, role: reviewer?.role ?? null, reason: reason ?? comment ?? null, version: input.version ?? approval.artefactVersion ?? null, summary: words,
      by: person.id, for: forReviewer.id, onBehalf,
      ...(approval.ref ? { ref: approval.ref } : {}),
      ...(item.type === 'pr' ? { itemType: 'pr', parentId: item.parentId ?? null, sha: approval.sha ?? null } : {}),
    }, person.id);
    if (onBehalf) await audit({ actor: person.id, action: 'approval.on_behalf', target: approvalId, itemId: item.id, for: forReviewer.id, decision });

    let moved = null;
    let handoff = null;
    if (outcome === 'approved') {
      // A pull request's Test approval moves nothing: it may merge now, and a person merges it (Phase 16e).
      const move = approval.type === 'stage' ? approval.to : item.type === 'pr' && item.pr && approval.type === 'test-approval' ? null : MOVES[approval.type];
      // The work goes to the Software Factory with the Engineering sign-off (Phase 16b), never before.
      if (approval.type === 'engineering-signoff') handoff = await createHandoff(item, updated, person);
      if (move === 'complete') await complete(item.id, person, `completed ${item.ref ?? item.id} · ${item.title}`);
      // A move to where the item already is (an approval opened before its stage was migrated) moves nothing.
      else if (move && move !== item.stage) moved = (await moveStage(item.id, move, person)).item;
    }
    if (item.type === 'pr' && item.pr && outcome !== 'pending') {
      await prs.afterDecision({ approval, outcome, item, person, reason: reason ?? comment });
      moved = moved ?? await repos.items.get(item.id);
    }
    const forText = onBehalf ? ` for ${forName}` : '';
    return {
      approval: updated, outcome, item: moved ?? await repos.items.get(item.id), handoff, by: person.id, for: forReviewer.id, ...(carried ? { carried } : {}),
      text: carried?.text ? carried.text : outcome === 'approved'
        ? (approval.type === 'test-approval' && item.type === 'pr' && item.pr ? `Approved${forText}. ${item.ref ?? item.id} may merge now: a person merges it.`
          : moved && moved.stage !== item.stage ? `Approved${forText}. ${item.ref ?? item.id} moved to ${stageLabel(moved.stage)}.` : `Approved${forText}.`)
        : outcome === 'pending' ? `Your approval${forText} is recorded. Still waiting on ${updated.reviewers.filter((r) => r.status === 'waiting').map((r) => r.id).join(', ')}.`
          : `Changes requested${forText}. The requester has been told why.`,
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
   * Whom a new approval opened by `person` waits on. Each of the rule's slots (or its one permission) is the person's
   * own place when their access role has that permission, else someone on the item's team who has it, else an Owner.
   * A rule that needs a number of people (a production deploy needs two) waits on that many different people, none
   * of whom may be the person giving the first approval twice.
   */
  async function reviewersOf(rule, item, person) {
    const slots = rule.slots?.length ? rule.slots : [{ permission: rule.permission, role: rule.selfRole ?? 'Approver' }];
    const reviewers = [];
    for (const slot of slots) {
      if (await host.can(person.accessRole, slot.permission)) {
        reviewers.push({ id: person.id, role: slot.role ?? 'Approver', status: 'waiting' });
        continue;
      }
      const found = (await reviewersFor({ permission: slot.permission }, item.team, person.id)).filter((r) => r.id !== person.id);
      if (!found.length) throw conflict('no_reviewers', `Nobody has the "${slot.permission}" permission to ${rule.verb ?? 'approve'} the ${rule.label?.toLowerCase() ?? 'approval'}. Ask an Owner to give someone that permission.`);
      reviewers.push({ ...found[0], ...(slot.role ? { role: slot.role } : {}) });
    }
    if (Number.isInteger(rule.quorum) && rule.quorum > 1) {
      const taken = new Set([person.id, ...reviewers.map((r) => r.id)]);
      let others = (await reviewersFor(rule, item.team, person.id)).filter((r) => !taken.has(r.id));
      // Too few on the item's team (or it has none): everyone else who may decide it.
      if (others.length < rule.quorum - reviewers.length) others = (await reviewersFor(rule, null, person.id, { everyone: true })).filter((r) => !taken.has(r.id));
      if (others.length < rule.quorum - reviewers.length) {
        const n = others.length + reviewers.filter((r) => r.id !== person.id).length;
        throw conflict('no_reviewers', `${rule.label ?? 'This decision'} needs ${rule.quorum} different people with the "${rule.permission}" permission, and there ${n === 0 ? 'is nobody else' : n === 1 ? 'is only one other' : `are only ${n} others`}. Ask an Owner to give someone that permission.`);
      }
      reviewers.push(...others.slice(0, rule.quorum - reviewers.length));
    }
    return reviewers;
  }

  /**
   * Opens an approval and records this person's decision at once: how a person moves an item on when no approval is
   * waiting ("Approve & move to …"), and how the Product section's Send lands. The approval waits on the people the
   * rule names; the person gives it in each place that is theirs, or, when none is, on behalf of the first. The rule
   * still applies (readiness), and the decision is on record like any other. A rule that needs more than one person
   * (a production deploy needs two) also waits on others, so the item stays where it is until one of them approves too.
   */
  async function openAndDecide({ item, type, to, person, input, extra = {} }) {
    const rule = await ruleOr500(type);
    await requireApprover(person, `item ${item.id}`);
    const reviewers = await reviewersOf(rule, item, person);
    const at = now();
    const approval = await repos.approvals.create({
      id: newId('apr'), type, itemId: item.id, subject: extra.subject ?? null, title: item.title,
      from: item.stage, to, requestedBy: { id: person.id, name: person.name, kind: 'person' }, requestedAt: at,
      dueAt: dueFrom(at, rule.target), reviewers, status: 'open', ...extra,
    });
    if (reviewers.some((r) => r.id !== person.id) && (reviewers.length > 1 || rule.quorum !== 'any')) {
      await emit('approval.requested', {
        approvalId: approval.id, itemId: item.id, type, system: item.system, reviewerIds: reviewers.map((r) => r.id),
        summary: `asked for the ${rule.label?.toLowerCase() ?? 'approval'} of ${item.ref ?? item.id} · ${item.title}${Number.isInteger(rule.quorum) ? ` (${rule.quorum} people)` : ''}`,
      }, person.id);
    }
    // Every place that is the person's own (one person may hold both of the Engineering sign-off's), else the first.
    const own = reviewers.map((r, i) => (r.id === person.id ? i : -1)).filter((i) => i >= 0);
    const places = own.length ? own : [0];
    try {
      let result;
      for (const i of places) {
        result = await decideApproval(approval.id, { decision: 'approve', comment: input.comment, override: input.override, for: reviewers[i].id }, person);
        if (result.outcome !== 'pending') break;
      }
      return result;
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
    await refuseWithStories(item, 'move on');
    await refuseWithPullRequests(item, 'move on');
    const open = (await repos.approvals.list()).filter((a) => a.itemId === item.id && a.status === 'open' && a.from === item.stage);
    if (open.length) throw conflict('approval_open', `${item.ref ?? item.id} already has an approval waiting for this step. Decide it in Approvals.`, { approvalIds: open.map((a) => a.id) });
    const type = LEAVES_BY[item.stage] ?? 'stage';
    const to = type === 'stage' ? nextStage(item.stage) : MOVES[type] === 'complete' ? null : MOVES[type];
    const extra = type === 'build-approval' || type === 'test-approval' ? { subject: item.ref ?? item.id } : {};
    return openAndDecide({ item, type, to, person, input, extra });
  }

  /**
   * Accepting an idea (Phase 17), the Discover exit, from the Product section: the idea's lifecycle item is opened when
   * it has none (in Discover), then a person gives the `idea` approval, with its readiness check ("Business case
   * complete") or an override with a reason. Refused anywhere but Discover.
   */
  async function acceptIdea({ itemId, title = null, override = null, comment = null, actor } = {}) {
    const person = await personFor(actor, { what: 'accept an idea', target: `item ${itemId}` });
    if (!/^IDEA-\d{3,}$/.test(String(itemId ?? ''))) throw badRequest('Only an idea (IDEA-…) is accepted this way.');
    let item = await repos.items.get(itemId);
    if (!item) {
      const at = now();
      const full = await host.people.get(person.id);
      item = await repos.items.create({
        id: itemId, type: 'idea', ref: itemId, title: text(title, 200) ?? itemId, system: 'product', stage: 'discover', status: 'active',
        owner: person.id, team: full?.teams?.[0] ?? null, createdAt: at, stageEnteredAt: at, history: [{ stage: 'discover', enteredAt: at, by: person.id }], version: 1, updatedAt: at,
      });
      await emit('item.created', { itemId, system: 'product', stage: 'discover', summary: `opened ${itemId} · ${item.title}` }, person.id);
    }
    if (item.stage !== 'discover') throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}: an idea is accepted in Discover.`);
    return advance(itemId, { ...(override ? { override } : {}), ...(comment ? { comment } : {}) }, person);
  }

  /**
   * The Engineering sign-off from the Factory's Engineering pages (Phase 16d): the person's Approve & send to Build on an
   * item in Engineer, with its readiness checks or an override with a reason. Refused anywhere but Engineer.
   */
  async function signOffEngineering({ itemId, override = null, comment = null, actor } = {}) {
    const item = await itemOr404(itemId);
    if (item.stage !== 'engineer') throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}: the Engineering sign-off is given in Engineer.`);
    return advance(itemId, { ...(override ? { override } : {}), ...(comment ? { comment } : {}) }, actor);
  }

  // ---------------------------------------------------------------------------- services for other apps

  /** The Product section's Approve / Request changes on a spec: the open spec approval this person is waiting on. */
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
  async function reviewersFor(rule, team, requesterId, { everyone: all = false } = {}) {
    const everyone = (await host.people.list()).filter((p) => p.active !== false && p.kind !== 'agent');
    const may = [];
    for (const p of everyone) if (await host.can(p.accessRole, rule.permission)) may.push(p);
    if (all) return may.map((p) => ({ id: p.id, role: p.jobTitle ?? p.accessRole, status: 'waiting' }));
    let picked = may.filter((p) => team && (p.teams ?? []).includes(team));
    if (!picked.some((p) => p.id !== requesterId)) {
      const owners = may.filter((p) => p.accessRole === 'Owner');
      picked = [...picked, ...owners.filter((o) => !picked.some((p) => p.id === o.id))];
    }
    return picked.map((p) => ({ id: p.id, role: p.jobTitle ?? p.accessRole, status: 'waiting' }));
  }

  /**
   * The Product section's Send for review: opens the spec approval for an item, and the item itself when the lifecycle
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
        id: itemId, type: 'spec', ref: itemId, title: cleanTitle, system: 'product', stage: 'product', status: 'active',
        owner: person.id, team: team ?? full?.teams?.[0] ?? null, createdAt: at, stageEnteredAt: at,
        history: [{ stage: 'product', enteredAt: at, by: person.id }], version: 1, updatedAt: at,
      });
      await emit('item.created', { itemId, system: 'product', stage: 'product', summary: `opened ${itemId} · ${cleanTitle}` }, person.id);
    }
    if (item.status !== 'active') throw conflict('not_active', `${item.ref ?? item.id} is ${item.status}.`);
    if (item.stage !== 'product') throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}, so its spec isn't up for review.`);
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

  /**
   * The Design handoff (Phase 16b, the UI handoff before): the Product section's Send, from an item in Design, with the
   * work items planned for it. It moves the item to Engineer. The work items go to the Software Factory only with the
   * Engineering sign-off (createHandoff), so nothing is built before Engineering has signed it off.
   */
  async function handoff({ itemId, workItems = [], repositories = [], estimate = null, repoCount, openChecks = [], note = null, actor } = {}) {
    const person = await personFor(actor, { what: 'hand work on to Engineering', target: `item ${itemId}` });
    const item = await itemOr404(itemId);
    if (item.stage !== 'design') {
      throw conflict('wrong_stage', `${item.ref ?? item.id} is in ${stageLabel(item.stage)}, so it can't be handed to Engineering yet: the Design handoff leaves from Design.`);
    }
    await refuseWithStories(item, 'hand off');
    const items = (Array.isArray(workItems) ? workItems : []).filter((w) => w?.repo && w?.title).map((w) => ({ repo: String(w.repo), title: String(w.title) }));
    const where = (Array.isArray(repositories) ? repositories : []).map(String).filter(Boolean);
    const outside = where.length ? items.filter((w) => !where.some((r) => r === w.repo || r.split('/').pop() === w.repo)) : [];
    if (outside.length) throw refused('outside_repositories', `${outside.map((w) => w.repo).join(', ')} is not among the item's repositories.`, { outside: outside.map((w) => w.repo) });
    const open = (await repos.approvals.list()).find((a) => a.itemId === item.id && a.type === 'design-handoff' && a.status === 'open');
    if (open) {
      await repos.approvals.update(open.id, (a) => ({ ...a, workItems: items.length ? items : a.workItems, ...(where.length ? { repositories: where } : {}), estimate: estimate ?? a.estimate ?? null, openChecks }));
      return decideApproval(open.id, { decision: 'approve', comment: note }, person);
    }
    return openAndDecide({ item, type: 'design-handoff', to: 'engineer', person, input: { comment: note }, extra: { workItems: items, ...(where.length ? { repositories: where } : {}), estimate, openChecks, repoCount: repoCount ?? null } });
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
    await requireApprover(person, `${type} ${ref?.designId ?? ''}`);
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
   * The item's pull requests were merged in Bitbucket by people (NooblyJS Phase 13). Since Phase 16b a pull request
   * merges after its Build and Test approvals, which move the item themselves, so a merge moves nothing: one made while
   * the item is still in Build or Test, before those approvals, is flagged on the item and in the audit log, not counted
   * as done. NooblyJS itself never merges: the caller passes who merged, and a merge with nobody named, or by an agent,
   * is refused here as well.
   */
  async function movedByMerge({ itemId, mergedBy = [], pullRequests = [] } = {}) {
    const names = mergedBy.map((m) => text(m?.name ?? m, 120)).filter(Boolean);
    if (!names.length || mergedBy.some((m) => m?.kind === 'agent')) {
      await audit({ actor: 'system', action: 'access.refused', target: `item ${itemId}`, reason: 'agents propose, people decide: only a person\'s merge counts' });
      throw forbidden('people_only', 'Only a person\'s merge in Bitbucket counts.');
    }
    const item = await itemOr404(itemId);
    if (item.status !== 'active' || !['build', 'test'].includes(item.stage)) return { moved: false, item, reason: `${item.ref ?? item.id} is not in Build or Test` };
    const who = [...new Set(names)];
    const missing = item.stage === 'build' ? ['the Build approval', 'the Test approval'] : ['the Test approval'];
    const by = { id: 'bitbucket', name: `Bitbucket (merged by ${who.join(', ')})`, kind: 'system' };
    const at = now();
    const flagged = await repos.items.update(item.id, (current) => ({ ...current, mergedEarly: { at, by: who, pullRequests, missing }, updatedAt: at }));
    await audit({ actor: by.id, action: 'item.merged_before_approval', target: item.id, itemId: item.id, mergedBy: who, pullRequests, missing });
    await emit('item.merged', {
      itemId: item.id, system: item.system, mergedBy: who, pullRequests, actorName: by.name, early: true, missing,
      summary: `${item.ref ?? item.id} · ${item.title}: its pull request${pullRequests.length === 1 ? ' was' : 's were'} merged in Bitbucket by ${who.join(', ')} before ${missing.join(' and ')}; it stays in ${stageLabel(item.stage)}`,
    }, by.id);
    return { moved: false, flagged: true, missing, item: flagged };
  }

  /**
   * Lifecycle v3 (Phase 16b; Phase 16a before it): each active item in a stage from before moves to where that stage
   * belongs now (specify, ux, ui → product; architect → design; verify, ship → test), and open approvals follow. Open
   * approvals of retired rules (the UI handoff, the release candidate) are withdrawn with the reason said, and an open
   * merge is the Build approval now. Nobody decided this, so no stage event is emitted (Activity and Metrics count no
   * handoff); one audit record says what moved. Only old keys are looked at, so a second run changes nothing.
   */
  async function migrateStages() {
    const at = now();
    const items = [];
    for (const found of await repos.items.list()) {
      if (found.status !== 'active' || !LEGACY[found.stage]) continue;
      const updated = await repos.items.update(found.id, (current) => {
        const to = LEGACY[current.stage];
        if (current.status !== 'active' || !to) return null;
        const history = (current.history ?? []).map((h) => ({ ...h }));
        const open = history.at(-1);
        if (open && !open.leftAt) open.leftAt = at;
        history.push({ stage: to, enteredAt: at, by: 'system', kind: 'migrated', from: current.stage });
        return { ...current, stage: to, stageEnteredAt: at, history, version: (current.version ?? 0) + 1, updatedAt: at };
      });
      if (updated) items.push({ id: found.id, from: found.stage, to: updated.stage });
    }
    const approvals = [];
    const withdrawn = [];
    for (const a of await repos.approvals.list()) {
      if (a.status !== 'open') continue;
      if (RETIRED_APPROVALS[a.type]) {
        const why = RETIRED_APPROVALS[a.type];
        const done = await repos.approvals.update(a.id, (current) => (current.status === 'open' ? { ...current, status: 'withdrawn', decidedAt: at, withdrawnReason: why, updatedAt: at } : null));
        if (done) {
          withdrawn.push(a.id);
          await emit('approval.withdrawn', { approvalId: a.id, itemId: a.itemId, type: a.type, reason: why, summary: `withdrew the ${a.subject ?? a.itemId} approval: ${why}` }, 'system');
        }
        continue;
      }
      const moves = (a.from && LEGACY[a.from]) || (a.to && LEGACY[a.to]) || a.type === 'merge';
      if (!moves) continue;
      const updated = await repos.approvals.update(a.id, (current) => (current.status !== 'open' ? null : {
        ...current,
        ...(current.from ? { from: currentStage(current.from) } : {}),
        ...(current.to ? { to: currentStage(current.to) } : {}),
        ...(current.type === 'merge' ? { type: 'build-approval', from: 'build', to: 'test' } : {}),
        updatedAt: at,
      }));
      if (updated) approvals.push(a.id);
    }
    if (items.length || approvals.length || withdrawn.length) {
      await audit({ actor: 'system', action: 'lifecycle.stages_migrated', target: 'lifecycle', items: items.map((i) => i.id), moves: items, approvals, withdrawn, reason: 'lifecycle v3: eight stages (Phase 16b)' });
      log.info(`lifecycle v3: moved ${items.length} item(s), ${approvals.length} open approval(s); withdrew ${withdrawn.length}`);
    }
    return { items: items.map((i) => i.id), approvals, withdrawn };
  }

  // Pull requests as lifecycle items (Phase 16e): their Build and Test approvals, merges, and the stories and features
  // that follow them.
  const prs = createPullRequests({ repos, host, log, now, emit, audit, personFor, requirePermission, reviewersFor, ruleOr500, itemOr404, storiesOf, followStories, moveStage });
  // One shape for checks, and the trace (Phase 16f).
  const checks = createLifecycleChecks({ repos, host, now, emit, audit, personFor, requireApprover, readinessOf, storiesOf });

  return { readinessOf, decideApproval, reassign, sendBack, advance, nudge, decide, requestApproval, handoff, sweep, onAdrAccepted, rules, now, requestAppApproval, closeAppApproval, withdrawAppApprovals, movedByMerge, migrateStages, storiesOf, syncStories, handoffStory, followStories, signOffEngineering, acceptIdea, pullRequests: prs, checks };
}
