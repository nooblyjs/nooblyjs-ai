# Phase F21: The learning loop

**Goal:** the factory should make the same mistake at most a few times.

```
run closes ─► retro: its feedback → learning records
           ─► learnings clustered; the same lesson in ≥ K runs of one repo
           ─► a DRAFT PR adding one rule to .factory/steering/conventions.md, with every comment
              that led to it, and bench numbers with and without the rule
           ─► a person merges it (or edits it, or closes it)
           ─► every future agent in that repo reads the rule
```

```bash
factory learn                          # retro settled runs, list recurring patterns
factory learn --now --propose --bench  # …and open a draft steering PR for each, with bench numbers
factory learn --agent                  # let the retro role phrase each lesson as a rule
```

---

## 1. The retro (`src/knowledge/retro.js`)

**It isn't a station on the line**, although the roadmap sketched one. The line ends at delivery, but the most useful feedback comes **after**: a person's review comments, a rejection, the edits they make before merging. A station would do its retrospective before anyone had spoken.

So `factory learn` looks at runs that have **settled**: merged, or finished and left alone for `settleHours` (24 by default; `--now` skips the wait). It's **incremental**: `retro.done` remembers the last event it read for each run, so a review that arrives a week later is still learned from, exactly once.

What it reads (`learningsFromRun` in `src/knowledge/learning.js`):

| Source | Event | Why |
|---|---|---|
| **human-review** | `pr.changes_requested` (F15/F18), an inbox **rejection**'s feedback (F12) | what *people* said: the strongest signal |
| **review** | the reviewer's findings, not nits (F11) | what the factory's own reviewer kept finding |
| **gates** | repairs triggered by failed checks (F13) | what kept breaking |

### The retro role (optional, `--agent`)

`src/roles/builtin/retro.md` is a cheap, read-only model. It turns each piece of feedback into **one general rule**, or `null` for a one-off:

```
2. [human-review, sam] n >> 1 truncates odd numbers: use n / 2
   → "Don't use bit shifts for arithmetic on numbers that may be odd or large."
1. [human-review, sam] Typo in a comment
   → null   (nothing general to learn)
```

Rules phrased the same way each time cluster much better than raw comments (next section).

## 2. Clustering (`clusterLearnings`)

One comment is an opinion. **The same comment on three different runs is a pattern.**

The clustering is deliberately simple and deterministic:
- **Words:** lowercase; common endings trimmed ("exports" → "export"); stopwords, file paths and numbers dropped.
- **Similarity:** Jaccard (shared words ÷ all words), threshold 0.4.
- **Grouping:** single-link: a learning joins a group if it's close to *any* member.
- **Per repo:** a convention in one repo isn't a rule for another.
- **Counted in distinct runs**, not comments: one run with three comments is still one run.

No embeddings: the inputs are short review sentences, the result has to be explainable in a PR, and tests have to be exact.

The tests show both its strength and its **limit**:
- "Please use named exports, not default exports", "Default export again: this repo uses named exports" and "use a named export here, never export default" → **one group** ✓.
- "Add a test for the empty list" and "Tests for empty input are missing" share too few words to meet directly. But single-link **chains**: "Missing a test for the empty list" is close to both, so all three end up together. Chaining is useful here, and it's also how single-link can over-merge. The retro role's consistent wording is the better fix.

## 3. The proposal (`src/knowledge/propose.js`)

For each pattern seen in **≥ K runs** (`--min-runs`, default 3) and not proposed before:

1. A workspace on the repo; **one bullet** added to `.factory/steering/conventions.md` under *Learned rules*, with a comment naming the runs.
2. A **draft** PR on `factory/learning/<words>` containing: the rule; a table of **every comment that led to it** (run, who, what); and a **bench** section.
3. A `learning.proposed` event listing the learnings it used, so the same pattern is **never proposed twice**.

`conventions.md` is new; it's now one of the steering files every agent reads (F08). The rule goes in **steering, not a role file**: a convention like "named exports only" is about *this repo*, and steering is per-repo. Roles are about a job, across repos.

