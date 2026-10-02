// @ts-check
// Phase F21: from a recurring lesson to a PROPOSED rule, as a pull request.
//
//   learnings ─cluster─► a pattern seen in ≥ K different runs of one repo, not proposed before
//             ─► a branch that adds ONE rule to .factory/steering/conventions.md (with its evidence)
//             ─► a DRAFT pull request: the rule, every comment that led to it, and (optionally)
//                a bench before/after, with and without the rule
//
// Nothing is applied until a person merges it. Steering is trusted text that every agent
// reads (F08); an automatic change to it would let a few review comments, or a few
// crafted issues, rewrite how the factory behaves. And steering is a protected path
// (F14): even at autonomy L3, the factory never merges it itself.
//
// Why steering, not role files? A convention ("named exports only") is about THIS repo,
// and steering is per-repo; role files are about a job, across repos.
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../exec/workspace/git.js';
import { acquireWorkspace, releaseWorkspace } from '../exec/workspace/worktree.js';
import { clusterLearnings } from './learning.js';
import { STEERING_DIR } from './steering.js';

export const CONVENTIONS = `${STEERING_DIR}/conventions.md`;
const HEADER = `# Conventions\n\nRules for every change to this repository. Most were learned from review feedback on the factory's pull requests, then approved by a person.\n\n## Learned rules\n`;

/** The recorded learnings, and the ones already in a proposal. */
export function readLearnings(store) {
  const learnings = store.read({ types: ['learning.recorded'] }).map((e) => ({ ...e.data, id: e.data.learningId }));
  const proposed = new Set(store.read({ types: ['learning.proposed'] }).flatMap((e) => e.data.learningIds));
  return { learnings, fresh: learnings.filter((l) => !proposed.has(l.id)) };
}

/** Patterns that have recurred in at least `minRuns` different runs, and aren't proposed yet. */
export function recurring(store, { minRuns = 3, threshold } = {}) {
  return clusterLearnings(readLearnings(store).fresh, { threshold }).filter((c) => c.runs.length >= minRuns).sort((a, b) => b.runs.length - a.runs.length);
}

/** The rule to propose: the retro's wording if there is one, else what people said. */
export function ruleFor(cluster) {
  const rules = cluster.members.map((m) => m.rule).filter(Boolean);
  if (rules.length) {
    const count = {};
    for (const r of rules) count[r] = (count[r] ?? 0) + 1;
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  }
  const text = cluster.representative.text.replace(/^(please|pls)[,:]?\s+/i, '').replace(/\s+/g, ' ');
  return `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}

/**
 * Open a steering PR for one recurring pattern.
 * @param {import('../store/events.js').Store} store
 * @param {ReturnType<typeof recurring>[number]} cluster
 * @param {{ forge: any, env?: NodeJS.ProcessEnv, bench?: (overlay: Record<string, string>) => Promise<string>, log?: (l: string) => void }} options
 *   bench: given the proposed files, returns a markdown section with before/after numbers
 */
export async function proposeRule(store, cluster, { forge, env = process.env, bench, log = () => {} }) {
  const first = cluster.members.find((m) => m.repo) ?? cluster.members[0];
  if (!first.repo) throw new Error(`No repository recorded for ${cluster.key}.`);
  const rule = ruleFor(cluster);
  const short = cluster.key.split(':')[1].slice(0, 40) || 'rule';
  const head = `factory/learning/${short}`;

  const ws = await acquireWorkspace({ repo: first.repo, base: first.base ?? undefined, name: `learning-${short}`, env });
  const file = path.join(ws.path, CONVENTIONS);
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : HEADER;
  const withSection = before.includes('## Learned rules') ? before : `${before.trimEnd()}\n\n## Learned rules\n`;
  const after = `${withSection.trimEnd()}\n- ${rule}\n  <!-- learned from ${cluster.runs.length} runs: ${cluster.runs.join(', ')} -->\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  const released = await releaseWorkspace(ws, { message: `Factory: proposed convention: ${rule.slice(0, 60)}\n\nLearned from feedback on ${cluster.runs.length} runs. A person decides.` });
  if (!released.commits) throw new Error('Nothing changed.');
  const changed = (await git(['diff', '--name-only', `${ws.baseSha}..refs/heads/${released.branch}`], { cwd: ws.mirror })).split('\n').filter(Boolean);

  log(`benching the rule…`);
  const benchSection = bench ? await bench({ [CONVENTIONS]: after }).catch((error) => `Bench failed: ${error.message}`) : null;

  await forge.pushBranch(ws.mirror, released.branch, head);
  const pr = await forge.openOrUpdatePR(ws.slug, {
    title: `Factory: proposed convention: ${rule.length > 60 ? `${rule.slice(0, 57)}…` : rule}`,
    head,
    base: ws.baseRef,
    status: 'draft',
    body: body({ rule, cluster, benchSection, file: CONVENTIONS }),
  });
  store.append('learning', 'learning.proposed', { key: cluster.key, slug: cluster.slug, rule, head, pr: pr.path, learningIds: cluster.members.map((m) => m.id), runIds: cluster.runs, changed });
  return { rule, head, pr: pr.path, changed, bench: benchSection };
}

function body({ rule, cluster, benchSection, file }) {
  const rows = cluster.members.map((m) => `| \`${m.runId.slice(-10)}\` | ${m.source}${m.by ? ` (${m.by})` : ''} | ${m.text.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160)} |`);
  return `# Proposed convention

> ${rule}

The factory got **the same feedback on ${cluster.runs.length} different runs**. Instead of making the mistake again, it proposes adding this rule to \`${file}\`, which every agent working on this repository reads.

**Nothing changes until you merge this.** Edit the wording, or close it if the rule is wrong.

## The evidence

| Run | From | What was said |
|---|---|---|
${rows.join('\n')}

## Bench: with and without the rule

${benchSection ?? '_Not run._ `factory learn --propose --bench` runs the bench cases with and without the rule. With a real model it shows whether the rule helps, hurts, or is noise.'}

---
_Proposed by the factory's learning loop (Phase F21). This PR only touches \`${file}\`._
`;
}
