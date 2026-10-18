---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 

# Product Requirements Document — NooblyJS Digital Teammate

| Field   | Value                                   |
|---------|-----------------------------------------|
| Status  | Draft v0.1                              |
| Date    | 2026-10-01                              |
| Owner   | Noobly JS                               |
| Related | [architecture.md](architecture.md), [roadmap history](../../docs/roadmap-history.md), [tech.md](tech.md) (NooblyJS platform rules) |

> **Teammates is part of NooblyJS.** §0 is what NooblyJS needs from Digital Teammates. It was
> extracted from `../nooblyjs-ai-host/.claude/steering/product.md` (the source of truth) and the mockups in
> `../nooblyjs-ai-host/.claude/steering/brief/` (`noobly-teammates-team-roster`, `noobly-teams-bot-*`,
> `noobly-for-you-*`, `noobly-teams-roles`). Sections 1–12 are this app's own product
> definition. Where they conflict with §0, §0 wins. The main differences: models come only
> through Bedrock / Vertex / Azure (FR-2, §5 "Provider"), sign-in and roles belong to NooblyJS
> (FR-9, open question 1), the screens follow the NooblyJS nav (FR-10), billing is hours × rate,
> and accessibility is WCAG **2.2** AA. Numbers in §0 are sample data from the PRD-031 story.

---

## 0. What NooblyJS needs from Digital Teammates

### 0.1 Where Teammates fits

NooblyJS is an engineering-lifecycle platform: AI agents draft and build, and **people
decide**. Digital Teammates is "named agents with skills, memory, rates and timesheets",
and it is **the source of agents across NooblyJS**. Its teammates draft in the Product
Factory, open PRs, index Knowledge, answer in team chat, and join Microsoft Teams meetings.
Every action is **billed to a timesheet and to the right team**.

### 0.2 Screens

Sidebar `teammates`. Nav: **Team roster, Profiles, Work timeline, Team board (§0.7), Billing &
timesheets, Hire a teammate, Team memory, Settings, Admin**. Status card: "October budget · $1,816 of $9,000
used · incl. $748 pending".

**Team roster** (mockup `noobly-teammates-team-roster`):

- Eyebrow "Digital Teammates". Title **"Your digital teammates"**. Summary in words: "Eight
  agents on the team. Four are on a task right now." Action **Hire a teammate**.
- Tiles: **On a task now** (4 of 8, with avatars), **Billed · last 30 days** ($6,814 · 312
  hours across 8 teammates), **October budget** (20% used).
- Filters with counts: Everyone 8 / On a task 4 / Available 2 / Paused 1 / Off shift 1.
- A **card per teammate**: status (On a task / Available / Paused / Off shift), avatar,
  name, role, current task (or "Paused · awaiting brief"), skills, **model with its cost
  tier** (Claude Opus $$$ / Sonnet $$ / Haiku $), hourly **rate**, **billed in 30 days**
  (hours · amount), and **memory** item count. The last card is "Hire a teammate · Pick a
  role, a model and a budget".

  | Teammate | Role | Current task | Skills | Model | Rate | Billed 30 d | Memory |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Ada Quill | Research Analyst | Q4 competitor scan | Deep research, source checking, market sizing | Opus $$$ | $48/hr | 42 h · $2,016 | 5 |
  | Milo Brightwater | Support Lead | Refund queue · 23 open | Ticket triage, refund policy, tone matching | Sonnet $$ | $14/hr | 96 h · $1,344 | 3 |
  | Juno Park | Frontend Engineer | Checkout accessibility fixes | React, accessibility, test writing | Opus $$$ | $52/hr | 38 h · $1,976 | 2 |
  | Otis Fern | Data Wrangler | Dedupe CRM export | CSV cleanup, SQL, deduplication | Haiku $ | $4/hr | 61 h · $244 | 1 |
  | Sable Reyes | Copywriter | Paused · awaiting brief | Brand voice, email campaigns, headlines | Sonnet $$ | $16/hr | 22 h · $352 | 1 |
  | Rhea Voss | Architect | (architecture drafting) | `[PLACEHOLDER]` | `[PLACEHOLDER]` | $52/hr | `[PLACEHOLDER]` | `[PLACEHOLDER]` |
  | Two more | `[PLACEHOLDER]` | | | | | | |

- **Profiles, Work timeline, Billing & timesheets, Hire a teammate, Team memory, Settings,
  Admin** come from this repo's existing screens, **restyled into the NooblyJS kit**. There is
  no new mockup for them.

