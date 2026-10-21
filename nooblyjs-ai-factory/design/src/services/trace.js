// The Design section's part of the trace (NooblyJS Phase 16f, root design.md §4). From an item's design: each business
// requirement (BR-031-01) and the goal of the spec it quotes (GOAL-031-1), each feature, each story with the feature it
// builds and the requirements it serves, each story's acceptance criteria (AC-031-1-1: story 1's first) and the
// interfaces. A story's trace is its item's design.

const storyNum = (storyId) => String(storyId).replace(/^STORY-/, '');

export function createDesignTrace({ repo, host }) {
  async function trace(itemId) {
    const item = await host.service?.('workflows')?.item?.({ itemId }).catch(() => null);
    const root = item?.type === 'story' && item.parentId ? item.parentId : itemId;
    const design = await repo.get(root).catch(() => null);
    if (!design) return { nodes: [], links: [] };
    const goals = (await Promise.resolve(host.service?.('product')?.designInputs?.(root)).catch(() => null))?.spec?.goals ?? [];
    const num = String(root).replace(/^[A-Z]+-/, '');
    const href = `/factory/design/items/${encodeURIComponent(root)}`;
    const nodes = [];
    const links = [];
    for (const r of design.requirements ?? []) {
      nodes.push({ id: r.id, type: 'business-requirement', title: r.text, status: r.status ?? null, system: 'design', href });
      const g = r.source?.section === 'Goals' ? goals.findIndex((x) => x.measure === r.source.quote) : -1;
      links.push({ from: r.id, rel: 'derives-from', to: g >= 0 ? `GOAL-${num}-${g + 1}` : root });
    }
    for (const f of design.features ?? []) {
      nodes.push({ id: f.id, type: 'feature', title: f.title, system: 'design', href });
      links.push({ from: f.id, rel: 'feature-of', to: root });
    }
    for (const i of design.interfaces ?? []) {
      nodes.push({ id: i.id, type: 'interface', title: /→/.test(i.name ?? '') ? i.name : `${i.name}: ${i.from || '?'} → ${i.to || '?'}`, system: 'design', href });
      links.push({ from: i.id, rel: 'interface-of', to: root });
    }
    for (const s of design.stories ?? []) {
      nodes.push({ id: s.id, type: 'story', title: s.title, system: 'design', href: `/factory/design/stories/${encodeURIComponent(root)}` });
      if (s.feature) links.push({ from: s.id, rel: 'builds', to: s.feature });
      for (const br of s.requirements ?? []) links.push({ from: s.id, rel: 'serves', to: br });
      (s.criteria ?? []).forEach((text, k) => {
        const id = `AC-${storyNum(s.id)}-${k + 1}`;
        nodes.push({ id, type: 'criterion', title: text, system: 'design', href: `/factory/design/stories/${encodeURIComponent(root)}` });
        links.push({ from: id, rel: 'criterion-of', to: s.id });
      });
    }
    return { nodes, links };
  }
  return { trace };
}
