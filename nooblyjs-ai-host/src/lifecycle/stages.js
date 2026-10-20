// The lifecycle stages (root product.md §3.2, version 3), in order. Every item is in exactly one of them. `area` is how a
// handoff between stages is named ("Product → Design"). Since Phase 16b (2026-10-20) requirements, UX and UI are one
// Product stage; Design does the business requirements, solution architecture and stories; Engineer the application
// architecture and test analysis; and Test, where a person gives the Test approval, replaces Verify.

export const STAGES = [
  { key: 'discover', number: 1, label: 'Discover', area: 'Discover' },
  { key: 'product', number: 2, label: 'Product', area: 'Product' },
  { key: 'design', number: 3, label: 'Design', area: 'Design' },
  { key: 'engineer', number: 4, label: 'Engineer', area: 'Engineering' },
  { key: 'build', number: 5, label: 'Build', area: 'Build' },
  { key: 'test', number: 6, label: 'Test', area: 'Test' },
  { key: 'release', number: 7, label: 'Release', area: 'Release' },
  { key: 'operate', number: 8, label: 'Operate', area: 'Operate' },
];

// Stage keys from before: what each means now, and how history written then reads. Ship was replaced by Verify in
// Phase 16a, and Verify by Test in Phase 16b.
export const LEGACY = { specify: 'product', ux: 'product', ui: 'product', architect: 'design', verify: 'test', ship: 'test' };
const LEGACY_LABELS = { specify: 'Specify', ux: 'UX design', ui: 'UI design', architect: 'Architect', verify: 'Verify', ship: 'Ship' };

export const STAGE_KEYS = STAGES.map((s) => s.key);
const BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

// The Product engine's names for its areas: product, ux and ui are the Product stage's work, architecture the Design
// stage's. Sending something back "to Product" means back to the Product stage.
const PRODUCT_NAMES = { architecture: 'design', ux: 'product', ui: 'product' };

/** A lifecycle stage key from a lifecycle or Product Factory name, or null. */
export function stageKey(name) {
  const key = String(name ?? '').toLowerCase();
  if (BY_KEY.has(key)) return key;
  return PRODUCT_NAMES[key] ?? LEGACY[key] ?? null;
}

/** Where a stage key, current or from before, belongs now (an unknown key is returned as it is). */
export const currentStage = (key) => (BY_KEY.has(key) ? key : LEGACY[key] ?? key);

export const stageLabel = (key) => BY_KEY.get(key)?.label ?? LEGACY_LABELS[key] ?? key;
export const stageIndex = (key) => STAGE_KEYS.indexOf(key);
export const nextStage = (key) => STAGE_KEYS[stageIndex(key) + 1] ?? null;

/** "Product → Design", or "Discover → Product" when both stages belong to the same area. */
export function handoffLabel(from, to) {
  const a = BY_KEY.get(from);
  const b = BY_KEY.get(to);
  if (!a || !b) return `${stageLabel(from)} → ${stageLabel(to)}`;
  return a.area === b.area ? `${a.label} → ${b.label}` : `${a.area} → ${b.area}`;
}
