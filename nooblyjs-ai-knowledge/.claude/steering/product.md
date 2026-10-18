---
inclusion: always
---

# Knowledge Repository: what NooblyJS needs from this repo

> Extracted from the NooblyJS product definition (`../nooblyjs-ai-host/.claude/steering/product.md`, the source
> of truth) and the design mockups in `../nooblyjs-ai-host/.claude/steering/brief/`
> (`noobly-knowledge-local`, `noobly-knowledge-enterprise`). This file lists only what the
> **Knowledge Repository** must provide inside NooblyJS. `tech.md` says how this repo plugs in,
> including the move from the legacy Wiki Platform, and `structure.md` says where things
> live. If this file and the NooblyJS `product.md` disagree, NooblyJS wins. Numbers are **sample
> data** from the PRD-031 "Same-day delivery slots" story. `[PLACEHOLDER]` and `[COUNT]`
> mark facts we don't have yet.

## 1. Where Knowledge fits

NooblyJS takes an idea from customer signal to merged code. AI agents draft and build, and
**people decide**. The Knowledge Repository is "one searchable memory of decisions, code,
specs and customers". On the Home overview it sits **across every stage**: "every stage
reads context in and writes decisions back". It absorbs the existing Enterprise Knowledge
Repository wiki.

It serves two audiences:

- **People** ask questions and get **cited answers**, browse spaces and the enterprise
  process model, and keep content fresh.
- **Agents** (drafting specs and architecture, teammates in chat and Teams, factory stations)
  read Knowledge as **context** and must cite what they used.

## 2. Screens

The module sidebar is titled `knowledge`. Nav: **Ask & search, Spaces, Collections,
Sources, Graph, Needs review** (badge, e.g. 37), **Contributions, Access**. Status card:
"Index up to date" · "Documents 18,240 · 9 sources" · "Reviewed in 90 days 84%".

### 2.1 Ask & search (mockup `noobly-knowledge-local`)

- Eyebrow "NooblyJS · Knowledge Repository". Title **"What does the team know?"**. Subtitle:
  "Decisions, code, specs, runbooks and customer voice — searchable by people and agents alike."
- **Ask** box. The **answer** says how many sources it used ("Answer · from 3 sources") and
  has **numbered inline citations** [1] [2] [3]. Example: "Capacity per slot is pickers on
  shift × picks per hour ÷ average basket size, capped by van count for the delivery window
  [1]. The planner recalculates at each shift change and publishes a slot.capacity event
  [2]. Stores may add up to 20% manual headroom in the evening [3]."
- Answer actions: **Add to PRD-031** (links the answer to the item being worked on), **Save
  as page**, **This is wrong** (feedback that flags the source for review).
- **Citations**, each with its title, type, location and freshness: "Slot capacity model ·
  Runbook · reviewed 12 days ago", "CapacityPublisher.java · delivery-planner · main",
  "Store ops policy · evening headroom · Policy · 14 months old".
- **Spaces** panel (All spaces):

  | Space | Description | Count |
  | --- | --- | --- |
  | Enterprise Space | Group architecture, the enterprise process model, standards, infrastructure | 16 process folders · 58 standards |
  | Financial Services Space | Financial services processes, products and controls | [COUNT] documents |
  | People Space | Human capital processes, roles and policies | [COUNT] documents |
  | Acme Space | Digital products, engineering decisions, specs and runbooks | [COUNT] documents |

- **Model types / collections** with counts: Business process models 16, Architecture models
  42, Standards 58, Infrastructure models 27, Decisions & specs 192, Customer insights 1,920.
- **Sources** (**Add source**), each with its scope and sync state: GitHub (24 repos · 4 min
  ago), Confluence (3 spaces · 1 h ago), Jira (6 projects · 12 min ago), Zendesk (Tickets ·
  **PII redacted** · 30 min ago), Google Drive (2 shared drives · **Re-auth needed**), and
  NooblyJS itself (Specs, ADRs, runs · **Live**).
