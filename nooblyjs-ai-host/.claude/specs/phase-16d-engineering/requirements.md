# Phase 16d — Engineering: application architecture from the code, and test analysis: requirements

> **Status: built 2026-10-20, waiting for review.** Summary: `docs/phases/phase-16d-summary.md`. Root `product.md` §3.2b,
> §4; root `roadmap.md` Phase 16d. Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-20: "Take the defaults and continue with 16d" (16a, 16b and 16c still waiting for review).

Goal: before anything is built, each story has an application architecture drawn from the real code and a test
analysis, signed off in one approval.

## Decisions taken before starting (2026-10-20, the defaults)

- **Which repositories the application architect agent may read:** every repository Platform lists, as each one's own
  agent access says (`readCode`), checked by `checkAgentWork` before every draft. A repository is read where the
  Factory has it (`repos.yaml`: a local git folder, the demo `web-storefront`), else through the devtools service
  (Bitbucket, read-only), else not at all: the draft then says it is drawn from the design alone.
- **The test case format** is given/when/then (`TC-031-1-1`: its criterion, given, when, then, level, whether the AI
  automates it, the systems it runs against, the interface or journey it covers). **Which levels the AI must automate**
  is the Test section's `test-policy.yaml`: a criterion a customer sees is an E2E test, any other an integration test;
  every interface has a contract test; an accessibility NFR is checked by a person; a performance NFR has a load test.
  `[CONFIRM]` with the test leads.
- **The Test section** is `nooblyjs-ai-factory/quality/`, at `/factory/quality`, data in `data/factory/quality/`,
  `provides: { quality }` (root `product.md` §9 open question 2, now taken). Its first row, Test analysis, sits in the
  sidebar's Engineering group.
- **Who drafts:** no application architect or test agent is in the roster: Rhea Voss (Architect) stands in for the
  first and Ada Quill (Research Analyst) for the second, as Design's drafts do. `[CONFIRM]`

## R1 — Application architecture, per story and impacted system

1. An agent drafts it from the repository at the head of its main branch: the **application flow** for the story, the
   **objects** it touches (from the modules' exports and their parameters), the **NFRs per component** (from the story's
   NFRs) and the **changes** it proposes (modules to add next to the existing ones, with their tests, and modules that
   change). It names the real modules it read. It is a teammate task, refused by Platform when agents may not read
   the repository.
2. A person edits a system's flow, objects, NFRs and changes (`draft`), which makes it proposed again, and accepts it
   (`accept-decisions`, people only, refused and audited for an agent).
3. It records the commit it was read at. When the repository's main branch moves past it, it is **stale**: said on the
   page, failing the sign-off check, and drafted again on request. Where the commit can't be checked (a sample, or a
   repository not readable here), it says so.

## R2 — Test analysis (the Test section)

1. An agent drafts it from the story's acceptance criteria, interfaces, systems and NFRs (the Design section's), under
   the test policy: at least one **test case per criterion**, a **contract test per interface**, an **E2E test per
   journey** (the story's feature), and the **checks a person makes by hand**. Each case says whether the AI automates
   it, and at which level.
2. A test analyst edits, adds and removes cases (`draft`) and **marks each ready** (people only). Coverage is said in
   words: "1 of 2 criteria have a ready test case".

## R3 — Work items carry their part

When the Engineering sign-off sends a story to the Software Factory, each work item's issue carries its system's
application architecture and the test cases that run against that system (their ids, levels and given/when/then).

## R4 — The Engineering sign-off's readiness

Checks for a story in Engineer (the `engineer` stage of `readiness.yaml`, built in for older data folders), worked out
by the Software Factory: **the architecture is accepted and current** for every impacted system, **every criterion has
a ready test case**, **every interface has an integration test**. A failing check names what fails. A person may
override with a reason, audited. An item with no Engineering work (from before 16d) has no Engineering checks.

## R5 — Pages and homes

1. Engineering · Application architecture: the stories in Engineer, each system's state in words; a story's page with
   Ask to draft, Edit, Accept and the stale notice. Engineering · Test analysis (the Test section): the stories, their
   coverage; a story's page with its cases, Mark ready, Edit, Add. Engineering · Engineering sign-off: each story's
   checks, and Sign off (with an override reason when a check fails).
2. The Application Architect's home (architectures to accept, stale ones, sign-offs waiting on them) and the Test
   analyst's (criteria without a ready case, interfaces without a test, sign-offs waiting on them).
3. CHG-008's sample becomes the seed of the real thing: STORY-027-1's architecture and test analysis in their formats.

## Test script (roadmap Phase 16d)

After the 16c script (STORY-031-1 in Engineer):

1. Ask for STORY-031-1's application architecture of `web-storefront`: it names the demo repository's real modules
   (`format-slot.js`, `formatSlot`), the flow, and the objects the story touches.
2. Test analysis: each of the story's criteria gives at least one test case with its automation level; "1 of 2 criteria
   have a ready test case" until the last is marked ready.
3. The sign-off is refused while a criterion has no ready test case, naming it; an override with a reason is allowed and
   audited.
4. Before the sign-off the Factory starts no run for STORY-031-1; after it, its web-storefront work item is queued as a
   run whose issue carries its architecture and its test cases.
5. Commit to the demo repository's main: the architecture says it is stale.

The roadmap's step 2 said "four criteria"; STORY-031-1 has the criteria Design gave it (two), so the script counts
those.

**Done when:** steps 1–5 pass, and no test that passed before fails.

## Out of scope

The PR's evidence per test case and the Test approval screens (16e); test runs recorded from the line, coverage and
defects for real (Phase 20); reading code in languages other than JavaScript and TypeScript (the draft lists their
files only); Knowledge as a source of the architecture beyond the impacted system's sources Design already found.
