# Phase 16d — Engineering: application architecture from the code, and test analysis: summary

**Status:** built 2026-10-20, waiting for your review (started at your word, with your defaults, while 16a–16c wait for
theirs). Spec: `.claude/specs/phase-16d-engineering/`. The work is in `nooblyjs-ai-factory` (`src/services/engineering/`,
the new Test section `quality/`, the intake, the pages) and `nooblyjs-ai-host` (the lifecycle's Engineering checks and
sign-off, the two Engineering homes). Root `product.md` §3.2b is what Engineering is for.

## What is there

| Area | What |
| --- | --- |
| Reading a repository | `repo-reader.js`: a local git folder named in `repos.yaml` (the demo `web-storefront`), else Bitbucket through NooblyJS's devtools service (read-only), else nothing. The branch, the head commit, the files and their text, capped |
| Application architecture | Per story and impacted system, drafted from the code at the head of main as a teammate task (Rhea Voss stands in for the application architect agent; Platform refuses a repository agents may not read): the **application flow** (the new module, the existing exports it uses, the interfaces), the **objects** (each export's noun and parameters: `formatSlot(start, end)` → Slot: start, end), the **NFRs per component** and the **changes** (a new module next to the existing source, its test where the repository keeps tests, the modules it uses or changes). It lists the modules it read. A person edits it (proposed again) and accepts it (`accept-decisions`; an agent is refused and audited). **Stale** when main moves past the commit it was read at; a repository not readable here is drawn from the design alone, and says so. `data/factory/engineering/architecture/<story>.md` |
| The Test section | `nooblyjs-ai-factory/quality/`, at `/factory/quality`, a section of the Factory like Product and Design: its own `register()`, API, pages, data (`data/factory/quality/`), `provides: { quality }`. Its **Test analysis** row sits in the sidebar's Engineering group, between Application architecture and the sign-off (a section's rows can now go *within* the Factory's own groups) |
| Test analysis | Drafted by the test agent (Ada Quill stands in) from the story's criteria, interfaces, journey and NFRs under `test-policy.yaml`: a case per criterion in given/when/then (E2E when a customer sees it, else integration), a contract test per interface, an E2E test for the journey, accessibility checked by a person, performance by a load test. `TC-031-1-1` …, never reused. A test analyst edits, adds, removes and **marks each ready** (people only). Coverage in words: "1 of 2 criteria has a ready test case" |
| The Engineering sign-off | Three checks (`readiness.yaml` `engineer`, built in for older folders), from the Factory's `engineeringReadiness`: the architecture accepted and current for every system, every criterion with a ready test case, every interface with a ready integration test; each names what fails. The Engineering sign-off page signs off (the lifecycle's new `signOffEngineering`), with an override reason when a check fails (audited). An item with no Engineering work (from before 16d) has no checks |
| Work items | The sign-off's handoff sends each work item to the Factory with its system's **application architecture** and the **test cases** that run against that system, in its issue |
| Homes | **Application Architect**: architectures to draft, accept or draw again, stale ones, the stories in Engineer, sign-offs waiting on them. **Test analyst**: criteria without a ready test case, stories with no test analysis, interfaces without a ready test, sign-offs waiting on them |
| The seed | CHG-008's STORY-027-1 sample is the seed of the real formats: its architecture (web-storefront accepted, delivery-planner proposed) and, in the Test section's seed, its test analysis (one criterion ready, one a draft; the map tiles' contract a draft). A scripted agent for STORY-031-1's web-storefront work item builds what its architecture proposes |

## The test script

Run in the real app by `test/engineering.test.js`, every step passing, after the 16c script puts STORY-031-1 in Engineer:

1. Thabo asks for web-storefront's application architecture: read from the demo repository at its head (`local`, a
   40-character commit), it lists `format-slot.js`, its flow says "It uses formatSlot(start, end) from format-slot.js",
   its objects include Slot (start, end), and it proposes a new module. slots-api and stores-service, which can't be
   read here, are drawn from the design and say so. Priya can't accept; Thabo accepts all three.
2. The test analysis gives each of STORY-031-1's two criteria a test case with its level, plus a contract test per
   interface and the journey; with all but the last criterion's case marked ready, it says "1 of 2 criteria has a ready
   test case". A Viewer can't mark one ready.
3. The sign-off is refused (`readiness_failed`), naming the criterion; nothing is in the Factory yet. With an override
   and its reason it goes through, audited, and STORY-031-1 is in Build with three work items.
4. Its web-storefront work item is a run whose issue carries "Application architecture of web-storefront (accepted, read
   at …)" with the flow, and "Test cases to automate and run" with TC-031-1-1 and the rest; the other two wait (no
   repository set up for them here).
5. A commit to the demo repository's main: "Stale: main is at …, and this was read at …", and the check would fail.

The roadmap's step 2 said "four criteria"; the script counts the criteria Design gave STORY-031-1 (two).

## Tests

- New in the Factory: `test/services/engineering/architecture.test.js` (6: the code map, the scripted draft, the local
  reader, draft and accept with an agent refused, edit, stale, facts, a work item's context, read only outside Engineer)
  and `quality/test/analysis.test.js` (6: the policy, the draft, mark ready with an agent refused, the facts, add and
  remove, a work item's cases, read only outside Engineer, the page drawn from the API).
- New in the host: `test/engineering.test.js` (7: the Engineering group, the test script's five steps, the two homes).
- Changed: CHG-008's `views.test.js`, `pages.test.js` and `samples.test.js` (the Engineering pages are real now), the
  Factory's sidebar and stylesheets (`register`, `sections`, `module` tests), and `to-express.js` passes an error's own
  code on (`people_only`, `readiness_failed`).
- **Whole suites:** host 347 of 347 pass (340 before this phase, all passing). Factory 569 of 573 pass, 4 skipped, none
  failing (557 of 561 before). No test that passed before fails.

## Decisions taken while building

- **A repository is read where the Factory has it** (`repos.yaml`), else through devtools. A system that is new, or a
  repository neither reaches, is drawn from the design and the page says why, rather than refusing the draft.
- **Accepting a stale architecture is refused**: draw it again first. Editing one makes it proposed again.
- **The interfaces check counts a ready contract or integration case**, like the criteria check counts a ready case.
- **A case a person adds without naming systems runs against the story's systems**, so a work item carries only its own.
- **Old Test analysis addresses move on** (`/factory/engineering/test-analysis…` → `/factory/quality/test-analysis…`).

## Open questions

1. **Who drafts.** No application architect or test agent is in the roster: Rhea Voss and Ada Quill stand in. `[CONFIRM]`
2. **The test policy** (`test-policy.yaml`) is a default to agree with the test leads `[CONFIRM]`: E2E when a customer sees
   it, else integration; a contract test per interface; accessibility by hand.
3. **The scripted architecture is a reading, not a design.** Offline it finds the modules whose names share words with
   the story and proposes a module named after it; a model, or the architect, does better. Only JavaScript and TypeScript
   are read; other files are listed. With a model the answer is read as JSON, not tried against a real model here.
4. **Bitbucket reads** go through devtools' folder listings (depth and file count capped); not tried against the real
   Bitbucket here (tests never call it).
5. Not looked at in a browser here: the Application architecture, Test analysis and sign-off pages and the two homes.
   The tests draw them in Node from the API's answers; the e2e specs were not run.

## Guide points (roadmap)

Is an architecture drawn from code trusted more than one drawn by hand? Is the test analysis too much before the first
line is written?
