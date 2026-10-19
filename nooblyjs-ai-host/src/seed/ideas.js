// Ideas were "opportunities" until 2026-10-12 (nooblyjs-ai-product CHG-001 follow-up): the word, the ids (OPP-018 is
// IDEA-018 now), the item type and the events. This brings a data folder from before up to date at each start, for
// the files NooblyJS itself owns; the Product Factory moves its own (nooblyjs-ai-factory/product/src/services/ideas.js).
// - workflows/items/OPP-NNN.md → IDEA-NNN.md, `type: opportunity` → `idea`; approvals and handoffs that name one follow
// - devtools/links.yaml: Jira links kept under OPP-NNN move to IDEA-NNN
// - config/work-roles.yaml: a first thing done on `opportunity.scored` for OPP-NNN waits for `idea.scored` and IDEA-NNN
// The event and audit streams are history and stay as they were written.

const OLD_ID = /\bOPP-(\d{3,})\b/g;
const HAS_OLD_ID = /\bOPP-\d{3,}\b/;
const OLD_TYPE = 'opportunity';
const newId = (value) => (typeof value === 'string' ? value.replace(OLD_ID, 'IDEA-$1') : value);

/** @param {object} store  the FsStore rooted at DATA_DIR. Resolves with how many files changed. */
export async function renameOpportunitiesToIdeas(store) {
  let changed = 0;
  const docs = async (folder) => (await store.list(folder)).filter((n) => n.endsWith('.md'));

  for (const name of await docs(['workflows', 'items'])) {
    const doc = await store.readDoc(['workflows', 'items', name]).catch(() => null);
    if (!doc || !(/^OPP-\d{3,}\.md$/.test(name) || doc.data.type === OLD_TYPE)) continue;
    const data = { ...doc.data, id: newId(doc.data.id), ref: newId(doc.data.ref), ...(doc.data.type === OLD_TYPE ? { type: 'idea' } : {}) };
    const target = newId(name);
    await store.writeDoc(['workflows', 'items', target], data, doc.body);
    if (target !== name) await store.remove(['workflows', 'items', name]);
    changed += 1;
  }
  for (const folder of [['workflows', 'approvals'], ['workflows', 'handoffs']]) {
    for (const name of await docs(folder)) {
      const doc = await store.readDoc([...folder, name]).catch(() => null);
      if (!doc || !HAS_OLD_ID.test(String(doc.data.itemId ?? ''))) continue;
      await store.writeDoc([...folder, name], { ...doc.data, itemId: newId(doc.data.itemId) }, doc.body);
      changed += 1;
    }
  }

  const links = await store.readYaml(['devtools', 'links.yaml']).catch(() => null);
  if (links && Object.keys(links).some((k) => /^OPP-\d{3,}$/.test(k))) {
    await store.writeYaml(['devtools', 'links.yaml'], Object.fromEntries(Object.entries(links).map(([k, v]) => [newId(k), v])));
    changed += 1;
  }

  const rolesText = await store.readText(['config', 'work-roles.yaml']).catch(() => null);
  if (rolesText && /opportunit|OPP-\d/.test(rolesText)) {
    const next = rolesText
      .replace(OLD_ID, 'IDEA-$1')
      .replace(/opportunity\.scored/g, 'idea.scored')
      .replace(/opportunityId/g, 'ideaId')
      .replace(/Opportunities/g, 'Ideas').replace(/opportunities/g, 'ideas')
      .replace(/Opportunity/g, 'Idea').replace(/opportunity/g, 'idea');
    await store.writeText(['config', 'work-roles.yaml'], next);
    changed += 1;
  }
  return { changed };
}
