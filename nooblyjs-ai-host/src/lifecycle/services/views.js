// What the Home screens show (NooblyJS product.md §5.2), computed from the item and approval files on every call:
// Overview's stage strip and Waiting on you, Lifecycle's swimlane, stage health, Where work waits and Handoffs this
// week, and the Approvals queue and detail panel. No number is stored; every one is counted here.
import { STAGES, stageLabel, stageIndex, handoffLabel } from '../stages.js';
import { daysBetween } from '../working-days.js';
import { loadThresholds } from '../config.js';
import { notFound } from '../errors.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

// The gates Where work waits counts, in lifecycle v3 (Phase 16b), and the ones from before, whose history still counts.
const GATE_LABELS = {
  spec: 'Product handoff', adr: 'Architecture sign-off', 'design-handoff': 'Design handoff', 'engineering-signoff': 'Engineering sign-off',
  'build-approval': 'Build approval', 'test-approval': 'Test approval', deploy: 'Production deploy', 'outcome-review': 'Outcome review',
  merge: 'PR review & merge', 'ui-handoff': 'UI handoff', 'release-candidate': 'Release candidate',
};
const TAG_TONES = {
  spec: 'info', adr: 'warning', 'design-handoff': 'success', 'engineering-signoff': 'success', 'build-approval': 'neutral', 'test-approval': 'info',
  'ui-handoff': 'success', merge: 'neutral', deploy: 'navy', stage: 'neutral', 'infra-design': 'navy', 'release-candidate': 'info',
  'outcome-review': 'success', 'threat-model': 'warning', 'risk-acceptance': 'danger',
};
// The approvals on a pull request: their title is the item, and their line names no requester.
const PR_TYPES = new Set(['build-approval', 'test-approval', 'merge']);
// What Approve & move says on an item's page, for the stages whose exit is a named decision (Phases 16a, 16b).
/** How moves nobody decided read in an item's history (Phase 16c–16e). */
const HISTORY_WORDS = {
  'new-commit': 'A new commit cleared its approvals: back in', 'pull-requests': 'Followed its pull requests to', feature: 'Its feature went to',
};

const ADVANCE_LABELS = {
  discover: 'Accept the idea',
  product: 'Approve & hand off to Design',
  design: 'Approve & hand off to Engineering',
  engineer: 'Sign off & send to Build',
  build: 'Give the Build approval',
  test: 'Give the Test approval',
  release: 'Approve the production deploy',
  operate: 'Close with the outcome review',
};
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

