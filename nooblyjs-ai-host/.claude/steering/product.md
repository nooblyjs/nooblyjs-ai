---
inclusion: always
---

# NooblyJS — Product

> Source of truth for what NooblyJS is and does. Derived from the design team's brief in
> `.claude/steering/brief/` (`noobly-build-brief.md` plus 22 screen mockups; last synced with
> the brief on 2026-10-08 15:00, and the `noobly-platform-*` screens re-checked in detail on 2026-10-08). Delivery order lives in `roadmap.md`. The child
> projects listed in [§10](#10-child-projects) build against this document.
> All numbers quoted from mockups are **sample data** that tells one story
> (PRD-031 "Same-day delivery slots"); they are not targets unless stated.
> Anything in `[BRACKETS]` is an open decision; see [§12](#12-open-questions).

---

## 1. What NooblyJS is

**NooblyJS** is an engineering-lifecycle platform. It takes an idea from customer
signal to merged, deployed code. **AI agents do most of the drafting and building;
people make the decisions.**

Five systems sit behind one shell, with cross-cutting **Home** screens on top:

| System | Purpose | Status |
| --- | --- | --- |
| **Product Factory** | Signals → ideas → specs → architecture → UX design → UI design → handoff | New |
| **Software Factory** | Runs approved work items through stations (implement, test, review) and produces pull requests | Exists (`nooblyjs-ai-factory`) |
| **Digital Teammates** | Named AI agents with roles, skills, models, memory, hourly rates, budgets and timesheets | Exists (`nooblyjs-ai-teammate`) |
| **Knowledge Repository** | One searchable memory of decisions, specs, code, process models, standards and customer insight. Agents read it as context and write decisions back | New; absorbs the existing Enterprise Knowledge Repository wiki |
| **Infrastructure** | Infrastructure designs drafted from an approved architecture, the environments built from them, provisioning runs, drift and cloud cost. It owns environments and previews | Exists (`nooblyjs-ai-infrastructure`), joined in Phase 9a |
| **Platform** | Repositories, containers/sandboxes, model routing, budgets, guardrails, integrations, members, audit; a summary of Infrastructure's environments | New |

The Home overview shows the stack: Knowledge sits across every stage ("every stage reads
context in and writes decisions back") and Platform sits underneath everything ("repos,
containers, models, budgets and guardrails").

**North-star outcome:** shorten idea → merged code (mockup baseline is about 9 days
median), with **every agent action traceable, costed and approved by an accountable person**.

## 2. Who uses it

Each person picks a **work role** at first login (pre-selected from their Entra job title).
The work role shapes their "For you" home, default filters and suggested tasks. It **does
not grant permissions**; permissions come only from the access roles in §6.

| Work role | What they do in NooblyJS | Their home leads with | Agent who helps (seed) |
| --- | --- | --- | --- |
| Product manager | Turns signals into specs, gets them approved, follows items to production | Specs waiting on you, top customer signals, your items by stage | Ada Quill (research, spec drafting) |
| Architect | Reviews generated designs, accepts or challenges decisions, keeps standards current | Decisions awaiting sign-off, items entering Architect, standards breaking on PRs | Rhea Voss (architecture drafting) |
| Developer | Reviews, steers and merges what agents build | PRs waiting for review, runs on your repos, failing gates | Juno Park (frontend engineering) |
| Designer | Shapes journeys and flows, approves screens, hands off to build | Flows waiting on you, screens in review, accessibility issues | Design agent |
| Engineering lead | Unblocks the line, balances people and agents, watches cost and speed | Bottlenecks this week, spend against budget, approvals running late | All teammates on their teams |
| Platform engineer | Grants repo access, runs the sandboxes, sets guardrails | Containers running now, images with vulnerabilities, guardrail changes | Otis Fern (indexing, clean-up) |
| Digital teammate (agent) | Drafts artifacts, writes code, opens PRs, indexes knowledge, answers in chats | — | Always capped at the **Contributor** access role |

## 3. Product principles and hard constraints

These are company governance rules, so they are not optional:

1. **People decide; agents propose.** Agents may open pull requests but never merge to
   `main`. Production deploys need human approval, from **two approvers** for restricted
   repos (e.g. `payments-gateway`).
2. **Every agent action is attributable:** who or what, when, on which item, at what cost.
   Every write produces an audit event.
3. **AI providers are Azure, GCP or AWS only.** Claude models route through **AWS Bedrock**
   or **Google Vertex AI** (or Azure where available). Never call a public consumer API
   directly. The provider is configurable per model route.
4. **Developer AI tools:** Kiro is approved. GitHub Copilot is not, so don't add Copilot integrations.
5. **Work tracking:** sync with **Jira Cloud**. NooblyJS does not replace it. (Targetprocess was dropped from scope on
   2026-10-11.)
6. **Collaboration:** Microsoft 365. Notifications and approvals reach people in **Teams
   and Outlook**, including approve-from-Teams cards.
7. **Personal data** is redacted on ingest to Knowledge and in agent logs. Customer data
   stays in-region `[CONFIRM REGION]`.
8. **Agents never see production secrets.** Sandboxes and preview environments get staging values only.
9. **Sandboxes have no outbound internet by default.** Package registries are allow-listed.
10. **Status is said in words, not colour alone.** The product targets WCAG 2.2 AA.

## 4. The lifecycle (core concept)

Every piece of work is an **Item** (e.g. `IDEA-018`, `PRD-031`, or a PR such as
`slots-api #482`) that moves through eight stages (lifecycle v3, since Phase 16b, 2026-10-20; the whole-SDLC view is
the monorepo root's `.claude/steering/product.md` §3):

```
1 Discover → 2 Product → 3 Design → 4 Engineer → 5 Build → 6 Test → 7 Release → 8 Operate
```

Requirements, UX and UI are one **Product** stage, worked on together. **Design** writes the business requirements, the
solution architecture, the functional analysis and the **stories** that build each feature (the Factory's Design section,
at `/factory/design`, §5.3a); from there an item goes on **story by story** (Phase 16c); **Engineer** the application
architecture and test analysis, signed off before anything is built; in **Build** the AI builds and tests and an
engineer gives the Build approval; in **Test** a person verifies the pull request and gives the Test approval. Items that
were in a stage from before moved once, on record (`lifecycle.stages_migrated` in the audit log): Specify, UX and UI to
Product, Architect to Design, Verify (Phase 16a) and Ship (before it) to Test. History written before still says what
it said.

| Stage | Main artifact | Default agent | Exit gate (a person approves) |
| --- | --- | --- | --- |
| Discover | Signal clusters, Idea with RICE score | Research agent (e.g. Ada Quill) | Idea accepted |
| Product | Spec/PRD (problem, goals, user stories, acceptance criteria, readiness checks), journeys and flows, screens | Product, design and UI agents | **Product handoff** (Product lead + Engineering) |
| Design | Business requirements, impacted systems, NFRs, the feature landscape, interfaces and technical requirements, the **stories** (Phase 16c); the container diagram, ADRs, standards check and quality attributes | Analyst agent (Ada Quill stands in), architect agent (e.g. Rhea Voss) | **Design handoff per story** (Solution Architect, `accept-decisions`; any person but a Viewer may give it for them), with the story's work items; ADR acceptance when a new dependency is added. An item without stories (from before 16c) keeps one Design handoff |
| Engineer | Per story: the application architecture per system, drawn from the code; the test analysis (Phase 16d) | Application architect agent (Rhea Voss stands in), test agent (Ada Quill stands in) | **Engineering sign-off** (an Application Architect and a test lead, one approval), with its checks: the work items go to the Software Factory, each with its architecture and test cases |
| Build | Work items → Software Factory runs → PRs | Factory stations / engineering teammates | Gates pass (tests, contracts, quality attributes); **Build approval** (an engineer, the code owner) |
| Test | The pull request verified by a person (tests in environments: root roadmap Phases 19–21) | Test agent, security agent | **Test approval** (a tester, `sign-off-tests`); then the PR may merge |
| Release | Release, rollout and rollback plans (the Operations app, Phase 22) | Release agent | **Production deploy** (two different people, `deploy-production`) |
| Operate | SLOs, incidents, the outcome review (Operations, Phase 23) | SRE agent | **Outcome review** (Product lead): the item is done |

A pull request merged in Bitbucket before its Build and Test approvals moves nothing: it is flagged on the item and in
the audit log (`item.merged_before_approval`), not counted as done.

**Approving on someone's behalf** (Phase 16b). A rule's permission says whom an approval waits on. Any person whose
access role is not Viewer may give it, for themselves or on behalf of someone it waits on; the approval, Activity and
the audit log (`approval.on_behalf`) record who gave it and for whom ("Lerato for Naledi"). Agents and Viewers are
refused, and the refusal is audited. A rule that needs a number of people (the production deploy needs two) needs that
many different people giving it.

**Rules**

- Every stage transition emits an event (`item.stage_changed`, `approval.requested`,
  `approval.decided`, `handoff.created`, …). Activity, Metrics, notifications and the audit
  log all read from these events. Stage times are computed from events, not snapshots.
- **Quality attributes** defined in Architect become **Factory gates** on every PR for that item.
- **Readiness checks** (e.g. "Problem backed by evidence", "Goals are measurable", "Criteria
  are testable", "Dependencies named", "Performance targets set", "Privacy reviewed",
  "Rollout plan") are configurable per stage. An item can't request approval until the
  required checks pass, unless a person overrides with a reason. A failing check offers one
  agent action (e.g. "Ask Ada to draft rollout").
- Approvals have a **target time** and an **escalation path** (remind → escalate).
- An item can be **sent back** to an earlier stage with a reason, and metrics track this.
- Each stage can call a configured teammate to draft its artifact.

### Approval rules ("Who approves what")

| Decision | Approver (whom it waits on) | Target time | If late |
| --- | --- | --- | --- |
| Product → Design (Product handoff: spec, UX and UI) | Product lead + Engineering | 1 working day | Remind, then escalate |
| New dependency (ADR) | Architect | 1 working day | Remind |
| Design → Engineering (Design handoff) | Solution Architect | 1 working day | Remind, then escalate |
| Engineering → Build (Engineering sign-off) | Application Architect and a test lead | 1 working day | Remind, then escalate |
| Build → Test (Build approval) | Engineer (code owner of the repo) | 4 hours | Remind |
| Test → Release (Test approval; then the PR may merge) | Tester | 4 hours | Remind |
| Production deploy (Release → Operate) | Two approvers | Same day | Hold deploy |
| Outcome review (Operate → done) | Product lead | 5 working days `[CONFIRM]` | Remind |
| Threat model accepted (the Security app, Phase 19) | Architect | 1 working day | Remind, then escalate |
| Risk acceptance (the Security app, Phase 19) | Risk owner (`accept-risk`) | 1 working day | Hold the release |
| Infrastructure design → Test or Staging | Platform owner | 1 working day | Remind |
| Write to Jira or Bitbucket (only for a kind of write an Owner set to "needs approval", Phase 13) | Approver | 1 working day | Remind |

Rules are editable in **Teams & roles** (Phase 3; until then they are the file
`data/workflows/approval-rules.yaml`). A spec needs **every** named reviewer, the Engineering sign-off one in each of
its two places (`slots`), the others **one** of theirs, and a production deploy two different people (Approve & move
on an item in Release records one and waits on the others who may decide it). Outcome review, threat model and risk
acceptance, and the lifecycle v3 rules for a data folder from before, are built in (`src/lifecycle/config.js`); threat
model and risk acceptance are decided by the Security app and are refused until it runs. The UI handoff, the merge and
the release candidate are retired (Phase 16b): an older file's rules are kept for history and not listed, and their
open approvals were withdrawn (the merge became the Build approval).
"1 working day" means by the end of the next working day (Monday to Friday). An escalation goes
to the Owners one working day after the target `[CONFIRM]`.

## 5. Screen inventory and capabilities

### 5.1 Shell (every screen)

- **Suite rail** (84px, navy): Home, Factory, Infra, Teammates, Knowledge, Platform. Since 2026-10-19 Product is a
  section of the Factory, not a rail item: its sidebar is grouped **Product · Design · Engineering · Build · Test** (§10;
  lifecycle v3, Phase 16b). Infra was a section too
  from 2026-10-19 to 2026-10-20 and is its own rail item again (CHG-007).
- **Module sidebar** (260px): the module name in lowercase (`nooblyjs-ai-host`, `product factory`,
  `factory`, `teammates`, `knowledge`, `platform`), nav rows with badges, and a **status
  card** at the bottom (e.g. "All systems healthy · 9 agents · 14 items in flight · Spent
  today $142 of $400", or the module's own spend against budget), plus the signed-in person
  and their work role. While onboarding tasks are open, Home shows a **Getting started**
  card instead ("1 of 4 · Next: decide on ADR-014").
- **Content** area with a fluid width up to 1240px. The layout stacks on narrow screens.
- **Team chat panel** (380px, docked right) on every item and work page. See §5.9.
- The shell stays in place when you move between modules, including into Factory, Teammates
  and Knowledge. Only the content area changes, so an open chat thread survives the move
  (`tech.md` §2.1, ADR-001).
- Design tokens, type, components and accessibility rules: see brief §7 and `.claude/style/`.

### 5.2 Home (`nooblyjs-ai-host`)

Nav: For you, Overview, Lifecycle, Approvals (badge), Activity, Metrics, Teams & roles.

0. **For you** (the default landing page after onboarding): see §5.8.
1. **Overview** (`noobly-platform-home`; the landing page for Designer and Engineering lead until their own "For you" layouts are designed): eyebrow "NooblyJS · Engineering lifecycle", title "From idea to merged code", and a summary in words ("14 items in flight across five systems. Four are waiting on you."),
   with a **New idea** action.
   - **The line, end to end**: the eight stages, each with a count of what is in it.
     Discover: ideas. Product: specs, UX and UI (and how many are in review). Design: ADRs proposed and Design
     handoffs waiting. Engineer: sign-offs waiting. Build: on the line and PRs awaiting the Build approval. Test: PRs
     awaiting the Test approval. Release: deploys awaiting approval. Operate: outcome reviews due. Above the strip sits the median idea → merge over the
     last 30 days. Under it are two bands: **Knowledge Repository** ("every stage reads
     context in and writes decisions back") and **Platform** ("repos, containers, models,
     budgets and guardrails underneath").
   - **One card per system**, with a one-line purpose and two live stats. Product Factory:
     items in design, approvals pending. Software Factory: slots in use and queued, spend
     today against the daily cap. Digital Teammates: teammates on a task (n of m), % of the
     month's budget. Knowledge: documents and sources, pages needing review. Platform: repos
     and live containers, vCPU in use.
   - **Waiting on you** (**All approvals** link): spec, ADR, handoff and PR approvals, each
     with a type tag, a line of context ("Drafted by Ada Quill · readiness 6 of 7 checks",
     "Adds a new dependency · needs an architect's sign-off", "4 screens · will create 6 work
     items", "All gates passed first time · $3.80 to produce") and a **Review** action.
   - **Recent activity** (**Full log** link to Activity): actor, action, system and time.
2. **Lifecycle** (`noobly-platform-lifecycle`): "Every item from idea to production, and where
   it is waiting." Filters with counts (All / Mine / Waiting 3+ days). Per-stage count and
   median time, with the slowest stage highlighted. An **item × stage swimlane** (legend: In
   flight / Done / Now / Waiting too long) lists every kind of item: ideas (showing
   their RICE score), specs and PRs. Each row shows the title and id, the current actor or
   state ("Your review", "Rhea drafting", "Ada · 64%", "Waiting 4 d", "Your merge") and age.
   **Where work waits** shows waiting-for-a-person time per gate over 30 days, plus an insight
   (e.g. "Adding a second architecture approver would cut idea → merge by about two days").
   **Handoffs this week** are counted by stage pair, including "Sent back for changes".
3. **Approvals** (`noobly-platform-approvals`): "Decisions only a person can make", followed by a
   summary in words ("Four are waiting on you; the oldest for 26 hours."). Tabs with counts:
   Waiting on you / Waiting on others / Done this week. The queue covers spec, ADR, UI
   handoff and **merge** decisions. Each row shows the type, age and due state ("26 h · due
   today"), the title, the stage transition and who requested it ("Product → Architecture ·
   from Ada Quill"; "Software Factory → Ship · all gates passed"). The **detail panel** has:
   - a header with the decision type, who requested it, when, and the version ("Requested by
     Ada Quill · 26 h ago · v4"), plus a from → to stage tracker
   - **What you're approving** (a summary with the targets) and **Read the full spec**
   - **Readiness** (n of m, with the failing check named)
   - **Other reviewers** (n of m approved, by whom)
   - **Agent cost so far**, with what it paid for ("$7.40 · Research + 4 drafts")
   - **What happens next** ("Rhea Voss (Architect agent) starts the container view and
     decisions. You will be asked to sign off any new dependency.")
   - an optional comment, and **Approve & send to <next stage> / Request changes / Reassign**
   
   The **Who approves what** rules table (§4) sits below, with an **Edit in Teams & roles** link.
4. **Activity** (`noobly-platform-activity`): "Everything people and agents did across NooblyJS,
   newest first", grouped by day (Today, Yesterday, …). Filters: Everything / People / Agents /
   Product / Factory / Teammates / Knowledge / Platform. Each row shows the actor (person,
   agent or system, with an avatar or initials), the action and item, an optional detail line
   ("on web-storefront · checkout focus order"), the system tag, the kind (Agent / Person /
   System), the time and **the cost of that agent action**. System rows can carry an outcome
   ("passed on retry"). A merge row names the person who merged and the item's **total**
   cost. Side panels: **Live now** (how many agents are working, each with its current task,
   and **See all**) and **Today so far** (agent actions, human decisions, PRs opened, spend).
   **Load earlier** pages back.
5. **Metrics** (`noobly-platform-metrics`; 7 days / 30 days / Quarter): "How fast ideas become merged code, what it costs, and who does the work." Idea → merge (with trend), PRs merged (from n
   approved specs), First-pass gates %, Human edits (% of PRs changed before merge), Cost per
   merged PR (agents + compute). Each tile has a line that explains it ("1.8 d faster than last
   period", "27 of 38 passed first time"). **Lead time by stage per week** (stacked: Product,
   Architecture, UX & UI design, Build & ship, with each week's total) and a written insight
   ("Architecture is the largest share every week — it's waiting for sign-off, not drafting
   time."). **Spend by system**: the period total, then Digital Teammates, Platform compute,
   Product Factory, Software Factory and Knowledge.
   **Who does the work, by stage**: agent vs people share, median, p90 and sent-back rate.
6. **Teams & roles**: **Invite a person** and **Hire a teammate**. Team cards mix people
   (round avatars) and agents (square avatars) and show focus areas (e.g. Delivery squad,
   Checkout squad, Platform team). A **roles × permissions matrix** and a **members table**
   (name, kind and model, team, role, approvals in 30 days).

### 5.3 Product Factory (`product factory`)

Nav: Overview · *Strategy*: Portfolios · *Stages*: Product, Specs, Architecture, UX Design, UI Design · *Flow*:
Reviews (badge), Handoffs · *Setup*: Settings. Status card: agents on duty, monthly spend against budget.

Where work sits (2026-10-12; the detail is the Product section's `product.md` §4, `nooblyjs-ai-factory/product/.claude/steering/`): **strategic themes** ("Solve the
every day", "Leverage AI") sit above **portfolios** (Digital, Buying, Banking), and a portfolio works towards any
number of them. A portfolio has none or many **value streams** (Digital Commerce, Media and Advertising, Rewards,
Data Monetisation). Each portfolio and value stream has a Markdown document made from a template that an Approver
changes in the Product Factory's **Settings**. Portfolio epics, epics, features and requirements sit below and are
not built yet `[CONFIRM how they map onto ideas, specs and Jira]`. The **Portfolios** screen shows the themes,
portfolios and value streams, and opens each document.

7. **Product board** (Stage 1 · Product): tabs Board / Roadmap / Insights, a **New
   idea** action, and filters by **portfolio** (Digital, Buying, Banking), then its **value streams**, then
   **product** (Delivery, Checkout, Search, …), which replaced "domain" on 2026-10-10. A product sits in one portfolio
   and may sit in one of its value streams. Portfolios and products are labels a person types and adds, set up in
   the board's **Portfolios & products** panel (first run: "Start with your portfolios"), and
   Mine. Kanban columns: **Signals** (clustered from Zendesk tickets, app reviews, app logs,
   with counts) → **Ideas** (product, RICE score) → **Spec drafting** (agent progress,
   or "Awaiting your brief") → **In review** (reviewer progress) → **To architecture**.
   Side panels: **Top signals this week** (from Knowledge, with the source count) and the
   **Q4 roadmap** (items across October–December with their current stage span).
8. **Spec detail** (e.g. PRD-031): status pill, product and portfolio, authorship ("Drafted by Ada Quill ·
   edited by Lerato M. · v4"), sticky **Request changes / Approve & send to Architecture**.
   Body: Problem (evidence-backed), Goals (measure / today / target), User stories,
   Acceptance criteria (given/when/then), Out of scope. Side rail: **Where this is** (stage
   tracker), **Readiness** (n of 7 with one agent action for the gap), **Linked knowledge**
   (runbooks, ADRs, customer insight) and **Reviewers** with their status.
9. **Architecture** (Stage 2): tabs Diagram / Decisions / Contracts / Standards. A
   **container view** generated by the Architect agent from the spec and existing services
   in Knowledge. Nodes are marked new / existing / external, edges are labelled with their
   protocol, and the diagram is **Edit as code**. **Decisions** list ADRs (proposed /
   accepted) with **Accept / Discuss**, flagging ones that add a dependency, plus **New ADR**.
   **Standards check** (approved stack only, customer data in-region, every API has a
   contract, new dependency needs an ADR). **Quality attributes** table (attribute,
   scenario, target, verified by) whose rows become Factory gates.
10. **UX Design** (Stage 3): tabs Journey / Flows / Research. A **journey map** per persona
    across steps, with Doing / Feeling / Pain / Opportunity rows. Opportunities can be
    marked out of scope and linked to another PRD. A **flow** with screens and decision
    branches. **Research** results (usability and preference tests) and **open questions**
    with a "Run a quick test" action.
11. **UI Design** (Stage 4): **Open in canvas** and **Send to Software Factory**. A
    device-frame **screen gallery** (Mobile / Web / Store console), each screen with a status
    (approved / in review). **Design system reuse** (version, n of m components reused, new
    components named). **Accessibility checks** (contrast ≥ 4.5:1, 44px touch targets, state
    not shown by colour alone, screen-reader labels). **Handoff preview**: the generated work
    items per repo, the repo count and the cost estimate range.

> The Product Factory numbers its own stages 1–4 (Product, Architecture, UX, UI). In lifecycle v3 (Phase 16b) its
> Product, UX and UI are the Product stage (with Discover before it), and its Architecture the Design stage, whose
> pages the Factory shows in its Design section (`/factory/design/architecture`).

### 5.3a Design (the Factory's Design section, `/factory/design`, Phase 16c)

The sidebar's Design group: **Architecture** (the Product section's pages, §5.3), **Business requirements**,
**Solution architecture**, **Functional analysis**, **Stories**, **Handoff to the Factory**. Each row lists the items in
Design with that part said in words ("6 business requirements · 4 accepted", "1 of 3 stories handed off") and opens the
item's page for it, with tabs for the five parts. Root `product.md` §3.2a says what Design is for.

- **Business requirements** (`BR-031-01`): drafted by the analyst agent, one per goal and per user story of the spec,
  each quoting the words it comes from. A person with `accept-requirement` accepts each; an edit makes it proposed again.
- **Solution architecture**: impacted systems (from the item's repositories, else its product's, and Platform's
  records: new, changed or retired, with the owning team and what Knowledge has on each), NFRs (from the item's quality
  attributes, then the NFR catalogue's default for each category not covered, `[CONFIRM]` targets), and the feature
  landscape (one feature per user story; a person names what each depends on, with no loops). Links to the container view and ADRs, the threat model (Phase 19) and the
  infrastructure design.
- **Functional analysis**: interfaces (one per relation of the container view; people add, edit and remove them; a side
  missing is said in red **and** in words) and a technical requirement per impacted system.
- **Stories** (`STORY-031-1`): proposed one per feature, each tracing to its business requirements, systems, interfaces,
  technical requirements, NFRs and acceptance criteria. An analyst **merges** picked stories (into the first) and
  **splits** one (it keeps the first part). Each story is a lifecycle item of its own (Lifecycle shows it, with its item
  and feature); one merged away is withdrawn.
- **Handoff to the Factory**: Design's three checks (every business requirement covered by a story, no decision still
  proposed, every interface with both sides named) and a **Hand off to Engineering** per story, with an override
  reason when a check fails. The story moves to Engineer with one work item per impacted system; the item stays in
  Design until its last story goes, then follows its stories. The item itself can't be handed off, signed off or moved
  on as a whole once it has stories.
- **Sample:** a fresh seed has PRD-027's whole design, with STORY-027-1 handed off and two stories held in Design (CHG-008).
- Agents draft every part (each a teammate task); people accept, edit, merge, split and hand off. Agents are refused
  every acceptance and handoff, and the refusal is audited. A Viewer reads everything and changes nothing.

### 5.4 Software Factory (`factory`): existing, restyle to NooblyJS

Nav: Line, Runs, Inbox, Campaigns, Metrics. Status card: accepting work, slots running and
queued, spend today against the daily cap, and **Stop all runs**.

17. **Metrics** (7 days / 30 days / All time): Delivery (runs, PRs delivered per day, lead
    time to PR, lead time to merge, first-pass gates, PR acceptance, human edits before
    merge, escalations, cost per merged PR) and a **Stations** table (runs, median, p90,
    cost, failures). Empty states must say plainly what is missing ("No stations have run in
    this period" plus "Open the Line").

Line, Runs, Inbox and Campaigns come from the existing repo. The existing line is triage →
spec → approve → build → verify → review → repair → deliver → merge, with every step an
event.

**Engineering** (Phase 16d, root `product.md` §3.2b). **Application architecture**: the stories in Engineer, each impacted
system's state in words; a story's page with, per system, the application flow, the objects, the NFRs per component and
the changes, drawn by an agent from the repository's code at the head of main (Ask Rhea to draft, as a teammate task;
Platform refuses a repository agents may not read), edited and accepted by a person (`accept-decisions`), and said
stale when main moves past the commit it was read at. A repository the Factory can't read here is drawn from the design
alone, and says so. **Test analysis** (the Test section, `/factory/quality`): a story's test cases from its acceptance
criteria (given/when/then), at the levels the test policy gives (E2E when a customer sees it, else integration; a
contract test per interface; an E2E test for its journey; accessibility checked by a person), marked ready by a test
analyst; coverage in words ("1 of 2 criteria have a ready test case"). **Engineering sign-off**: each story's three
checks (the architecture accepted and current, every criterion with a ready test case, every interface with a ready
integration test), each naming what fails, and Sign off & send to Build, with an override reason when a check fails. A
work item then carries its system's architecture and its test cases into the Software Factory.

**Pull requests and Test** (CHG-008): Pull requests shows each one's Build and Test approvals; Test approvals what waits
on a tester, what is in Test and what was given; Test runs, Coverage and Defects. The pull requests and approvals are
the lifecycle's, live; the runs and defects are the seed story's sample, said so, until Phases 16e and 20.

### 5.5 Digital Teammates (`teammates`): existing, restyle to NooblyJS

Nav: Team roster, Profiles, Work timeline, Billing & timesheets, Hire a teammate, Team
memory, Settings, Admin. Status card: monthly budget used, including pending.

18. **Team roster**: "Your digital teammates." **Hire a teammate** ("Pick a role, a model and
    a budget"). Summary tiles: on a task now, billed in the last 30 days (hours, amount),
    budget % used. Filters: Everyone / On a task / Available / Paused / Off shift. Each
    teammate card shows name, avatar, role, current task, skills, model (Opus / Sonnet /
    Haiku with a $ tier), hourly rate, billed in 30 days (hours and amount) and memory item count.

### 5.6 Knowledge Repository (`knowledge`)

Nav: Ask & search, Spaces, Collections, Sources, Graph, Needs review (badge),
Contributions, Access. Status card: index up to date, document and source counts,
% reviewed in 90 days.

12. **Ask & search**: "What does the team know?" A question box returns an **answer with
    numbered citations**, each showing type, location and freshness. Actions: **Add to
    <item>**, **Save as page**, **This is wrong**. Panels: **Spaces** (Enterprise, Financial
    Services, People, Acme Retail), **model types/collections** with counts (business process
    models, architecture models, standards, infrastructure models, decisions & specs,
    customer insights, …), **Sources** with sync status (GitHub, Confluence, Jira, Zendesk
    with PII redacted, Google Drive/SharePoint, NooblyJS itself, which is live), with **Add
    source** and re-auth prompts. **Needs review**: stale but heavily cited, contradicts
    merged code, superseded but still cited by agents, mentions outdated platform versions.
    Each has a Review or Archive action.
13. **Space / process model** (e.g. Enterprise Space → Business processes → L0): a space
    tree (architecture models, business processes L0 → L1 folders, standards,
    infrastructure models, capabilities). The model header shows type, level, owner, folder
    count and "Agent context up to date". Actions: **Pin, Share, Subscribe, Rebuild context**.
    Tabs: Model / Folders / Attributes / Linked documents / Notes. The **L0 Enterprise
    Process Model** shows the purpose statement and three **bands of chevrons**: Enterprise,
    Value chain (Plan PL, Procure PR, Supply SU, Sell SE) and Support. Each chevron has a
    code, its L1/L2 counts or active specs, and drill-down. **Used across NooblyJS** backlinks
    show the specs, ADRs and teammate work mapped to the model. **Ask about this model**
    offers suggested questions.

### 5.7 Platform (`platform`)

Nav: *Build*: Repositories, Containers, Environments · *Govern*: Settings, Secrets,
Members, Audit log. Status card: cluster health, containers running and queued, vCPU used.
On Containers, the status card also carries **Stop all containers**.

14. **Repositories** (`noobly-platform-repositories`): "<n> connected. Agents can only touch
    what is granted here." **Connect repository**. Filters with counts: All / Factory enabled /
    Read only / Not indexed. The table shows repo and branch (with notes such as "new this
    week" or "restricted"), stack, **agent access** (No agent access / Read only / Read + open
    PRs), base image, gates (n of m; blank when agents can't open PRs) and last activity. The
    **detail panel** ("<repo> · repository settings", with **View on GitHub**) shows build &
    test (install, test, container image), **What agents may do** toggles (read code and
    history, push to agent branches, open PRs, merge after all gates pass, index into
    Knowledge), and **Secrets & environments** (mapped vault keys such as `REDIS_URL →
    vault · staging`, staging only, with the note "Agents never see production secrets.
    Preview environments get staging values only.").
15. **Containers** (`noobly-platform-containers`): "Every agent works in its own sandbox. This is
    where they run." Range: Now / 24 hours / 7 days. Tiles: running (queued, failed), vCPU
    (used / total), memory (used / total GB), and compute today against the daily cap.
    **Pools**, each with capacity (n of m slots), a **Full** state and what's queued: Factory
    stations, Teammate sandboxes (one per teammate on a task), Preview environments (one per
    open PR, torn down on merge), Knowledge indexers (nightly full sync at 02:00). **Running
    now**, sorted by uptime (workload, kind, repo, image, CPU, uptime, **Logs** or **Open**
    for previews, **Stop**). **Base images** (with an **Image registry** link): image and
    version, how many repos use it, when it was rolled, and CVE status by severity ("0 CVEs",
    "2 medium").
16. **Settings** (`noobly-platform-settings`): "Models, budgets and guardrails that apply across
    every NooblyJS system." Tabs Models / Budgets / Guardrails / Integrations / Organisation, with
    **Save changes**.
    - **Model routing** ("Which model does which kind of work"): work type, which systems use
      the route ("Product Factory · Factory review station"), model with its cost tier
      ($ / $$ / $$$), fallback, and 30-day spend. For example: specs, architecture and review
      → Opus with a Sonnet fallback; implementation and tests → Sonnet with a Haiku fallback;
      indexing, triage and clean-up → Haiku. Each route carries its provider (Bedrock / Vertex / Azure).
    - **Budgets**: the month's total across systems ("$2,690 of $11,600"), then monthly per
      system (a daily cap for Software Factory), and **Pause all agents when a budget is reached**.
    - **Guardrails** (on/off, scope note, and a **Policy history** link): agents open PRs and
      people merge (per-repo override in Repositories); human approval for production deploys
      (two approvers for payments-gateway); new dependency requires an ADR (checked at the
      Architecture stage and on PRs); redact personal data on ingest (Knowledge sources and
      agent logs); allow outbound internet from sandboxes (off; package registries are always allowed).
    - **Integrations**: Bitbucket, Jira and Microsoft Teams/Outlook, each with its state. Bitbucket and Jira also
      show whether NooblyJS writes to them (**Record only** or **Sending**), the rule for each kind of write, and the
      outbox (Phase 13). The mockup's Google Drive/SharePoint and Datadog rows were dropped on 2026-10-11: nothing is
      built for them.

Environments, Secrets, Members and Audit log appear in the nav but have no mockup yet.
Build them in the same patterns. The audit log lists actor, action, target, cost and time
for every write.

Built in Phase 9 (decisions in `.claude/specs/phase-09-platform-governance/requirements.md`):
**Infrastructure (`nooblyjs-ai-infrastructure`) owns environments and previews**, so Platform · Environments is a
read-only summary that links there; Platform keeps Secrets (references only). Containers run on a **simulated**
runtime until §12 Q3 is decided. "Agents open PRs, people merge" is locked on, and an agent may never merge
whatever a repository's toggles say. A guardrail change needs an Owner and a reason; policy history is the audit
log's `guardrail.changed` records. Integrations show Connected or Not connected from NooblyJS's environment; Slack is
dropped (§11).

### 5.7a Infrastructure (`infrastructure`, rail label Infra)

Hosted from `nooblyjs-ai-infrastructure` at `/infrastructure` (Phase 9a; a section of the Software Factory at
`/factory/infrastructure` from 2026-10-19 to 2026-10-20, CHG-005 and CHG-007: provisioning is not part of the
factory); its screens and rules are specified in that repo's `.claude/steering/product.md`, from the mockups
`noobly-infrastructure-environments` and
`noobly-infrastructure-design-from-architecture`. Nav: Environments, Designs, Provisioning runs, Testing in
environments · *Govern*: Blueprints, Cost, Policies. Status card: drift, live environments, cloud spend.

How it sits in NooblyJS:
- **An infrastructure design is an artefact on the item with its own approval**, not a lifecycle stage. A version
  waiting for Test or Staging shows on Home · Approvals ("INF-031 v2 · Approve & provision Test"); deciding it there
  or on the Design screen is the same decision. The platform owner (`change-repo-access`, Owner) decides `[CONFIRM]`.
- Preview and Dev apply automatically; Test and Staging need that approval; Production only through a release.
- **It owns environments and previews.** Platform · Environments lists them and links here.
- New provisioning pauses at the **Cloud (Infrastructure)** budget in Platform · Settings.
- A drift sweep runs every 6 business hours; drift is never repaired automatically.
- The provisioner is a mock until the cloud, region and IaC tool are decided (§12 Q3).

### 5.8 Onboarding and "For you" homes

19. **First-login onboarding** (`noobly-platform-onboarding-first-login`): "Set up NooblyJS around the work
    you actually do. Four short steps. You can change any of this later from your profile."
    It has a step list on the left, each step with a hint (Your role: "So we show the right
    work"; What you'll do: "Your part of the lifecycle"; Teams & tools: "Filter to your teams";
    Your home: "Tuned for you"), and shows "Signed in as <name> · Microsoft account".
    **Back / Skip for now / Continue**, and the last step offers **Open my home**. The content
    for each role is in the table after this list.
    1. **Role**: "What do you do?" Six role cards (§2), with one pre-selected from the
       Microsoft profile job title, and a note saying where the guess came from.
    2. **What you'll do**: the role's promise ("Agents research and draft; you shape the
       problem and approve what moves on"), **three numbered tasks** each with where it
       happens, what the home will lead with, and the agents who'll help ("They draft; you
       decide. Nothing leaves your stage without your approval.").
    3. **Teams and tools**: "Your dashboards only show work from the teams you pick." Team
       cards show how many people and agents are in each team ("4 people · 2 agents"), and a
       team is marked **Suggested** when you're in its Microsoft Teams channel. The teams you
       pick filter every dashboard. Connect two role-specific tools (table below). Microsoft
       Teams is already connected. A toggle for **Send approvals to me in Teams**.
    4. **You're set**: a summary ("Your home is tuned for a product manager on the Delivery
       squad."), your **first three things**, and a preview of the role's home.
    - Every choice can be changed later (profile → **Change role**). Store work role, teams,
      tool connections, onboarding progress and dismissed hints per person.

    **Onboarding content per role** (seed copy from the mockup; the first three things refer to
    the PRD-031 story):

    | Role | Card blurb | Promise (step 2) | Three tasks → where they happen | Tools (step 3) | First three things (step 4) | Lands on |
    | --- | --- | --- | --- | --- | --- | --- |
    | Product manager | Turn customer signals into specs and get them approved. | Agents research and draft; you shape the problem and approve what moves on. | Shape ideas from signals → Product board · Approve specs → Specs, Approvals · Follow your items to production → Lifecycle | Jira Cloud, Zendesk | Review PRD-031 · Same-day delivery slots; Score the "Smarter substitutions" idea; Pin the Delivery space in Knowledge | For you · PM |
    | Architect | Shape solutions and sign off the decisions that matter. | The architect agent drafts container views and decisions; you own the trade-offs. | Review generated designs → Architecture · Accept or challenge decisions → Decisions, Approvals · Keep standards current → Knowledge | GitHub, Enterprise Knowledge Repository | Decide on ADR-014 · Slot cache in Redis; Review the tracking-map container view; Confirm the 3 standards flagged as stale | For you · Architect |
    | Developer | Review, steer and merge what agents build. | The Software Factory and engineering teammates write the code; you review, steer and merge. | Review agent pull requests → Software Factory · Steer runs that get stuck → Factory · Runs · Pair with engineering teammates → Teammates | GitHub, Jira Cloud | Review slots-api #482; Look at Run 213's contract-test failure; Set your code-owner repos | For you · Developer |
    | Designer | Journeys, flows and screens built from the design system. | Agents draft journeys and screens; you set the direction and hand off. | Shape journeys and flows → UX Design · Approve screens → UI Design · Hand off to build → Approvals | Figma `[CONFIRM]` (§12 Q11), Jira Cloud | Review the slot picker screens; Answer the hold-timer question; Pin the design system | Overview |
    | Engineering lead | Flow, people, agents and budgets across your teams. | See where work waits, who is overloaded and what it costs. | Unblock the line → Lifecycle · Balance people and agents → Teams & roles · Watch cost and speed → Metrics | Jira Cloud, GitHub | Add a second architecture approver; Review October spend; Check Teams & roles | Overview |
    | Platform engineer | Repos, sandboxes, models and guardrails. | Keep the factory floor safe, fast and affordable. | Grant repo access → Repositories · Run the sandboxes → Containers · Set guardrails → Settings | GitHub, Azure | Patch temurin-21; Review agent access on mobile-app; Check model spend | Platform · Repositories |
20. **For you · <role>** (mockups: Product manager, Architect, Developer. Designer,
    Engineering lead and Platform engineer reuse the pattern):
    - **Greeting and summary in words** ("Good morning, Lerato. Two specs need you today,
      and one of your items has waited four days for an architect."), with role + team in
      the eyebrow, **Change role**, and one primary action (PM: New idea; Architect:
      Open Architecture; Developer: Hand a ticket to a teammate).
    - **Filter row**: "Showing: <my items | Architecture work | Repos I own> · <teams>", plus **Show everything**.
    - **Four tiles** per role. PM: specs waiting on you, your items in flight, shipped this
      month (idea → production), new signals. Architect: decisions awaiting you (past
      target), items in Architecture (median against target), standards broken on PRs, models
      to review. Developer: PRs to review (oldest against target), runs on your repos, needs
      help, merged this week (first-pass).
    - **Role panels.**
      - PM: Waiting on you (Review / Preview / **Nudge**), Your items (stage swimlane), Top
        signals for your domain, "Ada Quill is working for you" (progress, **Give Ada a new brief**).
      - Architect: Decisions awaiting sign-off (summary, alternative considered, **Accept /
        Discuss / Open diagram**), Your Architecture queue (**Ask Rhea to draft / Watch /
        Preview spec**), Standards broken on PRs (per standard, with the offending PR),
        Models to review (contradicted, stale, heavily cited).
      - Developer: PRs waiting for you (run, source spec, cost, size, gates, **Review**),
        Runs on your repos (station progress, cost so far), **"Run 213 is asking you"**
        (a question from a stuck run, linked to the acceptance criterion, with **Answer /
        Open run**), and your engineering teammate card ("Juno opens PRs on your repos. You
        review and merge; Juno never merges to main.").
    - **The Design homes** (Phase 16c): the Solution Architect's (items in Design, decisions awaiting them, stories ready
      for their Design handoff, stories handed off) and the Functional Analyst's (interfaces with a side missing, stories
      to finish: no criteria or no business requirement, items in Design), each row linking to its Design page.
    - **The Engineering homes** (Phase 16d): the Application Architect's (architectures to draft, accept or draw again,
      stale ones, the stories in Engineer, sign-offs waiting on them) and the Test analyst's (criteria without a ready
      test case, stories with no test analysis, interfaces without a ready test, sign-offs waiting on them).
    - **Your first week** checklist (Hide). It tracks the onboarding's first three things
      plus "Pick your role and teams" to completion, and drives the Getting started card.

### 5.9 Team chat (people + agent teammates)

21. **Thread panel**: a docked 380px panel on the right of work pages, scoped to what's on
    screen (a spec, an ADR, a repo) or to a channel (e.g. `#platform`). The brief puts it on
    Spec, Architecture and Platform · Repositories, and every item page should have one.
    *(Described in the brief. No exported mockup yet.)*
    - People @mention people or agents. Agents reply with text, **structured cards** (draft
      plans, comparison tables, PR links), **cited Knowledge sources**, and a visible
      "working…" state. Agent messages look different: a square avatar, an "Agent" tag and a tinted bubble.
    - Agents may draft and edit content from the thread. **Status changes, approvals and
      permission grants are always a person's action.** When an agent needs a permission,
      it posts an **approval card** (Approve / Decline) that only the right access role can answer.
    - **System lines** record what changed because of the thread (e.g. "spec v5").
    - **Quick-action chips** depend on the context: Summarise thread, Find related ADRs, Why did a gate fail?
    - Every message and decision goes to the audit log and the item's Activity. Messages
      are mirrored to the item's Microsoft Teams channel `[CONFIRM]`.

### 5.10 Microsoft Teams bot ("NooblyJS")

22. **NooblyJS in a Teams chat or meeting** (`noobly-teams-bot-asks-who-to-add`,
    `-joins`, `-answers-in-the-chat-html`). The host chrome in the mockups is a neutral
    stand-in; only the bot and teammate cards are NooblyJS design.
    1. **Asks who to add:** when @mentioned or added, the bot posts an Adaptive Card:
       "Which teammate would you like to add to this meeting?" It lists the available agent
       teammates (name, role, status, rate), each with **Add**. The footnote says "The teammate
       sees messages from the moment they join, not before. Time is billed to <team>."
    2. **Teammate joins:** a system line ("Ada Quill joined the chat") and a confirmation that
       says who added them, how to ask ("Mention @Ada"), and **Choose someone else**. The
       teammate posts under its own name and avatar, labelled **NooblyJS teammate**, and introduces
       itself with what it has loaded (e.g. "I've loaded PRD-031 and the Delivery squad's
       latest activity… I'll post a summary to the spec when the meeting ends").
    3. **Answers in the chat:** when @mentioned, the teammate replies with text plus an
       **Adaptive Card** (key facts as label/value rows, a primary action such as **Open in
       NooblyJS / Open ADR-014 / Review PR #485 / Add to PRD-031**, a secondary action such as
       **Ask Thabo to decide / Compare in detail / Download CSV**), **sources**, and **the
       cost of that answer**. A "listening" indicator shows while it waits.
    - **Rules:** the teammate reads only messages posted after it joins. Its time is billed
      to the team the meeting belongs to. It **can't approve anything**: approval actions
      deep-link into NooblyJS. Every message is logged to the item's Activity and the audit log.
      Meeting notes are posted back to the item on request.

### 5.11 NooblyJS in the browser (the Edge extension)

23. **A NooblyJS side panel in Microsoft Edge** (`apps/edge`, no mockup yet). It brings team chat and the
    agent teammates to the page a person is working on, starting with **Jira Cloud**, so NooblyJS meets people in the
    tools they already use instead of asking them to copy things across.
    1. **Signed in already.** The panel uses the person's NooblyJS session (nooblyjs-core's authservice: Entra SSO in
       production). There is no separate sign-in, password or token to paste. Someone who isn't signed in gets
       **Sign in to NooblyJS**, which opens NooblyJS in a tab; with Entra SSO in an Edge work profile it finishes by itself.
       The panel shows who they are and their access role. A browser profile's email is never taken as proof of who
       someone is.
    2. **Knows the page.** On a Jira issue the panel shows the issue (key, summary, type, status), read from the page
       the person has open, and the NooblyJS item it belongs to, if any (Phase 11's issue links: "DTE-412 · part of
       PRD-031"). It reads only when the panel is open, and only that tab. Nothing is read in the background.
    3. **Agent chat about the issue.** The same thread and teammates as NooblyJS team chat (§5.9), scoped to the linked
       item, or to the issue on its own if it has no item. "@Ada what is blocking this?" answers with sources and
       cost, like a chat reply. The panel says what the teammate was given ("the issue as you see it, PRD-031's spec
       and ADRs").
    4. **Drafts for Jira, put in by the person.** Ask for a **description**, **acceptance criteria**
       (Given/When/Then from the spec), **sub-tasks** from the work items of the handoff, a **comment** (a status
       update from the Factory's runs and PRs), or a **bug report** from what the person describes. The teammate
       drafts in the panel. The person edits it and presses **Put in the field**, which places the text in Jira's
       own editor on the page. **The person presses Jira's Save.** The issue is changed in their name, in Jira's own
       history, under their own Jira permissions. NooblyJS never saves, creates or transitions anything in Jira from the
       extension.
    5. **Back into NooblyJS.** **Link to item** links the issue to a NooblyJS item (a NooblyJS write, audited). **Save to
       Knowledge** sends a selected passage to Knowledge as a source to review (redacted on the way in).
    6. **Later pages** `[CONFIRM]`: a Bitbucket pull request (explain the change against the item's architecture
       and gates; draft a review comment for the person to post), a Confluence or SharePoint page (Ask Knowledge
       about it), and any page (ask with the selected text as context).
    - **Rules:** agents propose, people decide: the extension fills a field only when the person asks, and never
      presses Save, Create, Transition or Merge. It talks only to NooblyJS, holds no Jira or Bitbucket credentials, and
      calls no Jira API. Each draft is a teammate task: checked by Platform, billed to the person's team, and in
      Activity and the audit log with what was put in which issue's field (`extension.draft_inserted`). Page text
      sent to a model is redacted for personal data first. It is installed for Acme Retail people through Edge
      management policy `[CONFIRM]`.

## 6. Roles and permissions

| Can… | Viewer | Contributor | Approver | Architect | Owner |
| --- | :-: | :-: | :-: | :-: | :-: |
| Read specs, models and runs | ✓ | ✓ | ✓ | ✓ | ✓ |
| Draft specs, ADRs, designs, PRs | — | ✓ | ✓ | ✓ | ✓ |
| Approve specs (the Product handoff) | — | — | ✓ | ✓ | ✓ |
| Accept architecture decisions and the Design handoff | — | — | — | ✓ | ✓ |
| Give the Build approval (as code owner) | — | — | ✓ | ✓ | ✓ |
| Give the Test approval, sign off test analysis (`sign-off-tests`) | — | — | ✓ | ✓ | ✓ |
| Hire teammates, set budgets | — | — | — | — | ✓ |
| Change guardrails and repo access | — | — | — | — | ✓ |
| Change a person's access role (`manage-members`) | — | — | — | — | ✓ |
| Read the audit log (`read-audit`) | — | — | ✓ | ✓ | ✓ |
| Accept requirements (`accept-requirement`) | — | — | ✓ | ✓ | ✓ |
| Accept threat models (`accept-threat-model`) | — | — | — | ✓ | ✓ |
| Accept a security risk (`accept-risk`) | — | — | — | ✓ | ✓ |
| Approve a production deploy, one of two (`deploy-production`) | — | — | ✓ | ✓ | ✓ |
| Declare an incident (`declare-incident`) | — | ✓ | ✓ | ✓ | ✓ |

The last five rows were added in Phase 16a, `sign-off-tests` in Phase 16b; a data folder from before gets them built in
(`src/middleware/roles.js` `BUILT_IN_PERMISSIONS`), and a row its `roles.yaml` lists wins. `accept-release-candidate`
went with Verify (Phase 16b) and is no longer shown. Nothing uses `accept-requirement` or `declare-incident` yet (Phases
18 and 23).

**Since Phase 16b an approval's permission says whom it waits on**: any person but a Viewer may give any approval on
behalf of one of them, and who gave it, for whom, is recorded (§4). The matrix still decides everything else (drafting,
budgets, guardrails, repo access, members, the audit log).

**Agents are always capped at Contributor.** Teams mix people and agents. Sign-in is
Microsoft Entra ID (SSO).

## 7. Domain model (first cut)

- **Lifecycle:** Item (id, title, type, stage, status, owner, team, links) · Signal (source,
  text, theme, count) · Idea (problem, RICE, linked signals) · Spec (problem, goals
  as measure/today/target, user stories, acceptance criteria, out of scope, version,
  readiness results) · ADR (number, title, proposed/accepted/superseded, context, decision,
  consequences, adds_dependency) · Diagram (container view as code) · QualityAttribute
  (attribute, scenario, target, verified-by, which becomes a gate) · JourneyMap / Flow /
  UIScreen (with status) · WorkItem (repo, description, estimate; synced to Jira) ·
  Approval (item, type, approver role, requested_by, requested_at, due_at, decision,
  comment) · Handoff (from_stage, to_stage, item, payload summary) · ReadinessCheck.
- **Build** (reuse the Factory): Run, Station, GateResult, PullRequest (repo, number,
  first-pass, human-edited, cost).
- **Teammates** (reuse): Teammate (name, avatar, role, skills, model, rate, memory, status
  on a task / available / paused / off shift, budget, timesheet entries).
- **People & access:** Person, Team, Role (access), PermissionMatrix · **Profile** (work
  role, teams, tool connections, notification preferences such as approvals-in-Teams,
  onboarding step, first-week checklist state, dismissed hints).
- **Conversation:** Thread (scope: item / repo / channel; mirrored Teams channel) · Message
  (author person | agent | system, text, mentions, cards, citations, cost, at) · Card
  (type: plan / comparison / pr-link / facts / approval; actions; answered_by) ·
  **MeetingSession** (Teams conversation id, teammate, added_by, billed team, joined_at,
  linked item, notes posted).
- **Knowledge:** Space · Collection/model type · Document (source, path, owner, last
  reviewed, freshness, citation count, embeddings) · ProcessModel (L0/L1/L2, code, band
  Enterprise/Value chain/Support, parent, children, linked items) · SourceConnector (sync
  status, last sync) · Answer (question, text, citations, "this is wrong" feedback).
- **Platform:** Repository (provider, default branch, stack, agent access, base image,
  build/test/install, mapped secrets, index flag, restricted flag) · ContainerPool ·
  Container · BaseImage (version, CVE scan) · ModelRoute (work type → model → fallback →
  provider) · Budget (system, period, cap, pause-on-limit) · Guardrail (policy, on/off,
  scope, history) · Integration · **AuditEvent** (actor, action, target, cost, timestamp).

## 8. Metrics definitions

| Metric | Definition |
| --- | --- |
| Idea → merge | Per item with a PR merged in the period: the time from the item being opened (`item.created`) to its last merge there. The median, compared with the period just before |
| Lead time by stage | For each of the six complete weeks before this one: the mean length of the stage visits that ended that week, per group (Product, Architecture, UX & UI design, Build & ship = Build + Ship). The sentence under the chart says which group is largest and whether most of its time had an approval open (waiting for sign-off) |
| PRs merged | Merged PRs in the period, with the count of items (approved specs) they came from |
| First-pass gates | % of merged PRs with no gate failure before the merge |
| Human edits | % of merged PRs changed by a person before merge |
| Cost per merged PR | The cost of the agent runs behind each merged PR, averaged. Compute is not attributed per PR yet |
| Agent vs people share | Per stage group, how the events during the visits that ended in the period split between agents and people |
| Median, p90 | Per stage group, over the visits that ended in the period (p90 by nearest rank) |
| Sent-back rate | % of those visits in which the item was sent back from that stage |
| Spend by system | Agent cost by system (Teammates, Product Factory, Software Factory, Knowledge) plus Platform compute |

A **stage visit** is the time an item spends in one group, from entering it to leaving it. The groups (Phase 16b) are
Product (Discover and Product, and history's Specify, UX and UI: one visit), Design (and history's Architect),
Engineer, Build, Test (and history's Verify), Release and Operate, with Ship kept for history. The chart's last part is
Build and Test to release. A visit whose beginning is not in the event log is left out. Periods are 7 days, 30
days and a quarter (90 days), ending now on the business clock.

Metrics must reconcile with the event log: every number is computed from events, and `npm run metrics:reconcile`
recomputes them from the raw files and reports any difference (Phase 10).

## 9. Integrations (priority order)

1. **Bitbucket Cloud** (workspace `acme`; it replaced GitHub in this list on 2026-10-10): repositories,
   branches, commits, pull requests, pipelines and default reviewers. Read first (Phase 11). Since Phase 13 the
   Software Factory pushes `factory/…` branches and opens pull requests with the default reviewers, where Platform
   lets agents open them; NooblyJS shows their checks and reviewers, **never merges**, and moves an item to Ship when
   people have merged its pull requests in Bitbucket.
2. **Microsoft Entra ID** (SSO, with the job title used to pre-select the work role), then
   **Teams / Outlook** notifications and approve-from-Teams cards, then the **NooblyJS Teams
   bot** (Entra-registered Teams app) that brings agent teammates into chats and meetings (§5.10).
3. **Jira Cloud**: read first (Phase 11: issues linked to ideas, specs and work items), then work items ↔
   issues (Phase 13). NooblyJS owns the lifecycle; Jira owns each issue once it exists. An approved handoff creates one
   issue per work item; NooblyJS reads its status back, and moves it forward only for a run started or a pull request
   merged. Writing is **Record only** until an Owner switches it to **Send** (Platform · Settings · Integrations),
   and each kind of write has a rule: automatic, needs approval, or off.
4. **Knowledge sources**: the Enterprise Knowledge Repository wiki, SharePoint, Confluence
   `[if used]`, Zendesk, Bitbucket, and NooblyJS itself.
5. **Model providers**: Bedrock / Vertex / Azure through one internal model gateway that
   records cost per call against item, teammate and system.

## 10. Child projects

Each child project owns one slice of this product. Build only your slice, and integrate
through events and APIs. Don't copy code from another slice.

| Project | Owns | Screens / capabilities |
| --- | --- | --- |
| **`nooblyjs-ai-host`** (this repo) | The NooblyJS shell and the new UI modules: suite rail, module sidebar, design system, routing, SSO, role checks, onboarding and profiles, team chat, the Teams bot endpoint | Onboarding, Home (For you, Overview, Lifecycle, Approvals, Activity, Metrics, Teams & roles), Product Factory screens, Platform screens, chat panel; hosts the restyled Factory, Teammates and Knowledge UIs |
| **`nooblyjs-core`** | Shared backend services: auth, logging, caching, queueing, data, notifying, scheduling, measuring, searching, workflow | Event bus for lifecycle events, **AuditEvent** store, notifications to Teams/Outlook, metrics aggregation, service dashboards |
| **`nooblyjs-ai-common`** | Shared AI building blocks: provider adapters, model catalogue, tokens, **cost**, retry, SSE | The **model gateway** behind Model routing: work type → model → fallback → provider (Bedrock / Vertex / Azure); cost per call tagged with item, teammate and system |
| **`nooblyjs-ai-harness`** | The agent runtime: agent loop, tools, permissions, sandboxing, hooks, MCP, skills, memory | What every agent runs in: factory stations, teammate tasks, Product Factory drafting agents. Enforces guardrails, no outbound internet, staging-only secrets |
| **`nooblyjs-ai-factory`** · Product section (`product/`, `/factory/product`; it was `nooblyjs-ai-product` until 2026-10-19) | The **Product Factory** (with its own screens): signals, ideas, specs, architecture artefacts (diagram as code, ADRs, standards check, quality attributes), UX and UI artefacts, the roadmap, and the per-stage **drafting agents** | Owns the Product board, Spec, Architecture, UX Design and UI Design screens (a UI module in the frame), the handoff preview, and "ask the agent to draft" |
| **`nooblyjs-ai-factory`** · Design section (`design/`, `/factory/design`; Phase 16c) | **Design**: business requirements, solution architecture, functional analysis and stories (§5.3a), and Design's readiness checks | Owns the five Design screens; keeps each story a lifecycle item through `host.service('workflows')` (`syncStories`, `handoffStory`); answers `host.service('design')` |
| **`nooblyjs-ai-infrastructure`** (`/infrastructure`; a section of the Software Factory from 2026-10-19 to 2026-10-20) | **Infrastructure**: designs, environments, provisioning runs, drift, cloud cost | Environments, Design, Designs, Provisioning runs (and a run's page), Environment, Testing in environments, Blueprints, Cost, Policies. Asks the lifecycle engine for design approvals and Platform for the cloud budget; tells Platform its environments and previews |
| **`nooblyjs-ai-factory`** · the line | **Software Factory**: queue, scheduler, line of stations, gates, PR delivery; one app at `/factory` that also mounts the Product section above and answers `host.service('product')` for it | Line, Runs, Inbox, Campaigns, **Metrics**. Accepts handoff work items; applies quality attributes as gates; reports runs, PRs and gate results back to the Item |
| **`nooblyjs-ai-teammate`** | **Digital Teammates**: hire, configure, budget and bill named agents | **Team roster**, Profiles, Work timeline, Billing & timesheets, Hire, Team memory. The source of agents across NooblyJS, including agents answering in chat and Teams meetings; every agent action bills to a timesheet and to the right team |
| **`nooblyjs-ai-knowledge`** | **Knowledge Repository** (new): spaces, collections, source connectors, ingest with PII redaction, embeddings, cited answers, freshness, process models | **Ask & search**, **Spaces / process model** (L0 → L1 → L2), Sources, Needs review, Graph, backlinks into Items. Context provider for every agent |
| **`nooblyjs-ai-host`** (`src/lifecycle/`) | The **lifecycle engine**, part of NooblyJS itself since 2026-10-10 (it was the hosted app `nooblyjs-ai-workflows`): Items, stages, readiness checks, approvals with target times and escalation, handoffs, send-back, and stage orchestration (which tells the Product section when an item enters a stage) | Backs Lifecycle, Approvals, the stage and approval parts of every Product Factory screen, and the UI → Factory handoff (generating Jira work items) |

> The `nooblyjs-ai-knowledge` responsibilities above are proposed. The lifecycle engine (Phase 2) and
> the Product section are built as described.

## 11. Known conflicts between the mockups and existing code

Resolve these before building the affected slice:

- **Model providers:** the harness, teammates and common code call the Anthropic API
  directly (`ANTHROPIC_API_KEY`). Governance requires Bedrock / Vertex / Azure, so
  `nooblyjs-ai-common` must add those adapters and make them the default.
- **Agent merge:** the Factory line ends in a `merge` station (autonomy L3), and the
  Repositories mockup shows a "Merge after all gates pass" agent toggle. Governance says
  agents never merge to `main`. The toggle must stay off and locked unless the
  guardrail is changed by an Owner and audited `[CONFIRM]`.
- **Collaboration tool:** the Settings mockup lists **Slack** as connected. The company
  standard is Microsoft 365, so use Teams/Outlook and drop Slack `[CONFIRM]`.
- **Stack (decided):** Node.js + Express with plain HTML/CSS/JS, and Markdown/YAML
  files for storage. This replaces the brief's TypeScript + React + Postgres defaults
  (see `tech.md`). The Factory and Teammates UIs are restyled into the NooblyJS shell.
  The factory's event log is files too (daily YAML streams, since Phase 7).
- **Screen count:** the brief now lists 22 screens. **Product board** exists only in
  `brief/noobly-platform.html`. The **team chat panel** is described in the brief but none
  of the exported Spec, Architecture or Repositories mockups shows it. Ask design for that export.
- **Real-time transport:** the brief's Phase 2 says WebSockets. NooblyJS uses **Server-Sent
  Events plus `POST`** for chat and live updates, which needs no extra dependency
  (`tech.md` §4.2). Decided and built in Phase 2.
- **Seed data drift:** in the Teams bot mockups Rhea Voss is billed at $52/hr, and
  PRD-031 is at v5 with readiness 7 of 7 (the rollout plan was added). Seed the
  later state for the Teams demo and the earlier state (v4, 6 of 7) for the Approvals demo.
- **Handoff repo count:** the UI Design handoff preview says "Estimated $18–$26 · 3 repos",
  but its six work items span four repos (slots-api, web-storefront, mobile-app,
  design-system) `[CONFIRM]`.

## 12. Open questions

1. ~~Monorepo or separate deployables~~: decided. These are separate repos, mounted as modules in one `nooblyjs-ai-host` process (see `tech.md` §2).
2. ~~Restyle or embed~~: decided. Restyle into the NooblyJS shell.
3. Hosting target (AKS / EKS / GKE) and data region. (Phase 9 built Containers over a simulated runtime behind an
   interface, so this can be decided later.)
4. Which provider hosts the Claude models (Bedrock, Vertex, Azure)? All three adapters are built (Phase 9) and
   each model route names its provider; the seed routes name Bedrock. Until credentials are set, development
   and test use the Anthropic API directly (decided 2026-10-10; refused in production).
5. How to get the Enterprise Knowledge Repository's data: export, API or database?
6. ~~Sync direction and source of truth for status with Jira~~: decided for Phase 13 and confirmed by Stevie on 2026-10-11. NooblyJS
   owns the lifecycle; Jira owns each issue once it exists (status, assignee, sprint). NooblyJS creates the issue and
   follows it, and moves it forward only for a run started or a pull request merged. Targetprocess is out of scope.
7. Diagram-as-code format (C4/Structurizr, Mermaid, …).
8. Real process-model values: the third Support process and the codes for Support and
   Enterprise Management (the mockups use `[HC]`, `[FR]`, `[IS]`, `EM` as placeholders).
9. Who fills the Approver, Architect and Owner roles at launch?
10. Teams bot: ~~who may add a teammate to a meeting, and which team is billed when the meeting
    has no linked team~~: decided 2026-10-10. Anyone with `draft` may add one; the meeting's team is
    billed, else the first team of the person who added them. Still open: is mirroring item threads to
    Teams channels in scope?
11. Is Figma an approved tool (it's offered as a Designer connection in onboarding)?
12. "For you" layouts for Designer, Engineering lead and Platform engineer. Until they are
    designed, they land on Overview or Platform · Repositories, as the onboarding mockup does.
13. ~~One page per app, or one shell~~: decided. NooblyJS owns one frame (rail, sidebar, chat dock),
    and each app supplies a UI module that loads into it (`docs/adr/ADR-001-host-owned-shell.md`).
14. The Edge extension (§5.11): is filling a Jira field for the person to save a "write to Jira" under the
    production rule (NooblyJS only reads Jira until Phase 13), or the person's own write? Proposed: the person's, because
    they press Save in Jira, under their own Jira permissions. Which pages after Jira (Bitbucket, Confluence,
    SharePoint)? Is it installed for everyone by Edge policy, or opt-in?

## 13. Reference

- Delivery phases, with how to test each one: `.claude/steering/roadmap.md`
- How it's built: `tech.md`. Where things live: `structure.md`.
- Full build brief and design tokens: `.claude/steering/brief/noobly-build-brief.md`
- Screen mockups: `.claude/steering/brief/<screen>/*.dc.html` (serve the folder over HTTP to
  view); the full canvas is `.claude/steering/brief/noobly-platform.html`
- Brand assets: `.claude/style/`