### 0.3 Capabilities NooblyJS relies on

1. **Run a task as a teammate** for other parts of NooblyJS: Product Factory drafting (Ada drafts
   specs, Rhea drafts container views and ADRs, a design agent drafts journeys and screens),
   engineering work (Juno opens PRs on your repos), data work (Otis pulls numbers and
   re-indexes repos), and chat replies. Each task shows progress ("Drafting PRD-032 · 64%")
   and reports its cost.
2. **Status and availability**: on a task, available, paused, off shift. Mentioning a paused
   teammate gets a clear "paused" reply, and nothing is billed.
3. **Billing**: hours × rate on a timesheet, billed to the right **team** (a meeting's time
   goes to the team the meeting belongs to). Pending entries count against the budget. The
   Digital Teammates budget is monthly ($1,816 of $9,000 in the seed), and **Pause all agents
   when a budget is reached** applies.
4. **Team chat** (a docked panel on item and work pages): people @mention teammates.
   Teammates reply with text, **structured cards** (draft plans, comparison tables, PR
   links), **cited Knowledge sources**, and a visible "working…" state. Agent messages use a
   square avatar, an "Agent" tag and a tinted bubble. Teammates may draft and edit content
   from the thread, but **status changes, approvals and permission grants are always a
   person's action**. When a teammate needs a permission, it posts an **approval card**
   (Approve / Decline) that only the right access role can answer. Context-dependent quick
   actions: Summarise thread, Find related ADRs, Why did a gate fail?