const ms = (iso) => new Date(iso).getTime();
const round1 = (n) => Math.round(n * 10) / 10;
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const words = (n) => NUMBER_WORDS[n] ?? String(n);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (name) => String(name ?? '').split(/\s+/)[0];
const titleCase = (id) => String(id ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const hoursText = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.floor(h / 24)} d`);

/** Monday 00:00 UTC of the week of `at`. */
function weekStart(at) {
  const d = new Date(at);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - back * DAY).toISOString();
}

export function createViews({ repos, host, engine }) {
  async function names() {
    const people = await host.people.list();
    const map = new Map(people.map((p) => [p.id, p.name]));
    return (id) => map.get(id) ?? titleCase(id);
  }

  async function load() {
    const [items, approvals, rules, thresholds] = await Promise.all([repos.items.list(), repos.approvals.list(), engine.rules(), loadThresholds(repos)]);
    return { items, approvals, rules, thresholds, at: engine.now() };
  }

  const isOpen = (a) => a.status === 'open';
  const waitingOn = (a, personId) => isOpen(a) && (a.reviewers ?? []).some((r) => r.id === personId && r.status === 'waiting');
  const overdue = (a, at) => isOpen(a) && a.dueAt && at > a.dueAt;

  /** The item's "waiting on a person" state: since when, and whether that is too long. */
  function waiting(item, approvals, at, thresholds) {
    const open = approvals.filter((a) => a.itemId === item.id && isOpen(a));
    const since = item.waitingSince ?? null;
    const days = since ? daysBetween(since, at) : 0;
    const late = open.some((a) => overdue(a, at)) || (since && days >= thresholds.waitingTooLongDays);
    const longest = Math.max(days, ...open.map((a) => daysBetween(a.requestedAt, at)));
    return { open, since, days, late: Boolean(late), longestDays: open.length || since ? longest : 0 };
  }

  /** What the swimlane's current cell says for this person: "Your review", "Rhea drafting", "Waiting 4 d", "RICE 42". */
  function nowText(item, w, personId, nameOf) {
    const mine = w.open.find((a) => waitingOn(a, personId));
    if (mine) return mine.type === 'build-approval' || mine.type === 'merge' ? 'Your Build approval' : mine.type === 'test-approval' ? 'Your Test approval' : 'Your review';
    if (w.since && w.late) return `Waiting ${w.days} d`;
    if (item.work?.text) return item.work.text;
    if (w.open.length) {
      const who = w.open.flatMap((a) => a.reviewers.filter((r) => r.status === 'waiting').map((r) => firstName(nameOf(r.id))));
      return who.length ? `${who[0]}'s review` : 'In review';
    }
    if (item.type === 'idea' && item.rice) {
      const { reach = 0, impact = 0, confidence = 0, effort = 1 } = item.rice;
      return `RICE ${Math.round((reach * impact * confidence) / (effort || 1))}`;
    }
    return stageLabel(item.stage);
  }

  function row(item, ctx, personId, nameOf) {
    const w = waiting(item, ctx.approvals, ctx.at, ctx.thresholds);
    const current = stageIndex(item.stage);
    const label = nowText(item, w, personId, nameOf);
    const cells = Object.fromEntries(STAGES.map((s, i) => {
      if (i < current) return [s.key, { state: 'done' }];
      if (i > current) return [s.key, { state: 'todo' }];
      return [s.key, { state: w.late ? 'waiting' : 'now', text: label }];
    }));
    const ageDays = daysBetween(item.createdAt, ctx.at);
    return {
      id: item.id, ref: item.ref ?? item.id, title: item.title, type: item.type, system: item.system,
      stage: item.stage, stageLabel: stageLabel(item.stage), owner: item.owner, ownerName: nameOf(item.owner),
      cells, now: label, late: w.late, waitingDays: w.longestDays, age: `${ageDays} d`, ageDays,
      mine: item.owner === personId || w.open.some((a) => waitingOn(a, personId)),
      href: `/home/lifecycle/${encodeURIComponent(item.id)}`,
      specHref: item.system === 'product' && item.type === 'spec' && item.inProduct !== false ? `/factory/product/specs/${encodeURIComponent(item.id)}` : null,
      // A pull request the Software Factory delivered has its own page there (Phase 16e).
      prHref: item.type === 'pr' && item.pr ? `/factory/pull-requests/${encodeURIComponent(item.id)}` : null,
    };
  }

  /** Per-stage count and median time in stage over the last 30 days, with the slowest named. */
  function stageHealth(ctx) {
    const since = ms(ctx.at) - 30 * DAY;
    const active = ctx.items.filter((i) => i.status === 'active');
    const stages = STAGES.map((s) => {
      const durations = [];
      for (const item of ctx.items) {
        for (const h of item.history ?? []) {
          if (h.stage === s.key && h.leftAt && ms(h.leftAt) >= since) durations.push((ms(h.leftAt) - ms(h.enteredAt)) / DAY);
        }
      }
      const m = median(durations);
      return { key: s.key, number: s.number, label: s.label, count: active.filter((i) => i.stage === s.key).length, medianDays: m === null ? null : round1(m) };
    });
    const slowest = stages.filter((s) => s.medianDays !== null).sort((a, b) => b.medianDays - a.medianDays)[0];
    for (const s of stages) s.slowest = Boolean(slowest && s.key === slowest.key);
    return stages;
  }

  // ---------------------------------------------------------------------------- Overview

  async function overview(person) {
    const ctx = await load();
    const nameOf = await names();
    const active = ctx.items.filter((i) => i.status === 'active');
    const open = ctx.approvals.filter(isOpen);
    const mine = open.filter((a) => waitingOn(a, person.id));
    const count = (type) => open.filter((a) => a.type === type).length;
    const notes = {
      discover: () => 'ideas',
      product: () => `specs, UX and UI · ${count('spec')} in review`,
      design: () => `${plural(count('adr'), 'ADR')} proposed · ${count('design-handoff')} awaiting handoff`,
      engineer: () => `${count('engineering-signoff')} awaiting sign-off`,
      build: () => `on the line · ${plural(count('build-approval'), 'PR')} awaiting the Build approval`,
      test: () => `${plural(count('test-approval'), 'PR')} awaiting the Test approval`,
      release: () => `${plural(count('deploy'), 'deploy')} awaiting approval`,
      operate: () => `${plural(count('outcome-review'), 'outcome review')} due`,
    };
    const stages = STAGES.map((s) => ({ key: s.key, number: s.number, label: s.label, count: active.filter((i) => i.stage === s.key).length, note: notes[s.key](), href: '/home/lifecycle' }));
    const busiest = [...stages].sort((a, b) => b.count - a.count)[0];
    const oldestHours = mine.length ? Math.max(...mine.map((a) => (ms(ctx.at) - ms(a.requestedAt)) / HOUR)) : 0;
    const waitingRows = await Promise.all(mine.sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt)).map((a) => queueRow(a, ctx, nameOf)));
    const systems = new Set(active.map((i) => i.system));
    return {
      at: ctx.at,
      inFlight: active.length,
      summary: `${plural(active.length, 'item')} in flight across ${plural(Math.max(systems.size, 1), 'system')}. ${mine.length ? `${words(mine.length)} ${mine.length === 1 ? 'is' : 'are'} waiting on you.` : 'Nothing is waiting on you.'}`,
      stages, current: busiest?.count ? busiest.key : null,
      waitingOnYou: mine.length, oldestHours: Math.round(oldestHours),
      waiting: waitingRows.map((r) => ({ ...r, context: r.context })),
      productStats: {
        // The Product Factory's items: stories (Phase 16c) are the Design section's, not the Product card's.
        inDesign: active.filter((i) => i.type !== 'story' && ['discover', 'product', 'design'].includes(i.stage)).length,
        approvalsPending: open.filter((a) => ['spec', 'adr', 'design-handoff'].includes(a.type)).length,
      },
    };
  }

  // ---------------------------------------------------------------------------- Lifecycle

  async function lifecycle(person, { filter = 'all' } = {}) {
    const ctx = await load();
    const nameOf = await names();
    const rows = ctx.items.filter((i) => i.status === 'active').map((i) => row(i, ctx, person.id, nameOf))
      .sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || b.ageDays - a.ageDays);
    const filters = {
      all: () => true,
      mine: (r) => r.mine,
      waiting: (r) => r.waitingDays >= ctx.thresholds.waitingTooLongDays || r.late,
    };
    const pick = filters[filter] ?? filters.all;
    return {
      at: ctx.at,
      filter: filters[filter] ? filter : 'all',
      counts: { all: rows.length, mine: rows.filter(filters.mine).length, waiting: rows.filter(filters.waiting).length },
      waitingTooLongDays: ctx.thresholds.waitingTooLongDays,
      stages: stageHealth(ctx),
      rows: rows.filter(pick),
    };
  }

  /** Where work waits (waiting for a person, by gate, last 30 days) and Handoffs this week. */
  async function flow() {
    const ctx = await load();
    const since = ms(ctx.at) - 30 * DAY;
    const gates = Object.entries(GATE_LABELS).map(([type, label]) => {
      const waits = ctx.approvals
        .filter((a) => a.type === type && ms(a.requestedAt) >= since && a.status !== 'withdrawn')
        .map((a) => (ms(a.decidedAt ?? ctx.at) - ms(a.requestedAt)) / DAY);
      return { type, label, days: waits.length ? round1(waits.reduce((s, d) => s + d, 0) / waits.length) : null, count: waits.length };
    }).filter((g) => g.count).sort((a, b) => b.days - a.days);
    const max = Math.max(0, ...gates.map((g) => g.days));
    for (const g of gates) g.ratio = max ? g.days / max : 0;
    const insight = gates.length
      ? `Work waits longest for ${gates[0].label}: ${gates[0].days} d on average over the last 30 days${gates.length > 1 ? `, against ${gates.at(-1).days} d for ${gates.at(-1).label}` : ''}.`
      : 'No approvals in the last 30 days yet.';

    const start = weekStart(ctx.at);
    const pairs = new Map();
    let sentBack = 0;
    for (const item of ctx.items) {
      const history = item.history ?? [];
      history.forEach((h, i) => {
        if (ms(h.enteredAt) < ms(start) || i === 0) return;
        if (h.kind === 'sent-back') {
          sentBack += 1;
          return;
        }
        const label = handoffLabel(history[i - 1].stage, h.stage);
        pairs.set(label, (pairs.get(label) ?? 0) + 1);
      });
    }
    const handoffs = [...pairs].map(([label, count]) => ({ label, count }));
    return {
      at: ctx.at, gates, insight,
      handoffs, sentBack, weekStart: start,
      handoffTotal: handoffs.reduce((s, h) => s + h.count, 0) + sentBack,
    };
  }

  /** One item with its history, readiness, approvals and the actions this person may take. */
  async function item(id, person) {
    const ctx = await load();
    const nameOf = await names();
    const found = ctx.items.find((i) => i.id === id);
    if (!found) throw notFound(`There is no item ${id}.`);
    const r = row(found, ctx, person.id, nameOf);
    const approvals = ctx.approvals.filter((a) => a.itemId === id).sort((a, b) => ms(b.requestedAt) - ms(a.requestedAt));
    const readiness = await engine.readinessOf(found);
    const canApprove = await host.can(person.accessRole, 'approve');
    // Any person but a Viewer may give an approval, on their own behalf or another's (Phase 16b).
    const mayApprove = person.accessRole !== 'Viewer';
    const blocking = approvals.filter((a) => isOpen(a) && a.from === found.stage);
    const next = STAGES[stageIndex(found.stage) + 1] ?? null;
    // Phase 16c: an item's stories (from Design on it goes story by story), and a story's item and feature.
    const stories = ctx.items.filter((i) => i.type === 'story' && i.parentId === found.id && i.status !== 'withdrawn')
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const handedOff = stories.filter((st) => stageIndex(st.stage) > stageIndex('design') || st.status === 'completed').length;
    const parent = found.parentId ? ctx.items.find((i) => i.id === found.parentId) : null;
    // Phase 16e: a story's pull requests (each a lifecycle item with its Build and Test approvals), and an item's features.
    const pulls = ctx.items.filter((i) => i.type === 'pr' && i.parentId === found.id && i.pr && i.status !== 'withdrawn')
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const features = stories.length ? await engine.pullRequests.featuresOf(found.id) : [];
    const prLink = (id) => `/factory/pull-requests/${encodeURIComponent(id)}`;
    return {
      at: ctx.at,
      item: {
        ...r, status: found.status, team: found.team, createdAt: found.createdAt, stageEnteredAt: found.stageEnteredAt,
        work: found.work ?? null, waitingSince: found.waitingSince ?? null, body: found.body ?? '',
        ...(found.type === 'story' ? {
          feature: found.feature ?? null,
          parent: parent ? { id: parent.id, ref: parent.ref ?? parent.id, title: parent.title, href: `/home/lifecycle/${encodeURIComponent(parent.id)}` } : null,
          designHref: parent ? `/factory/design/stories/${encodeURIComponent(parent.id)}` : null,
          ...(found.passedTestAt ? { passedTest: { at: found.passedTestAt, notBuiltHere: found.notBuiltHere ?? [] } } : {}),
        } : {}),
        ...(found.mergedEarly ? { mergedEarly: found.mergedEarly } : {}),
        ...(found.type === 'pr' && found.pr ? {
          pullRequest: { ...found.pr, href: prLink(found.id), mergedBy: found.mergedBy ?? null, mergedAt: found.mergedAt ?? null },
          parent: parent ? { id: parent.id, ref: parent.ref ?? parent.id, title: parent.title, href: `/home/lifecycle/${encodeURIComponent(parent.id)}` } : null,
        } : {}),
        ...(pulls.length ? {
          pullRequests: pulls.map((p) => ({ id: p.id, ref: p.ref ?? p.id, title: p.title, stage: p.stage, stageLabel: stageLabel(p.stage), status: p.status, evidence: p.pr.evidence?.text ?? null, href: prLink(p.id) })),
        } : {}),
        ...(features.length ? { features } : {}),
        ...(stories.length ? {
          stories: {
            total: stories.length, handedOff,
            text: `${handedOff} of ${plural(stories.length, 'story', 'stories')} handed off`,
            rows: stories.map((st) => ({ id: st.id, ref: st.ref ?? st.id, title: st.title, stage: st.stage, stageLabel: stageLabel(st.stage), status: st.status, feature: st.feature ?? null, href: `/home/lifecycle/${encodeURIComponent(st.id)}` })),
          },
        } : {}),
      },
      readiness,
      history: (found.history ?? []).map((h, i, all) => ({
        stage: h.stage, label: stageLabel(h.stage), enteredAt: h.enteredAt, leftAt: h.leftAt ?? null, byName: h.by ? nameOf(h.by) : null,
        kind: h.kind ?? (i === 0 ? 'entered' : 'forward'), reason: h.reason ?? null,
        text: h.kind === 'sent-back' ? `Sent back from ${stageLabel(h.from)} to ${h.label ?? stageLabel(h.stage)}: ${h.reason}`
          : HISTORY_WORDS[h.kind] ? `${HISTORY_WORDS[h.kind]} ${stageLabel(h.stage)}${h.reason ? `: ${h.reason}` : ''}`
            : i === 0 ? `Entered ${stageLabel(h.stage)}` : handoffLabel(all[i - 1].stage, h.stage),
      })).reverse(),
      approvals: await Promise.all(approvals.map((a) => queueRow(a, ctx, nameOf))),
      actions: {
        canSendBack: canApprove && found.status === 'active' && stageIndex(found.stage) > 0,
        sendBackTo: STAGES.slice(0, Math.max(0, stageIndex(found.stage))).map((s) => ({ key: s.key, label: s.label })),
        // An item with stories goes on story by story (Phase 16c); a story with pull requests, and a pull request, pull
        // request by pull request (Phase 16e).
        canAdvance: mayApprove && found.status === 'active' && !blocking.length && !stories.length && !(found.type === 'pr' && found.pr) && !(pulls.length && ['build', 'test'].includes(found.stage)),
        ...(stories.length ? { perStory: `${found.ref ?? found.id} goes on story by story: hand each one off in Design.` } : {}),
        ...(found.type === 'pr' && found.pr ? { perPullRequest: `${found.ref ?? found.id} moves on with its own Build and Test approvals: decide them on its page or in Approvals.` }
          : pulls.length && ['build', 'test'].includes(found.stage) ? { perPullRequest: `${found.ref ?? found.id} goes on pull request by pull request: decide each one's Build and Test approvals.` } : {}),
        advanceLabel: ADVANCE_LABELS[found.stage] ?? `Approve & move to ${next?.label}`,
        blockedBy: blocking.map((a) => a.id),
      },
    };
  }

  // ---------------------------------------------------------------------------- Approvals

  async function queueRow(a, ctx, nameOf) {
    const rule = ctx.rules.get(a.type) ?? {};
    const item = ctx.items.find((i) => i.id === a.itemId);
    const hours = (ms(a.decidedAt && !isOpen(a) ? a.decidedAt : ctx.at) - ms(a.requestedAt)) / HOUR;
    let due = null;
    if (isOpen(a) && a.dueAt) {
      if (ctx.at > a.dueAt) due = { text: `overdue ${hoursText((ms(ctx.at) - ms(a.dueAt)) / HOUR)}`, tone: 'danger' };
      else if (a.dueAt.slice(0, 10) === ctx.at.slice(0, 10)) due = { text: 'due today', tone: 'warning' };
    }
    const requester = a.requestedBy?.name ?? nameOf(a.requestedBy?.id);
    let context = a.context ?? null;
    if (a.type === 'spec' && item) {
      const readiness = await engine.readinessOf(item);
      context = `Drafted by ${requester} · readiness ${readiness.passed} of ${readiness.total} checks`;
    }
    const line = a.line ?? `${rule.transition ?? rule.label ?? a.type}${PR_TYPES.has(a.type) ? '' : ` · from ${requester}`}`;
    return {
      id: a.id, type: a.type, tag: rule.tag ?? a.type, tone: TAG_TONES[a.type] ?? 'neutral',
      title: a.type === 'infra-design' ? `${a.subject ?? a.title} · Approve & provision ${a.ref?.kindLabel ?? a.ref?.kind ?? ''}`.trim() : a.type === 'adr' && a.subject ? `${a.subject} · ${a.title}` : PR_TYPES.has(a.type) && item ? `${item.ref} · ${item.title}` : `${a.title} — ${a.itemId}`,
      shortTitle: a.title, itemId: a.itemId, itemRef: item?.ref ?? a.itemId, subject: a.subject ?? null,
      age: hoursText(hours), ageHours: Math.round(hours), due, line, context,
      status: a.status, overdue: overdue(a, ctx.at),
      decidedAt: a.decidedAt ?? null, decidedByName: a.decidedBy ? nameOf(a.decidedBy) : null,
      href: `/home/approvals?id=${a.id}`,
    };
  }

  async function approvals(person, { tab = 'mine' } = {}) {
    const ctx = await load();
    const nameOf = await names();
    const start = weekStart(ctx.at);
    const groups = {
      mine: ctx.approvals.filter((a) => waitingOn(a, person.id)),
      others: ctx.approvals.filter((a) => isOpen(a) && !waitingOn(a, person.id)),
      done: ctx.approvals.filter((a) => !isOpen(a) && a.status !== 'withdrawn' && a.decidedAt && a.decidedAt >= start),
    };
    const chosen = groups[tab] ? tab : 'mine';
    const list = [...groups[chosen]].sort((a, b) => (chosen === 'done' ? ms(b.decidedAt) - ms(a.decidedAt) : ms(a.requestedAt) - ms(b.requestedAt)));
    const mine = groups.mine;
    const oldest = mine.length ? Math.max(...mine.map((a) => (ms(ctx.at) - ms(a.requestedAt)) / HOUR)) : 0;
    return {
      at: ctx.at,
      tab: chosen,
      counts: { mine: groups.mine.length, others: groups.others.length, done: groups.done.length },
      summary: mine.length
        ? `${words(mine.length)} ${mine.length === 1 ? 'is' : 'are'} waiting on you; the oldest for ${hoursText(oldest).replace(' h', ' hours').replace(' d', ' days').replace(' min', ' minutes')}.`
        : 'Nothing is waiting on you.',
      rows: await Promise.all(list.map((a) => queueRow(a, ctx, nameOf))),
    };
  }

  async function approval(id, person) {
    const ctx = await load();
    const nameOf = await names();
    const a = ctx.approvals.find((x) => x.id === id);
    if (!a) throw notFound(`There is no approval ${id}.`);
    const rule = ctx.rules.get(a.type) ?? {};
    const item = ctx.items.find((i) => i.id === a.itemId);
    const readiness = item && rule.needsReadiness ? await engine.readinessOf(item) : null;
    const others = (a.reviewers ?? []).filter((r) => r.id !== person.id);
    const mineWaiting = waitingOn(a, person.id);
    const everyone = await host.people.list();
    const eligible = [];
    if (mineWaiting) {
      for (const p of everyone) {
        if (p.active && p.id !== person.id && !(a.reviewers ?? []).some((r) => r.id === p.id) && await host.can(p.accessRole, rule.permission)) eligible.push({ id: p.id, name: p.name, accessRole: p.accessRole });
      }
    }
    const next = a.to ? stageLabel(a.to) : null;
    // Whom this person may decide for: their own place when it is still waiting, else anyone it waits on (Phase 16b).
    const waitingRows = (a.reviewers ?? []).filter((r) => r.status === 'waiting');
    const multi = Number.isInteger(rule.quorum) && rule.quorum > 1;
    const alreadyGave = multi && (a.reviewers ?? []).some((r) => r.status === 'approved' && (r.by ?? r.id) === person.id);
    let cannot = null;
    if (!isOpen(a)) cannot = `This approval is ${a.status === 'approved' ? 'approved' : a.status === 'withdrawn' ? 'withdrawn' : 'back with the requester for changes'}.`;
    else if (person.accessRole === 'Viewer') cannot = `Viewers can't approve, for themselves or on anyone's behalf. Your access role is ${person.accessRole}.`;
    else if (!waitingRows.length) cannot = 'Nobody is still waiting on this approval.';
    else if (alreadyGave) cannot = `You already gave one of the ${rule.quorum} approvals ${rule.label ?? 'this'} needs: another person must give the next.`;
    return {
      at: ctx.at,
      row: await queueRow(a, ctx, nameOf),
      approval: {
        id: a.id, type: a.type, label: rule.label ?? a.type, status: a.status, title: a.title, subject: a.subject ?? null,
        itemId: a.itemId, itemRef: item?.ref ?? a.itemId, itemStage: item ? stageLabel(item.stage) : null,
        requestedBy: a.requestedBy ?? null, requestedByName: a.requestedBy?.name ?? nameOf(a.requestedBy?.id), requestedAt: a.requestedAt, age: hoursText((ms(ctx.at) - ms(a.requestedAt)) / HOUR),
        dueAt: a.dueAt ?? null, version: a.artefactVersion ?? null,
        from: a.from ? (a.type === 'adr' ? 'Proposed' : rule.fromLabel ?? stageLabel(a.from)) : null,
        to: a.type === 'adr' ? 'Accepted' : a.type === 'merge' ? 'Merged' : rule.toLabel ?? next,
        summary: a.body || null, next: a.next ?? null, cost: a.cost ?? null,
        readiness,
        others: { approved: others.filter((r) => r.status === 'approved').length, total: others.length, names: others.map((r) => `${nameOf(r.id)}${r.status === 'waiting' ? ' (waiting)' : r.status === 'changes-requested' ? ' (asked for changes)' : ''}`) },
        reviewers: (a.reviewers ?? []).map((r) => ({ ...r, name: nameOf(r.id), ...(r.by ? { byName: nameOf(r.by) } : {}) })),
        reminders: (a.reminders ?? []).map((r) => ({ at: r.at, toNames: (r.to ?? []).map(nameOf) })),
        escalated: a.escalated ? { at: a.escalated.at, toNames: (a.escalated.to ?? []).map(nameOf) } : null,
        override: a.override ? { ...a.override, byName: nameOf(a.override.by) } : null,
        workItems: a.workItems?.length ?? null,
        links: {
          artefact: a.link ?? (item?.system === 'product' && item.inProduct !== false
            ? (a.type === 'adr' ? `/factory/design/architecture/${encodeURIComponent(a.itemId)}` : `/factory/product/specs/${encodeURIComponent(a.itemId)}`)
            : null),
          artefactLabel: a.type === 'infra-design' ? `Open ${a.subject ?? 'the design'}` : a.type === 'adr' ? `Read ${a.subject ?? 'the decision'}` : 'Read the full spec',
          item: `/home/lifecycle/${encodeURIComponent(a.itemId)}`,
        },
        decide: {
          can: !cannot, cannot, needsReadiness: Boolean(rule.needsReadiness),
          approveLabel: a.type === 'infra-design' ? `Approve & provision ${a.ref?.kindLabel ?? a.ref?.kind ?? ''}`.trim() : a.type === 'adr' ? 'Accept the decision' : rule.transition ?? 'Approve',
          eligible,
          // The places this person may decide: their own when it waits on them, else on behalf of whoever it waits on.
          mine: mineWaiting,
          for: (mineWaiting ? waitingRows.filter((r) => r.id === person.id) : waitingRows).map((r) => ({ id: r.id, name: nameOf(r.id), role: r.role ?? null })),
        },
      },
    };
  }

  /** The Who approves what table (the rules marked listed). */
  async function rulesTable() {
    const rules = await engine.rules();
    return { rules: [...rules.values()].filter((r) => r.listed !== false && !r.retired).map((r) => ({ key: r.key, decision: r.decision, approver: r.approver, target: r.targetText, ifLate: r.ifLate })) };
  }

  /** Counts for status cards and badges. */
  async function counts(person) {
    const ctx = await load();
    const active = ctx.items.filter((i) => i.status === 'active');
    const agents = new Set(active.filter((i) => i.work?.by && i.work.progress !== undefined && i.work.progress !== null).map((i) => i.work.by));
    return {
      inFlight: active.length,
      waitingOnYou: person ? ctx.approvals.filter((a) => waitingOn(a, person.id)).length : 0,
      agentsWorking: agents.size,
    };
  }

  /** Agents working now (from the items they are drafting), for Activity's Live now. */
  async function live() {
    const ctx = await load();
    return ctx.items
      .filter((i) => i.status === 'active' && i.work?.by && typeof i.work.progress === 'number')
      .map((i) => ({ agent: i.work.by, name: titleCase(i.work.by), task: i.work.task ?? i.title, itemId: i.id, progress: i.work.progress }))
      .sort((a, b) => b.progress - a.progress);
  }

  /**
   * Everything a home page needs in one read (NooblyJS's For you pages): every item as a swimlane row with its team,
   * every open approval with its summary, who it waits on and whether this person may decide it, and stage health.
   * The host scopes it to the person's teams; nothing here is filtered.
   */
  async function snapshot(person) {
    const ctx = await load();
    const nameOf = await names();
    const items = ctx.items.map((i) => ({
      ...row(i, ctx, person.id, nameOf), status: i.status, team: i.team ?? null, work: i.work ?? null,
      waitingSince: i.waitingSince ?? null, createdAt: i.createdAt, completedAt: i.completedAt ?? null, stageEnteredAt: i.stageEnteredAt ?? null,
      lastNudgedAt: (i.nudges ?? []).at(-1)?.at ?? null,
    }));
    const approvals = [];
    for (const a of ctx.approvals.filter(isOpen)) {
      const rule = ctx.rules.get(a.type) ?? {};
      const waitingIds = (a.reviewers ?? []).filter((r) => r.status === 'waiting').map((r) => r.id);
      approvals.push({
        ...(await queueRow(a, ctx, nameOf)),
        summary: a.body || null, requestedAt: a.requestedAt, dueAt: a.dueAt ?? null, targetText: rule.targetText ?? null,
        requestedByName: a.requestedBy?.name ?? nameOf(a.requestedBy?.id), version: a.artefactVersion ?? null,
        waitingOn: waitingIds, waitingOnNames: waitingIds.map(nameOf), mine: waitingOn(a, person.id),
        // Waiting on them, and they may approve (anyone but a Viewer, Phase 16b).
        canDecide: waitingOn(a, person.id) && person.accessRole !== 'Viewer',
        team: ctx.items.find((i) => i.id === a.itemId)?.team ?? null,
      });
    }
    return { at: ctx.at, items, approvals, stages: stageHealth(ctx), waitingTooLongDays: ctx.thresholds.waitingTooLongDays, weekStart: weekStart(ctx.at) };
  }

  /** Waiting-on-you rows for other apps' homes. */
  async function waitingFor(person) {
    if (!person?.id) return [];
    const ctx = await load();
    const nameOf = await names();
    return Promise.all(ctx.approvals.filter((a) => waitingOn(a, person.id)).map((a) => queueRow(a, ctx, nameOf)));
  }

  return { overview, lifecycle, flow, item, approvals, approval, rulesTable, counts, live, waitingFor, snapshot };
}
