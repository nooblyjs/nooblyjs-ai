# Phase 16c — The Design section: requirements

> **Status: built 2026-10-20, waiting for review.** Summary: `docs/phases/phase-16c-summary.md`. Root `product.md` §3.2,
> §3.2a, §4; root `roadmap.md` Phase 16c. Bugs found while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-20: "Please continue with 16c" (Phases 16a and 16b are built and waiting for review; 12–14 reviewed the
> same day).

Goal: Design turns a Product handoff into business requirements, a solution architecture, a functional analysis and the
stories that build a feature, and hands each story to the Software Factory on its own.

## Decisions taken before starting (2026-10-20)

- A feature has many stories; a story belongs to exactly one feature (root `product.md` §3.2, decided).
- **Story ids** are `STORY-<item number>-<n>` (`STORY-031-1`), as proposed. The other ids follow the same shape:
  business requirements `BR-031-01`, NFRs `NFR-031-01`, interfaces `IF-031-01`, technical requirements `TR-031-01`,
  features `FEAT-031-1`. `[CONFIRM]`
- **The NFR catalogue** is a file of the Design section (`data/factory/design/nfr-catalogue.yaml`), seeded with seven
  categories (performance, availability, security, privacy, accessibility, cost, operability), each entry with a
  default target `[CONFIRM]` to agree with the teams. Phase 18 (elicitation) reads the same file. `[CONFIRM]`
- **Who drafts.** No analyst agent is in the teammate roster yet. Ada Quill (Research Analyst) drafts the business
  requirements and the functional analysis, Rhea Voss (Architect) the solution architecture and the stories, when
  hired; otherwise the only hired teammate, as in the Product section. Each draft is a teammate task.
  `[CONFIRM: a dedicated analyst agent]`
- **A repository's owner** is a team, on Platform's repository record (`team: delivery-squad`). The sample
  repositories get owners. `[CONFIRM]` how the real ones get theirs (Bitbucket's project? CODEOWNERS?).
- **Who accepts what.** A business requirement is accepted by a person with `accept-requirement` (Approver and up,
  Phase 16a). Everything else in Design is edited with `draft`. A story's Design handoff is the `design-handoff`
  approval (`accept-decisions`, Phase 16b), given per story. Agents are refused every acceptance and handoff.

## R1 — Business requirements

1. An analyst agent drafts the business requirements of an item in Design from its spec: one per goal and one per user
   story, each with an id (`BR-031-01`), a statement, and its **source**: the spec section and the words it quotes.
   The spec's elicitation record joins the sources when Phase 18 builds it.
2. A requirement is `proposed` until a person with `accept-requirement` accepts it; an agent is refused and the refusal
   audited. A person may edit a requirement's statement (`draft`); an edit of an accepted one makes it proposed again.
3. A draft never overwrites what a person accepted or edited: it adds what is missing.

## R2 — Solution architecture

1. **Impacted systems**: drafted from the item's repositories (Phase 11's, from the spec) and Platform's repository
   records, each **new** (not in Platform) or **changed**, with its **owner** (the repository's team) and what Knowledge
   says about it (sources, when Knowledge runs here). A person may set a system's change (new, changed, retired), its
   owner and a note, add a system, or remove one.
2. **NFRs**: drafted from the NFR catalogue and the item's quality attributes (the Architecture page's), each with its
   category, requirement, target and source; a catalogue entry without a scenario on the item has the catalogue's
   default target, marked `[CONFIRM]`. They become quality attributes in Phase 16d.
3. **Feature landscape**: the features this item serves (one per user story of the spec, as drafted), each with the
   stories it needs and the features it depends on, which a person names (no feature depends on itself, or in a loop).
4. The container view, ADRs and the standards check stay the Architecture pages (moved in 16b), linked from here. The
   threat model (Phase 19) and the infrastructure design (Infrastructure app) are linked, said in words when absent.

## R3 — Functional analysis

1. **Interface requirements** between impacted systems: a name, the kind (API, event, file), the two sides (`from`,
   `to`), and the contract. Drafted from the container view's relations; added and edited by people.
2. **Technical requirements** per impacted system: what that system must do, and the business requirements and NFRs it
   serves.

## R4 — Feature generation: the stories

1. The agent proposes the stories from the feature landscape and the analysis: each with its feature, title, the
   business requirements, systems, interfaces, technical requirements and NFRs it traces to, and its acceptance
   criteria (from the spec).
2. An analyst edits a story, **merges** two or more (into the first: their traces and criteria together, one feature),
   and **splits** one (into new stories of the same feature, each with its own title and criteria).
3. Every story is a **lifecycle item** (type `story`, `parentId` its item, its `feature`), in Design, kept in step with
   the Design section's list: a story merged away or removed while still in Design is withdrawn.

## R5 — Design's readiness and the Design handoff per story

1. Readiness checks before a Design handoff (the `design` stage of `readiness.yaml`, built in for older data folders):
   **every business requirement is covered by a story**, **no decision is still proposed** (the item's ADRs), **every
   interface has both sides named**. A failing check says which requirement, decision or interface.
2. **The Design handoff per story**: a person (not a Viewer, not an agent) hands one story to Engineering: its
   `design-handoff` approval, with the readiness checks (or an override with a reason). The story moves to Engineer.
   Its work items are one per impacted system it touches (Phase 16d refines them from the application architecture).
3. The item stays in Design until its last story is handed off, and says how far it is ("1 of 3 stories handed off").
   Then it follows its stories: its stage is the earliest of theirs. An item with stories is never handed off, signed
   off or advanced as a whole (refused, saying it goes story by story).
4. Items without stories (handed off before 16c, like PRD-028) keep the per-item Design handoff.

## R6 — The Design section and its pages

1. A section of the Software Factory of its own (`design/`, like `product/`): its `register()`, its API at
   `/factory/design/api/v1`, its pages in `public/design/`, its data in `data/factory/design/`, `provides: { design }`.
2. The sidebar's Design group: **Architecture** (the Product section's pages, as in 16b), **Business requirements**,
   **Solution architecture**, **Functional analysis**, **Stories**, **Handoff to the Factory**. Each lists the items in
   Design with that part's state in words, and opens the item's page for that part.
3. Status is said in words; WCAG 2.2 AA, as everywhere.

## R7 — Homes

The Solution Architect's home (items in Design, decisions awaiting them, stories ready for their handoff) and the
Functional Analyst's home (interfaces with one side missing, stories to finish, items in Design). The work role shapes
the home only.

## Test script (roadmap Phase 16c)

1. PRD-031 enters Design (the Product handoff, with the rollout plan overridden). Ask for business requirements: each
   quotes the spec. Accept them as Lerato; as an agent, refused and audited.
2. Impacted systems lists `web-storefront`, `slots-api` and `stores-service`, each new or changed, with an owner.
3. Add an interface with only one side: the Design handoff check fails, naming it. Name the other side: it passes.
4. Generate the stories: three, each tracing back to business requirements and its feature. Merge two; split one.
5. Hand off STORY-031-1 alone as Thabo (ADR-014 accepted first, or overridden): it is in Engineer; PRD-031 is still in
   Design and shows "1 of 3 stories handed off".

**Done when:** steps 1–5 pass, and no test that passed before fails.

## Out of scope

Application architecture and test analysis (16d); test cases written from the stories' criteria (16d); the Build and
Test approvals' screens (16e); the trace across apps and one shape for checks (16f); elicitation (Phase 18); the threat
model (Phase 19); syncing stories to Jira (the write gate exists, Phase 13; which stories sync is a 16f question).
