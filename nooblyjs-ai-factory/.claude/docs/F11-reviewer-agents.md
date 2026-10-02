# Phase F11: Reviewer agents

**Goal:** after the facts (gates), judgment: a **different** role, **read-only**, reviews the change against the spec and returns **structured findings**. A security reviewer joins when the change is sensitive. And before any model is asked, a program looks for the oldest trick there is: weakening the tests.

---

## The idea: what the checks can't catch

```
gates (F04, on a clean checkout: F07)  →  does it pass the checks we could write down?
review (F11)                           →  does it do what was ASKED? what did the checks miss?
human (F12)                            →  do we want this?
```

Gates only know what the tests test. The checkpoint shows the gap: the builder implements `divide` but "forgets" the division-by-zero criterion (R1.2), writes a test only for the happy path, and reports "tests for R1.1 and R1.2, all passing". The gate passes, honestly: the test that exists passes. Only something that reads the spec and the code can say "R1.2 isn't met, and nothing tests it".

## Deterministic first: test tampering (`src/review/tampering.js`)

The cheapest way to make failing tests pass is to weaken them. Gates can't see it (the tests *do* pass now), and a tired reviewer might not either. A program can:

| In the diff | Finding |
|---|---|
| a test file that existed at the base is **deleted** | blocking |
| **assertions removed** from an existing test file (net: removed > added) | blocking |
| **`.skip` / `.only` / `xit` / `test.todo`** / `@pytest.mark.skip` added | blocking |

No model, no judgment: the same diff always gives the same findings. A human can still decide the change was right, but it has to be *said*, not slipped through. The test "TAMPERING blocks even when the reviewer approves" is the point: the model's approval can't override a fact.

## The reviewer (`src/roles/builtin/reviewer.md`)

A **role** (F09): `readOnly: true`, so the harness runs it in `plan` mode. The loader keeps it read-only whatever a repo or operator says, and gives it no allow rules. A reviewer that could edit what it reviews would be reviewing its own work. The test has the reviewer *try* to "just fix it", and the harness refuses.

What it gets, in its prompt:

- the spec's acceptance criteria (or "no spec: review against the issue"),
- what the gates said on the clean checkout,
- what the tampering check already found ("you don't need to repeat these"),
- the diff (spec files excluded; cut at 60 000 characters, with a note to Read the rest),
- a checkout of the change, to read anything else.

What it's asked, in order: unmet acceptance criteria (read the **code**, not just the tests), bugs and edge cases, tests that don't test what they claim, changes nobody asked for. Not style preferences the repo doesn't have.

## Structured findings (`src/review/findings.js`)

```json
{ "verdict": "changes_requested",
  "summary": "R1.1 is done; R1.2 is not implemented, and no test covers it.",
  "findings": [ { "severity": "blocking", "file": "divide.js", "line": 1, "requirementId": "R1.2",
                  "rationale": "divide(1, 0) returns Infinity. R1.2 requires a RangeError…",
                  "suggestion": "if (b === 0) throw new RangeError('division by zero');" } ] }
```

