# Phase 8 — Knowledge Repository: requirements

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-08-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 8. Goal: one searchable, cited memory that agents use when they
> draft, with the L0 process model rendered from imported data. Repos: `nooblyjs-ai-knowledge` (the Wiki Platform,
> hosted at `/wiki`), `nooblyjs-ai-host` (the service name, the e2e story), `nooblyjs-ai-product` (drafts that cite).
>
> This one spec covers all the repos. Each task in `tasks.md` names its repo. The Wiki Platform's own design
> (spaces, filing, the search indexer, AI chat, the generated frame UI) is in its `CLAUDE.md`, and stays as it is.

## Where the phase starts

`nooblyjs-ai-knowledge` is the existing Wiki Platform. It is already hosted in the frame at **`/wiki`** (rail name
"Wiki"): its CommonJS modules run unchanged behind an adapter (`src/hosted/`), its standalone UI is generated into
the frame's shape (`npm run port:ui`), and its admin screens (Spaces, Repositories, Agents, …) are at
`/wiki/datasources/…`. Its hosted tests pass (19 of 19).

Already there, and used as it is:

- **Spaces**, each a folder of Markdown behind a filing provider (local or git), and a page tree to browse and edit.
- **Search** over every space (`searchIndexer`), with per-space visibility rules.
- **Ask with sources**: `POST …/ai/chat/search` searches, summarises the top hits and answers with numbered
  citations `[1] [2]` and a sources list. It needs an AI agent configured on the Agents screen.
- **Reviews** of a page by a named reviewer (a `reviews` block in the page), comments, annotations, linked documents.
- The Product Factory already expects Knowledge: it calls `host.service('knowledge')?.contextFor({ itemId })`
  when it drafts, a spec has **Linked knowledge**, and it listens for `knowledge.answer_flagged`.

Not there yet:

- No way to **import an export folder**, and nothing that says where a space's content came from or when.
- **Personal data is stored as it arrives.**
- With no AI agent configured, asking fails ("AI service not configured"), so nothing can be tested offline.
- An answer cannot be **added to an item**, **saved as a page** or reported as **wrong**; nothing flags a
  document for review because of an answer.
- No **process model** viewer.
- `register()` returns no `services`, and the app's name is `wiki`, so `host.service('knowledge')` is undefined.
- Drafts do not cite knowledge.

## Decisions taken before starting

Answered by Stevie on 2026-10-10 unless marked.

| Question | Answer |
| --- | --- |
| Where the phase's features are built | **In the wiki's own modules** (CommonJS, its routes, its screens), not in a new layer beside it |
| Mount path | **`/wiki` stays.** The roadmap, steering docs and test script say `/wiki` from now on |
| Where the content comes from, and the process-model codes | **A sample export I write** for the PRD-031 story: runbooks, a policy, a code note, ADRs and an L0 → L1 → L2 process model. Codes and names in the model are `[PLACEHOLDER]` sample data. Real data comes later through the same folder format |
| Search | **Already works. Not changed in this phase.** No semantic search, no new index |
| What "ingest" means for redaction (mine) | Content that arrives from outside: an **import**. A person editing a page in the wiki is not redacted (a contacts page would be destroyed) `[CONFIRM]` |
| What is redacted (mine) | Email addresses, phone numbers and South African ID numbers, replaced with `[REDACTED EMAIL]`, `[REDACTED PHONE]`, `[REDACTED ID]`. Names are not: that needs a model, and a list of who may be named `[CONFIRM]` |
| Asking with no model configured (mine) | The answer is **the matching passages from the top sources, with the same numbered citations**, and says plainly that no model wrote it. This is what the offline tests and a fresh `npm start` show |
| Which model answers when one is configured | The wiki's own Agents, as today. Moving them behind `nooblyjs-ai-common` and Teammates billing is **not** in this phase (see Out of scope) |
| Where the new records are kept (mine) | JSON files under `data/wiki/knowledge/` (`sources.json`, `answers.json`, `flags.json`), written atomically, like the rest of the wiki's records. The wiki's move to Markdown and YAML is not in this phase |
| Where "Sources" and "Needs review" live (mine) | Two new screens beside Spaces and Repositories, at `/wiki/datasources/sources` and `/wiki/datasources/needs-review` |
| How the process model is stored (mine) | Markdown pages in the Enterprise Space, each with a fenced `process-model` block of `key: value` lines (`level`, `code`, `band`, `parent`, `order`, `linked-items`), the way the wiki already keeps reviews and linked documents in a page. The wiki has no front matter. The wiki draws the block as the model: bands and chevrons on L0, children below |
| "Used across NooblyJS" (mine) | The model page's own `linkedItems` (imported data), each resolved to its title and link through the Product Factory and the lifecycle engine when they are running |

