// The roadmap: items across the quarter with the span each stage takes (product.md §3.8). The spans are planned
// dates in roadmap.yaml; the item's title and its current stage come from the item itself.
import { stageFor, stageLabel } from './stages.js';
import { specStatusText } from './views.js';

export async function roadmapView(ctx, repos, roadmap) {
  const items = [];
  for (const entry of roadmap.items ?? []) {
    const spec = await repos.specs.get(entry.id);
    const spans = (entry.spans ?? []).map((s) => ({ stage: s.stage, label: stageLabel(s.stage), from: s.from, to: s.to }));
    const current = spec ? stageFor('spec', spec.status) : null;
    items.push({
      id: entry.id,
      title: spec?.title ?? entry.title ?? entry.id,
      product: spec?.product ?? null,
      status: spec?.status ?? null,
      statusText: spec ? specStatusText(ctx, spec) : 'Not found',
      current,
      from: spans.map((s) => s.from).sort()[0] ?? null,
      to: spans.map((s) => s.to).sort().at(-1) ?? null,
      spans: spans.map((s) => ({ ...s, current: s.stage === current?.key })),
    });
  }
  return { quarter: roadmap.quarter ?? null, from: roadmap.from ?? null, to: roadmap.to ?? null, items };
}