- **Needs review** (All 37), each with the reason and one action:

  | Document | Why it needs review | Action |
  | --- | --- | --- |
  | Store ops policy · evening headroom | Cited 41 times this month · 14 months old | Review |
  | Checkout service runbook | Contradicts code merged in PR #455 | Review |
  | Promotions API v1 contract | Superseded by v2 · still cited by agents | Archive |
  | Onboarding · local dev setup | Mentions Node 18 · platform is on 22 | Review |

### 2.2 Space and process model (mockup `noobly-knowledge-enterprise`)

- **Space tree** on the left. The Enterprise Space has: Architecture models (42), Business
  processes (16), Standards (58), Infrastructure models (27) and Capabilities (134). Under
  Business processes are the **L0 Enterprise Process Model** and the L1 folders: Enterprise
  Management; Develop and Manage Human Capital; Manage Financial Resources; Manage Financial
  Services; Manage Franchise Operations; Manage Meat Market Operations; Manage
  Pharmaceutical Operations; Manage Red Star Operations; + 6 more. The other spaces
  (Financial Services, People, Acme Retail) are listed too.
- Breadcrumb: Spaces › Enterprise Space › Business processes › L0.
- **Model header**: "L0 Acme Retail Enterprise Process Model", type "Business process
  model", "Level 0", **"Agent context up to date"**, and "Owner [OWNER] · 16 L1 folders".
  Actions: **Pin, Share, Subscribe, Rebuild context**.
