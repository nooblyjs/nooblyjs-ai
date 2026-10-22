// OUTCOME REVIEWS (root product.md §3.2, §3.7): every item ends with one. It is due a number of days after the item's
// first release went to production (policies.yaml, default 30, on the business clock). When it is due, the lifecycle's
// `outcome-review` approval is opened on it (a Product lead decides; Home · Approvals or this app): the spec's goals,
// each measure today (the monitoring adapter) against where it started and its target. Approved, the item is done; a
// goal missed can open an idea that feeds Discover. Closing the item withdraws its stories never released (decided
// 2026-10-21; the lifecycle engine does it), and the review says so beforehand.
import { HttpError, notFound, conflict, badRequest } from '../util/errors.js';
import { numberOf } from '../util/ids.js';
import { needs, peopleOnly } from '../util/http.js';

const DAY = 86_400_000;
const STATUS_TEXT = { scheduled: 'Scheduled', due: 'Due: a Product lead decides', closed: 'Closed: the item is done', 'changes-requested': 'Changes asked for' };
const num = (text) => { const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
const seconds = (text) => { const n = num(text); if (n === null) return null; return /\bms\b/i.test(String(text)) ? n / 1000 : n; };

/** Has the measure reached its target? Down is better when the target is lower than where it started. */
export function goalMet(goal, now) {
  const scale = /\b(ms|s)\b/i.test(`${goal.today} ${goal.target}`) ? seconds : num;
  const [before, target, value] = [scale(goal.today), scale(goal.target), scale(now)];
  if (before === null || target === null || value === null) return null;
  return target >= before ? value >= target : value <= target;
}

export function createOutcomes({ repos, host, log, policies, monitor, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const svc = (name) => host.service?.(name) ?? null;
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });

  /** The item's first release is in production: its outcome review is scheduled (once). */
  async function schedule(release) {
    const id = `OR-${numberOf(release.itemId)}`;
    if (await repos.outcomes.get(id)) return null;
    const days = Number((await policies.read()).outcomeReviewDays) || 30;
    const record = { id, itemId: release.itemId, releaseId: release.id, release: `${release.id} · ${release.name}`, status: 'scheduled', dueAt: new Date(now() + days * DAY).toISOString(), days, createdAt: iso() };
    await repos.outcomes.write(record);
    await emit('outcome_review.scheduled', { outcomeId: id, itemId: release.itemId, dueAt: record.dueAt, summary: `scheduled ${release.itemId}'s outcome review for ${record.dueAt.slice(0, 10)}, ${days} days after ${record.release}` });
    return record;
  }

  /** Reviews whose day has come open the lifecycle's outcome-review approval (on the business clock). */
  async function sweep() {
    const at = now();
    for (const r of await repos.outcomes.list()) {
      if (r.status !== 'scheduled' || new Date(r.dueAt).getTime() > at) continue;
      const w = svc('workflows');
      if (typeof w?.requestAppApproval !== 'function') return;
      const asked = await w.requestAppApproval({
        type: 'outcome-review', itemId: r.itemId, title: `${r.itemId}'s outcome review`, subject: `${r.id} · ${r.itemId}`,
        ref: { app: 'operations', id: r.id, kind: 'outcome-review' }, link: `${mountPath}/outcome-reviews/${r.id}`,
        context: `The goals of ${r.itemId} against their targets, ${r.days} days after ${r.release}. Approve to close the item.`,
      }).catch((err) => { log.warn(`outcome review ${r.id}: ${err.message}`); return null; });
      if (!asked) continue;
      await repos.outcomes.update(r.id, (cur) => (cur.status !== 'scheduled' ? null : { ...cur, status: 'due', approvalId: asked.approvalId, openedAt: iso() }));
      await emit('outcome_review.due', { outcomeId: r.id, itemId: r.itemId, approvalId: asked.approvalId, summary: `${r.itemId}'s outcome review is due` });
    }
  }

  /** The review: each goal today against its target (the monitoring adapter), and what of the item is still under way. */
  async function view(id) {
    await sweep();
    const r = await repos.outcomes.get(id);
    if (!r) throw notFound(`There is no outcome review ${id}.`);
    const inputs = await Promise.resolve(svc('product')?.designInputs?.(r.itemId)).catch(() => null);
    const goals = [];
    for (const g of inputs?.spec?.goals ?? []) {
      const today = await monitor.measure(g);
      goals.push({ measure: g.measure, before: g.today, now: today, target: g.target, met: goalMet(g, today), text: `${g.measure}: ${today ?? 'not measured'} now (from ${g.today}; target ${g.target})` });
    }
    const stories = ((await Promise.resolve(svc('workflows')?.storiesOf?.({ itemId: r.itemId })).catch(() => [])) ?? []).filter((s) => s.status === 'active' && s.stage !== 'operate');
    const met = goals.filter((g) => g.met === true).length;
    return {
      ...r, statusText: STATUS_TEXT[r.status] ?? r.status, goals, monitor: { name: monitor.name, real: monitor.real },
      text: goals.length ? `${met} of ${goals.length} goals met` : 'The spec has no goals to measure',
      stillUnderWay: stories.map((s) => ({ id: s.id, title: s.title, stage: s.stage })),
      ...(stories.length ? { closingText: `Closing ${r.itemId} withdraws ${stories.map((s) => s.id).join(', ')}, never released.` } : {}),
      href: `${mountPath}/outcome-reviews/${r.id}`,
    };
  }

  /** The lifecycle relays each decision on the outcome-review approval: only a due review is decided. */
  async function decideApproval({ id, person }) {
    // Whoever decides it, for themselves or on someone's behalf, holds the rule's `approve` (people only).
    await peopleOnly(host, person, `decide ${id}`);
    await needs(host, person, 'approve', `decide ${id}`);
    const r = await repos.outcomes.get(id);
    if (!r) throw notFound(`There is no outcome review ${id}.`);
    if (r.status !== 'due') throw conflict(`${id} is ${STATUS_TEXT[r.status].toLowerCase()}: there is nothing to decide.`);
    return { id, text: null };
  }

  /** The approval was decided (the lifecycle's event): closed, with the goals as they stood. */
  async function onApprovalDecided(payload = {}) {
    if (payload.ref?.app !== 'operations' || payload.type !== 'outcome-review' || !payload.ref?.id || payload.outcome === 'pending') return null;
    const shown = await view(payload.ref.id).catch(() => null);
    if (!shown || shown.status !== 'due') return null;
    const at = iso();
    const status = payload.outcome === 'approved' ? 'closed' : 'changes-requested';
    await repos.outcomes.update(shown.id, (cur) => ({ ...cur, status, decidedAt: at, decidedBy: payload.by ?? null, goals: shown.goals, reason: payload.reason ?? null }));
    if (status === 'closed') {
      await emit('outcome_review.closed', { outcomeId: shown.id, itemId: shown.itemId, met: shown.goals.filter((g) => g.met === true).length, goals: shown.goals.length, text: shown.text, href: `${mountPath}/outcome-reviews/${shown.id}`, summary: `closed ${shown.itemId} with its outcome review: ${shown.text}` }, payload.by);
    }
    return status;
  }

  /** A goal was missed: an idea for Discover (the Product section), linked to the review. */
  async function openIdea(id, body = {}, person) {
    await needs(host, person, 'draft', `open an idea from ${id}`);
    const r = await view(id);
    const missed = r.goals.filter((g) => g.met === false);
    const title = (typeof body.title === 'string' && body.title.trim()) || (missed[0] ? `${missed[0].measure}: reach ${missed[0].target}` : '');
    if (!title) throw badRequest('Say what the idea is: every goal was met.', { title: 'required' });
    const product = svc('product');
    if (typeof product?.createIdea !== 'function') throw new HttpError(503, 'product_unavailable', 'The Product section is not running here.');
    const idea = await product.createIdea({ title: title.slice(0, 200), problem: `From ${r.itemId}'s outcome review (${id}): ${missed.map((g) => g.text).join('; ') || r.text}.`, actor: person });
    await repos.outcomes.update(id, (cur) => ({ ...cur, ideas: [...(cur.ideas ?? []), { id: idea.id, title: idea.title, by: { id: person.id, name: person.name ?? person.id } }] }));
    await emit('outcome_review.idea_opened', { outcomeId: id, itemId: r.itemId, ideaId: idea.id, summary: `opened ${idea.id} from ${r.itemId}'s outcome review` }, person);
    return view(id);
  }

  const list = async () => { await sweep(); return Promise.all((await repos.outcomes.list()).map((r) => view(r.id))); };
  return { schedule, sweep, view, decideApproval, onApprovalDecided, openIdea, list };
}
