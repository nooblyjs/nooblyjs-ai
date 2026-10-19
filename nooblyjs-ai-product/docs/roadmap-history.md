> **History, not a plan (2026-10-11).** NooblyJS keeps one roadmap: `../.claude/steering/roadmap.md`. This file is
> how this repo was built before that; what was still open here is in that roadmap under "Hosted apps: open work".

# Product Factory engine: roadmap

> The order `nooblyjs-ai-product` is built in. The whole repo is delivered inside **NooblyJS Phase 5
> (Product Factory)**, `../.claude/steering/roadmap.md`, so the phases below are
> **sub-phases** of that one NooblyJS phase, plus a follow-on that lands with NooblyJS Phase 6.
> Scope comes from `product.md`, the how from `tech.md`, the where from `structure.md`. If this
> file disagrees with the NooblyJS roadmap, **NooblyJS wins**.

---

## How we work through a phase

1. **Decisions first.** Every item marked 🔶 needs an answer before the build starts. Each one
   has a proposed default.
2. **Build** in small PRs, each with tests (`npm test`, offline, mock provider). Nothing outside
   the phase's scope is built.
3. **Check** with the phase's *How you check it* steps. Until the NooblyJS screens exist, check the
   API standalone (`npm start`, dev sign-in) with `curl` or the REST client of your choice. Once
   the screens exist, check through NooblyJS (`npm start` in `../nooblyjs-ai-host`, then `/product`).
4. **Review and steer**, then tick the phase in the tracker. The next phase starts only when
   this one is ✅.

Legend: ✅ done · ⬜ to do · 🔶 decision needed · 🔗 depends on another repo

### Tracker

| Phase | Name | Lands with | Status |
| --- | --- | --- | --- |
| P0 | Scaffold and hosted-app contract | NooblyJS Phase 5 | ✅ |
| P1 | Data, seed and read APIs (Product board, Spec) | NooblyJS Phase 5 | ✅ |
| P2 | Stage 1 writes: opportunities, specs, decisions | NooblyJS Phase 5 | ✅ |
| P3 | Drafting pipeline (mock agents) and governance | NooblyJS Phase 5 | ✅ |
| P4 | Architecture | NooblyJS Phase 5 | ✅ |
| P5 | UX design | NooblyJS Phase 5 | ✅ |
| P6 | UI design, handoff preview and Send to Software Factory | NooblyJS Phase 5 | ✅ |
| P7 | Flow, send-back and cross-NooblyJS surfaces | NooblyJS Phase 5 | ✅ |
| P8 | Real drafting agents | NooblyJS Phase 6 | 🔗 engine side done; waits on Teammates and nooblyjs-ai-common |

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─┬─▶ P4 ─▶ P5 ─▶ P6 ─▶ P7      (NooblyJS Phase 5 closes here)
                      │
                      └──────────────────────────▶ P8   (NooblyJS Phase 6)
