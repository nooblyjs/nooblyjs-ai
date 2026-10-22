// The ideas portal (NooblyJS Phase 25a): colleagues put ideas forward, vote, comment and follow. It is for everyone
// signed in to NooblyJS (the `suggest` permission, which every access role has), and never for agents. An idea put
// forward is an idea with the status "suggested": off the board until a person with `draft` promotes it, or merges it
// into another (its votes, followers and comments go with it).
//
// Votes: 10 open at a time per person. A vote stops counting when its idea ships or closes. A vote cast on behalf of a
// colleague (a store manager on the phone) carries their name and counts against the person who cast it.
import { HttpError, notFound, conflict } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { redact } from '../util/redact.js';
import { evidenceView } from './views.js';

export const VOTE_LIMIT = 10;
const DONE = ['closed', 'merged'];
const invalid = (message, details) => new HttpError(422, 'invalid', message, details);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '');

/** Does a vote on this idea still count against the limit? */
const counts = (idea) => !DONE.includes(idea.status ?? 'open') && !idea.shippedAt;

export function createPortal({ repos, host, ideas }) {
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? null });
  const audit = (entry) => host.audit?.record?.(entry);

  /** The idea's status in words, from where it is: the portal, the board, its spec, production. */
  function statusText(idea, specs) {
    if (idea.status === 'merged') return `Merged into ${idea.mergedInto}`;
    if (idea.status === 'closed') return 'Closed';
    if (idea.shippedAt) return 'Shipped';
    const spec = specs.find((s) => s.idea === idea.id);
    if (spec?.shippedAt) return 'Shipped';
    if (spec) return spec.status === 'approved' ? 'In progress' : 'Being specced';
    if (idea.status === 'accepted') return 'Accepted';
    if (idea.status === 'suggested') return 'Suggested';
    return 'On the board';
  }

  /** The person's votes that still count: [{ ideaId, title, voteId, onBehalfOf }]. */
  async function openVotes(personId, list = null) {
    const all = list ?? await repos.ideas.list();
    return all.filter(counts).flatMap((i) => (i.votes ?? []).filter((v) => v.by === personId).map((v) => ({ ideaId: i.id, title: i.title, voteId: v.id, onBehalfOf: v.onBehalfOf ?? null })));
  }

  async function ideaOr404(id) {
    const idea = /^IDEA-\d{3,}$/.test(String(id)) ? await repos.ideas.get(id) : null;
    if (!idea) throw notFound(`There is no idea ${String(id).slice(0, 20)}.`);
    return idea;
  }

  /** Every idea but the closed ones, as the portal shows it to this person, most votes first. */
  async function list(ctx, filter = {}) {
    const [all, specs] = await Promise.all([repos.ideas.list(), repos.specs.list()]);
    const me = ctx.me?.id;
    const name = (id) => ctx.people.get(id)?.name ?? id;
    const lower = (s) => String(s ?? '').toLowerCase();
    const view = (i) => ({
      id: i.id, title: i.title, problem: i.body?.trim() ?? '', product: i.product ?? null,
      portfolio: i.product ? ctx.products.get(lower(i.product)) ?? null : null,
      valueStream: i.product ? ctx.valueStreams.get(lower(i.product)) ?? null : null,
      status: i.status ?? 'open', statusText: statusText(i, specs), mergedInto: i.mergedInto ?? null,
      votes: (i.votes ?? []).length,
      yourVotes: (i.votes ?? []).filter((v) => v.by === me).map((v) => ({ id: v.id, onBehalfOf: v.onBehalfOf ?? null })),
      onBehalfOf: [...new Set((i.votes ?? []).map((v) => v.onBehalfOf).filter(Boolean))],
      followers: (i.followers ?? []).length, following: (i.followers ?? []).includes(me),
      comments: (i.comments ?? []).map((c) => ({ ...c, byName: name(c.by) })),
      submittedBy: i.submittedBy ? { id: i.submittedBy, name: name(i.submittedBy) } : null,
      votable: counts(i), evidence: evidenceView(ctx, i.id), createdAt: i.createdAt ?? null,
    });
    const is = (a, b) => !b || lower(a) === lower(b);
    const shown = all.filter((i) => (i.status ?? 'open') !== 'closed').map(view)
      .filter((v) => is(v.portfolio, filter.portfolio) && is(v.product, filter.product) && (!filter.status || v.status === filter.status))
      .sort((a, b) => b.votes - a.votes || b.id.localeCompare(a.id, 'en', { numeric: true }));
    const mine = await openVotes(me, all);
    return { ideas: shown, you: { openVotes: mine.length, limit: VOTE_LIMIT, left: Math.max(0, VOTE_LIMIT - mine.length), text: `You have ${mine.length} of ${VOTE_LIMIT} votes in use` } };
  }

  /** A colleague puts an idea forward for a product: it is suggested, followed by them. */
  async function submit(body, actor) {
    const idea = await ideas.createSuggested({ title: clean(body?.title, 120), product: clean(body?.product, 40), problem: redact(clean(body?.problem, 4000)) }, actor);
    await audit({ actor: actor.id, action: 'portal.idea_suggested', target: idea.id, system: 'product' });
    await emit('portal.idea_suggested', { ideaId: idea.id, product: idea.product, summary: `put forward ${idea.id} · ${idea.title} in the ideas portal` }, actor);
    return idea;
  }

  /** A vote, the person's own or { onBehalfOf: "a colleague's name" }, within the limit. */
  async function vote(id, body = {}, actor) {
    const behalf = clean(body.onBehalfOf, 80) ? redact(clean(body.onBehalfOf, 80)) : null;
    const mine = await openVotes(actor.id);
    if (mine.length >= VOTE_LIMIT) {
      throw new HttpError(409, 'vote_limit', `You have used all ${VOTE_LIMIT} of your votes. A vote comes back when its idea ships or closes, or take one back: ${mine.map((v) => `${v.ideaId}${v.onBehalfOf ? ` (for ${v.onBehalfOf})` : ''}`).join(', ')}.`, { votes: mine });
    }
    let cast;
    await repos.ideas.update(id, (idea) => {
      if (!idea) throw notFound(`There is no idea ${id}.`);
      if (!counts(idea)) throw conflict(`${id} is ${idea.status === 'merged' ? `merged into ${idea.mergedInto}: vote there` : idea.shippedAt ? 'shipped' : 'closed'}.`);
      const votes = idea.votes ?? [];
      if (!behalf && votes.some((v) => v.by === actor.id && !v.onBehalfOf)) throw conflict(`You have voted for ${id} already.`);
      if (behalf && votes.some((v) => v.by === actor.id && String(v.onBehalfOf).toLowerCase() === behalf.toLowerCase())) throw conflict(`You have voted for ${id} on behalf of ${behalf} already.`);
      cast = { id: newId('vot', 8), by: actor.id, ...(behalf ? { onBehalfOf: behalf } : {}), at: now() };
      const followers = idea.followers ?? [];
      return { ...idea, votes: [...votes, cast], followers: followers.includes(actor.id) ? followers : [...followers, actor.id] };
    });
    await audit({ actor: actor.id, action: 'portal.voted', target: id, system: 'product', ...(behalf ? { onBehalfOf: behalf } : {}) });
    await emit('portal.voted', { ideaId: id, summary: `voted for ${id}${behalf ? ` on behalf of ${behalf}` : ''}` }, actor);
    return { vote: cast, left: VOTE_LIMIT - mine.length - 1 };
  }

  /** Takes back one of the person's own votes (theirs, or one they cast on someone's behalf). */
  async function unvote(id, voteId, actor) {
    await repos.ideas.update(id, (idea) => {
      if (!idea) throw notFound(`There is no idea ${id}.`);
      const v = (idea.votes ?? []).find((x) => x.id === voteId);
      if (!v || v.by !== actor.id) throw notFound(`You have no vote ${String(voteId).slice(0, 30)} on ${id}.`);
      return { ...idea, votes: idea.votes.filter((x) => x.id !== voteId) };
    });
    await audit({ actor: actor.id, action: 'portal.unvoted', target: id, system: 'product' });
    await emit('portal.unvoted', { ideaId: id, summary: `took back a vote for ${id}` }, actor);
    return { removed: voteId };
  }

  async function comment(id, body = {}, actor) {
    const text = redact(clean(body.text, 2000));
    if (!text) throw invalid('Write a comment first.', { text: 'your comment' });
    let c;
    await repos.ideas.update(id, (idea) => {
      if (!idea) throw notFound(`There is no idea ${id}.`);
      if (idea.status === 'merged') throw conflict(`${id} is merged into ${idea.mergedInto}: comment there.`);
      c = { id: newId('cmt', 8), by: actor.id, text, at: now() };
      return { ...idea, comments: [...(idea.comments ?? []), c] };
    });
    await audit({ actor: actor.id, action: 'portal.commented', target: id, system: 'product' });
    await emit('portal.commented', { ideaId: id, summary: `commented on ${id}` }, actor);
    return c;
  }

  async function follow(id, on, actor) {
    await repos.ideas.update(id, (idea) => {
      if (!idea) throw notFound(`There is no idea ${id}.`);
      const followers = (idea.followers ?? []).filter((f) => f !== actor.id);
      return { ...idea, followers: on ? [...followers, actor.id] : followers };
    });
    await emit('portal.followed', { ideaId: id, following: on, summary: `${on ? 'follows' : 'stopped following'} ${id}` }, actor);
    return { ideaId: id, following: on };
  }

  /**
   * Merges an idea into another: its votes (a person's own vote once), followers and comments go with it, and it says
   * where it went. Only a suggested or open idea with no spec can be merged.
   */
  async function merge(id, into, actor) {
    if (id === into) throw invalid('Merge it into another idea.', { into: 'another idea' });
    const [from, target] = [await ideaOr404(id), await ideaOr404(into)];
    if (!['suggested', 'open'].includes(from.status ?? 'open')) throw conflict(`${id} is ${from.status}: only an idea that is suggested or on the board can be merged.`);
    if (!counts(target)) throw conflict(`${into} is ${target.status ?? 'shipped'}: merge into an idea that is still open.`);
    if ((await repos.specs.list()).some((s) => s.idea === id)) throw conflict(`${id} has a spec: it can't be merged.`);
    let moved = 0;
    await repos.ideas.update(into, (t) => {
      const votes = [...(t.votes ?? [])];
      for (const v of from.votes ?? []) {
        const same = votes.some((x) => x.by === v.by && String(x.onBehalfOf ?? '').toLowerCase() === String(v.onBehalfOf ?? '').toLowerCase());
        if (!same) { votes.push({ ...v, from: id }); moved += 1; }
      }
      const followers = [...new Set([...(t.followers ?? []), ...(from.followers ?? [])])];
      const comments = [...(t.comments ?? []), ...(from.comments ?? []).map((c) => ({ ...c, from: id }))];
      return { ...t, votes, followers, comments, merged: [...(t.merged ?? []), id], updatedAt: now() };
    });
    await repos.ideas.update(id, (f) => ({ ...f, status: 'merged', mergedInto: into, mergedBy: actor.id, mergedAt: now(), votes: [], followers: [], version: (f.version ?? 1) + 1 }));
    // Notes linked to the merged idea now count for the one it went into (evidence.js relatedIds).
    await audit({ actor: actor.id, action: 'portal.merged', target: id, system: 'product', into });
    await emit('portal.merged', { ideaId: id, into, votes: moved, summary: `merged ${id} into ${into} (${moved} vote${moved === 1 ? '' : 's'} carried over)` }, actor);
    return { ideaId: id, into, votesCarried: moved };
  }

  /** A suggested idea goes on the board. */
  async function promote(id, actor) {
    const idea = await ideaOr404(id);
    if (idea.status !== 'suggested') throw conflict(`${id} is ${idea.status === 'merged' ? `merged into ${idea.mergedInto}` : 'on the board already'}.`);
    await repos.ideas.update(id, (i) => ({ ...i, status: 'open', owner: i.owner ?? actor.id, promotedBy: actor.id, promotedAt: now(), version: (i.version ?? 1) + 1 }));
    await audit({ actor: actor.id, action: 'portal.promoted', target: id, system: 'product' });
    await emit('portal.promoted', { ideaId: id, summary: `put ${id} · ${idea.title} on the Product board` }, actor);
    return { ideaId: id, status: 'open' };
  }

  return { list, submit, vote, unvote, comment, follow, merge, promote, openVotes };
}
