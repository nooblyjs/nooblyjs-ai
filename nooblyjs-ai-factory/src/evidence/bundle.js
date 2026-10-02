// @ts-check
// Phase F14: the EVIDENCE BUNDLE. Make review fast by proving, in one place, what changed,
// why, and that it's within bounds.
//
// A reviewer shouldn't have to reconstruct a run from logs. The PR body IS the
// evidence (evidence.md), and the same facts are kept as data (evidence.json, an
// artifact) for tools, dashboards (F17) and metrics (F20):
//
//   what was asked          the issue, and the status at a glance
//   what the agent says     its summary, as a quote (a claim)
//   what's true             requirement → task → the test lines that check it
//                           the checks, the scope, the review findings, the repairs
//   what it cost            per station: cost and time
//   how to look             the commands, and the run's full story (factory logs)
//
// Claims and facts sit side by side, and every fact says where it came from.
import { formatGates } from '../exec/gates/runner.js';
import { git } from '../exec/workspace/git.js';
import { formatReview } from '../review/findings.js';
import { isTestFile } from '../review/tampering.js';

/**
 * Which test lines mention each criterion id (R1.2), in the change's test files.
 * A light, honest link: "this test says it's about R1.2", not a proof that it tests it.
 * @returns {Promise<Record<string, string[]>>}  id → ["test/divide.test.js:7", …]
 */
export async function testLinks(mirrorDir, baseSha, sha, ids) {
  if (!ids.length) return {};
  const files = (await git(['diff', '--name-only', `${baseSha}..${sha}`], { cwd: mirrorDir })).split('\n').filter((f) => f && isTestFile(f));
  const links = Object.fromEntries(ids.map((id) => [id, /** @type {string[]} */ ([])]));
  for (const file of files) {
    const text = await git(['show', `${sha}:${file}`], { cwd: mirrorDir }).catch(() => '');
    text.split('\n').forEach((line, i) => {
      for (const id of ids) if (new RegExp(`\\b${id.replace('.', '\\.')}\\b`).test(line)) links[id].push(`${file}:${i + 1}`);
    });
  }
  return links;
}

/**
 * @param {{ runId: string, run: any, issue: any, head: string, base: string, repo: string, build: any, verify: any,
 *           reviews: any[], repairs: any[], escalated: any, spec: any, links: Record<string, string[]>, decisions: any[],
 *           verdict: { status: 'draft' | 'ready', problems: string[], final: string } }} f
 * @returns {{ md: string, json: object }}
 */