```

P4–P6 follow the item through the stages, so each one reuses the drafting pipeline from P3
rather than building its own.

### Dependencies on other repos 🔗

| Needs | From | Status today | If it isn't there yet |
| --- | --- | --- | --- |
| `createShell()`, FsStore, UI kit | `nooblyjs-core` (NooblyJS Phases 0–1) | ✅ | — (used by `server.js`) |
| `workflows` service: items, approvals, handoffs, `item.stage_changed` | the lifecycle engine (part of `noobly`, `src/lifecycle/`) (NooblyJS Phase 2) | ✅ | Use the fake `workflows` in `test/fixtures/host.js`; decisions return `503 workflows_unavailable` standalone |
| `teammates.runTask()` | `nooblyjs-ai-teammate` (NooblyJS Phase 6) | available since 2026-10-10 | Mock / scripted drafts (P3) |
| `knowledge.contextFor()` | `nooblyjs-ai-knowledge` (NooblyJS Phase 8) | ☐ | Seeded citations; drafts say "no knowledge available" |
| The NooblyJS frame and UI kit | `nooblyjs-core` | ✅ | — (this repo owns its screens since 2026-10-09) |

---

## Before you start (answer once, for the whole repo)

These are the open points in `product.md` §8 and `structure.md`. Proposed defaults are in
brackets; tick or change them before P0.

- 🔶 **D1 · API shape.** Is the `structure.md` §3 API the one to build? It is marked "a proposal
  to settle in the Phase 5 spec". *[Yes, settle it in `.claude/specs/phase-05-product-factory-engine/`
  during P0 and freeze it at the end of P1.]*
- 🔶 **D2 · Diagram-as-code format** (NooblyJS §12 Q7): Structurizr DSL (C4), Mermaid, or other.
  *[Mermaid C4: renders in the browser with no build step and diffs well in Markdown. Needed by P4.]*
- 🔶 **D3 · Auto-draft vs wait for a brief.** Which stage entries start drafting automatically on
  `item.stage_changed`? *[None automatically in Phase 5. Every stage opens in **Awaiting your
  brief**, which also keeps spend predictable. Revisit in P8.]*
- 🔶 **D4 · Stage numbering.** Show "Stage 1–4" or the NooblyJS lifecycle numbers 1–5? This is a
  screen question, but it decides whether the API returns a `pfStage` field. *[Return both; the
  screens choose.]*
- 🔶 **D5 · Handoff repo count.** The preview says "3 repos" for six work items across four
  (slots-api, web-storefront, mobile-app, design-system). *[Compute the count from the work
  items (4); treat the mockup's "3" as a typo. Needed by P6.]*
- 🔶 **D6 · Where the check rules live.** `standards.yaml` and `accessibility.yaml` under
  `data/product/` or under `data/platform/` (guardrails)? *[`data/product/`, read-only through
  the API in Phase 5; editing moves to NooblyJS Phase 9 Platform and governance.]*
- 🔶 **D7 · Figma** (NooblyJS §12 Q11). *[Out of scope for this roadmap; "Open in canvas" returns a
  placeholder link.]*

---

## P0 — Scaffold and hosted-app contract ✅

**Goal:** an empty but correct hosted app. NooblyJS mounts it at `/product`, it answers only when
signed in, and it runs standalone through the same `register()`.

- ✅ **0.1 Kiro spec.** `.claude/specs/phase-05-product-factory-engine/` with requirements, design and
  tasks. It records D1–D7 and the agreed API.
- ✅ **0.2 `package.json`** as in `tech.md` §9.1 (ES modules, `main`/`exports`, `engines.node >= 22.12`,
  `js-yaml` plus `file:../../nooblyjs-core`, `file:../nooblyjs-ai-common` (`nooblyjs-ai-common`), `file:../nooblyjs-ai-harness`, and
  `express` for `server.js` only). Scripts: `start`, `test`, `seed`.
- ✅ **0.3 `index.js` → `register()`.** One router at `mountPath`; `/api/v1` behind `host.auth`;
  `next()` for everything else; nooblyjs-core services from `serverManager`; returns
  `{ name: 'product', label, icon, mountPath, services, seed, close }` with no UI, nav or status.
  Fails cleanly, leaving nothing half-mounted.
- ✅ **0.4 `server.js`** standalone: own Express 5 app, `serverManager`, `createShell()`, dev
  sign-in, store at `./data/product`, then the same `register()`.
- ✅ **0.5 `src/util/`**: `ids.js` (`OPP-`, `PRD-`, `ADR-` and `<prefix>_<random>`), `errors.js`
  (the one error shape with 400 / 401 / 403 / 404 / 409 / 422), `md-table.js`.
- ✅ **0.6 `test/fixtures/host.js`**: a stand-in host with exactly the `tech.md` §2 shape, plus
  fake `workflows`, `teammates` and `knowledge` services.
- ✅ **0.7 `test/register.test.js`**: mount path, 401 signed out, 403 plus audit record for a
  missing role, nothing written outside `dataDir`, `close()` stops everything, a throwing
  `register()` leaves the host running.
- ✅ **0.8 NooblyJS wiring** 🔗: add `product` to `../nooblyjs-ai-host/data/config/hosted-apps.yaml`.

**How you check it**
1. `npm test` is green.
2. `npm start` here: `GET /product/api/v1/board` signed out returns 401 with the error shape.
3. `npm start` in `../nooblyjs-ai-host` logs `mounted product at /product`; `/api/v1/shell` lists it.
4. Set `enabled: false` in `hosted-apps.yaml`; NooblyJS still starts.

**Done when:** hosted-app checklist steps 1, 2, 5–9 and 12 pass (P0 had no UI yet; since the screens moved here, all 12).

> **Done 2026-10-09.** 21 tests green. Checked standalone (`npm start`, port 11005) and through NooblyJS: `mounted product at /product`, listed by `/api/v1/shell` as API-only, 401 signed out, a Contributor refused and audited. Decisions D1–D7 were taken as their proposed defaults and still need your sign-off; P0 added two routes (`GET /about`, `POST /seed`, Owner only, never in production) so the contract can be checked before any product API exists. Details and open points: `.claude/specs/phase-05-product-factory-engine/`.

---

## P1 — Data, seed and read APIs (Product board, Spec) ✅

**Goal:** the Product board and Spec detail screens can be built against real data. Everything
is read-only, and the PRD-031 story is seeded.

- ✅ **1.1 Repos over `host.store`** for signals, opportunities, specs (with `versions/`) and the
  roadmap, using the `structure.md` §4 layout. Front matter in camelCase.
- ✅ **1.2 In-memory projections** rebuilt from files at start (board columns, counts per
  domain, top signals). Never the source of truth.
- ✅ **1.3 Seed** (`seed({ reset })`, `npm run seed -- --reset`): the four signals, OPP-018 and the
  other opportunities, PRD-025/027/029/031/032, PRD-031 at v4 with readiness inputs (6 of 7),
  reviewers, linked knowledge, and `roadmap.yaml`. All sample data, nothing hard-coded in code.
- ✅ **1.4 Read APIs:** `GET /board?portfolio=&product=&mine=` (portfolios and products replaced domain on 2026-10-10)
  — originally `GET /board?domain=&mine=` (five columns with counts, filter counts, top
  signals, Q4 roadmap), `GET /signals`, `GET /opportunities`, `GET /specs`, `GET /specs/:id`,
  `GET /specs/:id/versions`, `GET /roadmap`. Every status comes with words, not just a code
  ("Awaiting your brief", "2 of 3 reviewers approved").
- ✅ **1.5 Services** for other apps: `artefactsFor(itemId)` and `summary(person)` (agents on duty,
  monthly spend; spend reads 0 until P3).
- ✅ **1.6 Route tests** (`test/routes/*.test.js`, port 0 + `fetch`) asserting the seeded board
  matches `product.md` §5.1.

**How you check it**
1. `npm run seed -- --reset`, then open `data/product/` and read PRD-031 as a file.
2. `GET /board` returns Signals (4), Opportunities (3), Spec drafting (2), In review (2),
   To architecture (2). `?product=Delivery` narrows it (was `?domain=` before 2026-10-10).
3. `GET /specs/PRD-031` returns v4, "Drafted by Ada Quill · edited by Lerato M.", and readiness facts.

**Done when:** the board and spec responses carry everything the two mockups show, and the API
shape (D1) is frozen in the Kiro spec.
**Guide points:** Is anything on the board or spec mockups missing from the responses?

> **Done 2026-10-09.** 51 tests green; checked standalone. D1 (API) and D4 (both stage numberings) taken. Changes
> from the plan: 1.2 builds the board from the files on each request instead of keeping an in-memory projection
> (always fresh, cheap at this size); `GET /opportunities/:id` added. New decisions to confirm: "Mine" = items you
> own plus reviews still waiting on you (D10), and the seed domains of two signals (D12). Until the lifecycle engine (part of `noobly`, `src/lifecycle/`)
> exists, an item's stage comes from its artefact's status (D11).

---

## P2 — Stage 1 writes: opportunities, specs, decisions ✅

**Goal:** a person can work Stage 1 end to end by hand: signal → opportunity → spec → approval
request, with the approval itself recorded by the lifecycle engine (part of `noobly`, `src/lifecycle/`).

- ✅ **2.1 Signal → opportunity**: `POST /signals/:id/opportunity` creates `OPP-nnn` linked to the
  signal. Emits `opportunity.created`.
- ✅ **2.2 RICE**: `src/services/rice.js` with `POST/PUT /opportunities` storing reach, impact,
  confidence and effort, and returning the score. Emits `opportunity.scored`. Validation errors
  return 422 with field details.
- ✅ **2.3 Specs**: `POST /specs`, `PUT /specs/:id` with `If-Match` (409 on conflict). Every save is a
  new version (`edited by` a person); earlier versions move to `versions/v<N>.md`. Emits
  `spec.created` / `spec.updated`.
- ✅ **2.4 Linked knowledge**: `PUT /specs/:id/knowledge` (typed: runbook, ADR, customer insight).
- ✅ **2.5 `readinessFacts(itemId)` service**: the facts the lifecycle engine's readiness rules check
  (has goals, has acceptance criteria, has rollout plan, cites knowledge, …). This engine
  supplies facts; it does not decide readiness.
- ✅ **2.6 Spec decision** 🔗: `POST /specs/:id/decision` (**Request changes** / **Approve & send to
  Architecture**), people only, Approver+. Passed to `host.service('workflows')`. Never moves the
  stage itself. 503 when workflows is missing.
- ✅ **2.7 Governance tests** (`test/governance.test.js`): an agent actor calling `/decision` is
  refused and audited; a Contributor is refused.

**How you check it**
1. As Lerato, turn "Substitutions feel random" into an opportunity and score it. It appears in
   Opportunities with its RICE score (NooblyJS Phase 5 test step 1).
2. Edit PRD-031 twice with the same `If-Match`. The second save returns 409.
3. As Priya (Contributor), approve PRD-031. Refused, and the refusal is in the audit log.

**Done when:** steps 1–3 pass and every write is audited.
**Guide points:** Are the RICE inputs and the readiness facts the ones your PMs use?

> **Done 2026-10-09.** 71 tests green; steps 1–3 checked standalone. Decisions taken (to confirm): agents are
> actors with `kind: 'agent'` (D13); the `workflows.decide()` call and the `approval.decided` payload (D14);
> readiness recomputed from the content on every save (D15); a write without If-Match is a 428 (D16). Inside
> NooblyJS, approving answers 503 until the lifecycle engine (part of noobly) exists (NooblyJS Phase 2): nothing is changed.

---

## P3 — Drafting pipeline (mock agents) and governance ✅

**Goal:** "Ask the agent to draft" works for specs with progress, cost and attribution. The same
pipeline is reused for every later stage.

- ✅ **3.1 `POST /specs/:id/drafts`** → `202 { draftId }`. Records `data/product/drafts/<id>.md`
  (who asked, teammate, stage, status, cost).
- ✅ **3.2 Budget check** before queueing: at the Product Factory monthly budget the draft is
  refused, `budget.reached` is emitted, and agent work pauses.
- ✅ **3.3 `workers/drafting.js`** on `serverManager.queue()`: gets context from `knowledge` (if
  present), runs the task through `teammates.runTask({ workType: 'spec-drafting', … })` or a
  scripted mock when `teammates` is missing, and reports progress ("Ada Quill drafting · 64%")
  as events.
- ✅ **3.4 Saving a draft** as a new version (`draftedBy`, `version + 1`). A draft never overwrites
  a person's newer edit (`If-Match`), and never edits a version a person has approved. Emits
  `spec.drafted` and `agent.action` with `{ actor, teammateId, itemId, system: 'product',
  modelRoute, costUsd, at }`; `draft.failed` on error.
- ✅ **3.5 Awaiting your brief**: a spec-drafting card stays in this state until a person briefs
  the agent (D3).
- ✅ **3.6 Readiness actions**: each failing readiness fact offers exactly one draft action ("Ask
  Ada to draft rollout"), which uses the same pipeline.
- ✅ **3.7 Cost roll-up**: "Agent cost so far $7.40 · Research + 4 drafts" per item, and monthly
  spend in `summary(person)`.
- ✅ **3.8 Refuses tests**: agent approves, agent accepts an ADR, agent sends to Factory, drafting
  over budget, draft over a newer human edit.

**How you check it**
1. Ask Ada to draft a spec for OPP-018. The card moves to Spec drafting with progress, then to
   In review as a new version (NooblyJS Phase 5 test step 2).
2. On PRD-031, click the rollout-plan action; readiness becomes 7 of 7 at v5.
3. Lower the budget below current spend in the fixture; the next draft is refused with a reason.

**Done when:** steps 1–3 pass offline with the mock provider, and every refuses test is green.
**Guide points:** Is the progress and cost wording right? Should any stage draft automatically (D3)?

> **Done 2026-10-09** (offline, mock provider; 79 tests then). One pipeline for every stage
> (`services/drafting.js` on nooblyjs-core's queue, kinds in `services/draft-kinds.js`); scripted mocks write marked
> `[PLACEHOLDER]` content and never invent evidence. A finished draft stays in Spec drafting until a person asks
> for review. The budget is `data/product/budget.yaml` ($1,500 sample) until the platform shares one. Refuses
> tests for accepting an ADR and sending to the Factory arrive with P4 and P6, where those actions are built.

---

## Screens moved into this repo (2026-10-09) ✅

At your request the Product Factory now **owns its views**, like Teammates: `register()` returns `ui`, `nav` and
`status`; the pages are `public/js/` (a UI module in the NooblyJS frame) with scoped `public/css/product.css`. NooblyJS's
built-in Product placeholder app is retired, and `nooblyjs-ai-product` is listed first in `hosted-apps.yaml` so the
rail stays Home, Product, Factory, …

- Built: **Overview**, **Product board** (tabs, filters with counts, kanban with "Make it an opportunity", New
  opportunity, Top signals, Q4 roadmap), **Specs**, **Spec detail** (body, Where this is, Readiness with its agent
  action and live draft progress, Linked knowledge, Reviewers, Versions, Approve / Request changes, brief the agent),
  **Reviews**. Architecture, UX Design, UI Design and Handoffs say which phase builds them (P4–P7).
- Checked: NooblyJS's unit tests (incl. `test/product.test.js`) and its Playwright e2e suite (axe on every nav page,
  no sideways scroll at 375px, no reload when moving between apps). Found and fixed a NooblyJS shell bug on the way:
  a nav badge's hidden text widened the page at phone width (`nooblyjs-core` `shell.css`, `.nav { position: relative }`).
- Not yet: editing a spec's text on the page (the API supports it), scoring RICE on the page, live updates from the
  host's event stream (pages refresh after their own actions and poll a running draft).

## P4 — Architecture ✅

**Goal:** once a spec is approved, the Architecture stage has a container view as code, ADRs
with people-only acceptance, a standards check and quality attributes that become Factory gates.

- ✅ **4.1 React to `item.stage_changed`** 🔗 into Architecture (prepare the stage; draft only if D3 says so).
- ✅ **4.2 Diagram as code** (D2): `GET/PUT /architecture/:itemId/diagram` with `If-Match`, nodes
  marked New / Existing / External, labelled edges, and a provenance line. Emits
  `architecture.diagram_updated`.
- ✅ **4.3 ADRs**: `GET/POST /architecture/:itemId/adrs` (proposed, with `addsDependency`),
  `POST /adrs/:id/accept` (Architect+, people only) and `POST /adrs/:id/discuss`. Emits
  `adr.proposed`, `adr.accepted`. Superseding an ADR keeps the old one.
- ✅ **4.4 Standards check** (`standards.yaml`, D6): approved stack only, customer data in-region,
  every API has a contract, a new dependency needs an ADR. Each result is pass/fail with words.
- ✅ **4.5 Quality attributes**: `GET/PUT /architecture/:itemId/quality-attributes` (attribute,
  scenario, target, verified by), exposed through `artefactsFor()` so the lifecycle engine (part of `noobly`, `src/lifecycle/`) and the
  Software Factory can treat them as **gates on every PR**.
- ✅ **4.6 Drafting** of the container view and ADRs by Rhea Voss through the P3 pipeline
  (`workType` for architecture `[CONFIRM name]`).
- ✅ **4.7 Seed**: ADR-009, ADR-013, ADR-014 (proposed, adds Redis), ADR-015, the PRD-031 diagram
  and the four quality attributes.

**How you check it**
1. Approve PRD-031 → Architecture shows the container view. Edit as code, change a label, save;
   the diagram updates (NooblyJS Phase 5 test step 3).
2. As an agent actor, accept ADR-014: refused. As Thabo, accept it: accepted and audited, and
   the standards check now passes "new dependency needs an ADR".
3. The item's gate list shows the four quality attributes (NooblyJS Phase 5 test step 4).

**Done when:** steps 1–3 pass.
**Guide points:** Is the diagram format (D2) easy for your architects to edit? Are these the right standards?

> **Done 2026-10-09**, API and screen together. The container view is a subset of Mermaid C4 in
> `architecture/<PRD>/diagram.md` (D2), drawn by the screen in layers (callers first) with New / Existing /
> External; Edit as code refuses mistakes line by line. ADR numbers are global; accepting is Architect+ and people
> only, and superseding marks the old ADR. The standards check reads `data/product/standards.yaml` (D6). Quality
> attributes reach other apps through `artefactsFor().architecture.gates`. Rhea Voss drafts the container view and
> proposes the ADR a new store needs. An item entering Architecture (`item.stage_changed`) shows on the list;
> nothing drafts by itself (D3). Checked: 9 API tests, NooblyJS test, e2e (axe, 375px).

---

## P5 — UX design ✅

**Goal:** the UX Design stage holds the journey, flows, research and open questions.

- ✅ **5.1 Journey**: `GET/PUT /ux/:itemId/journey` with steps × **Doing / Feeling / Pain /
  Opportunity**. An opportunity can be marked out of scope and linked to another PRD (PRD-033).
- ✅ **5.2 Flows**: `GET/PUT /ux/:itemId/flows/:flow` (screens and decisions, e.g. 5 screens · 1 decision).
- ✅ **5.3 Research**: `GET/PUT /ux/:itemId/research` (usability and preference studies with participant counts).
- ✅ **5.4 Open questions**: `GET/PUT /ux/:itemId/questions`, each with a **Run a quick test** action
  that uses the drafting pipeline `[CONFIRM what a quick test produces]`.
- ✅ **5.5 Drafting** of journey and flow by the design agent; emits `ux.journey_drafted`.
- ✅ **5.6 Seed**: the evening-shopper journey, "choose and hold a slot" flow, two studies and the open question.

**How you check it**
1. `GET /ux/PRD-031/journey` returns the five steps and four rows, with the PRD-033 out-of-scope link.
2. Ask the design agent to draft a flow; it arrives as a new version, attributed and costed.

**Done when:** steps 1–2 pass and the UX Design mockup's content is all in the responses.
**Guide points:** Does the journey shape match how your designers work?

> **Done 2026-10-09**, API and screen together. Journey, flows, studies and questions are front matter in
> `ux/<PRD>/…` so they read as files; each edit is a version with If-Match. The design agent (a placeholder name,
> D21) drafts a journey or a flow from a brief, and "Run a quick test" adds a study linked to its question.
> Checked: 7 API tests, e2e (axe, 375px). The journey's Feeling row is sample wording: the mockup draws it.

---

## P6 — UI design, handoff preview and Send to Software Factory ✅

**Goal:** the UI Design stage shows screens, design-system reuse and accessibility checks, and a
person can send the item to the Software Factory with a generated work-item preview.

- ✅ **6.1 Screens**: `GET /ui/:itemId/screens` (Mobile / Web / Store console, status per device).
  Emits `ui.screen_updated`.
- ✅ **6.2 Design-system reuse**: `GET /ui/:itemId/design-system` (n of m components reused, new
  components named, design-system version).
- ✅ **6.3 Accessibility checks** (`accessibility.yaml`, D6): contrast ≥ 4.5:1, 44px targets, not
  colour alone, screen-reader labels. The seed fails "Timer needs a screen-reader label".
- ✅ **6.4 Handoff preview**: `GET /ui/:itemId/handoff-preview` generates work items per repo, the
  repo count (D5) and a cost range.
- ✅ **6.5 Send to Software Factory** 🔗: `POST /ui/:itemId/handoff`, people only per the approval
  rules. Passes the decision and the preview to `workflows`, which creates the handoff and the
  work items. This engine creates nothing in `data/workflows/`.
- ✅ **6.6 Drafting** of screens by the UI agent through the P3 pipeline.

**How you check it**
1. Screens show their status, and the checks list the failing "Timer needs a screen-reader
   label" (NooblyJS Phase 5 test step 5).
2. As the Design lead, Send to Software Factory: **6 work items** with the estimate $18–$26 are
   created by the lifecycle engine (part of `noobly`, `src/lifecycle/`), and the item moves to Build (NooblyJS Phase 5 test step 6).
3. An agent actor calling `/handoff` is refused and audited.

**Done when:** steps 1–3 pass.
**Guide points:** Is anything missing from the handoff a developer needs?

> **Done 2026-10-09**, API and screen together. Screens per device in `ui/<PRD>/screens/`, design-system reuse and
> accessibility results in `ui/<PRD>/design.md`, the check rules in `data/product/accessibility.yaml` (D6). The
> preview counts repos from the work items: **4**, not the mockup's 3 (D5). Cost range = work items × $3–$4.33
> (D22, to confirm). Send to Software Factory is Approver+, people only, and calls `workflows.handoff()`; the
> handoff is marked requested *before* the call (so `handoff.created` during the call isn't overwritten) and rolled
> back if the call fails; 503 without the lifecycle engine (part of noobly). Open in canvas is a disabled placeholder (D7). The UI agent
> drafts a screen or the handoff plan.

---

## P7 — Flow, send-back and cross-NooblyJS surfaces ✅

**Goal:** everything around the four stages works: sending back, the Overview / Reviews /
Handoffs screens, and the Product Factory data other NooblyJS screens show.

- ✅ **7.1 Send back** 🔗: returning an item to an earlier stage with a reason goes through
  `workflows`; the engine keeps the artefacts and marks them "Sent back: <reason>".
- ✅ **7.2 Overview, Reviews and Handoffs** data (no mockup; same patterns): a four-stage summary,
  what is waiting for a reviewer (the badge count), and stage-to-stage handoffs including items
  sent back. `[CONFIRM]` whether these are new endpoints or projections over `workflows`.
- ✅ **7.3 Home and For you** data through `artefactsFor()` and `summary()`: Waiting-on-you rows,
  "Ada Quill is working for you · 64%", architecture queue, decisions awaiting sign-off.
- ✅ **7.4 Knowledge re-check**: on `knowledge.answer_flagged`, flag specs that cite that answer.
- ✅ **7.5 Metrics facts** for NooblyJS Phase 10: product lead time, sent-back rate per stage, Product
  Factory spend (events and facts only; the Metrics screen is NooblyJS's).
- ✅ **7.6 End-to-end test**: the six NooblyJS Phase 5 test steps as one automated test against the fixture host.

**How you check it**
1. Send PRD-029 back from In review to Spec drafting with a reason; it shows on Handoffs as sent back.
2. Home · Overview shows the Product Factory card and Waiting-on-you rows from this engine.
3. Run the NooblyJS Phase 5 test script in `../nooblyjs-ai-host` from a fresh `seed --reset`.

**Done when:** the NooblyJS Phase 5 test script passes, every Product Factory screen matches its
mockup, and NooblyJS Phase 5 can be marked ✅.
**Guide points:** Which metrics matter most to product leads?

> **Done 2026-10-09.** `data/product/flow/history.yaml` records every handoff and send-back (Handoffs screen,
> metrics). `POST /specs/:id/send-back` (people only) calls `workflows.sendBack()`; on `item.sent_back` the spec
> reopens and keeps all its work. `knowledge.answer_flagged` flags the specs that cite it. Services for other apps:
> `waitingFor(person)`, `metrics()`, `gatesFor(itemId)`. The board's Insights tab shows lead time, sent-back rate
> and spend. `test/story.test.js` runs the six NooblyJS Phase 5 steps end to end against a fake the lifecycle engine (part of noobly).

---

## P8 — Real drafting agents (with NooblyJS Phase 6) 🔗

**Goal:** replace scripted drafts with real teammate tasks, routed and costed by the platform.

- ⬜ **8.1** 🔗 Drafts run through `teammates.runTask()` for real, by **work type** (spec-drafting,
  architecture, ux, ui `[CONFIRM names]`), with no model ids in code.
- ⬜ **8.2** Routing: spec, architecture and review work on Claude Opus with a Sonnet fallback,
  via Bedrock / Vertex / Azure only. A direct provider API is refused when `NODE_ENV=production`.
- ⬜ **8.3** Drafts cite Knowledge (`knowledge.contextFor()`), and personal data is redacted before
  any agent log is written.
- ⬜ **8.4** Revisit D3: which stages draft automatically, now that real costs are known.
- ⬜ **8.5** Team chat drafting: agents edit spec content from a thread, recorded as a version
  ("spec v5") `[CONFIRM ownership with noobly]`.
- ⬜ **8.6** Opt-in live tests (`*.live.test.js`) for one draft per stage.

**How you check it**
1. With a real provider configured, ask Ada to draft a spec. The draft cites knowledge, and
   `agent.action` records a real `costUsd` and `modelRoute`.
2. Start in production mode with only a direct consumer API configured: drafting is refused.

**Done when:** steps 1–2 pass and the real costs match the teammate's timesheet.
**Guide points:** Is draft quality good enough to keep auto-drafting off, or turn it on?

> **Engine side done 2026-10-09; the rest waits on other repos (NooblyJS Phase 6).** Done here: the `runTask` contract is
> pinned by tests (`test/agents.test.js`: slug, workType, itemId, system, input → output, costUsd, modelRoute; no
> model ids sent); in production a draft without Teammates is refused (503), never mocked; briefs are redacted
> before they are written to disk (`util/redact.js`), and a leak of the brief into the spec's change note was
> found and fixed. **Not done, and can't be from here:** 8.1 needs nooblyjs-ai-teammate to return
> `services.runTask` (it returns no services today); 8.2 needs work-type routing and the Bedrock / Vertex / Azure
> providers in nooblyjs-ai-common (today it has direct providers only); 8.5 needs NooblyJS's team chat (NooblyJS Phase 4);
> 8.6 live tests need both. 8.4 (auto-drafting) is your decision once real costs are known.
