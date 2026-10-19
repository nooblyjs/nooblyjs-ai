---
inclusion: always
---

# Product Factory engine (`nooblyjs-ai-product`)

> **Since 2026-10-19 this is the Software Factory's Product section** (`nooblyjs-ai-factory/product`, pages in
> `nooblyjs-ai-factory/public/product`), not an app of its own. Where this file says `/product`, read `/factory/product`;
> `data/product`, read `data/factory/product`; `nooblyjs-ai-product`, read the Factory's Product section. There is no
> `server.js` or standalone mode any more. See the section's `CLAUDE.md`.

> **What this repo is:** the Product Factory engine. It owns the **artefacts** (signals,
> ideas, specs, architecture, UX/UI designs, handoff previews) and the **drafting
> agents** that produce them. It owns its **screens** (a UI module in the NooblyJS frame at `/product`, like
> Teammates) and exposes a JSON API at `/product/api/v1`.
>
> **Source of truth:** the NooblyJS product definition (`../../nooblyjs-ai-host/.claude/steering/product.md` §5.3)
> and the mockups in `../../nooblyjs-ai-host/.claude/steering/brief/` (`noobly-platform.html` for the Product
> board; `noobly-product-factory-spec`, `-architecture`, `-ux-design`, `-ui-design`). If this
> file disagrees with the NooblyJS `product.md`, **NooblyJS wins**. See `structure.md` for the API
> and data layout and `tech.md` for platform rules.
>
> **Boundary:** this engine does **not** own items, stages, approvals or handoffs — those
> belong to the lifecycle engine (part of `noobly`, `src/lifecycle/`). All numbers below are **sample data** from the PRD-031
> "Same-day delivery slots" seed story (§7); never treat them as targets or hard-code them.

## 1. Core rules (apply to every change here)

These are non-negotiable; most of this engine's code enforces one of them.

- **People decide; agents propose.** Drafting agents create and edit artefacts only. They
  **never** approve a spec, accept an ADR, approve a handoff, or send to the Factory. Enforce
  this server-side, not just in the API shape. Access roles:

  | Action | Who | Notes |
  | --- | --- | --- |
  | Draft specs, ADRs and designs | Contributor and up | **Agents are capped at Contributor** |
  | Approve specs and UI handoffs | Approver, Architect, Owner | — |
  | Accept architecture decisions | Architect, Owner | — |
  | Change a portfolio or value stream template; link a portfolio to its strategic themes | Approver, Architect, Owner | People only: an agent never changes a template |

- **Readiness gates approval.** An item cannot request approval until its required readiness
  checks pass, unless a person overrides **with a reason**. Checks are configurable per stage.
  Each failing check offers exactly **one** agent action (e.g. "Ask Ada to draft rollout").
- **Every agent action is attributed and costed.** Record who/what, when, which item, and
  cost (shown as "Agent cost so far $7.40 · Research + 4 drafts"). The Product Factory has a
  monthly budget ($412 of $1,500 in seed). Spec/architecture/review work routes to Claude
  Opus with a Sonnet fallback, via Bedrock / Vertex / Azure only — never a direct provider API.
