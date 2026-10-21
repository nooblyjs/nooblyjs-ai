// Phase 16c: the Design section's files, over its own store (data/design/). One file per item,
// items/<itemId>/design.md: the design in its front matter, and a body written from it so a person can read the file.
// Every save is a new version, under the file's lock.

export const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LISTS = ['requirements', 'systems', 'nfrs', 'features', 'interfaces', 'technical', 'stories', 'drafts'];

/** An empty design for an item. */
export const blankDesign = (itemId) => ({ itemId, version: 0, counters: {}, ...Object.fromEntries(LISTS.map((k) => [k, []])) });

/** The body of design.md: what the front matter says, as headings and lists. */
function render(d) {
  const part = (heading, rows) => (rows.length ? `## ${heading}\n\n${rows.map((r) => `- ${r}`).join('\n')}` : '');
  return [
    `# Design of ${d.itemId}`,
    part('Business requirements', d.requirements.map((r) => `${r.id} (${r.status}): ${r.text}`)),
    part('Impacted systems', d.systems.map((s) => `${s.name} (${s.change}${s.team ? `, ${s.team}` : ''})`)),
    part('NFRs', d.nfrs.map((n) => `${n.id} ${n.category}: ${n.requirement} · ${n.target}`)),
    part('Features', d.features.map((f) => `${f.id}: ${f.title}`)),
    part('Interfaces', d.interfaces.map((i) => `${i.id} ${i.kind}: ${i.from || '?'} → ${i.to || '?'} · ${i.contract}`)),
    part('Technical requirements', d.technical.map((t) => `${t.id} ${t.system}: ${t.text}`)),
    part('Stories', d.stories.map((s) => `${s.id} (${s.feature}): ${s.title}`)),
  ].filter(Boolean).join('\n\n');
}

export function createDesignRepo(store) {
  const file = (itemId) => ['items', itemId, 'design.md'];
  const read = async (itemId) => {
    const doc = await store.readDoc(file(itemId));
    return doc?.data ? { ...blankDesign(itemId), ...doc.data } : null;
  };
  return {
    /** The item's design, or null when nothing was written for it yet. */
    async get(itemId) {
      return ITEM.test(itemId ?? '') ? read(itemId) : null;
    },
    /** The ids of the items with a design. */
    async itemIds() {
      return (await store.list(['items'], { dirs: true }).catch(() => [])).filter((n) => ITEM.test(n));
    },
    /**
     * Read-modify-write under the file's lock. `fn(design)` (a blank one when there is none) returns the new design, or
     * null to change nothing. Resolves with what is stored afterwards.
     */
    async update(itemId, fn) {
      if (!ITEM.test(itemId ?? '')) throw new Error(`not an item id: ${itemId}`);
      return store.withLock(file(itemId), async () => {
        const current = (await read(itemId)) ?? blankDesign(itemId);
        const next = await fn(structuredClone(current));
        if (!next) return current;
        const saved = { ...next, version: (current.version ?? 0) + 1 };
        await store.writeDoc(file(itemId), saved, `\n${render(saved)}\n`);
        return saved;
      });
    },
  };
}