5. **Microsoft Teams meetings** through the NooblyJS bot (mockups `noobly-teams-bot-*`):
   - **Asks who to add**: an Adaptive Card ("Which teammate would you like to add to this
     meeting?") lists the available teammates with name, role, status and rate, each with
     **Add**. Footnote: "The teammate sees messages from the moment they join, not before.
     Time is billed to Delivery squad."
   - **Joins**: "<name> joined the chat", "was added by Stevie. Mention @Ada to ask a
     question", **Choose someone else**. The teammate posts as itself, labelled **NooblyJS
     teammate**, and introduces what it has loaded.
   - **Answers**: text plus a card (label/value rows, a primary and a secondary action),
     **sources**, and **"this answer cost $0.06"**. A "listening" indicator shows while it
     waits. Meeting notes are posted back to the item on request.

   | Teammate | Intro (what it loaded) | Sample question → card | Actions | Sources · cost |
   | --- | --- | --- | --- | --- |
   | Ada Quill (Research Analyst, $48/hr) | "I've loaded PRD-031 and the Delivery squad's latest activity… I'll post a summary to the spec when the meeting ends." | "What's still blocking the slot pilot?" → Stage: Architecture · Readiness 7 of 7 · Waiting on ADR-014 · Thabo N. · Pilot stores 3 · [PILOT DATE] | Open in NooblyJS · Ask Thabo to decide | PRD-031 v5, ADR-014 · $0.06 |
   | Rhea Voss (Architect, $52/hr) | "I drafted the slot architecture and ADR-014. Ask me about trade-offs; decisions stay with Thabo." | "Can we hit 300 ms without adding Redis?" → Redis p95 120 ms · Replica p95 640 ms · Extra cost $150/month · Proposed · needs Thabo | Open ADR-014 · Compare in detail | Planner load test (Sept), ADR-009 · $0.09 |
   | Juno Park (Frontend Engineer, $52/hr) | "I'm building the slot picker and checkout fixes. Ask me about anything in web-storefront." | "When will the slot picker screens be ready to test?" → PR #485 6 of 6 gates · Hold timer in test station 70% · Ready tomorrow 12:00 | Review PR #485 · Open preview | Software Factory runs 216–217 · $0.04 |
   | Otis Fern (Data Wrangler, $4/hr) | "I can pull numbers from the delivery and support data while you talk." | "How many 'no slots' tickets came from the pilot stores?" → All stores 412 · Pilot stores 61 (15%) · Peak 07:00–10:00 | Add to PRD-031 · Download CSV | Zendesk export (redacted) · $0.01 |

6. **Teams mix people and agents** (Home → Teams & roles): team cards show people (round
   avatars) and agents (square avatars), and the members table lists agents as "Agent ·
   Opus", with their team and the **Contributor** role. Hire a teammate is also offered there.
7. **Sandboxes**: a teammate on a task runs in the Platform's **Teammate sandboxes** pool
   (one per teammate on a task, e.g. "Juno Park · a11y fixes · web-storefront ·
   node-22:22.11", "Otis Fern · CRM dedupe · data-pipelines · python-3.13").

### 0.4 Rules that apply here

- **Teammates are always capped at the Contributor access role.** They never merge to
  `main` ("Juno opens PRs on your repos. You review and merge; Juno never merges to main."),
  never approve, never accept a decision, and never grant permissions, including in chat,
  in Teams or through an API key. In Teams, approval actions **deep-link into NooblyJS**.
- A teammate in a meeting **reads only messages posted after it joined**.
- **Hire teammates and set budgets** is **Owner** only (NooblyJS access roles: Viewer,
  Contributor, Approver, Architect, Owner). A person's work role only shapes their home.
- **Every action is attributed and costed** (`{ actor, teammateId, itemId, system,
  modelRoute, costUsd, at }`) and audited. Every chat message and decision goes to the
  item's Activity and the audit log.
- **Models** come only through `nooblyjs-ai-common`, on Bedrock / Vertex / Azure. A teammate's
  model tier (Opus $$$, Sonnet $$, Haiku $) maps to the Platform's model routes. Direct
  consumer APIs are development-only.
- Agents never see production secrets. Personal data is redacted in agent logs.

### 0.5 Where Teammates shows up elsewhere in NooblyJS

| Screen | What it shows |
| --- | --- |
| Home · Overview | Digital Teammates card ("4 of 8 on a task", "20% of October budget") |
| Home · Activity | agent rows with cost ("Ada Quill clustered 412 support tickets into 5 themes · $0.84"), Live now ("Ada Quill · Mobile promo spec", "Rhea Voss · Tracking map C4", "Otis Fern · CRM dedupe") |
| Home · Metrics | Spend by system (Digital Teammates is the largest: $1,816) and the agent vs people share of work |
| For you · PM | "Ada Quill is working for you · Drafting PRD-032 · 64%" with **Give Ada a new brief** |
| For you · Architect | "Rhea drafting the container view · 22%", **Ask Rhea to draft** |
| For you · Developer | the engineering teammate card ("Juno Park · Frontend Engineer · On checkout accessibility · $52/hr") and the primary action **Hand a ticket to a teammate** |
| Onboarding | "Agents who'll work with you" for each role (Ada Quill, Rhea Voss, Juno Park, the design agent, all teammates on your teams, Otis Fern) |
| Platform · Settings | the Digital Teammates budget and model routes |

### 0.6 Open points

- The seed has eight teammates, but only five appear on the roster mockup, plus Rhea Voss
  from the Teams bot. The other two are `[PLACEHOLDER]`.
- Rhea's rate ($52/hr in the Teams bot) and her other card values `[CONFIRM]`.
- Teammate identity in Teams: one bot with teammate-branded cards, or an app per teammate
  (NooblyJS `tech.md` §7.3).
- How this app's owner / manager / viewer roles map to NooblyJS access roles `[CONFIRM]`.

### 0.7 Team board (`.claude/specs/team-board/`)

A board where teammates and people **work out loud**: an asynchronous, threaded board sorted by topic (`item:PRD-031`,
`repo:web-storefront`, `team:delivery-squad`, `#tags`). Built, waiting for review (`/board`, `src/services/board*.js`).

- **Seven kinds of post**, each with one job: **Working on** and **Done** (posted automatically when a task starts and
  finishes, at no cost), **Finding**, **Ask**, **Heads-up**, **Needs a person** and **Note**.
- **Working on now**: who, agent or person, is on what, so two teammates don't do the same work.
- **Agents read it**: every task on an item gets a short **board briefing** in its prompt (claims, open asks,
  heads-ups, the most useful findings), marked as information, not instructions. Teammates given the board tools
  can read, post, reply and signal while they work.
- **@mentions wake teammates** as a billed `runTask`. A **conversation brake** stops agent-only chains after two
  hops and rests a thread after four agent replies in a row until a person replies.
- **People decide**: only a person resolves a Needs-a-person post, promotes a Finding to team memory, pins or hides.
  Nothing is edited or deleted: mistakes get a Correction reply.
- A **daily stand-up** per teammate, built from the work log at no cost, and an optional weekly digest.

---

## 1. Summary

A **Digital Teammate** is a named, callable AI worker with a defined role. Each teammate has:

- **Skills** — reusable instructions for how to do a kind of work (e.g. "C4 modelling", "ADR writing", "API reference docs").
- **Knowledge** — reference material it can draw on (standards, glossaries, prior decisions).
- **An AI provider and model** — chosen per teammate, so a senior *Architect* can run on an expensive reasoning model while a *Documentor* runs on a cheaper model tuned for clear writing.
- **Its own memory** — notes it writes about the work it has done, which shape future work.
- **A cost ledger** — every call is metered and charged to the teammate.

Each teammate is exposed as an **HTTP endpoint** that people and systems can call. A web UI lets users **procure** (hire) teammates from a catalog, **configure** them, watch their work and costs, and inspect or curate their memory.

The application is a Node.js Express app with a plain HTML/CSS/JavaScript front end. **All data lives on the file system as folders and Markdown files** — there is no database.

## 2. Problem

Teams use general-purpose AI chat tools ad hoc. That leads to:

1. **No specialization.** Every prompt starts from scratch; good role-specific instructions live in people's heads or scattered prompt files.
2. **No cost control.** One model is used for everything. Expensive models get used for trivial work, and nobody can say what a given type of work costs.
3. **No continuity.** The AI does not remember what it did last week on the same project.
4. **No integration point.** There is no stable endpoint that a CI pipeline, a chat bot or another service can call to "ask the architect".

## 3. Goals and non-goals

### Goals

| # | Goal |
|---|------|
| G1 | Model AI workers as **teammates with roles**: identity, persona, skills, knowledge, model. |
| G2 | Make every teammate **callable over HTTP** with a stable, documented contract. |
| G3 | Let users **procure** teammates from a catalog of templates and **configure** them in a UI. |
| G4 | **Meter and attribute cost** for every call, per teammate, with budgets and limits. |
| G5 | Give each teammate **persistent memory** that it writes and that humans can review and edit. |
| G6 | Store everything as **human-readable, git-friendly Markdown** on the file system. |
| G7 | Support **multiple AI providers** behind one interface, so the model is a configuration choice. |

### Non-goals (v1)

- Multi-tenant SaaS hosting, billing or payments. Costs are tracked, not charged.
- A relational or document database.
- Front-end frameworks or a build step (no React, no bundler).
- Autonomous, long-running agents that act without being called. v1 teammates respond to requests; scheduled work comes later (see roadmap).
- Fine-tuning or hosting models.

## 4. Personas

| Persona | Description | Main needs |
|---------|-------------|-----------|
| **Team Lead / Procurer** | Decides which teammates the team needs and what they may spend. | Browse the catalog, hire, set budgets, compare cost against value. |
| **Teammate Curator** | Tunes a teammate's persona, skills, knowledge and memory. | Edit Markdown, attach skills, upload knowledge, prune memory. |
| **Requester** (human) | Asks a teammate to do work. | A playground UI, quick answers, a history of past work. |
| **Integrator** (system) | Calls teammates from CI, bots or scripts. | A stable REST API, API keys, streaming, predictable errors. |
| **Administrator** | Runs the app. | Provider credentials, model price list, API keys, backups. |

## 5. Core concepts

| Concept | Definition |
|---------|------------|
| **Template** (catalog entry) | A blueprint for a role: default persona, suggested skills, recommended model tier, starter knowledge. For example, *Architect*, *Documentor*, *Code Reviewer*, *Business Analyst*, *QA Engineer*. |
| **Teammate** | A hired instance of a template, with a unique slug (`ada-architect`), display name, pronouns, avatar, persona, provider/model, skills, knowledge, memory, budget and status. |
| **Skill** | A Markdown document (front matter plus instructions) describing how to do a kind of task. Skills live in a shared library and are attached to teammates. A teammate can also have private skills. |
| **Knowledge** | Markdown documents a teammate can consult. Relevant passages are retrieved and added to the prompt at call time. |
| **Memory** | Short Markdown notes the teammate writes after doing work (decisions, preferences learned, open threads). Indexed by a `MEMORY.md` file per teammate. Humans can edit or delete them. |
| **Provider** | An AI API backend, for example Anthropic, OpenAI, Azure OpenAI, Google, Ollama, or a local mock. |
| **Model profile** | A provider plus model ID plus price per million input/output tokens plus limits (context window, max output). |
| **Work item** | One request to a teammate and its result: the input, output, model used, tokens, cost, duration and status. Stored as a Markdown file. |
| **Cost entry** | One line in a teammate's monthly cost ledger. |
| **Budget** | A spend limit per teammate (monthly) and globally, with a soft warning threshold and a hard stop. |

## 6. User stories

### 6.1 Procurement

- **US-P1** As a Team Lead, I can browse a **catalog** of teammate templates showing each role's description, skills, recommended model tier and *estimated cost per typical task*.
- **US-P2** As a Team Lead, I can **hire** a teammate from a template by giving it a name, picking a model (defaulting to the template's tier) and setting a monthly budget.
- **US-P3** As a Team Lead, I can **compare** two model choices for the same template by estimated cost.
- **US-P4** As a Team Lead, I can **pause**, **resume** or **retire** a teammate. A retired teammate's files are archived, not deleted.
- **US-P5** As a Curator, I can **create a custom template** from scratch or by saving an existing teammate as a template.

### 6.2 Configuration

- **US-C1** As a Curator, I can edit a teammate's **persona** (system prompt) in a Markdown editor with preview.
- **US-C2** As a Curator, I can **attach or detach skills** from the shared library and write private skills.
- **US-C3** As a Curator, I can **upload or write knowledge** documents (`.md`, `.txt`; PDF/DOCX conversion is a later phase).
- **US-C4** As a Curator, I can change the **provider and model**, temperature and max output tokens, and see the cost impact before saving.
- **US-C5** As a Curator, I can configure **memory behavior**: on or off, which model writes memory (for example a cheaper one), and maximum memory size.
- **US-C6** Every configuration change is recorded in the teammate's **change history**.

### 6.3 Invocation

- **US-I1** As an Integrator, I can `POST /api/v1/teammates/{slug}/tasks` with an instruction and optional context and receive the result, usage and cost.
- **US-I2** As an Integrator, I can request **streaming** output (Server-Sent Events).
- **US-I3** As an Integrator, I can pass a **`skill`** hint to force a specific skill, and a **`thread`** ID to continue a conversation.
- **US-I4** As a Requester, I can use a **playground** in the UI to talk to a teammate and see the token and cost breakdown live.
- **US-I5** A call is **rejected with a clear error** if the teammate is paused or retired, the budget is exhausted, or the API key lacks access to that teammate.

### 6.4 Cost

- **US-$1** Every call records input tokens, output tokens, cached tokens (when the provider reports them), model, unit prices and computed cost.
- **US-$2** As a Team Lead, I can see **cost per teammate** by day and month, cost per skill, and cost per caller (API key).
- **US-$3** As a Team Lead, I get a **warning** at a configurable share of budget (default 80%), and calls are **blocked** at 100% unless an override is set.
- **US-$4** As an Administrator, I can maintain the **model price list** in one place. Price changes apply only to calls made after the change; ledger entries keep the prices that applied at the time of the call.
- **US-$5** I can **export** the cost ledgers as CSV.

### 6.5 Memory

- **US-M1** After completing a work item, the teammate can **reflect** and write or update memory notes (decisions, user preferences, project facts, follow-ups).
- **US-M2** On each new call, the most **relevant memories** are included in the prompt.
- **US-M3** As a Curator, I can **view, edit, pin, and delete** memories, and see which work item produced each one.
- **US-M4** Memory has a **size cap**. When the cap is reached, the teammate consolidates older notes.

### 6.6 Work history

- **US-W1** As a Requester, I can browse a teammate's **work log** (newest first), filter it by date, skill, status or caller, and open any item to see the full input and output.
- **US-W2** As a Requester, I can **rate** a work item (thumbs up or down plus a comment). Ratings are fed back into memory.

## 7. Functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | CRUD for templates, teammates, skills, knowledge, memory and provider/model profiles, all stored as Markdown with YAML front matter. | Must |
| FR-2 | A provider abstraction with at least **Anthropic**, **OpenAI-compatible** (which also covers Azure, Ollama, LM Studio and vLLM) and a **Mock** provider for tests. | Must |
| FR-3 | Invocation endpoint per teammate with synchronous and SSE streaming modes. | Must |
| FR-4 | Prompt assembly: persona, then selected skills, then retrieved knowledge, then retrieved memory, then thread history, then the task. | Must |
| FR-5 | Token and cost metering per call, written to an append-only monthly ledger. | Must |
| FR-6 | Budgets with soft and hard limits per teammate and globally. | Must |
| FR-7 | Memory reflection step (configurable, can use a different model) and memory retrieval. | Must |
| FR-8 | Work log persisted per call as a Markdown file. | Must |
| FR-9 | API-key authentication for the invoke API, with keys scoped to teammates; session login for the UI. | Must |
| FR-10 | Web UI: Dashboard, Catalog, Team, Teammate detail (Overview, Persona, Skills, Knowledge, Memory, Work, Costs, Settings, Playground), Skills Library, Models & Providers, Costs, Admin. | Must |
| FR-11 | Skill auto-selection: choose relevant skills from the request when no `skill` hint is given. | Should |
| FR-12 | Knowledge retrieval with lexical search (BM25) in v1, with embeddings as an option later. | Should |
| FR-13 | Cost estimates for a template or model before hiring. | Should |
| FR-14 | Export and import a teammate as a zip of its folder. | Should |
| FR-15 | Teammate-to-teammate delegation (the Architect asks the Documentor to write it up). | Could (Phase 4) |
| FR-16 | Tool use / MCP servers per teammate. | Could (Phase 4) |
| FR-17 | Scheduled or recurring tasks. | Could (Phase 5) |

## 8. Non-functional requirements

| Area | Requirement |
|------|-------------|
| **Stack** | Node.js 20 LTS or later, Express 4/5, vanilla HTML/CSS/ES modules, no front-end build step. Keep runtime dependencies few and well known. |
| **Storage** | File system only. All entity files are Markdown with YAML front matter. Writes are atomic (temp file then rename) and serialized per file. The data directory can be put under git. |
| **Security** | Provider secrets come from environment variables or a `.env` file and are **never** written to Markdown. API keys are stored hashed. Untrusted Markdown is sanitized before rendering. Uploads are size-limited and type-checked. Path traversal is blocked on every slug or path input. |
| **Performance** | Platform overhead (excluding the model call) under 50 ms p95 for invocation with up to 500 knowledge docs and 1,000 memory notes per teammate. Indexes are cached in memory and rebuilt when files change. |
| **Scale target (v1)** | A single node and a single process, up to about 50 teammates and about 100k work items per year. |
| **Observability** | Structured JSON logs, a `/health` endpoint, and a request ID on every call that is written into the work item. |
| **Portability** | Runs inside NooblyJS (`npm start` in `../nooblyjs-ai-host`) with no external services, apart from the AI providers. It also runs standalone (`npm start`: `server.js` on nooblyjs-core's sign-in). The Mock provider lets the app run fully offline. |
| **Accessibility** | The UI meets WCAG 2.1 AA, including keyboard navigation and light and dark themes. |

## 9. Example teammates

| Teammate | Template | Model tier | Skills | Notes |
|----------|----------|-----------|--------|-------|
| **Ada** (she/her) | Architect | Premium reasoning (for example `claude-opus-5-5`) | C4 modelling, ADR authoring, trade-off analysis, NFR review | High cost per task, used for decisions. |
| **Wren** (she/her) | Documentor | Standard (for example `claude-sonnet-5-5`) or economy (`claude-haiku-4-5`) | Plain-language explanation, API reference, tutorials, release notes | Persona tuned for clear, warm, well-structured writing. |
| **Rex** (he/him) | Code Reviewer | Standard | Security review, style review, test-gap analysis | Called from CI. |

Model IDs and prices are configuration, not code. Ship the price list with clearly marked example values that an administrator must check against current provider pricing.

## 10. Success metrics

- Time to hire and make a first successful call to a new teammate is **under 5 minutes**.
- **100%** of calls have a cost entry, with ledger totals reconciling to the work log.
- Teams can report cost per teammate per month **without opening a spreadsheet**.
- At least **30%** of work items cite at least one memory note after a teammate's first 20 tasks, which shows the memory is being used.
- Requesters rate **at least 70%** of work items positively.

## 11. Assumptions and constraints

- Users run the app themselves (locally, in a VM or in a container) with a persistent volume for `data/`.
- AI providers return token usage in their responses. Where they do not, the app estimates usage with a tokenizer and marks the entry `estimated: true`.
- File-system storage is enough for the target scale. A store interface keeps a future database adapter possible.

## 12. Open questions

1. **Identity:** Is single-admin login enough for v1, or do we need multiple users with roles (Owner, Curator, Requester)?
2. **Cost currency:** Track costs in USD only, or allow a configured display currency with a fixed rate?
3. **Memory privacy:** Should memory be scoped per caller or project, so that work for project A does not leak into project B? (The proposal is optional `project` tags with retrieval filtered by tag.)
4. **Knowledge formats:** Is PDF/DOCX ingestion needed in v1 or v2?
5. **Pricing for internal chargeback:** Should a teammate have a markup or "rate card" price that differs from the raw model cost?
