# Phase 16c — The Design section: summary

**Status:** done, signed off 2026-10-21 (built 2026-10-20, started at your word while 16a and 16b wait for theirs). Spec:
`.claude/specs/phase-16c-design-section/`. The work is in `nooblyjs-ai-factory` (the Design section, `design/` and
`public/design/`; the Product section's `designInputs`), `nooblyjs-ai-host` (stories in the lifecycle engine, Design's
readiness, Platform's repository teams, the two Design homes) and the root steering. Root `product.md` §3.2a is what
Design is for.

## What is there

| Area | What |
| --- | --- |
| The section | A section of the Factory of its own, like Product: `design/index.js` `register()`, its API at `/factory/design/api/v1`, its pages in `public/design/`, its data in `data/factory/design/` (`nfr-catalogue.yaml`, `items/<itemId>/design.md`, readable as Markdown), `host.service('design')` through the Factory's `provides`, a line on the Factory's status card ("4 items in Design · 1 story handed off") |
| The sidebar | The Design group: **Architecture** (the Product section's pages, drawn in its scope as in 16b), **Business requirements**, **Solution architecture**, **Functional analysis**, **Stories**, **Handoff to the Factory**. Each lists the items in Design with that part in words and opens the item's page for it, one tab per part |
| Business requirements | `BR-031-01` …: the analyst agent drafts one per goal and one per user story of the spec, each quoting the words it comes from. A person with `accept-requirement` accepts each; an edit makes it proposed again. A Contributor can't accept; an agent is refused whatever its role, and audited |
| Solution architecture | **Impacted systems** from the item's repositories (the spec's, else its product's defaults: the sample Delivery product has web-storefront, slots-api and stores-service), changed when Platform has them and new when it doesn't, each with its **owning team** (a new `team` on Platform's repository record) and what Knowledge has on it. **NFRs** (`NFR-031-01`) from the item's quality attributes, then the NFR catalogue's default for each category not covered. **Feature landscape** (`FEAT-031-1`): one feature per user story; a person names what each depends on (no loops). Links to the container view and ADRs, the threat model (Phase 19, said in words) and Infrastructure |
| Functional analysis | **Interfaces** (`IF-031-01`): one per relation of the container view, both sides by name, the contract in the relation's words; people add, edit and remove them. A side missing is said in words. **Technical requirements** (`TR-031-01`): one per impacted system |
| Stories | `STORY-031-1` …: one per feature, each tracing to its business requirements, systems, interfaces, technical requirements, NFRs and acceptance criteria. Merge (into the first) and split (the story keeps the first part). Ids are never given out again |
| Stories in the lifecycle | Each story is a lifecycle item of its own (type `story`, `parentId`, `feature`, system Factory), created in Design by `syncStories`; one merged away or removed while in Design is **withdrawn**, with the reason. Lifecycle shows a story's item and feature, and an item's stories ("1 of 3 stories handed off") |
| The Design handoff per story | `handoffStory`: the story's `design-handoff` approval, given by any person but a Viewer (never an agent), with Design's three checks: every business requirement covered by a story, no decision still proposed, every interface with both sides named. A failing check names what fails ("ADR-014 is still proposed", "IF-031-05 has no "to" side"); an override needs a reason. The story moves to Engineer with one work item per impacted system it touches; nothing goes to the Software Factory before its Engineering sign-off |
| The item follows its stories | It stays in Design while any story is there, then takes the earliest of its stories' stages, on record (history `stories`, audit `item.followed_stories`) with no stage event, so Metrics counts no handoff. An item with stories can't be handed off, signed off or moved on as a whole (`per_story`). Items without stories (PRD-028, handed off before 16c) keep the per-item Design handoff and have no Design checks |
| Drafting | Each draft is a hired teammate's task (`runTask`, work types `requirements-drafting`, `architecture-drafting`, `analysis-drafting`, `story-drafting`, routed as "Specs, architecture, review"): Ada Quill for requirements and the functional analysis, Rhea Voss for the solution architecture and stories, else the only hired teammate. With no model configured the teammate plays the section's scripted draft; a model's answer is read as JSON of the same shape. A draft only adds what is missing, never overwriting a person's work |
| The Product section's handoff | Its UI Design page no longer offers Send to Software Factory for an item with stories: it says the item goes story by story and links to Design's handoff (the lifecycle engine refuses the whole-item handoff anyway, `per_story`) |
| Homes | **Solution Architect**: items in Design, decisions awaiting them, stories ready for their Design handoff, stories handed off. **Functional Analyst**: interfaces with a side missing, stories to finish (no criteria or no business requirement), items in Design. Both work roles land on For you now |

## The test script

Run in the real app by `test/design.test.js` (the Factory and Teammates hosted), every step passing:

1. PRD-031 enters Design with its Product handoff (the rollout plan overridden). Lerato asks for the business
   requirements: six, each quoting the spec, drafted by Ada Quill as a teammate task. Lerato accepts them; Priya
   (Contributor) is refused; an agent with its role raised to Owner is refused and audited.
2. Impacted systems: web-storefront, slots-api and stores-service, each changed, owned by checkout-squad,
   delivery-squad and delivery-squad.
3. An interface with only a "from" side: Design's check fails, naming it. With its "to" side named, the check passes.
4. Three stories, each tracing to business requirements and its feature, each a lifecycle item in Design. Merge two
   (STORY-031-3 is withdrawn), split one (STORY-031-4): three again.
5. Thabo's handoff of STORY-031-1 is refused while ADR-014 is proposed, naming it; he accepts ADR-014 and hands it off:
   STORY-031-1 is in Engineer, with its approval; PRD-031 is still in Design and says "1 of 3 stories handed off"; the
   Factory has started no run for it. A Viewer and an agent are refused.

## Tests

- New: `design/test/design.test.js` (13) and `design/test/public.test.js` (3) in the Factory: each part's draft, the
  catalogue, accepting and the refusals, systems, interfaces and Design's checks, stories and their traces, the feature
  landscape's dependencies, merge and split, the handoff call, read only outside Design, the readable file, and each
  part's page and the list drawn from the API's answers (in Node: the kit's modules, a stand-in view), with a Viewer
  offered nothing to change. `test/lifecycle/stories.test.js` (7) in the host: stories as items, withdrawal, the
  refusals for an item with stories, the per-story handoff with Design's readiness, the item following its stories.
  `test/design.test.js` (8): the test script and the two homes in the real app.
- Changed to the new meaning: the Factory's sidebar rows and stylesheets (`test/register.test.js`,
  `test/sections.test.js`, the host's `factory.test.js` and `product.test.js`), the Design section's Architecture pages
  being the Product section's per route.
- **Whole suites:** host 336 of 336 pass (321 before this phase, all passing). Factory 550 of 554 pass, 4 skipped, none
  failing (533 of 537 before). No test that passed before fails.

## Decisions taken while building

- **Story ids** `STORY-031-1`, as proposed, and the other ids in the same shape (`BR-031-01`, `NFR-031-01`, `IF-031-01`,
  `TR-031-01`, `FEAT-031-1`). `[CONFIRM]`
- **The NFR catalogue** is the Design section's `nfr-catalogue.yaml`: seven categories, one entry each, every target
  `[CONFIRM]` or `[PLACEHOLDER]`. Phase 18 reads the same file.
- **A repository's owner is a team** (`team` on Platform's record, not `owner`, which Bitbucket's name already uses).
- **Stories become lifecycle items when they are written**, not when they are handed off, so Lifecycle and Overview
  show them in Design and the handoff is a stage move like any other.
- **An item with no Design work has no Design checks**, so items handed off before 16c keep working.
- **Each story's work items are one per impacted system it touches.** Phase 16d makes them from the application
  architecture.

## Open questions

1. **Who drafts.** No analyst agent is in the roster: Ada Quill and Rhea Voss stand in. Hire or name a dedicated one?
   `[CONFIRM]`
2. **Where real repositories get their team.** The sample ones have it on their Platform record; Bitbucket's project,
   CODEOWNERS or a person in Platform? `[CONFIRM]`
3. **NFRs and technical requirements can't be edited on the page yet**, only drafted (and changed in the file). Stories,
   systems, interfaces and features can. Is that enough for 16c, or should the analyst edit those too?
4. **The scripted drafts are a sample.** Offline, a goal's requirement and a criterion go to the story they share the most
   words with, and every story touches every system; a model, or the analyst, does better. With a model configured
   the answer is read as JSON, which has not been tried against a real model here.
5. **Work roles in an existing data folder**: the layouts are in the seed's `work-roles.yaml`; a folder made before
   keeps its own file, so the two homes appear there only when someone adds `layout` to those roles.
6. Not looked at in a browser here (no Chromium libraries in this codespace): the five Design pages and the two homes.
   They are drawn in Node from the API's answers by the tests, and the e2e specs were not run.

## Guide points (roadmap)

Are generated stories the right size for one pull request or a few? Is the feature landscape read?