export function buildEvidence(f) {
  const { build, verify, reviews, repairs, spec, verdict } = f;
  const agent = build.agent;
  const cost = (n) => `$${Number(n ?? 0).toFixed(4)}`;
  const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const blocking = reviews.reduce((n, r) => n + r.blocking, 0);
  const scope = verify?.scope;

  // ── the facts, as data ──
  // Stations that ran (a rewind leaves some "pending": they didn't run in the end), plus each
  // repair attempt as its own row: the repair station's own result is reset by the rewind it
  // causes, so its cost lives in the run's repair history (F13). Otherwise the table wouldn't
  // add up to the run's total, which it must.
  const stations = [
    ...Object.entries(f.run.steps ?? {})
      .filter(([id, s]) => s.status !== 'pending' && !(id === 'repair' && s.result?.repaired))
      .map(([id, s]) => ({ id, status: s.status, costUsd: s.result?.costUsd ?? 0, ms: s.startedAt && s.endedAt ? Date.parse(s.endedAt) - Date.parse(s.startedAt) : null })),
    ...repairs.map((r) => ({ id: `repair ${r.attempt}`, status: r.outcome === 'success' ? 'fixed' : r.outcome, costUsd: r.costUsd ?? 0, ms: null })),
  ];
  const coverage = spec
    ? spec.trace.criteria.map((c) => ({ id: c.id, text: c.text, tasks: c.tasks, tests: f.links[c.id] ?? [] }))
    : null;
  const json = {
    run: f.runId,
    issue: { ref: f.issue.ref, title: f.issue.title },
    status: verdict.final,
    pr: { head: f.head, base: f.base, sha: build.sha, draft: verdict.status === 'draft', problems: verdict.problems },
    agent: { outcome: agent.outcome, model: agent.model, turns: agent.turns, toolCalls: agent.toolCalls, summary: agent.text },
    checks: verify?.gates?.results ?? null,
    scope: scope ?? null,
    reviews: reviews.map((r) => ({ by: r.by, verdict: r.verdict, findings: r.findings })),
    repairs,
    escalated: f.escalated ? { reason: f.escalated.reason } : null,
    spec: spec ? { dir: spec.specDir, requirements: spec.requirements.length, tasks: spec.tasks.map((t) => ({ id: t.id, title: t.title, paths: t.paths })) } : null,
    coverage,
    decisions: f.decisions,
    stations,
    costUsd: f.run.costUsd,
  };

  // ── the same facts, for people ──
  const untested = coverage ? coverage.filter((c) => !c.tests.length).map((c) => c.id) : [];
  const glance = `| Status | Checks | Review | Repairs | Scope | Tests named | Cost |\n|---|---|---|---|---|---|---|\n| ${verdict.final} | ${verify?.passed === true ? '✅ pass' : verify?.passed === false ? '❌ fail' : '⚠️ none configured'} | ${reviews.length ? (blocking ? `⛔ ${blocking} blocking` : '✅ approved') : '—'} | ${repairs.length || '—'} | ${scope ? (scope.ok ? '✅ within declared paths' : `${scope.violations.length} outside`) : '—'} | ${coverage ? (untested.length ? `⚠️ none for ${untested.join(', ')}` : `✅ every criterion`) : '—'} | ${cost(f.run.costUsd)} |`;
  const sections = [
    `# ${f.issue.title}\n\nResolves ${f.issue.ref}.`,
    verdict.status === 'draft' ? `> **Draft:** ${verdict.problems.join(' ')}` : '',
    `## At a glance\n\n${glance}`,
    `## Summary (written by the agent)\n\n${quote(agent.text?.trim() || '(no summary)')}`,
    coverage
      ? `## Requirements → tasks → tests\n\nFrom the spec in \`${spec.specDir}/\` (in this PR). "Tests" are the test lines that name the criterion.\n\n| Criterion | Acceptance criterion | Task(s) | Tests |\n|---|---|---|---|\n${coverage.map((c) => `| ${c.id} | ${c.text.replace(/\|/g, '\\|')} | ${c.tasks.join(', ') || '⚠️ none'} | ${c.tests.length ? c.tests.map((t) => `\`${t}\``).join(' ') : '⚠️ none named'} |`).join('\n')}`
      : '',
    agent.outcome === 'success' ? formatGates(verify?.gates?.results ?? []) : '',
    scope ? scopeSection(scope, spec) : '',
    reviews.length ? formatReview(reviews) : '',
    repairs.length || f.escalated ? repairSection(repairs, f.escalated) : '',
    f.decisions.length ? `## Decisions (recorded by the agents)\n\n${f.decisions.map((d) => `- **${d.title}**: ${d.rationale}`).join('\n')}` : '',
    `## Changes\n\n\`\`\`\n${build.stat?.trim() || '(none)'}\n\`\`\``,
    `## Cost and time, by station\n\n| Station | Result | Cost | Time |\n|---|---|---|---|\n${stations.map((s) => `| ${s.id} | ${s.status} | ${cost(s.costUsd)} | ${secs(s.ms)} |`).join('\n')}\n| **run** | ${verdict.final} | **${cost(f.run.costUsd)}** | |\n\nModel (builder): ${agent.model ?? '?'} · ${agent.turns} turn(s) · ${agent.toolCalls} tool call(s)${agent.costIsEstimate ? ' · cost is an estimate' : ''}`,
    `## Review it\n\n\`\`\`bash\ncd ${f.repo}\ngit log --oneline ${f.base}..${f.head}\ngit diff ${f.base}...${f.head}\ngit merge ${f.head}          # when you're happy: merging is your call\n\`\`\`\n\nThe run's whole story: \`factory logs ${f.runId}\` · this evidence as data: \`evidence.json\` (a run artifact)\n\nBase: \`${f.base}\` @ \`${String(build.prBaseSha ?? build.workspace?.baseSha ?? '').slice(0, 12)}\``,
  ];
  return { md: `${sections.filter(Boolean).join('\n\n')}\n`, json };
}

function scopeSection(scope, spec) {
  if (scope.ok && !scope.declaredProtected.length) return `## Scope\n\n✅ Every changed file is within ${spec ? "the tasks' declared Paths, tests or the spec" : 'bounds (no protected paths)'}.`;
  const rows = scope.violations.map((v) => `| \`${v.file}\` | ${v.why === 'protected' ? '⛔ protected path, not declared' : '⚠️ outside every declared Path'} |`);
  const declared = scope.declaredProtected.map((file) => `| \`${file}\` | 🔐 protected, but declared by a task: a person merges |`);
  return `## Scope\n\n| File | |\n|---|---|\n${[...rows, ...declared].join('\n')}`;
}

function repairSection(repairs, escalated) {
  const rows = repairs.map((r) => `| ${r.attempt} | ${r.trigger === 'gates' ? 'checks' : 'review'}: ${r.title} | ${r.outcome === 'success' ? `fixed in \`${String(r.sha).slice(0, 8)}\`` : r.outcome} |`);
  const esc = escalated ? `\n\n⚠️ **Escalated:** ${escalated.reason}. A person needs to look (\`factory inbox\`).` : '';
  return `## Repairs\n\n| # | What failed | Result |\n|---|---|---|\n${rows.join('\n')}${esc}`;
}

const quote = (text) => text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
