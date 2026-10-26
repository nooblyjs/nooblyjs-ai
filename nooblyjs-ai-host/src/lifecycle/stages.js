// The lifecycle stages (root product.md §3.2, version 3), in order. Every item is in exactly one of them. `area` is how a
// handoff between stages is named ("Product → Design"). Since Phase 16b (2026-10-20) requirements, UX and UI are one
// Product stage; Design does the business requirements, solution architecture and stories; Engineer the application
// architecture and test analysis; and Test, where a person gives the Test approval, replaces Verify.
//
// Phase 27 (2026-10-26): the stages are data. data/workflows/lifecycle.yaml says which there are, in what order, how each
// is left and what it checks (workflow.js reads it and hands the list to useStages()). What stays code is the KINDS: the
// eight kinds of step the code knows how to run (stories are written in a `design` stage, pull requests are built in a
// `build` stage…), as the Software Factory knows its station kinds. Each built-in stage names its kind; a stage with no
// kind is a plain gate. Code asks for a stage by its kind (stageOfKind), never by its key.

/** The kinds of step the code knows, in the order they must come. */
export const KINDS = ['discover', 'product', 'design', 'engineer', 'build', 'test', 'release', 'operate'];

/** The stages when lifecycle.yaml says nothing else: lifecycle v3's eight, each of its own kind. */
export const BUILT_IN_STAGES = Object.freeze([
  { key: 'discover', number: 1, label: 'Discover', area: 'Discover', kind: 'discover' },
  { key: 'product', number: 2, label: 'Product', area: 'Product', kind: 'product' },
  { key: 'design', number: 3, label: 'Design', area: 'Design', kind: 'design' },
  { key: 'engineer', number: 4, label: 'Engineer', area: 'Engineering', kind: 'engineer' },
  { key: 'build', number: 5, label: 'Build', area: 'Build', kind: 'build' },
  { key: 'test', number: 6, label: 'Test', area: 'Test', kind: 'test' },
  { key: 'release', number: 7, label: 'Release', area: 'Release', kind: 'release' },
  { key: 'operate', number: 8, label: 'Operate', area: 'Operate', kind: 'operate' },
].map((s) => Object.freeze(s)));

// Stage keys from before: what each means now, and how history written then reads. Ship was replaced by Verify in
// Phase 16a, and Verify by Test in Phase 16b. They name kinds: a renamed stage of that kind is where they belong now.
export const LEGACY = { specify: 'product', ux: 'product', ui: 'product', architect: 'design', verify: 'test', ship: 'test' };
const LEGACY_LABELS = { specify: 'Specify', ux: 'UX design', ui: 'UI design', architect: 'Architect', verify: 'Verify', ship: 'Ship' };

// The stages in use, replaced in place by useStages() so that every module importing them sees the current list.
export const STAGES = [];
export const STAGE_KEYS = [];
let BY_KEY = new Map();
let BY_KIND = new Map();
// Every label a stage has had in this process, so history written under a stage that has since gone still reads.
const SEEN_LABELS = new Map();

/** Makes `list` ([{ key, label, area, kind? }], in order) the stages in use. */
export function useStages(list) {
  const stages = list.map((s, i) => Object.freeze({ key: s.key, number: i + 1, label: s.label, area: s.area ?? s.label, kind: s.kind ?? null }));
  STAGES.splice(0, STAGES.length, ...stages);
  STAGE_KEYS.splice(0, STAGE_KEYS.length, ...stages.map((s) => s.key));
  BY_KEY = new Map(stages.map((s) => [s.key, s]));
  BY_KIND = new Map(stages.filter((s) => s.kind).map((s) => [s.kind, s]));
  for (const s of stages) SEEN_LABELS.set(s.key, s.label);
}
useStages(BUILT_IN_STAGES);

/** The key of the stage of a kind ('design' → the stage stories are written in), or null when none is that kind. */
export const stageOfKind = (kind) => BY_KIND.get(kind)?.key ?? null;
/** The kind of a stage (null for a plain gate, or a stage that has gone). History's keys answer with their kind. */
export const kindOf = (key) => BY_KEY.get(key)?.kind ?? (LEGACY[key] ? BY_KIND.get(LEGACY[key])?.kind ?? LEGACY[key] : null);
/** True when `key` is the stage of that kind. */
export const isKind = (key, kind) => Boolean(key) && kindOf(key) === kind;

// The Product engine's names for its areas: product, ux and ui are the Product stage's work, architecture the Design
// stage's. Sending something back "to Product" means back to the Product stage.
const PRODUCT_NAMES = { architecture: 'design', ux: 'product', ui: 'product' };

/** A lifecycle stage key from a lifecycle or Product Factory name, or null. */
export function stageKey(name) {
  const key = String(name ?? '').toLowerCase();
  if (BY_KEY.has(key)) return key;
  const kind = PRODUCT_NAMES[key] ?? LEGACY[key] ?? null;
  return kind ? stageOfKind(kind) : null;
}

/** Where a stage key, current or from before, belongs now (an unknown key is returned as it is). */
export const currentStage = (key) => (BY_KEY.has(key) ? key : LEGACY[key] ? stageOfKind(LEGACY[key]) ?? key : key);

export const stageLabel = (key) => BY_KEY.get(key)?.label ?? LEGACY_LABELS[key] ?? SEEN_LABELS.get(key) ?? key;
export const stageIndex = (key) => STAGE_KEYS.indexOf(key);
export const nextStage = (key) => STAGE_KEYS[stageIndex(key) + 1] ?? null;
/** The stage the history key `key` meant (Specify → the Product stage), for Metrics and the trace. */
export const stageOf = (key) => BY_KEY.get(currentStage(key)) ?? null;

/** "Product → Design", or "Discover → Product" when both stages belong to the same area. */
export function handoffLabel(from, to) {
  const a = BY_KEY.get(from);
  const b = BY_KEY.get(to);
  if (!a || !b) return `${stageLabel(from)} → ${stageLabel(to)}`;
  return a.area === b.area ? `${a.label} → ${b.label}` : `${a.area} → ${b.area}`;
}