- **Drafts cite Knowledge.** A new dependency requires an ADR. Customer data stays in-region.
- **Status is said in words**, not colour alone ("Awaiting your brief", "2 of 3 reviewers
  approved"). Accessibility target is WCAG 2.2 AA.
- **Send to Software Factory** does not create the handoff itself — it passes the person's
  decision to the lifecycle engine (part of `noobly`, `src/lifecycle/`), which creates it.

## 2. Where the Product Factory fits

NooblyJS takes an idea from customer signal to merged code. The Product Factory covers the front
half: signal → handoff. It numbers its own stages 1–4, which map to NooblyJS lifecycle stages 1–5:

| Product Factory stage | NooblyJS stages | Main artefact | Default agent | Exit gate (a person decides) |
| --- | --- | --- | --- | --- |
| 1 · Product | 1 Discover + 2 Specify | Signal clusters, idea with RICE score, spec (problem, goals, stories, acceptance criteria, readiness) | Research agent (Ada Quill), product agent | Idea accepted. **Spec approval** (Product lead + Engineering, 1 working day, remind then escalate) |
| 2 · Architecture | 3 Architect | Container diagram, ADRs, standards check, quality attributes | Architect agent (Rhea Voss) | **ADR acceptance** when a new dependency is added (Architect, 1 working day, remind) |
| 3 · UX design | 4 UX design | Journey map, flows, research findings | Design agent | Flow approved |
| 4 · UI design | 5 UI design | Screens, design-system reuse, accessibility checks, handoff preview | UI agent | **UI handoff** (Design lead, 4 hours, remind), which creates the Software Factory work items |

Primary users: **Product managers**, **Architects**, **Designers**, and Engineering as spec
reviewers. Approval rules carry target times and escalation; they are editable in Teams & roles.

## 3. Capabilities the API must provide

1. **Signals → ideas.** Cluster customer signals (Zendesk, app reviews, app logs,
   via Knowledge) into themes with counts; turn a signal into an idea scored with RICE.
2. **Specs** with versions, authorship ("drafted by" an agent, "edited by" a person),
   reviewers and their status, linked knowledge, and readiness results.
3. **"Ask the agent to draft"** at every stage (spec, rollout plan, container view, ADRs,
   journey/flow, screens). Expose progress ("Ada Quill drafting · 64%") and an **Awaiting your
   brief** state until a person briefs the agent. The button names the teammate hired for that stage
   (`GET /drafters`), never a name written in the page. **When no teammate can draft a stage, its "Ask …"
   buttons are not shown** and the page says why (with a link to hire one), and a person does the work
   themselves through the same write APIs: Write the spec, the container view as code, New ADR, a journey,
   a flow, an answer to an open question, a screen, and the handoff's work items. These forms are also there,
   behind a button, when a teammate is hired.
4. **Architecture as code.** The container view is editable as code; ADRs are proposed then
   accepted (flagging those that add a dependency). The standards check and quality attributes
   flow to the Software Factory as **gates on every PR**.
5. **UX and UI artefacts**: journeys, flows, research, open questions with quick tests;
   screens with per-device status; design-system reuse; accessibility checks.
6. **Handoff preview.** Generate work items per repo with a repo count and cost estimate range.
7. **Send back.** An item can be returned to an earlier stage with a reason; metrics track the
   sent-back rate per stage.
8. **Roadmap**: items across the quarter with their stage span.

## 4. Data this engine owns

### 4.1 How Acme Retail organises its work (2026-10-12)

From the top down:

| Level | What it is | Examples | Here |
| --- | --- | --- | --- |
| **Strategic theme** | An aspiration of the whole company. A portfolio works towards any number of them | "Solve the every day", "Leverage AI" | Built |
| **Portfolio** | A very large area of the company | Buying, Banking, Digital | Built, with its document |
| **Value stream** | Sits in one portfolio; a portfolio has **none or many** | Digital Commerce, Media and Advertising, Rewards, Data Monetisation | Built, with its document |
| **Portfolio epic** | A long-running, large initiative | — | Not built yet |
| **Epic** | Sits under a portfolio epic, or straight under a portfolio; may belong to a value stream | — | Not built yet |
| **Feature** | Sits under an epic | — | Not built yet |
| **Requirement** | Sits under a feature | — | Not built yet |

How portfolio epics, epics, features and requirements map onto this engine's ideas and specs, and onto
Jira, is still open (§8).

### 4.2 The records

- **Signal** — source, text, theme, count
- **Strategic theme** — name, and one line on what it means. A portfolio links to any number of themes (`themes`);
  a theme a portfolio works towards can't be removed until it is unlinked.
- **Portfolio**, **Value stream** and **Product** — where work sits (products 2026-10-10, replacing the free-text
  "domain"; value streams 2026-10-12). A portfolio (Digital, Buying, Banking) has none or many value streams
  (Digital Commerce, Rewards) and holds products (Registration, Payments, Checkout, Delivery, Search). A product
  sits in one portfolio, and may sit in one of **that portfolio's** value streams. A signal, an idea and a
  spec each sit in **one product**, and through it in one portfolio (and value stream). They are **labels a person
  types and adds, never a drop-down**: anyone who may draft adds one (also by naming a new product on an
  idea); renaming, moving or removing one, and linking a portfolio to its themes, needs `approve`. A name is
  unique (whatever its capitals) among products, among value streams and among themes. Moving a value stream to
  another portfolio moves its products with it; a portfolio with products or value streams, a value stream with
  products, and a product with work filed under it can't be removed. The board filters by portfolio, then value
  stream, then product. With none set up the board opens on "Start with your portfolios".
  (`catalogue.yaml`, `src/services/catalogue.js`)
- **Portfolio document** and **Value stream document** — Markdown, one per portfolio (`portfolios/<id>.md`) and
  per value stream (`value-streams/<id>.md`), made from its **template** when the portfolio or value stream is
  added: the template's `## ` headings, empty. Anyone who may draft fills them in, saved as a new version with
  `If-Match`. (`src/services/documents.js`)
- **Template** — the Markdown a document starts from (`templates/portfolio.md`, `templates/value-stream.md`), changed
  in **Settings** (§5.8). Each `## ` heading is a section; the text under it is the hint shown while filling it in.
  The first templates:
  - **Portfolio**: Key Partners, Key Activities, Key Resources, Cost Structure, Revenue Streams.
  - **Value stream**: Description, Value Stream Vision, Customer Segments, Channels, Customer Relationship, KPIs
    or Revenue, Solution Context, Economic Framework, People and Locations, Attachments.

  Changing a template changes what every document of its kind shows: a section the template gained shows empty;
  a section it lost stays in the documents with text in it (marked "no longer in the template") until emptied.
  (`src/services/templates.js`)
- **Idea** — problem, product, RICE, linked signals
- **Spec** — problem; goals (measure / today / target); user stories; acceptance criteria
  (given/when/then); out of scope; version; readiness results; reviewers; linked knowledge
- **ADR** — number, title, status (proposed / accepted / superseded), context, decision,
  consequences, `addsDependency`
- **Diagram** — container view, stored **as code**
- **QualityAttribute** — attribute, scenario, target, verified-by (becomes a Factory gate)
- **JourneyMap**, **Flow**, **Research**
- **UIScreen** — device, status
- **Handoff preview** — work items per repo, estimate
- **Roadmap**

## 5. Screens (this repo's `public/js/`, in the NooblyJS frame at `/product`)

These screens are this repo's UI module (`public/js/module.js`, pages in `public/js/pages/`). They
call this repo's API at `/product/api/v1` through the frame's `ctx.api`. Sidebar `product factory`. Nav: **Overview** ·
*Strategy*: **Portfolios** · *Stages*: **Product, Specs, Architecture, UX Design, UI Design** · *Flow*: **Reviews**
(badge), **Handoffs** · *Setup*: **Settings**. Status card: "3 agents on duty" and "October spend $412 of $1,500".

### 5.1 Product board (Stage 1; `noobly-platform.html`)

- Tabs **Board / Roadmap / Insights**; action **New idea**; filters with counts
  (All 13 / Mine 5, then a label per portfolio; under a chosen portfolio its value streams, then its products, e.g.
  Digital 13 → Digital Commerce 11 / Rewards 2 → Delivery 5 / Checkout 4 / Search 2).
- **Kanban**, count per column:

  | Column | Cards (seed) |
  | --- | --- |
  | Signals (4) | Slots sell out before 10:00 · 412 tickets · Zendesk. Substitutions feel random · 188 app reviews. Can't edit order after checkout · 96 tickets · Zendesk. Promo codes fail on mobile · 54 tickets · app logs |
  | Ideas (3) | Smarter substitutions · Delivery · RICE 42. Edit order until picking starts · Checkout · RICE 38. Basket recommendations · Search · RICE 27 |
  | Spec drafting (2) | Mobile promo code fix · Ada Quill drafting · 64%. Loyalty points at checkout · **Awaiting your brief** |
  | In review (2) | PRD-031 Same-day delivery slots · Needs your approval. PRD-029 Checkout accessibility · 2 of 3 reviewers approved |
  | To architecture (2) | PRD-027 Live order tracking map · Approved. PRD-025 Store pickup lockers · Approved |

- **Top signals this week** ("from Knowledge · 6 sources"): slot availability 412,
  substitution quality 188, order editing 96, promo codes on mobile 54.
- **Q4 roadmap**: Oct–Dec bars with each item's stage span.

### 5.2 Spec detail (`noobly-product-factory-spec`)

- PRD-031, status **In review**, product **Delivery** (portfolio Digital, value stream Digital Commerce). Authorship "Drafted by Ada Quill ·
  edited by Lerato M. · v4". Sticky actions **Request changes**, **Approve & send to Architecture**.
- Body: **Problem** (evidence-backed), **Goals** table (slots open at 12:00 18%→45%; slot-step
  abandonment 31%→20%; slot list load p95 1.8 s→300 ms), **User stories** (3), **Acceptance
  criteria** given/when/then (3), **Out of scope**.
- Side rail: **Where this is** (stage tracker); **Readiness 6 of 7** (Rollout plan missing,
  offering "Ask Ada to draft rollout"); **Linked knowledge** (each typed: runbook, ADR,
  customer insight); **Reviewers** (Lerato M. Approved, You Waiting).

### 5.3 Architecture (`noobly-product-factory-architecture`)

- Tabs **Diagram / Decisions / Contracts / Standards**.
- **Container view** with legend New / Existing / External; nodes include **Slot API** (Node
  22, repo slots-api), **Slot cache** (Redis · 30 s TTL · ADR-014 proposed), Event bus (Kafka),
  Store inventory (Postgres, read only); edges labelled with protocol. Provenance line names
  the agent and sources. Action **Edit as code**.
- **Decisions** (**New ADR**): ADR-014 Proposed (adds a dependency, Accept / Discuss),
  ADR-013 Accepted, ADR-009 Accepted.
- **Standards check**: approved stack only; data in-region; every API has a contract; new
  dependency needs an ADR.
- **Quality attributes** (become Factory gates):

  | Attribute | Scenario | Target | Verified by |
  | --- | --- | --- | --- |
  | Latency | Slot list at 18:00 peak | p95 < 300 ms | Load test station |
  | Consistency | Two holds on the last slot | 0 double-books | Contract tests |
  | Availability | Cache node lost | 99.9% monthly | Chaos check · staging |
  | Cost | Run cost at current volume | < $600 / month | Platform budget alert |

### 5.4 UX Design (`noobly-product-factory-ux-design`)

- Tabs **Journey / Flows / Research**.
- **Journey · evening shopper** across Plan → Pick a slot → Build basket → Checkout →
  Delivery, with **Doing / Feeling / Pain / Opportunity** rows. An opportunity can be marked
  **out of scope and linked to another PRD** (e.g. PRD-033).
- **Flow · choose and hold a slot** (5 screens · 1 decision).
- **Research**: usability (8 people) and preference tests. **Open question** with **Run a quick test**.

### 5.5 UI Design (`noobly-product-factory-ui-design`)

- Actions **Open in canvas**, **Send to Software Factory**. **Screen gallery** in device
  frames (tabs Mobile / Web / Store console), each screen with a status.
- **Design system** v3.2: 14 of 16 components reused; new ones named (SlotChip, HoldTimer).
- **Accessibility** checks, including the failing "Timer needs a screen-reader label".
- **Handoff preview**: "6 work items for the Software Factory" across slots-api,
  web-storefront, mobile-app and design-system, with "Estimated $18–$26 · 3 repos" (repo
  count is an open point, §8).

### 5.6 Overview, Reviews and Handoffs

No mockup yet. Overview summarises the four stages; Reviews lists what is waiting for a
reviewer (the badge count); Handoffs lists stage-to-stage handoffs including items sent back.
Build these in the same patterns.

### 5.7 Portfolios (Strategy; no mockup yet)

- **Portfolios** (`/product/portfolios`): the **Strategic themes** (each with the portfolios that work towards it;
  add one, and an Approver renames, describes or removes one); then a card per **portfolio** with the themes it works
  towards (**Change themes**, Approver), its **value streams** (each a link to its document, with its products), the
  products in no value stream, and **Add a value stream**; then **Add a portfolio**. Products are still added on the
  Product board's **Portfolios & products** panel, where an Approver can also put a product in a value stream.
- **A portfolio's or value stream's document** (`/product/portfolios/:id`, `/product/value-streams/:id`): "n of m
  sections filled in · Version v · who, when"; each section of the template with its text, or "Not filled in yet"
  and the hint; **Edit** (a text box per section, saved with `If-Match`). Side rail: the strategic themes; a
  portfolio's value streams and products, or a value stream's portfolio and products; and, for an Approver,
  **Rename or remove** (and move a value stream to another portfolio). A note says when the template has changed
  since the document was written.

### 5.8 Settings (Setup; no mockup yet)

The **Portfolio template** and **Value stream template**: each section listed with its hint, and for an Approver the
template as Markdown with **Save**. Everyone signed in can read them.

## 6. Where Product Factory work surfaces elsewhere in NooblyJS

| Screen | What it shows |
| --- | --- |
| Home · Overview | Product Factory card ("16 items in design · 4 approvals pending"), stage counts, Waiting-on-you rows for specs, ADRs and UI handoffs |
| Home · Approvals | spec approval detail: what you're approving, readiness, other reviewers, agent cost so far, what happens next |
| Home · Activity | "Ada Quill clustered 412 support tickets into 5 themes · $0.84", "Rhea Voss proposed ADR-014 · $1.95", "You accepted ADR-013" |
| For you · PM | Tiles (specs waiting on you, items in flight, shipped this month, new signals); panels (Top signals for Delivery, "Ada Quill is working for you · 64%", **Nudge**) |
| For you · Architect | Decisions awaiting sign-off with the alternative considered, **Accept / Discuss / Open diagram**; Architecture queue (**Ask Rhea to draft / Watch / Preview spec**) |
| Metrics | Product lead time, sent-back rate, Product Factory spend ($412) |
| Team chat | Agents draft and edit spec content from the thread; system lines record the change ("spec v5") |

## 7. Seed story

PRD-031 "Same-day delivery slots" (v4 in review, readiness 6 of 7; the Teams demo uses v5 at
7 of 7). Also: IDEA-018 Smarter substitutions (RICE 42), PRD-025 Store pickup lockers, PRD-027
Live order tracking map, PRD-029 Checkout accessibility, PRD-032 Mobile promo code fix,
ADR-009, ADR-013, ADR-014, ADR-015, and the PRD-033 out-of-scope link. All sample data.

## 8. Open points (`[CONFIRM]` before relying on them)

- How portfolio epics, epics, features and requirements (§4.1) map onto ideas and specs, and onto Jira's
  issue types. Until that is settled they are not built.
- Whether "Attachments" on a value stream stays a section of links, or becomes uploaded files.
- Which strategic themes each sample portfolio works towards, and what each theme means: the seed links Digital to
  both and leaves the descriptions empty `[PLACEHOLDER]`.

- Handoff preview says "3 repos" but its six work items span four (slots-api, web-storefront,
  mobile-app, design-system).
- Diagram-as-code format: C4/Structurizr, Mermaid, … (NooblyJS §12 Q7).
- Whether the Stage 1–4 numbering is what people should see.
- Which stage entries start drafting automatically vs wait for a person's brief.
- Figma for designers (NooblyJS §12 Q11).
