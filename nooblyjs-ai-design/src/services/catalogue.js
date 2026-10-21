// Phase 16c: the NFR catalogue (data/design/nfr-catalogue.yaml), read on every use so an edit applies without a
// restart. Design draws an item's NFRs from it; Phase 18 (elicitation) will read it too. A category or entry with no
// key is left out.
export function createCatalogue({ store, log }) {
  async function read() {
    let doc = null;
    try {
      doc = await store.readYaml(['nfr-catalogue.yaml']);
    } catch (err) {
      log?.warn?.(`design: nfr-catalogue.yaml can't be read: ${err.message}`);
    }
    const categories = (doc?.categories ?? []).filter((c) => c?.key).map((c) => ({
      key: String(c.key), label: String(c.label ?? c.key),
      // NooblyJS Phase 18: the question the elicitation's NFR walk asks for this category.
      ...(c.prompt ? { prompt: String(c.prompt) } : {}),
      entries: (c.entries ?? []).filter((e) => e?.key && e?.requirement).map((e) => ({ key: String(e.key), requirement: String(e.requirement), target: String(e.target ?? '[CONFIRM]') })),
    }));
    return { categories, text: categories.length ? `${categories.length} categories, ${categories.reduce((n, c) => n + c.entries.length, 0)} entries` : 'The NFR catalogue is empty' };
  }
  return { read };
}
