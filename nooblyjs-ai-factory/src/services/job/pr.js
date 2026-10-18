// @ts-check
// Phase F03: the PR description. The reviewer's first (and ideally only) stop.
//
// A factory PR has to answer, without the reviewer opening anything else:
// what was asked · what changed · did the agent think it worked · what did it
// cost · how do I look at it. Later phases add gates (F04), review findings
// (F11) and the full evidence bundle (F14) to the same page.

/**
 * @typedef {Object} PrFacts
 * @property {{ ref: string, title: string }} issue
 * @property {string} head
 * @property {string} base
 * @property {string} baseSha
 * @property {string} repo                                  where to review it
 * @property {string} stat                                  git diff --stat
 * @property {import('../exec/harness/driver.js').StepResult} result
 * @property {'draft' | 'ready'} status
 * @property {string[]} [problems]                          why it is a draft
 * @property {string} [checks]                              Phase F04: a Markdown section
 */

/** @param {PrFacts} f */
export function renderPrBody(f) {
  const r = f.result;
  const cost = `$${r.costUsd.toFixed(4)}${r.costIsEstimate ? ' (estimate)' : ''}`;
  const draftNote = f.status === 'draft' ? `\n> **Draft:** ${(f.problems ?? ['not ready']).join(' ')}\n` : '';
  return `# ${f.issue.title}

Resolves ${f.issue.ref}.
${draftNote}
## Summary (written by the agent)

${quote(r.text.trim() || '(no summary)')}

## Changes

\`\`\`
${f.stat.trim() || '(none)'}
\`\`\`
${f.checks ? `\n${f.checks}\n` : ''}
## Run

| Outcome | Model | Turns | Tool calls | Cost | Time |
|---|---|---|---|---|---|
| ${r.outcome} | ${r.model ?? '?'} | ${r.turns} | ${r.toolCalls} | ${cost} | ${(r.durationMs / 1000).toFixed(1)}s |

## Review it

\`\`\`bash
cd ${f.repo}
git log --oneline ${f.base}..${f.head}
git diff ${f.base}...${f.head}
git merge ${f.head}          # when you're happy: merging is your call
\`\`\`

Base: \`${f.base}\` @ \`${f.baseSha.slice(0, 12)}\`
`;
}

/** The agent's words, shown as a quote so it's clear who is speaking. */
function quote(text) {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}
