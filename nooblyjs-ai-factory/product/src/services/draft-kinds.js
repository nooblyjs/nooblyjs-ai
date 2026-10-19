// What each stage's agent can draft, and how a finished draft is saved (docs/roadmap-history.md P3–P5). Each kind says which
// stage and teammate it belongs to, its work type (model routing, nooblyjs-ai.md), a cost estimate for the budget
// check, check() before it is queued, mock() for when Teammates isn't running, and apply() to save the result as
// a new version through the stage's own write path (so the same If-Match and approval rules apply).
//
// The mocks write clearly marked placeholder content: they show the flow; they never invent evidence or numbers.
import { HttpError, notFound } from '../util/errors.js';
import { parseSpec } from './spec-format.js';
import { PRODUCT_AGENT } from './spec-writes.js';

/** A draft that would land on a newer version than it started from is not saved: nothing a person wrote is lost. */
export function staleDraft(itemId, err) {
  if (err?.status === 409 && err.code === 'conflict') {
    return new HttpError(409, 'stale_draft', `${itemId} changed while the agent was drafting, so the draft was not saved. Nothing you wrote was lost; ask again.`);
  }
  return err;
}

const P = (what) => `[PLACEHOLDER: ${what}]`;

/** Spec sections the mock agent drafts, each from the spec as it is. */
const SPEC_SECTIONS = {
  problem: {
    label: 'the problem',
    patch: (parts, draft) => ({ problem: `${parts.problem || draft.brief || 'The problem as briefed.'} ${P('evidence from Knowledge: ticket counts, review themes, funnel data')}`.trim() }),
  },
  goals: {
    label: 'measurable goals',
    patch: (parts) => ({ goals: [...parts.goals, { measure: P('the outcome to move'), today: P("today's value"), target: P('target') }] }),
  },
  'acceptance-criteria': {
    label: 'testable criteria',
    patch: (parts) => ({
      acceptanceCriteria: parts.acceptanceCriteria.length
        ? parts.acceptanceCriteria.map((c) => (c.given ? c : { given: P('the starting state'), when: c.text, then: P('the observable result') }))
        : [{ given: P('the starting state'), when: P('the customer acts'), then: P('the observable result') }],
    }),
  },
  dependencies: {
    label: 'the dependencies',
    patch: (parts) => ({ sections: [...parts.other.filter((s) => !/^dependencies$/i.test(s.heading)), { heading: 'Dependencies', text: `- ${P('services and teams this change relies on, from the architecture in Knowledge')}` }] }),
  },
  'performance-targets': {
    label: 'performance targets',
    patch: (parts) => ({ goals: [...parts.goals, { measure: 'Page load time, p95', today: P("today's p95"), target: P('target, e.g. 300 ms') }] }),
  },
  'privacy-review': {
    label: 'a privacy review',
    // A draft for a person to review: "Privacy reviewed" stays as recorded until a person marks it.
    patch: (parts) => ({ sections: [...parts.other.filter((s) => !/^privacy review/i.test(s.heading)), { heading: 'Privacy review (draft)', text: `${P('personal data touched, where it is stored, retention')}\n\nCustomer data stays in-region. A person confirms this review.` }] }),
  },
  'rollout-plan': {
    label: 'the rollout plan',
    patch: () => ({
      rolloutPlan: [
        `1. Pilot in ${P('number')} stores behind a feature flag for two weeks.`,
        '2. Watch the goals above daily; roll back by turning the flag off.',
        '3. Roll out region by region once the pilot meets its targets.',
      ].join('\n'),
    }),
  },
};

const ESTIMATE = { spec: 1.4, section: 0.45 };

/** The Product stage's kinds: the whole spec (from a person's brief) and one per readiness action. */
export function specKinds({ repos, specWrites }) {
  async function specFor(itemId, { forWriting = true } = {}) {
    const spec = await repos.specs.get(itemId);
    if (!spec) throw notFound(`There is no spec ${itemId}.`);
    if (forWriting && spec.status === 'approved') {
      throw new HttpError(409, 'approved', `${itemId} v${spec.version} is approved, so agents can't change it.`);
    }
    return spec;
  }

  async function save(draft, patch, note) {
    try {
      const { spec } = await specWrites.update(draft.itemId, { ...patch, changeNote: note }, draft.teammate, { ifMatch: `"${draft.itemId}@${draft.baseVersion}"` });
      return { version: spec.version, text: note, ref: { specId: draft.itemId } };
    } catch (err) {
      throw staleDraft(draft.itemId, err);
    }
  }

  const kinds = {
    spec: {
      stage: 'product', label: 'the spec', workType: 'spec-drafting', agent: PRODUCT_AGENT, estimateUsd: ESTIMATE.spec, doneEvent: 'spec.drafted',
      async check(itemId, fields) {
        const spec = await specFor(itemId);
        if (spec.status === 'awaiting-brief' && !fields.brief?.trim()) {
          throw new HttpError(422, 'invalid', 'Brief the agent first: say what the spec is about.', { brief: 'brief is required to start a spec' });
        }
        return { baseVersion: spec.version ?? 0, title: spec.title };
      },
      async mock(draft) {
        const spec = await specFor(draft.itemId);
        const parts = parseSpec(spec.body);
        const brief = draft.brief ?? spec.title;
        return {
          costUsd: ESTIMATE.spec,
          output: {
            problem: parts.problem || `${brief} ${P('evidence from Knowledge')}`,
            goals: parts.goals.length ? parts.goals : [{ measure: P('the outcome to move'), today: P("today's value"), target: P('target') }],
            stories: parts.stories.length ? parts.stories : [`As a customer, ${P('what they can do, from the brief')}.`],
            acceptanceCriteria: parts.acceptanceCriteria.length ? parts.acceptanceCriteria : [{ given: P('the starting state'), when: P('the customer acts'), then: P('the observable result') }],
            outOfScope: parts.outOfScope || P('what this spec leaves out'),
          },
        };
      },
      // The note doesn't quote the brief: briefs can hold personal data, and notes are kept in the spec's history.
      apply: (draft, output) => save(draft, output, draft.brief ? 'Drafted from your brief' : 'Drafted the spec'),
    },
  };

  for (const [key, section] of Object.entries(SPEC_SECTIONS)) {
    kinds[key] = {
      stage: 'product', label: section.label, workType: 'spec-drafting', agent: PRODUCT_AGENT, estimateUsd: ESTIMATE.section, doneEvent: 'spec.drafted',
      async check(itemId) {
        const spec = await specFor(itemId);
        if (!spec.version) throw new HttpError(409, 'not_started', `${itemId} has no content yet. Brief the agent to draft the spec first.`);
        return { baseVersion: spec.version, title: spec.title };
      },
      async mock(draft) {
        const spec = await specFor(draft.itemId);
        return { costUsd: ESTIMATE.section, output: section.patch(parseSpec(spec.body), draft) };
      },
      apply: (draft, output) => save(draft, output, `Drafted ${section.label}`),
    };
  }
  return kinds;
}
