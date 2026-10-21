# Phase 16c — The Design section: design

> **Status: done, signed off 2026-10-21** (built 2026-10-20). Requirements: `requirements.md`. Summary: `.claude/phases/phase-16c-summary.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/design/` | The section: `index.js` (`register()`, `NAV`), `src/` (services, routes, seed), `test/`, `CLAUDE.md` |
| `nooblyjs-ai-factory/public/design/` | Its pages: `js/module.js` (route table), `js/pages/`, `css/design.css` (under `[data-module="design"]`) |
| `nooblyjs-ai-factory/src/services/sections.js`, `public/js/sections.js` | The Design section has a `register()` now; its Architecture rows keep the Product section's pages (`scope` per route) |
| `nooblyjs-ai-factory/product/` | `designInputs(itemId)`: the spec (parsed), its repositories (else its product's defaults), the container view, the quality attributes and the ADRs |
| `nooblyjs-ai-host/src/lifecycle/` | Stories as items, the Design handoff per story, the item following its stories, Design's readiness |
| `nooblyjs-ai-host/src/services/platform/` | A repository's owning `team`, read by other apps through `repositories.list()` |
| `nooblyjs-ai-host/src/services/for-you.js`, `public/js/pages/home/` | The Solution Architect and Functional Analyst homes |

## The data (`data/factory/design/`)

```
nfr-catalogue.yaml            the NFR catalogue (seeded; Phase 18 reads it too)
items/<itemId>/design.md      one item's design: front matter, a readable body written from it
```

`design.md`'s front matter, every list kept in id order:

```yaml
itemId: PRD-031
version: 7                        # every save
requirements: [{ id: BR-031-01, text, source: { section, quote }, status: proposed | accepted,
                 acceptedBy, acceptedAt, draftedBy, editedBy }]
systems:      [{ repo: acme/slots-api, name: slots-api, change: new | changed | retired, owner: delivery-squad,
                 ownerName, note, knowledge: [{ title, href }] }]
nfrs:         [{ id: NFR-031-01, category, requirement, target, source }]
features:     [{ id: FEAT-031-1, title, summary, dependsOn: [FEAT-…] }]
interfaces:   [{ id: IF-031-01, name, kind: api | event | file, from, to, contract }]
technical:    [{ id: TR-031-01, system, text, serves: [BR-…, NFR-…] }]
stories:      [{ id: STORY-031-1, feature, title, requirements, systems, interfaces, technical, nfrs,
                 criteria: [text], mergedFrom?, splitFrom? }]
drafts:       [{ part, by: { id, name, kind }, at, costUsd, modelRoute }]
```

A new id is the next number for the item, never reused (a merged story's id is not given out again: `counters` keeps
the last number per kind).

## Drafting

`createDrafter({ host })`: `draft(part, itemId, inputs, actor)` resolves the teammate (the part's usual one when hired,
else the only hired one; with Teammates not running, the usual name stands in, as in the Product section) and runs
`host.service('teammates').runTask({ slug, workType, itemId, system: 'factory', caller, input, scripted })`. The
scripted answer is the section's own deterministic draft from the inputs (below); a model's answer is read as JSON of
the same shape and falls back to the scripted one when it isn't. Work types: `requirements-drafting`,
`architecture-drafting`, `analysis-drafting`, `story-drafting` `[CONFIRM routes in Platform]`.

| Part | From | Scripted draft |
| --- | --- | --- |
| requirements | spec goals and user stories | one BR per goal ("Reach <target> for <measure> (today <today>)") and per user story, each quoting it |
| systems | spec repositories, Platform's records, Knowledge | each repository: changed when Platform has it, else new; owner from Platform |
| nfrs | catalogue, quality attributes | one per quality attribute (its category by word), plus each catalogue category not covered, at its default target |
| features | spec user stories | one feature per user story, its title the story's want; no dependencies are drafted: a person names them on the Solution architecture page |
| interfaces | container view relations | one per relation, its sides the container labels, its contract the relation's label |
| technical | systems, requirements, nfrs | one per system that is not retired, serving every requirement and NFR (the analyst narrows it) |
| stories | features, everything above | one story per feature, tracing to the requirements whose words it shares (each goal to the story it shares most with, else the first), all systems, interfaces and technical requirements of those systems, all NFRs, and the criteria that share its words |

## The API (`/factory/design/api/v1`)

| Method | Path | Permission | What |
| --- | --- | --- | --- |
| GET | `/items` | read | Items in Design, each part's state in words |
| GET | `/items/:id` | read | The item's design and its readiness |
| GET | `/catalogue` | read | The NFR catalogue |
| GET | `/drafters` | read | Who drafts each part, or why nobody can |
| POST | `/items/:id/draft/:part` | draft | An agent drafts a part (people only start it; the draft is the teammate's) |
| POST | `/items/:id/requirements/:brId/accept` | accept-requirement | People only |
| PATCH | `/items/:id/requirements/:brId` | draft | Edit the statement |
| PUT | `/items/:id/systems` | draft | Replace the list (each repo, change, owner, note) |
| POST, PATCH, DELETE | `/items/:id/interfaces[/:ifId]` | draft | Add, edit, remove |
| PATCH | `/items/:id/features/:featureId` | draft | A feature's title and what it depends on (no loops) |
| PATCH | `/items/:id/stories/:storyId` | draft | Edit |
| POST | `/items/:id/stories/merge` | draft | `{ ids: [...] }`, into the first |
| POST | `/items/:id/stories/:storyId/split` | draft | `{ parts: [{ title, criteria }] }`, at least two |
| POST | `/items/:id/stories/:storyId/handoff` | (the engine's rule) | The story's Design handoff, people only |

Every write is audited by the host and emits `design.<part>_drafted`, `design.requirement_accepted`,
`design.interface_changed`, `design.features_changed`, `design.stories_changed`, `design.story_handed_off`.

## The lifecycle (`nooblyjs-ai-host/src/lifecycle/`)

- `syncStories({ itemId, stories, actor })` (service): creates each story the item does not have as an item `{ id:
  STORY-031-1, type: story, ref, title, system: 'factory', parentId, feature, team, owner, stage: design }`, updates
  the title and feature of those still in Design, and withdraws (`status: withdrawn`, with the reason) those in Design
  that are no longer listed. Emits `item.created` / `item.withdrawn`; nothing else.
- `handoffStory({ storyId, workItems, note, override, actor })`: the story's `design-handoff` approval, opened and
  decided by the person (`openAndDecide`), with Design's readiness. `MOVES` takes it to Engineer.
- After any stage move of a story, `followStories(parentId)`: while any story is in Design the item stays; otherwise
  its stage is the earliest of its active stories', moved on record (`history kind: 'stories'`, audit
  `item.followed_stories`, no stage event, so Metrics counts no handoff).
- `advance`, `handoff` (the item's Design handoff) and the item's own decisions refuse an item with stories
  (`per_story`).
- `readinessOf`: an item in Design (or a story) asks `host.service('design').readinessFacts(itemId)` (the parent's, for
  a story) for its results; the `design` checks are built in (`config.js`) when `readiness.yaml` has none.
- `views.item`: `stories: { total, handedOff, text, rows }` on an item with stories; `parent` and `feature` on a story.

## The Factory

- `SECTIONS`'s Design entry: `register: registerDesign`, `nav: [the Product section's Architecture row, ...DESIGN_NAV]`
  and no `scope`. The browser's route table gives the Architecture routes `scope: 'product'` (per route), so they keep
  drawing the Product section's pages under `/design`.
- `provides: { product, design }`; the status card gets a Design line ("2 items in Design · 1 story handed off").

## Tests

- `nooblyjs-ai-factory/design/test/`: the section on the stand-in host with fake `product`, `workflows`, `platform`,
  `teammates` and `knowledge` services: drafting each part, accept (agent refused, audited), the readiness facts,
  merge and split, ids never reused, the handoff call.
- `nooblyjs-ai-host/test/lifecycle/stories.test.js`: `syncStories`, the per-story handoff, following the stories, the
  refusals.
- `nooblyjs-ai-host/test/design.test.js`: the test script in the real app, steps 1–5.
