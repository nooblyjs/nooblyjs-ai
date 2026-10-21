# Phase 16d — Engineering: design

> **Status: built 2026-10-20, waiting for review.** Requirements: `requirements.md`. Summary: `docs/phases/phase-16d-summary.md`.

## Where it lives

| Place | What |
| --- | --- |
| `nooblyjs-ai-factory/src/services/engineering/` | `repo-reader.js` (a repository's files, text and head: local git from `repos.yaml`, else devtools), `code-map.js` (pure: the modules, their exports and imports, and the scripted draft), `architecture.js` (the files, drafting as a teammate task, edit, accept, staleness, the sign-off's facts, a work item's context), `views.js` (the route table rows), `samples.js` (CHG-008's runs and defects) |
| `nooblyjs-ai-factory/quality/` | The Test section: `register()`, `NAV` (Test analysis, in the Engineering group), `src/` (repo, policy, drafts, analysis, routes, seed), `test/`; pages in `public/quality/` |
| `nooblyjs-ai-factory/src/services/sections.js`, `public/js/sections.js`, `src/services/hosted.js` | The Test section mounted; a section whose rows go *within* the Factory's own groups (`place: 'within'`), placed after Application architecture |
| `nooblyjs-ai-factory/src/services/intake/handoff.js` | A work item's issue gets its architecture and test cases |
| `nooblyjs-ai-host/src/lifecycle/` | The `engineer` readiness checks, from `host.service('factory').engineeringReadiness`; `signOffEngineering` |
| `nooblyjs-ai-host/src/services/for-you.js`, `public/js/pages/home/for-you-design.js` | The Application Architect and Test analyst homes |

## The data

```
data/factory/engineering/architecture/<storyId>.md    { storyId, itemId, title, systems: [{ name, repo, status: proposed | accepted,
                                                          readAt: { branch, commit, source: local | bitbucket | design }, flow: [text],
                                                          objects: [{ name, kind, fields, note }], nfrs: [{ component, requirement, target, from }],
                                                          changes: [{ kind: new | changed, path, what }], modules: [path], draftedBy, editedBy,
                                                          acceptedBy, acceptedAt }] }
data/factory/quality/test-policy.yaml                  levels per kind of criterion, interface, journey and NFR
data/factory/quality/test-analysis/<storyId>.md        { storyId, itemId, title, criteria: [{ text, cases }], cases: [{ id, criterion, title,
                                                          given, when, then, level, automate, systems, interface, journey, status,
                                                          readyBy, readyAt }], counter, draftedBy }
```

## The scripted architecture draft (code-map.js)

From the repository at its head: every `.js`/`.mjs`/`.ts` file outside `test/` and `node_modules/` with its exports
(`export const|function|class`, with parameters) and relative imports. The modules whose names or exports share words
with the story (title, criteria, technical requirement for the system) are the ones it changes; with none, it adds a
module named after the story next to the existing ones, with a test in the repository's test folder. The flow names
the entry (the new or changed module), what it calls among the existing exports, and what it returns. The objects are
each touched export's noun and its parameters (`formatSlot(start, end)` → Slot: start, end) and the story's interface
contracts. The NFRs per component are the story's NFRs on the module they concern.

## The scripted test analysis draft (quality drafts.js)

One case per criterion (its given/when/then; E2E when a customer sees it, else integration), a contract case per
interface (its two sides), an E2E case for the story's journey (its feature), and a case per NFR the policy names
(accessibility: by a person; performance: a load test). Each case runs against the story's systems (a contract case
against the interface's sides that are systems).

## The sign-off

`readiness.yaml` `engineer`: `architecture-accepted`, `criteria-ready`, `interfaces-tested`. The lifecycle engine asks
`host.service('factory').engineeringReadiness(itemId)`; null (an item with no Engineering work) means no checks.
`signOffEngineering({ itemId, override, comment, actor })` is the engine's advance from Engineer, refused anywhere else.
