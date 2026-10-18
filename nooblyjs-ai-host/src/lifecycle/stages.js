// The seven lifecycle stages (NooblyJS product.md §4), in order. Every item is in exactly one of them. `area` is how a
// handoff between stages is named ("Product → Architecture"): Discover and Specify are both the Product Factory's.

export const STAGES = [
  { key: 'discover', number: 1, label: 'Discover', area: 'Product' },
  { key: 'specify', number: 2, label: 'Specify', area: 'Product' },
  { key: 'architect', number: 3, label: 'Architect', area: 'Architecture' },
  { key: 'ux', number: 4, label: 'UX design', area: 'UX design' },
  { key: 'ui', number: 5, label: 'UI design', area: 'UI design' },
  { key: 'build', number: 6, label: 'Build', area: 'Software Factory' },
  { key: 'ship', number: 7, label: 'Ship', area: 'Ship' },
];

export const STAGE_KEYS = STAGES.map((s) => s.key);
const BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

// The Product Factory names its stages product · architecture · ux · ui · build (its own numbering 1–4). Product is
// Discover + Specify; sending something back "to Product" means back to Specify.
const PRODUCT_NAMES = { product: 'specify', architecture: 'architect', ux: 'ux', ui: 'ui', build: 'build' };

/** A lifecycle stage key from a lifecycle or Product Factory name, or null. */
export function stageKey(name) {
  const key = String(name ?? '').toLowerCase();
  if (BY_KEY.has(key)) return key;
  return PRODUCT_NAMES[key] ?? null;
}

export const stageLabel = (key) => BY_KEY.get(key)?.label ?? key;
export const stageIndex = (key) => STAGE_KEYS.indexOf(key);
export const nextStage = (key) => STAGE_KEYS[stageIndex(key) + 1] ?? null;

/** "Product → Architecture", or "Discover → Specify" when both stages belong to the same area. */
export function handoffLabel(from, to) {
  const a = BY_KEY.get(from);
  const b = BY_KEY.get(to);
  if (!a || !b) return `${stageLabel(from)} → ${stageLabel(to)}`;
  return a.area === b.area ? `${a.label} → ${b.label}` : `${a.area} → ${b.area}`;
}