**Severity is what the factory acts on:** `blocking` keeps the PR a draft and ends the run `changes_requested` (F13's fixer will pick it up); `major` is shown prominently; `minor`/`nit` are shown and block nobody.

The answer is **validated** before anyone trusts it: known severities, a rationale on every finding, `requirementId`s that exist in the spec, and no "approve" with a blocking finding (that contradicts itself). An answer that fails is sent back through the check → fix loop from F08 ("Your review could not be used: …"). Harness track H33 (structured output) would do this inside the harness; until then the factory validates.

## The security reviewer (`security-reviewer.md`)

Same station kind, different role (`"role": "security-reviewer"` in the line), **strong** tier, and it only runs when the change is sensitive (`"when": "review.sensitive == true"`):

```json
"review": { "sensitive": ["src/auth/**", "*.sql"], "dependencies": true }
```

Changed files matching those globs, or any dependency manifest/lockfile (`package.json`, `package-lock.json`, `go.mod`… on by default), make a change sensitive. The patterns come from the **original base's** config, so a change can't unmark itself as sensitive. It looks only at security: injection, secrets, auth checks, unsafe eval, unexpected or typo-squatted dependencies, new network destinations.

## The line now

```
triage → spec (not small) → build (waves) → verify → review → security (if sensitive) → deliver
```

The `quick` line (build → verify → deliver) has no review, for work that's already trusted, and for tests of the later stations.

## Bugs found on the way

- **Tests could quietly reach a real model.** With the reviewer added, some tests gave scripted models for triage and build but not review. `providerFor` then fell through to the run's *real* provider: the tests tried to call the Anthropic API and failed only because there's no key here. With a key they'd have spent money. Now, if **any** scripted providers are given, a station without one is an error that names it (`No model for the "review" station: scripted providers were given for triage, build, but not this one`). **Scripted mode must never fall back to a real model.**
- **The PR's base was a commit sha, not `main`** (since F08). When the builder starts from the spec commit, its workspace's "base ref" is that sha, and the PR (its `base:` field and "Review it" commands) inherited it. The spec station now carries the branch name through; a test checks `base: main`.

## What was built

| File | What it does |
|---|---|
| `src/review/tampering.js` | Deleted tests, removed assertions, new skips: blocking, deterministic |
| `src/review/findings.js` | The review schema, `parseReview` (validation with named problems), `formatReview` (the PR section) |
| `src/roles/builtin/reviewer.md`, `security-reviewer.md` | The roles (read-only) |
| `src/line/stations/review.js` | The station: sensitive files, tampering, context, validated answer |
| `src/util/glob.js` | `**` / `*` / `?` path matching |
| `src/job/deliver.js` | Blocking findings → draft PR, `changes_requested`; the Review section |
| `lines/default.json` | `review`, and `security` when sensitive |

## Try it: the checkpoint

```bash
export FACTORY_HOME=/tmp/factory-demo
examples/make-demo-repo.sh /tmp/calc

node bin/factory.js run examples/issues/add-divide.md --repo /tmp/calc \
  --script examples/scripts/divide-misses-criterion.json --autonomy L2 --allow-unsandboxed
#   ▶ verify    verify (clean checkout): test passed
#   ▶ review    review: 1 blocking finding(s), 1 other
#   finished: changes_requested
cat $FACTORY_HOME/forge/*/prs/issue-1.md
```

The PR's Review section:

| Severity | Where | Requirement | Finding | By |
|---|---|---|---|---|
| ⛔ blocking | `divide.js:1` | R1.2 | divide(1, 0) returns Infinity. R1.2 requires a RangeError…<br>→ if (b === 0) throw new RangeError('division by zero'); | reviewer |
| 🟠 major | `test/divide.test.js` | R1.2 | No test for R1.2, although the builder's summary says it tested it. | reviewer |

The reviewer here is scripted, so this shows the *plumbing*: the criteria and diff reach the reviewer, its answer is validated, the finding names the requirement, and the PR stays a draft. How often a *real* model catches such things (and how often it cries wolf) is a measurement for the bench (F19).

> **Since later phases:** `--autonomy L2` skips F12's spec approval. Since F13 a blocking finding goes to a **fixer** first; this script's fixer doesn't manage it, so the run escalates and still ends `changes_requested`, now with a Repairs section.

## What we learned

- **Gates check facts; review checks intent.** A passing test suite says nothing about a criterion no test covers.
- **Look for tampering deterministically.** A model's approval must not override "you deleted an assertion".
- **A reviewer must be unable to edit**: separation of duties as a permission (F09), tested by a reviewer that tries.
- **Structured, validated findings** with severities the factory acts on, and requirement ids that tie back to the spec.
- **Specialised reviewers only where they matter**: security review when sensitive paths or dependencies change, judged by the original base's config.
- **Scripted mode must never fall back to a real model.**
- How the commercial factories appear to do it: AI code-review products (CodeRabbit, Graphite's reviewer, GitHub Copilot code review) post structured, severity-tagged comments on PRs; Factory.ai has a dedicated review droid; GitHub's own setup runs CodeQL (deterministic) next to AI review. The shared pattern: **deterministic checks, then AI review, then humans.**
