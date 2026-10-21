---
inclusion: always
---

# NooblyJS Software Factory: the product

> **Status:** Draft v1 · 2026-10-19 · a fresh look at the whole factory, written after reviewing every project in
> this monorepo. **What this file is:** the product view across the whole software development lifecycle (SDLC),
> from the business case to production and back again. `design.md` says how the parts fit together, `stack.md`
> what they are built with, and `roadmap.md` the order of the work.
>
> **How it relates to the existing steering.** `nooblyjs-ai-host/.claude/steering/product.md` is still the detailed
> record of what is **built** (screens, the permissions matrix, approval rules, metrics definitions). This file does
> not repeat it. It sets the **shape of the whole factory** and names what is missing. Where the two disagree, the
> host file describes today and this file describes the target; each phase that builds part of the target updates
> the host file in the same change. The one roadmap is `roadmap.md` in this folder.
>
> **Decided 2026-10-19:** nine lifecycle stages (§3.2); three new apps, Quality, Security and Operations, built in
> that order (§4); the root `roadmap.md` is the one roadmap.
>
> **Decided 2026-10-20:** the factory is Product, Design, Build and Test. **Quality is the Software Factory's Test
> section, not a separate app**; Infrastructure is an app of its own again (§4, §9). The lifecycle follows how the teams
> work: **eight stages**, Discover · Product · Design · Engineer · Build · Test · Release · Operate (§3.2, §3.2a–c).
> Design writes the **stories** that build a feature, each handed to the Software Factory on its own; Engineer is signed
> off before anything is built; the AI builds and tests, an engineer gives the **Build approval** and a human tester
> verifies the pull request and gives the **Test approval**; a **feature is released on its own** once all its stories
> have passed Test.
>
> Numbers quoted from the seed story (Acme Retail, PRD-031 "Same-day delivery slots") are **sample data**.
> `[PLACEHOLDER]` marks a company fact we don't have. `[CONFIRM]` marks a decision to check.

---

## 1. The idea in one paragraph

NooblyJS is a **software factory** that takes work from a **business intent** to **running, observed software**,
and then feeds what it learns in production back into the next intent. **AI agents do most of the drafting,
building, testing and checking. People make every decision that matters.** Each step leaves evidence, so for any
line of code in production you can answer: *which business goal asked for it, which requirement it meets, which
decision shaped it, which tests and security checks proved it, who approved it, what it cost, and whether it
worked.*

## 2. What we have built (review, 2026-10-19)

