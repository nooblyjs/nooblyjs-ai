---
inclusion: always
---

# Software Factory: what NooblyJS needs from this repo

> **The Software Factory is one app**, `/factory`: the **line** (this file), Engineering, and its **Test section**
> (`quality/`, Phase 16d; Quality is the Test section, decided 2026-10-20). One rail item, **Factory**; one sidebar,
> grouped **Engineering · Build · Test** (lifecycle v3, Phase 16b); one status card with a line per section. **Product**
> and **Design** come before it on the rail as apps of their own (CHG-009, 2026-10-21: `nooblyjs-ai-product` at
> `/product`, `nooblyjs-ai-design` at `/design`); they were its sections from 2026-10-19 (Product) and Phase 16c
> (Design). Infrastructure, a section here from 2026-10-19 to 2026-10-20, is the hosted app `nooblyjs-ai-infrastructure`
> at `/infrastructure` again (CHG-007).

> Extracted from the NooblyJS product definition (`../nooblyjs-ai-host/.claude/steering/product.md`, the source
> of truth) and the design mockups in `../nooblyjs-ai-host/.claude/steering/brief/`. This file lists only
> what the **Software Factory** must provide inside NooblyJS. `tech.md` says how this repo plugs
> in, and `structure.md` says where things live. The factory's own design and phase history
> are in `.claude/steering/` and `.claude/docs/`. If this file and the NooblyJS `product.md`
> disagree, NooblyJS wins. All numbers are **sample data** from the PRD-031 "Same-day delivery
> slots" story, not targets.

## 1. Where the factory fits

NooblyJS takes an idea from customer signal to merged, deployed code. AI agents do most of the
drafting and building, and **people make the decisions**. Every piece of work is an **Item**
that moves through seven stages:

```
1 Discover → 2 Specify → 3 Architect → 4 UX design → 5 UI design → 6 Build → 7 Ship
```

The Software Factory owns **Build** and feeds **Ship**. It "runs specs through stations to
reviewed pull requests". A **UI handoff** (approved by the Design lead) creates **work
items**. The factory turns each one into runs on its line, and its stations produce pull
requests with evidence. **A person merges**: the code owner of the repo, within a 4-hour
target. Production deploys need two approvers.

| Stage | What the factory does | Exit gate (a person decides) |
| --- | --- | --- |
| 6 Build | Work items → runs → PRs. The item's **quality attributes** are gates on every PR | Gates pass (tests, contracts, quality attributes) |
| 7 Ship | Reports PRs awaiting merge and their gate results | **Merge** by the code owner (target 4 h, then a reminder). **Production deploy** by two approvers (same day, else hold the deploy) |

Who uses it most: **Developers** (review, steer and merge what agents build), **Engineering
leads** (flow and cost) and **Platform engineers** (capacity and sandboxes).

## 2. Screens

The factory's module sidebar is titled `factory`. Nav: **Line, Runs, Inbox, Campaigns,
Metrics**. Status card: "Accepting work" (or stopped) · "Running now 0 of 3 slots · 0
queued" · "Spent today $0 of $20" · **Stop all runs**.

Line, Runs, Inbox and Campaigns come from the existing factory and are **restyled into the
NooblyJS kit**. Their behaviour stays. The existing line is triage → spec → approve → build →
verify → review → repair → deliver → merge, and every step is an event. The merge step is
disabled in NooblyJS (§4).

### 2.1 Metrics (mockup `noobly-factory-metrics`)