- Tabs: **Model / Folders / Attributes / Linked documents / Notes**.
- **The L0 model**: the hint "Select a process to open its L1 model", then the purpose
  statement ("Uplifting lives every day by pioneering access to the most affordable goods and
  services, creating economic opportunity and protecting our planet."), then three **bands
  of chevrons**. Each chevron has a name, a code, and its L1/L2 counts or its active specs.
  Clicking one drills down to L1, then L2.

  | Band | Processes (code · counts) |
  | --- | --- |
  | Enterprise (3) | Enterprise Management (EM · L1 · 6 L2) · Provide Marketing and Innovation Services (MI · L1 · 5 L2) · Provide Enterprise Data Services (ED · L1 · 4 L2) |
  | Value chain (4) | Plan (PL · L1 · 7 L2) · Procure (PR · L1 · 6 L2) · Supply (SU · 2 active specs) · Sell (SE · 3 active specs) |
  | Support (3) | Develop and Manage Human Capital ([HC] · L1) · Manage Financial Resources ([FR] · L1) · Provide Information [Services] ([IS] · L1) |

- **Used across NooblyJS**: backlinks to the specs, decisions and teammate work mapped to the
  model. "PRD-031 · Same-day delivery slots · Mapped to Supply → home delivery · Spec",
  "ADR-014 · Slot cache · Supports Supply · Sell · Decision", "Ada Quill · competitor scan ·
  Cites Marketing & Innovation · Teammate".
- **Ask about this model**: "Agents read this model as context when they draft specs and
  architecture." Suggested questions: "Which L2 processes does same-day delivery touch?",
  "Which applications support Procure?", "Show standards that apply to Sell".

### 2.3 Screens without a mockup

**Collections, Sources, Graph, Contributions and Access** appear in the nav. Build them in
the same patterns. Collections and Sources are fuller versions of the panels in §2.1. Graph
shows how documents, models, specs and code link up (full width). Contributions shows who
added or changed what. Access controls who may see each space. Mark gaps `[PLACEHOLDER]`.

## 3. Capabilities NooblyJS relies on

1. **Cited answers** for people and agents. Every answer lists its sources with type,
   location and freshness. An answer with no source says so.
2. **Context for agents.** Drafting agents, teammates and factory stations ask Knowledge for
   context about an item, and their drafts cite it. For example, PRD-031's **Linked
   knowledge** is "Slot capacity model · Runbook · delivery-planner", "ADR-013 · Event-driven
   slot release · Architecture decision · accepted" and "September support themes · Customer
   insight · 412 tickets". The Architect agent builds the container view "from PRD-031 and 6
   existing services in Knowledge".
3. **Ingest with personal data redacted before anything is written** (e.g. Zendesk tickets
   are stored as "PII redacted"). Customer data stays in-region `[CONFIRM REGION]`.
4. **Freshness and review.** Find what is stale but heavily cited, contradicts merged code,
   is superseded but still cited by agents, or mentions outdated platform versions. Offer
   Review or Archive. "This is wrong" reports feed the same queue.
5. **Signals for the Product Factory.** Customer insight (Zendesk tickets, app reviews, app
   logs) is the source of the Product board's **Top signals this week · from Knowledge · 6
   sources** (Delivery slot availability 412, Substitution quality 188, Order editing 96,
   Promo codes on mobile 54). The clustering into themes is done by a research agent (Ada
   Quill "clustered 412 support tickets into 5 themes").
6. **Standards and models as checks.** "Your standards and models become checks on every
   pull request." The Architect's home lists **Models to review**: "Delivery container view
   · contradicts ADR-013", "Supply · L1 process model · 14 months old", "Integration standard
   v2 · cited 41× by agents".
7. **NooblyJS writes back.** Specs, ADRs and runs flow in live, so decisions are searchable as
   soon as they're made.
8. **Indexing.** Repos are indexed when Platform → Repositories allows it ("Index into
   Knowledge"; the filter "Not indexed"). Indexers run in the Platform's **Knowledge
   indexers** pool, with a nightly full sync at 02:00. A teammate (Otis Fern) can re-index on request.
9. **Pin, Share, Subscribe, Rebuild context** on a model or space. Pinning puts it on the
   person's home. Rebuilding context refreshes what agents read.

## 4. Rules that apply here

- **Personal data is redacted on ingest**, before the document is stored. This is a
  guardrail ("Redact personal data on ingest · Knowledge sources and agent logs").
- **No secrets** in stored documents. Source credentials are stored by reference only.
- **Every write is audited**, and every agent action (indexing, answering) is attributed
  and costed. The Knowledge budget is monthly ($96 of $500 used in the seed). Indexing,
  triage and clean-up route to Claude Haiku through Bedrock / Vertex / Azure.
- **Agents are capped at Contributor.** They can suggest changes and flag documents, but
  archiving or changing access is a person's action.
- **Status is said in words** ("Re-auth needed", "Live", "14 months old"), not colour alone.

## 5. Data Knowledge owns

Space · Collection / model type · Document (source, path, owner, last reviewed, freshness,
citation count, embeddings) · ProcessModel (L0/L1/L2, code, band Enterprise / Value chain /
Support, parent, children, linked items) · SourceConnector (sync status, last sync) · Answer
(question, text, citations, "this is wrong" feedback).

## 6. Where Knowledge shows up elsewhere in NooblyJS

| Screen | What it shows from Knowledge |
| --- | --- |
| Home · Overview | The Knowledge band across all stages, and the Knowledge card ("18,240 documents · 9 sources", "37 pages need review") |
| Home · Activity | "Otis Fern re-indexed 3 repositories into Knowledge · $0.31" |
| Product board | Top signals this week · from Knowledge |
| Spec | Linked knowledge (side rail) |
| Architecture | The container view generated from existing services in Knowledge |
| For you · Architect | Models to review. Standards broken on PRs (standards live here) |
| For you · PM | first-week task "Pin the Delivery space in Knowledge" |
| Onboarding | Architect tool "Enterprise Knowledge Repository"; Architect's first task "Confirm the 3 standards flagged as stale" |
| Team chat, Teams bot | Cited Knowledge sources in agent replies ("Sources: Zendesk export (redacted)") |
| Platform · Settings | Knowledge budget and its model route |

## 7. Integrations (sources)

The Enterprise Knowledge Repository wiki (export first), SharePoint / Google Drive,
Confluence `[if used]`, Jira, Zendesk (PII redacted), GitHub, and NooblyJS itself.

## 8. Open questions

- How to get the Enterprise Knowledge Repository's data: export, API or database (NooblyJS §12 Q5).
- The real process-model values: the third Support process, and the codes for Support and
  Enterprise Management (`[HC]`, `[FR]`, `[IS]`, `EM` are placeholders; NooblyJS §12 Q8).
- Semantic search: a sidecar index format, or lexical search only for now.
- The real counts for the Financial Services, People and Acme Retail spaces, and the model owner `[OWNER]`.
