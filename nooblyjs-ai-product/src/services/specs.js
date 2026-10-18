// The Spec screen (product.md §5.2): the spec's parts, where it is, readiness, linked knowledge, reviewers and agent
// cost. Writes (versions, If-Match, decisions) arrive in P2.
import { parseSpec } from './spec-format.js';
import { readinessView } from './readiness.js';
import { trackerFor } from './stages.js';
import { actorRef, agentCost, authorship, reviewersView, specSummary } from './views.js';

const KNOWLEDGE_KIND = { runbook: 'Runbook', adr: 'Architecture decision', 'customer-insight': 'Customer insight', doc: 'Document' };

export function knowledgeView(link) {
  const kindLabel = KNOWLEDGE_KIND[link.kind] ?? 'Knowledge';
  return {
    id: link.id,
    title: link.kind === 'adr' ? `${link.id} · ${link.title}` : link.title,
    kind: link.kind ?? null,
    kindLabel,
    text: link.detail ? `${kindLabel} · ${link.detail}` : kindLabel,
  };
}

/** The ETag of a spec version: what If-Match is compared with. */
export { etagOf as specEtag } from '../util/http.js';

export function specDetail(ctx, spec) {
  const reviewers = reviewersView(ctx, spec);
  const youReview = reviewers.some((r) => r.you && r.status === 'waiting');
  const parts = parseSpec(spec.body);
  return {
    ...specSummary(ctx, spec),
    authorship: authorship(ctx, spec),
    changeNote: spec.changeNote ?? null,
    idea: spec.idea ?? null,
    signals: spec.signals ?? [],
    problem: parts.problem,
    goals: parts.goals,
    stories: parts.stories,
    acceptanceCriteria: parts.acceptanceCriteria,
    outOfScope: parts.outOfScope,
    rolloutPlan: parts.rolloutPlan || null,
    sections: parts.other,
    tracker: trackerFor(spec.status, { youReview }),
    readiness: readinessView(spec.readiness, spec.agent),
    knowledge: (spec.knowledge ?? []).map((k) => {
      const flag = (spec.knowledgeFlags ?? []).find((f) => f.id === k.id);
      return { ...knowledgeView(k), flagged: flag ? { reason: flag.reason, at: flag.at } : null };
    }),
    sentBack: spec.sentBack ? { ...spec.sentBack, text: `Sent back${spec.sentBack.from ? ` from ${spec.sentBack.from}` : ''}: ${spec.sentBack.reason ?? 'no reason given'}` } : null,
    reviewers,
    agent: actorRef(ctx, spec.agent),
    agentCost: agentCost(ctx, spec.id),
    createdAt: spec.createdAt ?? null,
  };
}

/** Every version, oldest first; the current one is last and marked. */
export function versionsView(ctx, spec, earlier) {
  const rows = earlier.map((v) => ({ version: v.version, by: actorRef(ctx, v.by), at: v.at ?? null, note: v.note ?? null, current: false }));
  if (spec.version > 0) {
    rows.push({ version: spec.version, by: actorRef(ctx, spec.versionBy ?? spec.editedBy ?? spec.draftedBy), at: spec.updatedAt ?? null, note: spec.changeNote ?? null, current: true });
  }
  return rows;
}
