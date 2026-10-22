// Customer importance (NooblyJS Phase 25a): who asked for an idea, feature or spec, for which portfolios, and how much
// it matters to them, from the insights on feedback notes. Computed on each read, never stored: at tens to hundreds of
// notes that is cheap, and it can't go stale when a note is linked or unlinked. It sits beside the RICE score and
// never changes it.

export const IMPORTANCE = ['nice', 'important', 'critical'];
export const IMPORTANCE_WORDS = { nice: 'Nice to have', important: 'Important', critical: 'Critical' };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => String(s ?? '').toLowerCase();

/** Who a note is from, as one key: a NooblyJS person, a name, or (typed with no one named) who logged it. */
export const colleagueKey = (note) => (note.from?.id ? `p:${note.from.id}` : note.from?.name ? `n:${lower(note.from.name)}` : note.through?.id ? `p:${note.through.id}` : null);

/**
 * The ids whose insights count for a record: a spec's own and its idea's; an idea's own, the ideas merged into it and
 * its specs'; a feature's own and those of every idea and spec under it.
 * @param {string} id
 * @param {{ ideas: object[], specs: object[] }} records
 */
export function relatedIds(id, { ideas, specs }) {
  const out = new Set([id]);
  const mergedInto = (ideaId) => ideas.filter((i) => i.mergedInto === ideaId).map((i) => i.id);
  const addIdea = (ideaId) => {
    if (!ideaId) return;
    out.add(ideaId);
    for (const m of mergedInto(ideaId)) out.add(m);
    for (const s of specs.filter((x) => x.idea === ideaId)) out.add(s.id);
  };
  if (/^PRD-/.test(id)) addIdea(specs.find((s) => s.id === id)?.idea);
  else if (/^IDEA-/.test(id)) addIdea(id);
  else if (/^FEAT-/.test(id)) {
    for (const i of ideas.filter((x) => x.feature === id)) addIdea(i.id);
    for (const s of specs.filter((x) => x.feature === id)) { out.add(s.id); addIdea(s.idea); }
  }
  return out;
}

/** "3 colleagues across 1 portfolio; 1 says critical · 1 form note", or null when nobody has asked. */
export function importanceText({ colleagues, portfolios, critical, formNotes }) {
  if (!colleagues && !formNotes) return null;
  const parts = [];
  if (colleagues) parts.push(`${plural(colleagues, 'colleague')}${portfolios ? ` across ${plural(portfolios, 'portfolio')}` : ''}${critical ? `; ${critical} ${critical === 1 ? 'says' : 'say'} critical` : ''}`);
  if (formNotes) parts.push(plural(formNotes, 'form note'));
  return parts.join(' · ');
}

/**
 * Customer importance for one record.
 * @param {string} id   IDEA-…, PRD-… or FEAT-…
 * @param {{ notes: object[], ideas: object[], specs: object[], portfolioOf: (product: string) => string|null }} data
 */
export function importanceOf(id, { notes, ideas, specs, portfolioOf }) {
  const ids = relatedIds(id, { ideas, specs });
  const colleagues = new Set();
  const critical = new Set();
  const portfolios = new Set();
  const noteIds = [];
  let formNotes = 0;
  for (const note of notes) {
    const hits = (note.insights ?? []).filter((x) => ids.has(x.target));
    if (!hits.length) continue;
    noteIds.push(note.id);
    if (note.source === 'form') {
      formNotes += 1;
      continue;
    }
    const who = colleagueKey(note);
    if (who) colleagues.add(who);
    if (who && hits.some((x) => x.importance === 'critical')) critical.add(who);
    const portfolio = note.product ? portfolioOf(note.product) : null;
    if (portfolio) portfolios.add(portfolio);
  }
  const counts = { colleagues: colleagues.size, portfolios: portfolios.size, critical: critical.size, formNotes };
  return { ...counts, notes: noteIds, portfolioNames: [...portfolios].sort(), text: importanceText(counts) };
}

/** Customer importance for every idea, spec and feature that has any: Map id → importanceOf(). */
export function importanceIndex({ notes, ideas, specs, features = [], portfolioOf }) {
  const out = new Map();
  if (!notes.some((n) => n.insights?.length)) return out;
  for (const id of [...ideas.map((i) => i.id), ...specs.map((s) => s.id), ...features.map((f) => f.id)]) {
    const e = importanceOf(id, { notes, ideas, specs, portfolioOf });
    if (e.text) out.set(id, e);
  }
  return out;
}

/** How many notes belong to each signal: Map signalId → count. */
export function signalNoteCounts(notes) {
  const out = new Map();
  for (const n of notes) if (n.signal) out.set(n.signal, (out.get(n.signal) ?? 0) + 1);
  return out;
}