- Ranges: **7 days / 30 days / All time**. The subtitle names the period in words ("Since 1
  Oct 2026"). When nothing has run, it says so: "No stations have run in this period."
- **Delivery** tiles, each with a plain empty state:

  | Tile | Shows | Empty state |
  | --- | --- | --- |
  | Runs | runs, with how many finished | "0 finished" |
  | PRs delivered a day | average | "0.0" |
  | Lead time to PR | median | "no PRs yet" |
  | Lead time to merge | median | "no merges yet" |
  | First-pass gates | % of PRs whose gates all passed first time | "no checks yet" |
  | PR acceptance | n of m merged | "0 of 0 merged" |
  | Human edits before merge | % of agent PRs a person changed | "no merges yet" |
  | Escalations | runs that asked a person for help | — |
  | Cost per merged PR | agent model cost + compute ÷ merged PRs | "no merges yet" |

- **Stations** table, sorted by median time: station, runs, median time, p90, cost,
  failures. Empty: "No station has run in this period" with **Open the Line**.

## 3. Capabilities NooblyJS relies on

1. **Accept handoff work items.** The UI handoff for PRD-031 creates 6 work items: slots-api
   hold & release endpoints, slots-api capacity events, web-storefront SlotChip and
   HoldTimer, web-storefront picker, nearby and basket, mobile-app with the same four
   screens, and design-system to publish 2 components (estimate $18–$26). Each becomes a
   factory issue and then runs. Results report back to the item: runs, PRs and gate results.
2. **Quality attributes become gates.** Rows defined at the Architecture stage apply to
   every PR for that item. For example:

   | Attribute | Scenario | Target | Verified by |
   | --- | --- | --- | --- |
   | Latency | Slot list at 18:00 peak | p95 < 300 ms | Load test station |
   | Consistency | Two holds on the last slot | 0 double-books | Contract tests |
   | Availability | Cache node lost | 99.9% monthly | Chaos check · staging |
   | Cost | Run cost at current volume | < $600/month | Platform budget alert |

3. **Standards on PRs.** Approved stack only, every API has a contract, customer data stays
   in-region, and a new dependency needs an ADR. Breaks are reported per PR (e.g.
   "web-storefront #479 adds an unapproved chart library", "slots-api #484 · new endpoint,
   no contract yet"). Architects see them on their home. Whether this check runs as a
   factory gate or as a review station is to be decided `[CONFIRM]`.
4. **PR evidence.** Every PR carries its run, source spec, cost, size, gates passed (n of m)
   and any standards flag ("Run 209 · flagged by the architecture standards check").
5. **Stuck runs ask a person.** When a gate fails twice, or a run needs help, the run asks
   the developer a question linked to the acceptance criterion: "Run 213 is asking you: The
   hold-expiry contract test fails twice. Should holds release at exactly 15:00, or allow a
   5-second grace? · slots-api · PRD-031 acceptance criterion 1", with **Answer / Open run**.
   The answer resumes the run.
6. **Live progress.** For each run: repo, current station, a station strip (Plan, Scaffold,
   Implement, Test, Review), elapsed time and cost so far ("Run 214 · slots-api · Implement
   station · 41 min · $1.90 so far").
7. **Retries are visible.** "Run 213 failed the contract-test gate on slots-api and retried
   · passed on retry" appears in Activity as a System row.
8. **Capacity and cost controls.** Slots (3 of 3, with what's queued), a daily cap ($20),
   **Stop all runs**, and pausing at the budget. Stations run in the Platform's **Factory
   stations** pool, each in its own sandbox container on the repo's base image (e.g.
   `node-22:22.11`).
9. **Repo access from Platform.** Agents may only touch repos granted in Platform →
   Repositories. Access is No agent access, Read only, or Read + open PRs, with toggles for
   read code and history, push to agent branches, open pull requests, and index into
   Knowledge. A repo marked **restricted** (e.g. `payments-gateway`) has no agent access.

## 4. Rules that apply here

- **Agents never merge to `main`.** Merging is a person's action (code owner, target 4 h).
  The Repositories mockup has a "Merge after all gates pass" agent toggle. It stays **off and
  locked** unless an Owner changes the guardrail, and that change is audited.
- **Deterministic gates decide.** A model reviewer can add findings but never passes a gate.
- **Every agent action is attributed and costed**: who or what, when, which item, which
  model route, at what cost. Every write is audited.
- **Agents never see production secrets.** Sandboxes and preview environments get staging
  values only. **No outbound internet** from sandboxes, except allow-listed package registries.
- **Models** come only through Bedrock / Vertex / Azure (via `nooblyjs-ai-common`), routed by
  work type. Implementation and tests → Sonnet with a Haiku fallback. Review → Opus with a
  Sonnet fallback.
- **Budgets**: the Software Factory has a **daily cap** ($20 a day in the seed). At the
  limit, work pauses and `budget.reached` is emitted.
- **Status is said in words**, not colour alone (WCAG 2.2 AA).

## 5. Data the factory owns

Run, Station, GateResult, PullRequest (repo, number, first-pass, human-edited, cost) and the
work items received from a handoff (repo, description, estimate; synced to Jira by NooblyJS).
Everything is derived from the factory's event log.

## 6. Metrics the factory feeds

| NooblyJS metric | From the factory |
| --- | --- |
| PRs merged | merged PRs in the period (with the approved specs they came from) |
| First-pass gates | % of PRs whose gates all passed on the first run |
| Human edits | % of agent PRs changed by a person before merge |
| Cost per merged PR | agent model cost + compute ÷ merged PRs |
| Lead time by stage | Build & ship time, from events |
| Spend by system | Software Factory spend ($318 over 30 days in the seed) |
| Today so far | PRs opened today |

## 7. Where the factory shows up elsewhere in NooblyJS

| Screen | What it shows from the factory |
| --- | --- |
| Home · Overview | The Software Factory card ("3 of 3 slots · 2 queued", "$11 of $20 spent today"). Build stage "runs on the line", Ship stage "PRs awaiting merge". PR rows in Waiting on you ("All gates passed first time · $3.80 to produce") |
| Home · Approvals | Merge decisions ("slots-api #482 · Slot capacity endpoint · Software Factory → Ship · all gates passed") |
| Home · Lifecycle | Build and Ship cells of the swimlane, and the "Software Factory → Ship" handoff count |
| Home · Activity | "Juno Park opened PR #481", "Run 213 failed the contract-test gate…", "PR #476 merged · Merged by Thabo N. · $4.20 total", and Live now ("Run 214 · Implement · slots-api") |
| For you · Developer | Tiles: PRs to review (oldest against the 4 h target), runs on your repos (live), needs help, merged this week (n passed first time). Panels: Pull requests waiting for you, Runs on your repos, "Run 213 is asking you" |
| For you · Architect | Standards broken on PRs |
| Platform · Containers | Factory stations pool ("Full · 3 of 3 slots · 2 runs queued"), running stations, Stop |
| Team chat | The quick action "Why did a gate fail?" |
| Teams bot | Teammates cite factory runs as sources ("Software Factory runs 216–217") |

## 8. Seed story

| Thing | Sample values |
| --- | --- |
| PRs waiting for review | slots-api #482 · Slot capacity endpoint (Run 212, from PRD-031, $3.80, 412 lines, 5 of 5 gates). web-storefront #481 · Checkout focus order (Juno Park, PRD-029, $2.10, 96 lines, 6 of 6). web-storefront #479 · Order history chart (Run 209, standards flag, 5 of 6) |
| Other PRs | #476 merged by Thabo N. ($4.20 total). #484 has no API contract yet. #485 slot picker (6 of 6 gates, ready) |
| Runs | Run 214 · slots-api · Implement · 41 min · $1.90. Run 215 · web-storefront · Test · 12 min · $0.60. Run 213 asking about the hold-expiry test. Runs 216–217 for the slot picker |
| Metrics screen | A fresh reset shows every empty state (§2.1) |

## 9. Open points

- Who runs the standards check on PRs: a factory gate or a review station `[CONFIRM]`.
- The handoff preview says "3 repos", but its six work items span four (slots-api,
  web-storefront, mobile-app, design-system) `[CONFIRM]`.
- The event log is daily YAML streams (NooblyJS Phase 7); SQLite is gone, for the CLI as well (`tech.md` §9).
