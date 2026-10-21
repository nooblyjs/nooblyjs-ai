// Where an item is. The Product Factory numbers its own stages 1–4, which map to NooblyJS lifecycle stages 1–5
// (product.md §2). Both are returned (D4); the screens choose which to show.

export const STAGES = [
  { key: 'product', label: 'Product', factory: 1, lifecycle: [{ number: 1, label: 'Discover' }, { number: 2, label: 'Specify' }] },
  { key: 'architecture', label: 'Architecture', factory: 2, lifecycle: [{ number: 3, label: 'Architect' }] },
  { key: 'ux', label: 'UX design', factory: 3, lifecycle: [{ number: 4, label: 'UX design' }] },
  { key: 'ui', label: 'UI design', factory: 4, lifecycle: [{ number: 5, label: 'UI design' }] },
  { key: 'build', label: 'Software Factory', factory: null, lifecycle: [{ number: 6, label: 'Build' }] },
];
const BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

export const stageLabel = (key) => BY_KEY.get(key)?.label ?? key;

/** { key, label, factory: { number, label } | null, lifecycle: { number, label } } for a stage and lifecycle step. */
export function stageView(key, lifecycleNumber) {
  const stage = BY_KEY.get(key);
  if (!stage) return null;
  const lifecycle = stage.lifecycle.find((l) => l.number === lifecycleNumber) ?? stage.lifecycle[0];
  return {
    key: stage.key,
    label: stage.label,
    factory: stage.factory ? { number: stage.factory, label: stage.label } : null,
    lifecycle: { ...lifecycle },
  };
}

/**
 * The stage an item is in, from its kind and status. Until the NooblyJS lifecycle engine owns items (NooblyJS Phase 2), the status in
 * the artefact is the source; afterwards this comes from workflows.
 */
export function stageFor(kind, status) {
  if (kind === 'signal' || kind === 'idea') return stageView('product', 1);
  if (kind === 'spec') return status === 'approved' ? stageView('architecture', 3) : stageView('product', 2);
  return null;
}

/** The steps of the spec's "Where this is" tracker. */
const TRACKER = [
  { key: 'signal-clustered', label: 'Signal clustered' },
  { key: 'spec-drafted', label: 'Spec drafted' },
  { key: 'product-review', label: 'Product review' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'ux-ui-design', label: 'UX & UI design' },
  { key: 'software-factory', label: 'Software Factory' },
];
const CURRENT_STEP = { 'awaiting-brief': 'spec-drafted', drafting: 'spec-drafted', 'changes-requested': 'spec-drafted', 'in-review': 'product-review', approved: 'architecture' };

/** @param {string} status   the spec's status   @param {boolean} youReview   the viewer is a reviewer still waiting */
export function trackerFor(status, { youReview = false } = {}) {
  const current = TRACKER.findIndex((s) => s.key === (CURRENT_STEP[status] ?? 'spec-drafted'));
  return TRACKER.map((step, i) => ({
    key: step.key,
    label: step.key === 'product-review' && youReview && i === current ? `${step.label} — you` : step.label,
    state: i < current ? 'done' : i === current ? 'current' : 'next',
  }));
}
