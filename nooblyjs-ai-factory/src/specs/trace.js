// @ts-check
// Phase F08: TRACEABILITY. Which task implements which acceptance criterion?
//
//                 T1   T2   T3
//   R1.1          ✓
//   R1.2          ✓    ✓
//   R2.1                    ✓
//   R2.2                          ← uncovered: nothing implements it. The spec is not done.
//
// Two checks fall out of the matrix for free:
//   uncovered   a criterion no task mentions: it will silently not get built
//   unknown     a task that cites a criterion that doesn't exist: a typo, or a spec that moved
//
// The same matrix goes into the PR (formatCoverage), so a reviewer can go from
// a requirement straight to the task (and later, F11/F14, the test) that proves it.

/**
 * @param {import('./schema.js').Requirement[]} requirements
 * @param {import('./schema.js').Task[]} tasks
 */
export function coverage(requirements, tasks) {
  const criteria = requirements.flatMap((r) => r.criteria.map((c) => ({ ...c, requirement: r.id, tasks: /** @type {string[]} */ ([]) })));
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const unknown = [];
  for (const t of tasks) {
    for (const ref of t.requirements) {
      // "R1" on a task means all of R1's criteria.
      const targets = byId.has(ref) ? [byId.get(ref)] : criteria.filter((c) => c.requirement === ref);
      if (!targets.length) unknown.push({ task: t.id, ref });
      for (const c of targets) if (c && !c.tasks.includes(t.id)) c.tasks.push(t.id);
    }
  }
  return { criteria, uncovered: criteria.filter((c) => !c.tasks.length), unknown };
}

/** The coverage matrix as a Markdown section for the PR. */
export function formatCoverage(trace, specDir) {
  if (!trace?.criteria?.length) return '';
  const rows = trace.criteria.map((c) => `| ${c.id} | ${c.text.replace(/\|/g, '\\|')} | ${c.tasks.join(', ') || '⚠️ none'} |`);
  return `## Requirements coverage\n\nFrom the spec in \`${specDir}/\` (reviewed with this PR).\n\n| Criterion | Acceptance criterion | Task(s) |\n|---|---|---|\n${rows.join('\n')}`;
}
