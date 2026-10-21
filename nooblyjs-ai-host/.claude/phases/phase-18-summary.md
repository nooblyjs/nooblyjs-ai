# Phase 18 — Requirements elicitation: summary

**Status:** done, signed off 2026-10-21 (built 2026-10-21, started at your word, with the defaults, while 16a–17 wait for
theirs). Spec: `.claude/specs/phase-18-requirements-elicitation/`. Root `product.md` §3.4 is what it builds. The work is
in `nooblyjs-ai-factory/product` (elicitation, the page, the spec's requirements), `nooblyjs-ai-factory/design` (the NFR
catalogue's prompts) and `nooblyjs-ai-host` (the extra readiness check, Teams meeting notes, the Business analyst).

## What is there

| Area | What |
| --- | --- |
| Stakeholders and sessions | Each spec's Elicitation page (`/factory/product/elicitation/PRD-033`, from the spec's Requirements card): stakeholders (affected, decides or consulted) and sessions (`SES-033-1`: interview, workshop or meeting) with their notes |
| Candidate requirements | **Ask Ada**: a teammate task (`requirements-elicitation`) turns the notes into candidates (`CAN-033-1`), each quoting the sentence it came from; with no model configured, the scripted draft keeps each sentence that says need, must, should, want… A person with `accept-requirement` accepts one, merges it into another or rejects it with a reason; an agent is refused and the refusal audited |
| Requirements | `REQ-033-01`, each with its quotes (a merged candidate's too), the candidates it came from, who accepted it and when, and acceptance criteria (`AC-033-01-1`). The spec's JSON and page show them |
| The NFR walk | The Design section's catalogue, each category with its prompt ("How fast must it be, and when?"): answers with targets, or not applicable with a reason. A person who may accept requirements states accepted NFRs; anyone else's answers are candidates. An accepted NFR with a target becomes a quality attribute row ("… (REQ-033-03)"), which Design's solution draft turns into its NFRs |
| Questions and assumptions | `Q-033-1`, with an owner. While a spec has questions, its readiness has one more check, "Every question is answered", failing with the open one named; an override needs a reason and is audited. A spec with no questions keeps its seven checks |
| Teams | "post meeting notes to PRD-033" (simulator or real bot): the notes become a `meeting` session marked "from Teams". Only notes a person posts to a spec are read |
| The Business analyst | The work role (its onboarding card) and home: candidates to decide, open questions, specs with no session, NFR walks to finish, each row linking to the item's Elicitation page |

## The test script

Run in the real app by `test/elicitation.test.js`, every step passing, with the Factory and Digital Teammates hosted.
PRD-033 is not in the seed, so the test makes it first (Lerato, a new spec in Delivery).

1. Lerato adds three stakeholders and records an interview; Ada drafts four candidates, `CAN-033-1` to `-4`, each
   quoting a sentence of the notes (the fourth, "should load in under two seconds", is a performance NFR).
2. Priya (a Contributor) can't decide. Lerato merges CAN-033-3 into CAN-033-1 and accepts it (`REQ-033-01`, with both
   quotes), accepts CAN-033-2 (`REQ-033-02`) and rejects CAN-033-4 ("Covered by the NFR walk"). The spec lists only
   REQ-033-01 and REQ-033-02.
3. An agent (a fixture actor with the Owner role) accepting CAN-033-4: refused `people_only`, `access.refused` audited.
4. The walk: two performance answers are REQ-033-03 and REQ-033-04 and two Performance quality attributes; the other six
   categories are not applicable with a reason ("7 of 7 categories walked").
5. A question is left open and the spec sent for review: the approval is refused, `readiness_failed`, "A question is
   still open: Q-033-1 "Which stores get lockers first?" (owner lerato-m)". Stevie overrides with a reason for both
   approvers (`readiness.overridden`, audited, naming `questions-answered`); PRD-033 is in Design, and the solution
   draft's NFRs carry REQ-033-03 and REQ-033-04 with their targets.
6. In the Teams simulator, Ada joins, someone speaks, and "@NooblyJS post meeting notes to PRD-033" makes `SES-033-2`, a
   meeting from Teams, with what was said.

And Priya as a Business analyst: her home's tiles are candidates, specs with no session, open questions and walks to
finish; PRD-033 is under open questions and candidates, and not under no session or walks.

## Tests

- New in the host: `test/elicitation.test.js` (6: the test script and the Business analyst),
  `test/lifecycle/questions.test.js` (1: a fact with its own words is a check of that item only). In the Product
  section: `product/test/services/elicitation.test.js` (3: candidates and decisions, the walk, questions).
- Changed: `people.test.js` lists the Business analyst among the work roles. The Product section's stand-in host now
  gives `host.can` (the real host does) and the `accept-requirement` permission.
- **Whole suites:** host 384 of 384 pass (377 before this phase). Factory 586 of 590 pass, 4 skipped, none failing (583 of 587 before). Infrastructure 48 of 48. No test that passed before fails.

## Decisions taken while building

- **Merging asks for the other candidate** and both must still be proposed; a candidate can't be merged into itself
  (400). The requirement the other becomes carries both quotes and both candidate ids.
- **A session's kind must be interview, workshop or meeting** (400 otherwise); with none it is an interview.
- **The extra check is shown only for the item whose facts carry it**, after the stage's own checks, and never twice.
- **Approving PRD-033 waits on two people** (Lerato and Thabo, from the approval rule); Stevie gives both on their
  behalf with the override, as Phase 16b allows.

## Open questions

1. **The NFR catalogue's owner** `[CONFIRM]`: the Solution Architects, as the Design section's file. Which prompts are
   missing (the roadmap's guide point)?
2. **An NFR answer from an Approver is accepted at once** (it is their own statement): or should it be a candidate
   like everyone else's?
3. **Design's business requirements and REQ ids**: Design's analyst still drafts `BR-031-01` from the spec; reading the
   elicitation's requirements instead (or linking BR to REQ) is not built. The trace has no `REQ` nodes yet. Linking
   Design's per-item features to the hierarchy's (Phase 17's open question 1) is not built either.
4. **Stakeholders are names**: picking a person or a team from Teams & roles (`personId`, `teamId`) is stored but the
   page offers only a name.
5. Not looked at in a browser here: the Elicitation page, the spec's Requirements card and the Business analyst's home.
   The tests read their APIs; the e2e specs were not run.

## Guide points (roadmap)

Is the candidate-requirement step too much friction? Which NFR prompts are missing?