**Nothing is applied automatically.** Steering is trusted text that shapes every agent. If a few review comments, or a few crafted issues, could rewrite it without a person, that would be a backdoor. It's also a **protected path** (F14), so even at L3 the factory won't merge its own proposal.

### The bench before/after

`--bench` runs the F19 bench cases twice: as they are, and with the proposed steering file added to each case's starting commit (a new `overlay` option on the bench's `materialise`). The PR gets both summaries and the per-case flips.

A convention about *your* repo won't move a generic bench much. The bench answers a narrower but important question: **does the rule break or confuse anything?** A rule that makes the model worse at ordinary tasks ("never use loops") shows up here. With `--bench-agent oracle` (no model) it only checks the pipeline, and the PR says so.

## The checkpoint

*Give three PRs the same review comment; see a steering PR proposing the rule, with bench numbers.*

It's a test (`test/learning.test.js`), end to end, offline:

1. Three factory runs on one repo, each delivered.
2. Each gets a "changes requested" review, in different words: *"Please use named exports, not default exports."*, *"Default export again: this repo uses named exports."*, *"We use named exports here, never export default."*
3. `runRetros` → three learnings → `recurring(minRuns: 4)` is empty, `recurring(minRuns: 3)` has one pattern in 3 runs.
4. `proposeRule` with a bench (oracle agent, one case) → a draft PR:

```
# Proposed convention

> Use named exports, not default exports.

The factory got the same feedback on 3 different runs. …
Nothing changes until you merge this.

| Run | From | What was said |  (all three comments)

## Bench: with and without the rule
without the rule: 1 cases × 1 repeat(s) … resolved 100%
with the rule:    1 cases × 1 repeat(s) … resolved 100%
```

5. The PR changes **only** `.factory/steering/conventions.md`, and the pattern is never proposed again.
6. A person merges it, and the **next** run's builder prompt contains `conventions.md` with the rule.

With a real model, `factory learn --propose --bench --bench-case …` puts real numbers there.

## Tests

- **Words and similarity**; **clustering** synthetic learnings (the same lesson grouped; other lessons and other repos apart; the chaining case; the rule wording: "please" dropped, a full stop added, the retro's wording preferred).
- **What a run teaches**: human reviews, rejections, non-nit findings, gate repairs (not human-triggered repairs, which are counted once, as reviews).
- **The retro**: settled or not; incremental; the retro role with a scripted model, a one-off dropped.
- **The checkpoint** above.

## Known issue

While running the full suite for this phase, F05's "several processes creating the same new database" test failed once in two full runs, and never in five runs on its own. It's a timing-sensitive test that runs alongside everything else. It's recorded here and not yet fixed; the next step is to look at `busy_timeout` and migration order under load.

## What was built

| File | What it does |
|---|---|
| `src/knowledge/learning.js` | `tokens`, `similarity`, `clusterLearnings`, `learningsFromRun` |
| `src/knowledge/retro.js` | `runRetros` (settled runs, incremental, optional retro role), `isSettled` |
| `src/knowledge/propose.js` | `recurring`, `ruleFor`, `proposeRule` (the steering PR) |
| `src/roles/builtin/retro.md` | the retro role |
| `src/commands/learn.js` | `factory learn`, `benchWith` |
| `src/knowledge/steering.js` | `conventions.md` is now a steering file |
| `src/bench/*` | `overlay`: extra files in each case's start |

## What we learned

- **Learn after close**, not at the end of the line: the useful feedback comes later.
- **Count runs, not comments.** A pattern is the same lesson in different runs.
- **Deterministic first, a model to help.** Word overlap is exact and explainable; the retro role supplies consistent wording, where it helps most.
- **Propose, don't apply.** Steering is trusted and protected; a person merges every rule, with the evidence in front of them.
- **Bench the change.** Even a sensible rule can confuse a model; "does it break anything?" is worth asking every time.
- How the commercial factories appear to do it: Devin's "Knowledge" (suggested from sessions, approved by a user), Cursor's and Claude Code's memory/rules files, Copilot's custom instructions, Kiro's steering files. The pattern is the same: **learned notes become explicit, editable text that a person controls**.
