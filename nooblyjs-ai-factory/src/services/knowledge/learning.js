// @ts-check
// Phase F21: LEARNINGS, and finding the ones that keep coming back.
//
// A learning is one piece of feedback about one run, in words:
//
//   { runId, slug, source: 'human-review' | 'review' | 'gates' | 'retro',
//     text: "Please use named exports, not default exports",   what was said
//     rule: "Use named exports; never default exports." }      (optional) as a rule for next time
//
// One comment is an opinion. The SAME comment on three different runs is a pattern the
// factory should stop repeating, and that's what goes to a person as a proposed rule.
//
// Clustering is deliberately simple and deterministic: words (lowercased, trimmed of
// endings, minus stopwords, paths and numbers) → Jaccard similarity → single-link groups,
// within one repo (a convention in one repo is not a rule for another). No embeddings:
// the input is short review sentences, the output must be explainable, and tests must be exact.

const STOP = new Set('a an the this that these those is are was were be been being to of in on for with as at by from and or but not no nor so if then than too very can could should would will shall may might must do does did done have has had it its we you they i he she them our your their please pls just also again still here there what which who when where why how all any each more most other some such only own same into out up down over under about after before above below'.split(' '));

/** A sentence → its content words ("Exports: use named ones!" → ["export", "use", "name"]). */
export function tokens(text) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/`[^`]*\/[^`]*`/g, ' ') // `src/a.js`-style paths
    .replace(/\S+\.(js|ts|mjs|cjs|json|md)\b/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
  return [...new Set(words)];
}

/** Crude English stemming: enough to make "exports", "exported" and "export" meet. */
function stem(w) {
  for (const end of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'ies', 'es', 's', 'ly']) {
    if (w.length > end.length + 3 && w.endsWith(end)) return end === 'ies' ? `${w.slice(0, -3)}y` : w.slice(0, -end.length);
  }
  return w;
}

export function similarity(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

/**
 * Group learnings that say the same thing. Single-link: joins a group if it's similar
 * enough to ANY member. A rule (from the retro agent) is compared when there is one:
 * it's already phrased the same way each time.
 * @template {{ id: string, runId: string, slug: string, text: string, rule?: string | null }} L
 * @param {L[]} learnings
 * @returns {Array<{ key: string, slug: string, members: L[], runs: string[], representative: L }>}
 */
export function clusterLearnings(learnings, { threshold = 0.4 } = {}) {
  const toks = new Map(learnings.map((l) => [l.id, tokens(l.rule || l.text)]));
  const groups = [];
  for (const l of learnings) {
    const mine = /** @type {string[]} */ (toks.get(l.id));
    const near = groups.filter((g) => g.slug === l.slug && g.members.some((m) => similarity(toks.get(m.id), mine) >= threshold));
    if (!near.length) groups.push({ slug: l.slug, members: [l] });
    else {
      // l links these groups together: merge them.
      const [first, ...rest] = near;
      first.members.push(l, ...rest.flatMap((g) => g.members));
      for (const g of rest) groups.splice(groups.indexOf(g), 1);
    }
  }
  return groups.map((g) => {
    const count = {};
    for (const m of g.members) for (const t of toks.get(m.id)) count[t] = (count[t] ?? 0) + 1;
    // The key: the words most members share. Stable as the group grows.
    const shared = Object.keys(count).filter((t) => count[t] >= Math.max(2, g.members.length / 2)).sort();
    const key = `${g.slug}:${(shared.length ? shared : Object.keys(count).sort()).slice(0, 6).join('-')}`;
    // The representative: the member most like all the others.
    const score = (m) => g.members.reduce((s, o) => s + similarity(toks.get(m.id), toks.get(o.id)), 0);
    const representative = g.members.toSorted((a, b) => score(b) - score(a) || a.text.length - b.text.length)[0];
    return { key, slug: g.slug, members: g.members, runs: [...new Set(g.members.map((m) => m.runId))], representative };
  });
}

/**
 * The feedback in one closed run's events, as learnings (without ids).
 * @param {{ id: string, slug?: string, request?: any }} run
 * @param {Array<{ type: string, data: any }>} events
 */
export function learningsFromRun(run, events) {
  const out = [];
  const add = (source, text, extra = {}) => text && String(text).trim() && out.push({ runId: run.id, slug: run.slug ?? '', source, text: String(text).trim().slice(0, 500), ...extra });
  for (const e of events) {
    const d = e.data ?? {};
    // What people said: the strongest signal.
    if (e.type === 'pr.changes_requested') add('human-review', d.body, { by: d.by });
    if (e.type === 'inbox.answered' && d.decision === 'rejected') add('human-review', d.feedback, { by: d.by });
    // What the factory's own reviewer found (not nits).
    if (e.type === 'step.finished' && d.result?.findings) for (const f of d.result.findings) if (f.severity !== 'nit') add('review', f.title, { severity: f.severity, file: f.file ?? null });
    // Checks that failed (and made the fixer work).
    if (e.type === 'repair.attempted' && d.trigger === 'gates' && d.title) add('gates', d.title);
  }
  return out;
}
