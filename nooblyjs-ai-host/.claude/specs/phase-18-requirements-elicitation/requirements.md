# Phase 18 — Requirements elicitation: requirements

> **Status: built 2026-10-21, waiting for review.** Root `product.md` §3.4; root `roadmap.md` Phase 18. Bugs found while
> reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Yes please commit and push and then do the next phase" (16a–17 still waiting for review).

Goal: every requirement says where it came from and who accepted it, and non-functional requirements are asked for,
not remembered.

## Decisions taken before starting (2026-10-21, the defaults)

- **The NFR catalogue** is the Design section's (`data/factory/design/nfr-catalogue.yaml`, Phase 16c): its seven
  categories, each now with a **prompt** (the question the walk asks). Solution Architects own it `[CONFIRM]`.
- **Candidate requirements from Teams** come only from meetings whose notes a person posted to an item ("post meeting
  notes to PRD-033"): those notes become an elicitation session of that item. No other meeting is read.
- **Where it lives:** the Product section, one file per item (`elicitation/<item>.md`): stakeholders, sessions
  (`SES-033-1`), candidates (`CAN-033-1`), requirements (`REQ-033-01`), the NFR walk and questions (`Q-033-1`).
- **Who decides:** accepting, merging and rejecting a candidate takes `accept-requirement` (Approver and up), a
  person's, audited; an agent is refused and audited. An NFR walk answer given by a person who may accept requirements
  is an accepted requirement at once (it is their own statement); anyone else's is a candidate.
- **Accepted NFRs with a target** become rows of the item's quality attributes (the Architecture page), which Design's
  solution draft turns into its NFRs (Phase 16c already does), each naming its requirement.
- **Questions and assumptions** (with an owner): while one is open, the spec's readiness has a check "Every question is
  answered" that fails naming it; a spec with no questions has no such check (the seven stay seven).

## R1 — Stakeholders and sessions
A stakeholder map per item (people and teams of NooblyJS, or outside names; affected, decides or consulted); sessions
(interview, workshop, meeting) with their notes; Teams meeting notes posted to the item become a session.

## R2 — Candidates and requirements
Ask Ada for candidates: each quotes the notes it came from. Accept (a requirement `REQ-033-01`, with its sources and who
accepted it), merge into another (the other carries both quotes), or reject with a reason. The spec shows its accepted
requirements, and acceptance criteria can hang off a requirement.

## R3 — The NFR walk
Each catalogue category answered (one or more answers, each with a target) or marked not applicable with a reason.

## R4 — Questions and assumptions
With an owner; open ones block the spec approval unless a person overrides with a reason.

## R5 — The Business analyst
The work role and home: candidates to decide, items with no session, open questions, NFR categories not walked.

## Test script (roadmap Phase 18)
1. As Lerato, add three stakeholders to PRD-033 and record an interview. Ask the analyst agent for requirements: four
   candidates appear, each quoting the notes.
2. Accept two, merge one into another, reject one with a reason. Only the accepted ones are in the spec.
3. As an agent (fixture), try to accept a candidate: refused and audited.
4. Walk the NFR catalogue; the two performance answers appear in Design as NFRs and quality attributes.
5. Leave a question open: spec approval is refused, naming it. Override with a reason: allowed and audited.
6. Post meeting notes from the Teams simulator to PRD-033: they appear as an elicitation session.

PRD-033 is not in the seed: the script makes it (a new spec in Delivery) first.

**Done when:** steps 1–6 pass, and no test that passed before fails.