## Requirements

### R1 — Import, with personal data redacted
1. An Owner SHALL be able to import an export folder: each top-level folder becomes (or updates) a space, and its
   Markdown files are written through the space's filing provider and indexed for search.
2. Before a file is stored, email addresses, phone numbers and ID numbers in it SHALL be replaced with a marker.
   The original SHALL not be written anywhere, including logs.
3. Each import SHALL be recorded as a **source**: its name, where it came from, when it last ran, its state in
   words, how many documents it wrote per space, and how many values it redacted.
4. Importing the same folder again SHALL update the same source and spaces, not duplicate them.
5. The seed SHALL import the bundled sample export, so a fresh NooblyJS has an Enterprise Space and a Acme Space.
6. An import SHALL be refused for anyone but an Owner, and is audited.

### R2 — Sources screen
1. `/wiki/datasources/sources` SHALL list every source with its state, last run, document counts and redaction
   count, and offer **Import again** to an Owner.

### R3 — Cited answers that work offline
1. Asking SHALL work with no AI agent configured: the answer is built from the top sources' matching passages,
   with numbered citations, and says no model wrote it.
2. Every answer from search SHALL be kept (question, text, sources, who asked, when) and SHALL have an id.
3. Nothing a person could not open in the wiki SHALL be used as a source (the existing visibility rules).

### R4 — Answer actions
1. **Add to item**: a person with `draft` SHALL be able to link an answer's sources to a spec (PRD-031's Linked
   knowledge). Sources already linked are not duplicated.
2. **Save as page**: the answer SHALL be saved as a page in a space the person can write to, with its sources.
3. **This is wrong**: the report SHALL be recorded against the answer, each cited document SHALL be flagged for
   review with the reason, and `knowledge.answer_flagged` SHALL be emitted so specs that link those documents say so.
4. An agent SHALL NOT be able to do any of the three.

### R5 — Needs review
1. `/wiki/datasources/needs-review` SHALL list flagged documents with why, who reported it and when, and a
   **Reviewed** action for a person with `approve` that clears the flag. Its count is the nav badge.

### R6 — Process model
1. A page with a `process-model` block SHALL be drawn with its place in the model: for L0, the three
   bands (Enterprise, Value chain, Support) with a chevron per L1 process, in the order the data gives.
2. Clicking a chevron SHALL open that L1 page, which lists its L2 children, and so on down.
3. The page SHALL show **Used across NooblyJS**: its linked items, with titles and links where NooblyJS knows them.
4. Opening the model's URL directly, and refreshing, SHALL land on the same page.

### R7 — Knowledge for agents
1. `register()` SHALL return `services`: `contextFor({ itemId, query, limit })` (documents with a passage and a
   link, from search), `search`, `flagged()` and `status()`.
2. `host.service('knowledge')` SHALL resolve to them, whatever the app's mount path or name.
3. A Product Factory draft SHALL carry the knowledge documents it was given as its sources, and they SHALL be
   added to the spec's Linked knowledge when the draft is applied. With no Knowledge running, drafting works as before.

### R8 — Hosted-app checklist and accessibility
1. `nooblyjs-ai-knowledge` SHALL pass the hosted-app checklist at `/wiki`.
2. The new screens and the process model SHALL pass axe (WCAG 2.2 AA) and work at phone width.

## Out of scope (named so nobody expects them)

- Moving the app to `/knowledge`, or rebuilding the wiki's pages on the UI kit's components.
- Semantic search, embeddings, a new index.
- The wiki's Agents going through `nooblyjs-ai-common` and Teammates (checks, billing, attribution). Today the wiki
  calls its configured provider directly, which the governance rules allow in development only.
- Connectors (GitHub, Confluence, Jira, Zendesk, Google Drive) and scheduled syncs. A source is a folder.
- Collections with counts, the Graph, Contributions and Access screens from the mockup.
- Freshness rules ("14 months old", "contradicts merged code"). A document needs review only when someone says
  an answer from it was wrong.
- Pin, Share, Subscribe and Rebuild context on a model.
- The wiki's storage moving from JSON files to Markdown and YAML.