Eight projects, over 370 test files, all offline by default. Phases 0–11 of the host roadmap are signed off;
12, 13 and 14 (the Edge extension's skeleton) were reviewed on 2026-10-20; 15 is open.

| Part of the SDLC | What exists | Project | Maturity |
| --- | --- | --- | --- |
| Business and strategy | Strategic themes, portfolios, value streams and their documents from templates; products as labels | `nooblyjs-ai-factory/product` | Partly built: portfolio epics, epics, features and requirements are **not** built |
| Discover | Signals clustered into themes, ideas scored with RICE, the Product board, the quarter roadmap | `nooblyjs-ai-factory/product` | Built (signals are seeded; no live connector) |
| Requirements | Spec: problem, goals (measure / today / target), user stories, Given/When/Then criteria, out of scope, readiness checks, reviewers, versions | `nooblyjs-ai-factory/product`, lifecycle engine | Built. **Elicitation since Phase 18** (§3.4): stakeholders, sessions, candidates quoting their source, requirements `REQ-033-01`, the NFR walk, questions |
| Architecture | Container view as code, ADRs, standards check, quality attributes that become gates | `nooblyjs-ai-factory/product` | Built |
| UX and UI design | Journeys, flows, research, screens, design-system reuse, accessibility checks, handoff preview | `nooblyjs-ai-factory/product` | Built |
| Lifecycle and approvals | Items, 7 stages, readiness, approvals with target times and escalation, send-back, handoffs, Activity, audit | `nooblyjs-ai-host` (`src/lifecycle/`) | Built |
| Build | Line of stations (triage → spec → approve → build → verify → review → repair → deliver), gates, PR evidence, "a run is asking you", campaigns, bench, hash-chained audit export, secret scan, agent-environment scrubbing | `nooblyjs-ai-factory` | Built; runs on a local demo repository; PRs on real repositories wait for Phase 13's review |
| Testing | Gates per PR from quality attributes; "Testing in environments" screen; e2e results per environment (seeded) | `nooblyjs-ai-factory`, `nooblyjs-ai-infrastructure` | **Thin.** No test strategy, test plan, test cases or test runs as things of their own |
| Security | Governance enforced in services; secret scan and env scrubbing in the Factory; sandboxes (Linux, macOS); base-image CVE status (typed in, not scanned); a code-reading security review (Phase 13) | spread across | **Thin.** No threat model, no scanning pipeline, no findings, no security testing in environments |
| Infrastructure | Designs from architecture, environments, provisioning runs, drift, cloud cost, blueprints, policies | `nooblyjs-ai-infrastructure` | Built on a **mock provisioner**; cloud, region and IaC tool undecided |
| Release | Merge by a person; "production deploy needs two approvers" as a rule | lifecycle engine | **Not built** (Infrastructure I10, owner open) |
| Operate and learn | Drift sweep, cloud cost | `nooblyjs-ai-infrastructure` | **Not built**: no SLOs, monitoring, incidents, or loop back to Discover |
| Agents | Named teammates with skills, memory, rates, budgets, timesheets; the agent runtime with tools, sandbox, MCP, skills | `nooblyjs-ai-teammate`, `nooblyjs-ai-harness` | Built |
| Knowledge | Wiki, spaces, sources, cited answers, PII redaction, process models, MCP | `nooblyjs-ai-knowledge` | Built (legacy wiki behind an adapter) |
| Platform | Repositories and agent access, containers (simulated), model routing, budgets, guardrails, secrets as references, audit | `nooblyjs-ai-host` | Built; runtime and secret store simulated |
| Outside tools | Bitbucket and Jira (read; writes through a gate, Record only), Entra SSO, Teams bot, Outlook | `nooblyjs-ai-host` | Read built; writes and Microsoft 365 waiting for review |

**What the review says.** The **front half** (idea → spec → architecture → design → handoff → PR) is deep and
governed. The **back half** (test → secure → release → operate → learn) is a set of rules and seeded screens with
little behind them. And there is **no loop**: nothing that happens in production comes back as a signal, and
nobody checks whether a spec's goals were met. Closing that is what this document is for.

## 3. The factory, end to end

### 3.1 The loop

```
              ┌─────────────────────────── STRATEGY ───────────────────────────┐
              │ themes · portfolios · value streams · epics · business cases    │
              └───────────────────────────────┬────────────────────────────────┘
                                              ▼
 ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌────────┐  ┌─────────┐  ┌─────────┐
 │1 Discover │→ │2 Product │→ │3 Design  │→ │4 Engineer│→ │5 Build │→ │6 Test  │→ │7 Release│→ │8 Operate│
 └───────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘  └────────┘  └─────────┘  └────┬────┘
                 spec, UX, UI  business reqs app arch +    AI builds,  a person    a feature,       │
                 together      solution arch test analysis AI tests;   verifies    when all its     │
                               functional    per story     engineer:   the PR:     stories have     │
                               → stories                   BUILD       TEST        passed Test      │
                                                           APPROVAL    APPROVAL,                    │
                                                                       then merge                   │
       ▲                                                                                            │
       └──────────────── LEARN: incidents, SLO breaches, usage, goal results become signals ◄───────┘

  The Software Factory's sidebar: Product (2) · Design (3) · Engineering (4) · Build (5) · Test (6)
  Threads through every stage:  Security · Quality · Accessibility · Cost · Compliance
  Underneath everything:        Knowledge · Teammates · Platform · Infrastructure · Harness
```

### 3.2 Stages (the item's lifecycle, version 3)

Version 3 (decided 2026-10-20) follows how the teams work. **Product** is one stage: requirements, UX and UI are worked
on together. **Design** turns the Product handoff into business requirements, a solution architecture, a functional
analysis and the **stories** that build a feature. **Engineer** works out, per story, the application architecture
from the code and the system and the test analysis, and is signed off before anything is built. In **Build** the AI
builds and tests, and an engineer gives the **Build approval**. In **Test** a human tester verifies the pull request
and gives the **Test approval**; then it merges. A **feature is released on its own** once all its stories have passed
Test. Release and Operate are version 2's; version 2's Verify is replaced by Test.

Stage keys, not numbers, are what events and data keep. Older keys still land: `specify`, `ux`, `ui` → `product`;
`architect` → `design`; `verify` and `ship` → `test`; history keeps its own labels. (Version 2, 2026-10-19, had nine
stages: Discover, Specify, Architect, UX, UI, Build, Verify, Release, Operate.)

| # | Stage | Question it answers | Main artefacts | Default agent (role) | Exit decision (a person) |
| --- | --- | --- | --- | --- | --- |
| 1 | Discover | Is this worth solving? | Signals, idea, RICE, **business case** | Research agent | Idea accepted (Product lead) |
| 2 | **Product** | What do customers need, and how will they use it? | Spec (problem, goals, user stories, acceptance criteria, **elicitation record**), UX (journeys, flows, research), UI (screens, components, accessibility checks), together | Product agent, design agent, UI agent | **Product handoff** (Product lead) |
| 3 | **Design** | What must the business get, which systems change, and how do they meet? | **Business requirements**; **solution architecture**: feature landscape, impacted systems, NFRs (with the container view, ADRs, standards, **threat model**, infrastructure design); **functional analysis**: interface requirements, technical requirements; **feature generation**: the stories | Analyst agent, solution architect agent, security agent | **Design handoff**, per story (Solution Architect) |
| 4 | **Engineer** | How will each system do it, and how will we prove it? | Per story: **system / application architecture** from the code and the system (application flow, objects, NFRs per component, …); **test analysis**: test cases, automated testing requirements, integration tests, E2E tests; work items per repository | Application architect agent (reads the repositories), test agent | **Engineering sign-off**, per story (Application Architect and a test lead, one approval) |
| 5 | Build | Is it built right? | Runs, PRs with the automated tests from the test analysis, written and run by the AI; **build-time security scans**, SBOM | Factory stations, engineering teammates | **Build approval**, per PR: an engineer (code owner) approves the code, gates passed |
| 6 | **Test** | Does it do what the test analysis says, in a person's eyes? | The PR's test evidence (the AI's automated tests against the test cases), the tester's own checks in a preview environment, tests in environments (E2E, performance, accessibility, resilience), **security tests** | Test agent, security agent | **Test approval**, per PR: a human tester verifies and signs it off; then it merges |
| 7 | **Release** | Is this feature safe to put in front of customers now? | Release of one feature (its merged stories), change record, rollout plan, rollback plan, release notes | Release agent | **Production deploy** (two approvers) |
| 8 | **Operate** | Is it working, and did it do what we wanted? | SLOs, alerts, incidents, post-incident reviews, cost, **outcome review** | SRE agent | **Outcome review** closes the item (Product lead) |

**Rules carried over unchanged:** every transition is an event; readiness checks gate approval with a person's
override and a reason; approvals have targets and escalation; any item can be sent back with a reason; each stage can
call a hired teammate to draft.

**New rules:**

- **Stories are the unit from Design on.** Feature generation writes the **technical features, which are the stories
  that build a feature** (`STORY-031-1`, …). A feature has many stories; a story belongs to exactly one feature of the
  work hierarchy (§3.3). An item's feature landscape names the features its stories build. Each story traces to
  the business requirements, impacted systems, interfaces and NFRs it serves. Each is handed off on its own and goes
  through Engineer, Build and Test as an item of its own, linked to its parent item and its feature.
- **Features are released on their own.** A feature goes to Release when all its stories have passed their Test
  approval, without waiting for the other features of the same item. The item stays in Design until its last story is
  handed off, then shows where its stories and features are.
- **Nothing is built before the Engineering sign-off.** The Software Factory starts runs for a story only once its
  application architecture and test analysis are signed off.
- **The AI tests; people approve.** The AI writes and runs the automated tests in Build. The Build approval waits on
  the engineer and the Test approval on the tester, in that order. Like every approval (§5), **any person but a Viewer
  may give either on someone else's behalf** (so the engineer and the tester may be the same person); the approval and
  the audit log record who gave it and for whom. An agent can give neither. A pull request merges only after both (a person merges, as today), and a new
  commit clears them.
- An item **stays in Operate** after its features are released until its outcome review. The review compares the
  spec's goals (measure, today, target) with what was measured. It closes the item, or opens a follow-up idea.
- **Learn is not a stage, it is a source.** Incidents, SLO breaches, failing synthetic checks, support tickets and
  goal results arrive in Discover as signals, linked back to the item and release that caused them.
- **Tests run in environments too**, not only on a branch: the tester verifies against a preview environment, and the
  environment-level suites (§3.6) run there.

### 3.2a Design (stage 3, the Factory's Design section)

Done by Business Analysts, Solution Architects and Functional Analysts, from the Product handoff (spec, UX and UI).

1. **Business requirements.** What the business must get, written from the spec and its elicitation record (§3.4, which
   stays in Product), each with an id (`BR-031-01`) and a source. An analyst agent drafts; an analyst accepts each one.
2. **Solution architecture.** How the change fits the estate:
   - **Feature landscape**: the features this item serves and the stories each needs (every story in exactly one
     feature), and how they relate (dependencies, order).
   - **Impacted systems**: which systems, services and repositories change, and how (new, changed, retired), with
     their owners. Drawn from Platform's repositories and the Knowledge repository.
   - **NFRs**: performance, availability, security, privacy, accessibility, cost and operability targets, from the
     NFR catalogue (§3.4); they become quality attributes and, later, SLOs.
   - The container view, ADRs and standards check (built today, in the Product section's Architecture pages, which
     move here), the **threat model** (§3.5) and the infrastructure design (in the Infrastructure app).
3. **Functional analysis.** Per impacted system:
   - **Interface requirements**: the APIs, events and files between systems: who calls whom, with what, and what
     comes back (contract-first, so each side can be built and tested on its own).
   - **Technical requirements**: what each system must do to meet the business requirements and NFRs.
4. **Feature generation: the stories.** The technical features are the stories that build a feature. They are
   proposed from the feature landscape and the functional analysis (an agent drafts; an analyst edits, splits and
   merges), each with its feature, business requirements, impacted systems, interfaces, technical requirements, NFRs
   and acceptance criteria. Stories are what Jira tracks. Readiness checks before the Design handoff: every business
   requirement is covered by a story, no decision is still proposed, every interface has both sides named.
5. **Design handoff**, per story: a Solution Architect approves it, and the story enters the Software Factory.

### 3.2b Engineer (stage 4, the Factory's Engineering group)

Done per story by Application Architects and test analysts, inside the Software Factory, before anything is built.

1. **System / application architecture, from the code and the system.** An application architect agent reads the
   impacted repositories (through the devtools service and the Knowledge repository) and the running system's
   description, and drafts per system: the **application flow** for the story, the **objects** (domain model, data,
   state) it touches, the **NFRs** per component, and the changes it proposes. A person edits and accepts it. It is a
   picture of the real code, refreshed when the code changes, not a drawing that drifts.
2. **Test analysis.** A test agent drafts, from the acceptance criteria, the interface and technical requirements and
   the NFRs: **test cases** (one or more per criterion, `TC-031-1-1`), **automated testing requirements** (which tests
   the AI must automate, at which level: unit, contract, integration, E2E), **integration tests** (per interface) and
   **E2E tests** (per journey). A test analyst edits them and marks each ready. Coverage is said in words ("11 of 12
   criteria have a ready test case").
3. **Work items** per repository, each carrying the parts of the application architecture and the test cases it must
   satisfy (the factory's runs read them).
4. **Engineering sign-off**, per story, one approval: the application architecture accepted by an Application
   Architect and the test analysis accepted by a test lead. Then runs start.

### 3.2c Build and Test (stages 5 and 6): the AI builds and tests, people approve

1. **Build.** The line runs each work item (triage → build → verify → review → repair → deliver, as today). The AI
   writes the code **and the automated tests** the test analysis asked for, runs them with the gates, and opens a pull
   request whose evidence lists each required test (by test case id) and its result.
2. **Build approval.** An engineer (code owner) reviews and approves the pull request. Agents never approve or merge.
   The pull request moves to Test.
3. **Test.** A human tester verifies the pull request (or another person on their behalf, recorded as such): reads the
   AI's test evidence against the test cases, checks it in a preview environment, and runs what the test analysis says
   a person should check. They give the **Test approval**, or send it back to Build with a reason ("TC-031-1-3 is not
   automated"), which the line repairs and the engineer approves again.
4. **Merge.** After both approvals, a person merges (as today); a new commit clears both. A story is done when its last
   pull request is merged, and its feature goes to Release when all its stories are done.

### 3.3 Strategy (above the line)

Already built: strategic themes, portfolios, value streams, products, and their template documents. To add:

1. **The work hierarchy**: portfolio epic → epic → feature → requirement, under a portfolio (and optionally a value
   stream). How these map to ideas and specs, and to Jira, is open (`nooblyjs-ai-factory/product` product.md §8). Proposed:
   an **idea belongs to a feature**, and a spec's requirements are the feature's requirements `[CONFIRM]`.
2. **Business case** on an idea or epic: the value hypothesis, who benefits, the measure that will show it, a cost
   estimate (agent cost, cloud cost and people's time, from the factory's own history) and a time horizon.
3. **Outcomes**: each theme and value stream names the measures it cares about (KPIs are already a value-stream
   template section). Outcome reviews (stage 9) roll up to them.
4. **Capacity and funding**: monthly budgets already exist per system. Add a budget per portfolio, so an Engineering
   lead can see agent and cloud spend by value stream, not only by system.

### 3.4 Requirements elicitation (inside Product)

Today a spec is drafted from an idea and its signals. Elicitation adds **where requirements come from** and **who
said so**:

- **Stakeholder map** per item: who is affected, who decides, who must be consulted (people and teams from Teams &
  roles; outside parties as names only).
- **Elicitation sessions**: an interview, a workshop or a Teams meeting a teammate joined (the Teams bot already
  posts meeting notes to an item). The analyst agent turns notes into **candidate requirements**, each quoting its
  source. A person accepts, merges or rejects each one. Nothing becomes a requirement without that decision.
- **Non-functional requirements** are elicited from a catalogue (performance, availability, security, privacy,
  accessibility, cost, operability), so they are asked about, not remembered. Accepted ones become the NFRs of the
  solution architecture in Design (§3.2a), and quality attributes.
- **Questions and assumptions** are listed with an owner. An open question blocks spec approval unless a person
  overrides it.
- **Traceability starts here**: every requirement has an id, and every later artefact (criterion, ADR, threat, test,
  work item, PR, release) links back to it (`design.md` §4).

### 3.5 Security (a thread, with its own gate)

Security is designed in at Design, checked at Build, tested at Test and watched in Operate.

| Stage | What happens | Who decides |
| --- | --- | --- |
| Strategy | Risk appetite and which compliance regimes apply `[PLACEHOLDER]` | Owner |
| Discover, Product | Data classification of the idea; privacy review (already a readiness check); security requirements and abuse cases | Product lead |
| Design | **Threat model** drafted by the security agent from the container view (data flows, trust boundaries, threats, mitigations, each mitigation a requirement or a quality attribute) | Architect (accepts it) |
| Build | Secret scan (exists), static analysis, dependency and licence scan, IaC scan, SBOM, on every PR as gates | Gates decide; a model never passes a gate |
| Test | Dynamic scan against the preview, Test or Staging environment, container image scan, **penetration test** for restricted repositories, security regression of earlier findings | Security sign-off where risk requires it |
| Release | SBOM and open findings shown on the release; a release with an open finding above the threshold needs a **risk acceptance** | Two approvers + risk owner |
| Operate | New CVEs against running images, security incidents through the same incident flow | SRE, Owner |

A **finding** has a severity, a fix-by date from a policy (`[CONFIRM]` days per severity), an owner, and a state.
The factory may draft the fix as a PR. Closing a finding needs proof (the scan passes). **Accepting a risk is a
person's decision with a reason and an expiry**, never an agent's.

### 3.6 Quality and testing (a thread, with its own stage)

- **Test analysis per story** at Engineer (§3.2b): test cases, automated testing requirements, integration and E2E
  tests, at which levels (unit, contract, integration, E2E, performance, accessibility, resilience, security) they
  prove which requirement and NFR. Drafted by the test agent, made ready by a test analyst.
- **Test cases come from acceptance criteria.** A Given/When/Then criterion becomes at least one test case, so
  coverage is a fact: "11 of 12 criteria have a passing test".
- **The AI writes and runs the automated tests** in Build, as Factory gates (as today, now from the test analysis), and
  **a human tester verifies each pull request and gives the Test approval** before it merges (§3.2c).
- **Environment-level tests** run in Test, against Infrastructure's preview and Test environments, on each deploy: e2e, load (from
  quality attributes, e.g. "p95 < 300 ms at the 18:00 peak"), accessibility (axe), resilience (e.g. "cache node
  lost"). Results attach to the environment (as the Environments screen already shows) **and** to the requirement.
- **A failing test is a question, not a fix.** The test agent may propose a fix as a PR or a change to the test; a
  person decides which is wrong.
- **Defects** found in Test or Operate are items of their own, linked to the requirement they break, so escaped
  defects can be counted per stage.

### 3.7 Release and Operate

- A **release** is one **feature**, released on its own once all its stories have passed Test: its merged work items as one deployable set for one product, with its version, the evidence pack
  (tests, security, approvals), release notes drafted by an agent, a rollout plan (from the spec) and a rollback
  plan.
- **Production changes only through a release** with two approvers (already the rule; now it has a home).
- **Progressive rollout** (percentage, store pilot, feature flag) is a release's plan, executed by Infrastructure or
  the deployment tool `[CONFIRM]`.
- **SLOs** come from quality attributes: "availability 99.9% monthly" in Design becomes an SLO in Operate, with an
  error budget.
- **Incidents** (from alerts, or opened by a person) link to the release and item; the SRE agent drafts the timeline
  and the post-incident review; follow-ups become ideas or defects.
- **Outcome review** (§3.2) closes the loop for the business.

## 4. Systems

The factory is the existing systems plus three new ones (decided 2026-10-19), built in the order Security,
Quality, Operations. Every system is a hosted app in the one frame (`design.md` §2), except the Product Factory and
Quality, which are sections of the Software Factory (Product since 2026-10-19; Quality, its **Test** section, decided
2026-10-20).

| System | Rail | Covers | Project | Status |
| --- | --- | --- | --- | --- |
| Home | Home | For you, Overview, Lifecycle, Approvals, Activity, Metrics, Teams & roles | `nooblyjs-ai-host` | Built |
| Product Factory | Factory (Product section) | Strategy, Discover, Product (spec with elicitation, UX, UI) | `nooblyjs-ai-factory/product` | Built; strategy and elicitation to extend |
| **Design** | Factory (Design section) | Business requirements, solution architecture (feature landscape, impacted systems, NFRs; today's Architecture pages), functional analysis (interface and technical requirements), feature generation (the stories), the Design handoff | `nooblyjs-ai-factory/design` (at `/factory/design`) | Built (Phase 16c, waiting for review): stories go to Engineering one at a time |
| Software Factory | Factory (Engineering, Build) | Engineer: system / application architecture from the code; Build: the line (the AI builds and tests), runs, pull requests and the engineer's Build approval | `nooblyjs-ai-factory` | Build built; Engineering built (Phase 16d, waiting for review) |
| **Quality** | Factory (Test section: test analysis in Engineering; the Test group) | Test analysis (test cases, automated testing requirements, integration and E2E tests), the human tester's verification and Test approval on each pull request, test runs, coverage, defects, evidence | `nooblyjs-ai-factory/quality` (at `/factory/quality`, decided 2026-10-20) | Built: test analysis (16d), Test approvals (16e), test runs, coverage, cases kept in step and defects (Phase 20); environment runs in Phase 21 |
| **Security** | Security | Threat models, scans, findings, risk acceptance, pen tests, compliance evidence | `nooblyjs-ai-security` (at `/security`) | Built (Phase 19; the scanner is the mock until one is approved) |
| Infrastructure | Infra | Designs, environments, provisioning, drift, cloud cost | `nooblyjs-ai-infrastructure` | Built on a mock |
| **Operations** | Ops | Releases, deployments, SLOs, incidents, post-incident reviews, outcome reviews | `nooblyjs-ai-operations` (new) `[CONFIRM name]` | Decided; Phases 22–23 |
| Digital Teammates | Teammates | The agents | `nooblyjs-ai-teammate` | Built |
| Knowledge | Knowledge | The memory every stage reads and writes | `nooblyjs-ai-knowledge` | Built |
| Platform | Platform | Repos, containers, models, budgets, guardrails, secrets, audit | `nooblyjs-ai-host` | Built (runtime simulated) |

**Since 2026-10-19 the Product Factory is a section of the Software Factory** (one rail item, **Factory**), not an app
of its own. **The factory is Product, Design, Build and Test** (decided 2026-10-20), and its sidebar follows the work in
five groups:

| Group | Rows | Section (code) |
| --- | --- | --- |
| Product | Overview, Portfolios, Product board, Specs, UX Design, UI Design, Reviews, Handoffs, Settings | Product (`product/`) |
| Design | Business requirements, Solution architecture, Functional analysis, Stories, Handoff to the Factory | Design (`design/`) |
| Engineering | Application architecture, Test analysis, Engineering sign-off | the Factory's own (application architecture) and Test (`quality/`: test analysis) |
| Build | Line, Runs, Pull requests (waiting on the Build approval), Inbox, Campaigns, Metrics | the Factory's own |
| Test | Test approvals (pull requests waiting on a tester), Test runs, Coverage, Defects | Test (`quality/`) |

Quality is the Factory's **Test** section, not an app of its own: its rows sit in Engineering (test analysis) and
Test. Infrastructure was a section for a day and **since 2026-10-20 is an app of its own again**
(`nooblyjs-ai-infrastructure`, at `/infrastructure`, rail label Infra): provisioning infrastructure is something
different (CHG-007). Security and Operations stay apps of their own, as decided.

Alternatives considered: a separate Quality app (decided on 2026-10-19, replaced on 2026-10-20 by the Factory's Test
section: testing is part of making the software, so it sits with Product, Design and Build, with its own sidebar group,
screens, people and approvals inside the Factory), and Security inside Platform (rejected: security spans four or more
stages and needs its own people, screens and approvals, and its artefacts would otherwise be scattered across apps
that don't own them).

## 5. People

Work roles shape a person's home; they never grant permissions. Today's six stay, and new ones are added:

| Work role | What they do | Their home leads with | New? |
| --- | --- | --- | --- |
| Business owner | Owns a portfolio or value stream's outcomes and funding | Business cases waiting, outcome reviews, spend by value stream | New |
| Product manager | Turns signals into specs and follows items to outcome | (as today) plus outcome reviews due | |
| Business analyst | Runs elicitation in Product; writes the business requirements in Design; keeps traceability whole | Sessions to run, candidate requirements, business requirements to accept, open questions | New |
| Solution Architect | Owns the solution architecture (feature landscape, impacted systems, NFRs), design decisions and threat models; approves the Design handoff | Items in Design, decisions and threat models to accept, features to hand off | New (today's Architect) |
| Functional Analyst | Writes the functional analysis (interface and technical requirements) and shapes the stories | Interfaces with one side missing, stories to finish | New |
| Application Architect | Owns each system's application architecture from the code; signs off Engineering | Stories in Engineer, architecture to accept, drift between the picture and the code | New |
| Designer | Journeys, flows, screens | (as today) | |
| Developer (engineer) | Reviews and steers agent work; gives the Build approval on pull requests | (as today) plus pull requests waiting on a Build approval, findings on their repos | |
| Test analyst / tester | Writes the test analysis in Engineer; verifies each pull request and gives the Test approval | Test analysis to finish, pull requests waiting on a Test approval, coverage gaps, defects | New |
| Security engineer | Owns findings, threat models, pen tests, risk | Findings past fix-by, threat models to review, risk acceptances expiring | New |
| Engineering lead | Flow, people, agents, budgets | (as today) plus DORA measures | |
| Platform engineer / SRE | Platform, environments, releases, on-call | (as today) plus incidents, SLOs burning, releases to deploy | Extended |

**Access roles stay the five we have** (Viewer, Contributor, Approver, Architect, Owner). New decisions are new
**permissions** on that matrix, not new roles.

**Approving on someone's behalf** (decided 2026-10-20). A permission says whom an approval **waits on**: the people
whose access role has the rule's permission. Any person whose access role is not Viewer may **give** any approval on
behalf of one of them; the approval, Activity and the audit log record who gave it (`by`) and for whom (`for`). Agents
and Viewers never approve. An approval that needs more than one person (the production deploy needs two) needs that
many different people giving it. An app that carries a decision out (Infrastructure, Security) may still refuse it by
its own rules.

| New permission | Proposed holders | Who it lets decide, or whom an approval with it waits on |
| --- | --- | --- |
| `accept-requirement` | Approver and up | Turning a candidate requirement into a requirement, and accepting a business requirement |
| `accept-decisions` (exists) | Architect, Owner | The Design handoff (a Solution Architect) and the application architecture in the Engineering sign-off |
| `sign-off-tests` | Approver and up `[CONFIRM]` | The test lead's part of the Engineering sign-off, and the Test approval (the testers) |
| `accept-threat-model` | Architect, Owner | Part of the Design stage's exit |
| `accept-risk` | Owner (and Architect for low and medium) `[CONFIRM]` | Risk acceptance on a finding |
| `accept-release-candidate` (Phase 16a) | — | Retired with Verify: the Test approval replaces the release candidate |
| `deploy-production` | Approver and up, two of them | Release exit (stage 7; exists as a rule) |
| `declare-incident` | Contributor and up (people only) | Opening an incident |

**Agents stay capped at Contributor.** They draft business requirements, architectures, stories, test analysis and the automated tests,
threat models, release notes and post-incident reviews; they never accept, approve, sign off tests, deploy, accept a
risk or close an incident.

### New approval rules (to add to "Who approves what")

| Decision | Approver | Target time | If late |
| --- | --- | --- | --- |
| Business case → Discover accepted | Business owner | `[CONFIRM]` 3 working days | Remind |
| Product handoff (spec, UX and UI) → Design | Product lead | 1 working day (today's spec rule) | Remind, then escalate |
| Design handoff, per story → Engineer | Solution Architect (`accept-decisions`) | `[CONFIRM]` 1 working day | Remind, then escalate |
| Engineering sign-off, per story → Build | Application Architect and a test lead, one approval | `[CONFIRM]` 1 working day | Remind, then escalate |
| Build approval, per pull request → Test | Engineer (code owner) | 4 hours (today's merge) | Remind |
| Test approval, per pull request → merge | Tester (`sign-off-tests`) | `[CONFIRM]` 4 hours | Remind |
| Threat model accepted | Architect | 1 working day | Remind, then escalate |
| Production deploy of a feature | Two approvers | Same day | Hold deploy (exists) |
| Risk acceptance | Risk owner (`accept-risk`) | 1 working day | Hold the release |
| Outcome review | Product lead | `[CONFIRM]` N days after release | Remind |

## 6. Principles and hard constraints

The ten governance rules in the host `product.md` §3 stand unchanged (people decide; everything attributable;
Bedrock / Vertex / Azure only; no Copilot; Jira for work tracking; Microsoft 365; PII redacted; no production
secrets for agents; no outbound internet from sandboxes; status in words, WCAG 2.2 AA). Added for the whole SDLC:

11. **Evidence over assertion.** A stage is done when its evidence exists (a passing test, a clean scan, an approval),
    not when someone says so. Every gate result keeps its evidence.
12. **Trace everything.** Every artefact links to the requirement and item it serves. An orphan (a test, a PR, a
    finding) is shown as such.
13. **Deterministic checks decide; models advise.** Scanners and tests pass or fail a gate. A model can explain,
    suggest or draft, never pass.
14. **Shift left, verify right.** Security and quality are designed in early and proven in real environments late.
    Neither replaces the other.
15. **Close the loop.** Nothing is "done" at merge. An item ends with an outcome review, and production feeds
    Discover.
16. **Mocks behind interfaces, never in the way.** Every outside dependency (cloud, scanner, monitoring) sits behind
    an adapter with an offline fake, so the factory can be demonstrated and tested before each decision is taken
    (the provisioner and container runtime already work this way).

## 7. Measures

Today's metrics (idea → merge, first-pass gates, human edits, cost per merged PR, lead time by stage, spend by
system, agent vs people share) stay. Added, all computed from events:

| Measure | Definition |
| --- | --- |
| Idea → production | Item opened to its first feature's production release (median) |
| Idea → outcome | Item opened to its outcome review, and the share whose goals were met |
| Deployment frequency | Production releases per product per week |
| Change lead time | First commit of a work item to its production release (median) |
| Change failure rate | % of production releases followed by an incident or rollback within `[CONFIRM]` 7 days |
| Time to restore | Incident opened to resolved (median) |
| Requirement coverage | % of an item's acceptance criteria with a passing test in its latest environment |
| Design to build | Product handoff to a story's first run, and Design handoff to Engineering sign-off, per story (median) |
| Waiting on approval | Pull requests waiting on a Build approval, and on a Test approval, with their age |
| Escaped defects | Defects found in Operate, per release |
| Findings past fix-by | Open security findings beyond their policy date, by severity |
| End-to-end cost | Agent + cloud cost per item, from Discover to Operate, against its business case estimate |

## 8. What we are not building

- A replacement for Jira, Bitbucket, an observability platform or a scanner. The factory **connects** to them,
  records their results as evidence and acts on them. It owns the lifecycle, the decisions and the trace.
- Autonomous release. No agent deploys to production, accepts risk or closes an incident, whatever a guardrail says.
- A second roadmap per project. There is one roadmap (`roadmap.md`).

## 9. Decisions and open questions

**Decided 2026-10-19**

- Lifecycle v2 has nine stages: Verify, Release and Operate replace Ship, so Metrics can show their waiting time.
- Three new apps, Quality, Security and Operations, built in the order Security, Quality, Operations.
- The root `roadmap.md` is the one roadmap for every project.

**Decided 2026-10-20**

- The factory is Product, Design, Build and Test. Quality is the Software Factory's Test section, not a separate app.
- Infrastructure is an app of its own again (`nooblyjs-ai-infrastructure`): provisioning is not part of the factory.
- Lifecycle version 3, eight stages: Discover, Product, Design, Engineer, Build, Test, Release, Operate (§3.2). Test
  replaces version 2's Verify.
- Design does business requirements, solution architecture (feature landscape, impacted systems, NFRs), functional
  analysis (interface and technical requirements) and feature generation. The technical features it generates are the
  **stories** that build a feature; they enter the Software Factory one at a time (§3.2a).
- Engineer does the system / application architecture from the code and the test analysis, per story, and is signed
  off before anything is built, in one approval (§3.2b).
- The AI builds and tests in Build; an engineer gives the **Build approval**; a human tester verifies the pull request
  and gives the **Test approval**; then it merges (§3.2c).
- A **feature is released on its own** once all its stories have passed Test. A feature has many stories; a story
  belongs to exactly one feature.
- A tester gives the Test approval and an engineer the Build approval, but **every approval may be given on someone
  else's behalf** by any person who is not a Viewer; who approved, and for whom, is logged. Agents and Viewers never
  approve. The production deploy still needs two different people (§5).
- Elicitation stays in Product (§3.4); Design writes the business requirements from it.
- The Factory's sidebar: Product · Design · Engineering · Build · Test (§4).

**Open**

1. Who owns releases: Operations (proposed), Infrastructure, or the lifecycle engine? (Infrastructure I10.)
2. The names and paths of the apps `nooblyjs-ai-security` and `nooblyjs-ai-operations` and their mount paths `[CONFIRM]`.
   (The Test section's was taken on 2026-10-20, Phase 16d: `nooblyjs-ai-factory/quality`, at `/factory/quality`.)
3. The work hierarchy above the feature (portfolio epic, epic) against ideas, specs and Jira
   (`nooblyjs-ai-factory/product` §8). Feature → stories is decided: many stories per feature, one feature per story.
   **Taken as a default in Phase 17 (2026-10-21), to confirm:** portfolio epics, epics and features live in the Product
   section's catalogue; an idea belongs to a feature and its spec follows it; Design's per-item features are linked to a
   hierarchy feature later (Phase 18); Jira keeps only the stories `[CONFIRM]`.
4. Which scanners, load-test and monitoring tools are approved (`stack.md` §6), and where they run.
5. Fix-by days per finding severity, and who may accept which risk.
6. Compliance regimes in scope `[PLACEHOLDER]`.
7. Everything still open in the host `product.md` §12 (hosting target and region, model cloud, IaC tool), which
   Release and Operate depend on.
