// How records read to the screens: names instead of ids, every status in words (product.md §1), and the stage in
// both numberings (D4). Views are built per request for one person, because "you" and "mine" depend on who asks.
import { stageFor } from './stages.js';
import { riceScore } from './rice.js';

const money = (usd) => `$${usd.toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What every view needs: who is asking, everyone's names, and the drafting jobs (for progress and cost).
 * @param {{ people: object, repos: object }} deps
 * @param {object|null} person   req.person
 */
export async function viewContext({ people, repos }, person) {
  const [everyone, drafts, catalogue] = await Promise.all([people.list().catch(() => []), repos.drafts.list(), repos.catalogue.get()]);
  // product name (lower case) → the portfolio it sits in, and the value stream, so a view can say all three.
  const filed = (catalogue?.products ?? []).filter((p) => p?.name);
  const products = new Map(filed.map((p) => [String(p.name).toLowerCase(), p.portfolio ?? null]));
  const valueStreams = new Map(filed.map((p) => [String(p.name).toLowerCase(), p.valueStream ?? null]));
  // NooblyJS Phase 17: feature id → { id, name, epic: { id, name } }, so a card can say which feature it is for.
  const epics = new Map((catalogue?.epics ?? []).map((e) => [e.id, e]));
  const features = new Map((catalogue?.features ?? []).map((f) => [f.id, { id: f.id, name: f.name, epic: epics.has(f.epic) ? { id: f.epic, name: epics.get(f.epic).name } : null }]));
  return { me: person ?? null, people: new Map(everyone.map((p) => [p.id, p])), drafts, products, valueStreams, features };
}

/** The feature of the work hierarchy a record is for, and its epic (Phase 17): { feature, epic } or nulls. */
export function featureOf(ctx, record) {
  const f = record?.feature ? ctx?.features?.get(record.feature) ?? null : null;
  return { feature: f ? { id: f.id, name: f.name } : null, epic: f?.epic ?? null };
}

/** Where a record sits: { product, portfolio, valueStream }. The portfolio and value stream are the product's, from the catalogue. */
export function filedUnder(ctx, record) {
  const product = record?.product ?? null;
  const key = String(product ?? '').toLowerCase();
  return { product, portfolio: product ? ctx?.products?.get(key) ?? null : null, valueStream: product ? ctx?.valueStreams?.get(key) ?? null : null };
}

/** { id, name, kind } for a stored reference: an agent carries its name; a person's comes from people. */
export function actorRef(ctx, ref) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? ref : ref.id;
  const kind = typeof ref === 'string' ? 'person' : ref.kind ?? 'person';
  const name = kind === 'agent' ? ref.name ?? id : ctx.people.get(id)?.name ?? ref.name ?? id;
  return { id, name, kind };
}

// ---------- signals and ideas ----------

export function signalView(signal, ctx = null) {
  const unit = signal.unit ?? 'signals';
  // "188 app reviews" already names its source; "412 tickets" needs "· Zendesk".
  const names = signal.sourceLabel && !unit.toLowerCase().includes(signal.sourceLabel.toLowerCase());
  return {
    kind: 'signal',
    id: signal.id,
    title: signal.title,
    theme: signal.theme ?? null,
    ...filedUnder(ctx, signal),
    source: signal.source ?? null,
    sourceLabel: signal.sourceLabel ?? null,
    count: signal.count ?? 0,
    unit,
    week: signal.week ?? null,
    status: signal.status ?? 'new',
    idea: signal.idea ?? null,
    // NooblyJS Phase 23: a signal from production names the release and item it came from.
    ...(signal.release || signal.itemId ? { release: signal.release ?? null, itemId: signal.itemId ?? null } : {}),
    text: `${signal.count ?? 0} ${unit}${names ? ` · ${signal.sourceLabel}` : ''}${signal.release ? ` · ${signal.release}` : ''}`,
    stage: stageFor('signal'),
    detail: signal.body?.trim() || null,
  };
}

/** Where a record will be built (NooblyJS Phase 11): its repositories and Jira project. Linked Jira issues are NooblyJS's (devtools). */
export const whereBuilt = (record) => ({
  repositories: record.repositories ?? [],
  jiraProject: record.jiraProject ?? null,
});

export function ideaView(ctx, opp) {
  const score = riceScore(opp.rice);
  return {
    kind: 'idea',
    id: opp.id,
    title: opp.title,
    ...filedUnder(ctx, opp),
    ...featureOf(ctx, opp),
    status: opp.status ?? 'open',
    version: opp.version ?? 1, // an edit sends it back as If-Match: "<id>@<version>"
    owner: actorRef(ctx, opp.owner),
    problem: opp.body?.trim() || '',
    rice: { ...(opp.rice ?? {}), score },
    signals: opp.signals ?? [],
    ...whereBuilt(opp),
    text: [opp.product, score == null ? 'RICE not scored' : `RICE ${score}`].filter(Boolean).join(' · '),
    stage: stageFor('idea'),
    createdAt: opp.createdAt ?? null,
  };
}

// ---------- specs ----------

const REVIEW_STATUS = { approved: 'Approved', waiting: 'Waiting', 'changes-requested': 'Changes requested' };

export function reviewersView(ctx, spec) {
  return (spec.reviewers ?? []).map((r) => ({
    ...actorRef(ctx, r.id),
    role: r.role ?? null,
    status: r.status ?? 'waiting',
    statusText: REVIEW_STATUS[r.status] ?? 'Waiting',
    at: r.at ?? null,
    you: r.id === ctx.me?.id,
  }));
}

/** The running draft for an item, if any. */
export const runningDraft = (ctx, itemId) => ctx.drafts.find((d) => d.itemId === itemId && ['queued', 'running'].includes(d.status)) ?? null;

/** The spec's status in words, for this person. */
export function specStatusText(ctx, spec) {
  switch (spec.status) {
    case 'awaiting-brief':
    case 'drafting': {
      if (spec.status === 'awaiting-brief' && !runningDraft(ctx, spec.id)) return 'Awaiting your brief';
      const draft = runningDraft(ctx, spec.id);
      return draft ? `${draft.teammate?.name ?? 'The agent'} drafting · ${draft.progress ?? 0}%` : 'Drafting';
    }
    case 'in-review': {
      const reviewers = spec.reviewers ?? [];
      if (reviewers.some((r) => r.id === ctx.me?.id && r.status === 'waiting')) return 'Needs your approval';
      const approved = reviewers.filter((r) => r.status === 'approved').length;
      return `${approved} of ${plural(reviewers.length, 'reviewer')} approved`;
    }
    case 'changes-requested':
      return 'Changes requested';
    case 'approved':
      return 'Approved';
    default:
      return spec.status ?? 'Unknown';
  }
}

/** "Agent cost so far $7.40 · Research + 4 drafts", from the item's drafting jobs. */
export function agentCost(ctx, itemId) {
  const jobs = ctx.drafts.filter((d) => d.itemId === itemId);
  if (!jobs.length) return { usd: 0, research: 0, drafts: 0, text: 'No agent work yet' };
  const usd = Math.round(jobs.reduce((sum, d) => sum + (Number(d.costUsd) || 0), 0) * 100) / 100;
  const research = jobs.filter((d) => d.kind === 'research').length;
  const drafts = jobs.length - research;
  const parts = [research && (research === 1 ? 'Research' : plural(research, 'research run')), drafts && plural(drafts, 'draft')].filter(Boolean);
  return { usd, research, drafts, text: `Agent cost so far ${money(usd)} · ${parts.join(' + ')}` };
}

/** "Drafted by Ada Quill · edited by Lerato M. · v4" */
export function authorship(ctx, spec) {
  const draftedBy = actorRef(ctx, spec.draftedBy);
  const editedBy = actorRef(ctx, spec.editedBy);
  const parts = [draftedBy && `Drafted by ${draftedBy.name}`, editedBy && `edited by ${editedBy.name}`, spec.version ? `v${spec.version}` : null].filter(Boolean);
  const text = parts.length ? parts.join(' · ') : 'Not drafted yet';
  return { draftedBy, editedBy, version: spec.version ?? 0, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** The fields every list of specs shows. */
export function specSummary(ctx, spec) {
  const draft = ['drafting', 'awaiting-brief'].includes(spec.status) ? runningDraft(ctx, spec.id) : null;
  return {
    kind: 'spec',
    id: spec.id,
    title: spec.title,
    ...filedUnder(ctx, spec),
    ...featureOf(ctx, spec),
    status: spec.status,
    statusText: specStatusText(ctx, spec),
    progress: draft ? draft.progress ?? 0 : null,
    version: spec.version ?? 0,
    owner: actorRef(ctx, spec.owner),
    stage: stageFor('spec', spec.status),
    updatedAt: spec.updatedAt ?? null,
    ...whereBuilt(spec),
  };
}

/** The money spent by agents in a month ("2026-10"), from the drafting jobs. */
export function monthSpend(ctx, month) {
  const usd = ctx.drafts
    .filter((d) => String(d.createdAt ?? '').startsWith(month))
    .reduce((sum, d) => sum + (Number(d.costUsd) || 0), 0);
  return Math.round(usd * 100) / 100;
}

export { money };
