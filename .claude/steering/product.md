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
12 and 13 are built and waiting for review; 14 and 15 are open.

| Part of the SDLC | What exists | Project | Maturity |
| --- | --- | --- | --- |
| Business and strategy | Strategic themes, portfolios, value streams and their documents from templates; products as labels | `nooblyjs-ai-factory/product` | Partly built: portfolio epics, epics, features and requirements are **not** built |
| Discover | Signals clustered into themes, ideas scored with RICE, the Product board, the quarter roadmap | `nooblyjs-ai-factory/product` | Built (signals are seeded; no live connector) |
| Requirements | Spec: problem, goals (measure / today / target), user stories, Given/When/Then criteria, out of scope, readiness checks, reviewers, versions | `nooblyjs-ai-factory/product`, lifecycle engine | Built. **No elicitation**: requirements arrive already written, by an agent or a person |
| Architecture | Container view as code, ADRs, standards check, quality attributes that become gates | `nooblyjs-ai-factory/product` | Built |
| UX and UI design | Journeys, flows, research, screens, design-system reuse, accessibility checks, handoff preview | `nooblyjs-ai-factory/product` | Built |
| Lifecycle and approvals | Items, 7 stages, readiness, approvals with target times and escalation, send-back, handoffs, Activity, audit | `nooblyjs-ai-host` (`src/lifecycle/`) | Built |
| Build | Line of stations (triage → spec → approve → build → verify → review → repair → deliver), gates, PR evidence, "a run is asking you", campaigns, bench, hash-chained audit export, secret scan, agent-environment scrubbing | `nooblyjs-ai-factory` | Built; runs on a local demo repository; PRs on real repositories wait for Phase 13's review |
| Testing | Gates per PR from quality attributes; "Testing in environments" screen; e2e results per environment (seeded) | `nooblyjs-ai-factory`, `nooblyjs-ai-factory/infrastructure` | **Thin.** No test strategy, test plan, test cases or test runs as things of their own |
| Security | Governance enforced in services; secret scan and env scrubbing in the Factory; sandboxes (Linux, macOS); base-image CVE status (typed in, not scanned); a code-reading security review (Phase 13) | spread across | **Thin.** No threat model, no scanning pipeline, no findings, no security testing in environments |
| Infrastructure | Designs from architecture, environments, provisioning runs, drift, cloud cost, blueprints, policies | `nooblyjs-ai-factory/infrastructure` | Built on a **mock provisioner**; cloud, region and IaC tool undecided |
| Release | Merge by a person; "production deploy needs two approvers" as a rule | lifecycle engine | **Not built** (Infrastructure I10, owner open) |
| Operate and learn | Drift sweep, cloud cost | `nooblyjs-ai-factory/infrastructure` | **Not built**: no SLOs, monitoring, incidents, or loop back to Discover |
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
 ┌───────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐  ┌────────┐  ┌───────┐  ┌────────┐  ┌─────────┐  ┌─────────┐
 │1 Discover │→ │2 Specify │→ │3 Architect│→ │4 UX    │→ │5 UI    │→ │6 Build│→ │7 Verify│→ │8 Release│→ │9 Operate│
 └───────────┘  └──────────┘  └───────────┘  └────────┘  └────────┘  └───────┘  └────────┘  └─────────┘  └────┬────┘
       ▲                                                                                                      │
       └──────────────── LEARN: incidents, SLO breaches, usage, goal results become signals ◄────────────────┘

  Threads through every stage:  Security · Quality · Accessibility · Cost · Compliance
  Underneath everything:        Knowledge · Teammates · Platform · Infrastructure · Harness
```

### 3.2 Stages (the item's lifecycle, version 2)

Stages 1–6 are today's, unchanged. Today's **Ship** splits into **Verify** and **Release**, and **Operate** is new.
Numbering stays stable for 1–6 so existing events, metrics and data keep their meaning (decided 2026-10-19).

| # | Stage | Question it answers | Main artefacts | Default agent (role) | Exit decision (a person) |
| --- | --- | --- | --- | --- | --- |
| 1 | Discover | Is this worth solving? | Signals, idea, RICE, **business case** | Research agent | Idea accepted (Product lead) |
| 2 | Specify | What exactly is needed? | **Elicitation record**, spec, requirements, NFRs, acceptance criteria, **security and privacy needs** | Product agent, analyst agent | Spec approval (Product lead + Engineering) |
| 3 | Architect | How will it work, safely? | Container view, ADRs, standards, quality attributes, **threat model**, infrastructure design | Architect agent, security agent, infrastructure agent | ADR acceptance; **threat model accepted**; infra design approved for Test |
| 4 | UX design | How will people use it? | Journeys, flows, research | Design agent | Flow approved |
| 5 | UI design | What will they see? | Screens, components, accessibility checks, **test ideas from screens** | UI agent | UI handoff (Design lead) → work items |
| 6 | Build | Is it built right? | Runs, PRs, unit and contract tests, **build-time security scans**, SBOM | Factory stations, engineering teammates | Merge (code owner), with gates passed |
| 7 | **Verify** | Does it work, perform and resist attack in a real environment? | **Test plan and runs** (e2e, performance, accessibility, resilience), **security tests** (DAST, container and IaC scans), evidence pack | Test agent, security agent | **Release candidate accepted** (QA lead; security sign-off when the risk calls for it) |
| 8 | **Release** | Is it safe to put in front of customers now? | Release, change record, rollout plan, rollback plan, release notes | Release agent | **Production deploy** (two approvers) |
| 9 | **Operate** | Is it working, and did it do what we wanted? | SLOs, alerts, incidents, post-incident reviews, cost, **outcome review** | SRE agent | **Outcome review** closes the item (Product lead) |

**Rules carried over unchanged:** every transition is an event; readiness checks gate approval with a person's
override and a reason; approvals have targets and escalation; any item can be sent back with a reason; each stage can
call a hired teammate to draft.

**New rules:**

- An item **stays in Operate** after release until its outcome review. The review compares the spec's goals (measure,
  today, target) with what was measured. It closes the item, or opens a follow-up idea.
- **Learn is not a stage, it is a source.** Incidents, SLO breaches, failing synthetic checks, support tickets and
  goal results arrive in Discover as signals, linked back to the item and release that caused them.
- **Verify happens in environments**, not on a branch. Build proves the code. Verify proves the deployed system.

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

### 3.4 Requirements elicitation (inside Specify)

Today a spec is drafted from an idea and its signals. Elicitation adds **where requirements come from** and **who
said so**:

- **Stakeholder map** per item: who is affected, who decides, who must be consulted (people and teams from Teams &
  roles; outside parties as names only).
- **Elicitation sessions**: an interview, a workshop or a Teams meeting a teammate joined (the Teams bot already
  posts meeting notes to an item). The analyst agent turns notes into **candidate requirements**, each quoting its
  source. A person accepts, merges or rejects each one. Nothing becomes a requirement without that decision.
- **Non-functional requirements** are elicited from a catalogue (performance, availability, security, privacy,
  accessibility, cost, operability), so they are asked about, not remembered. Accepted ones become quality
  attributes in Architect.
- **Questions and assumptions** are listed with an owner. An open question blocks spec approval unless a person
  overrides it.
- **Traceability starts here**: every requirement has an id, and every later artefact (criterion, ADR, threat, test,
  work item, PR, release) links back to it (`design.md` §4).

### 3.5 Security (a thread, with its own gate)

Security is designed in at Architect, checked at Build, tested at Verify and watched in Operate.

| Stage | What happens | Who decides |
| --- | --- | --- |
| Strategy | Risk appetite and which compliance regimes apply `[PLACEHOLDER]` | Owner |
| Discover, Specify | Data classification of the idea; privacy review (already a readiness check); security requirements and abuse cases | Product lead |
| Architect | **Threat model** drafted by the security agent from the container view (data flows, trust boundaries, threats, mitigations, each mitigation a requirement or a quality attribute) | Architect (accepts it) |
| Build | Secret scan (exists), static analysis, dependency and licence scan, IaC scan, SBOM, on every PR as gates | Gates decide; a model never passes a gate |
| Verify | Dynamic scan against Test or Staging, container image scan, **penetration test** for restricted repositories, security regression of earlier findings | Security sign-off where risk requires it |
| Release | SBOM and open findings shown on the release; a release with an open finding above the threshold needs a **risk acceptance** | Two approvers + risk owner |
| Operate | New CVEs against running images, security incidents through the same incident flow | SRE, Owner |

A **finding** has a severity, a fix-by date from a policy (`[CONFIRM]` days per severity), an owner, and a state.
The factory may draft the fix as a PR. Closing a finding needs proof (the scan passes). **Accepting a risk is a
person's decision with a reason and an expiry**, never an agent's.

### 3.6 Quality and testing (a thread, with its own stage)

- **Test strategy per item** at Architect: which levels (unit, contract, integration, e2e, performance,
  accessibility, resilience, security) prove which requirement and quality attribute. Drafted by the test agent.
- **Test cases come from acceptance criteria.** A Given/When/Then criterion becomes a test case automatically,
  so coverage is a fact: "11 of 12 criteria have a passing test in Test".
- **Build-level tests** run as Factory gates (as today).
- **Environment-level tests** run in Verify, against Infrastructure's environments, on each deploy: e2e, load (from
  quality attributes, e.g. "p95 < 300 ms at the 18:00 peak"), accessibility (axe), resilience (e.g. "cache node
  lost"). Results attach to the environment (as the Environments screen already shows) **and** to the requirement.
- **A failing test is a question, not a fix.** The test agent may propose a fix as a PR or a change to the test; a
  person decides which is wrong.
- **Defects** found in Verify or Operate are items of their own, linked to the requirement they break, so escaped
  defects can be counted per stage.

### 3.7 Release and Operate

- A **release** groups merged work items into one deployable set for one product, with its version, the evidence pack
  (tests, security, approvals), release notes drafted by an agent, a rollout plan (from the spec) and a rollback
  plan.
- **Production changes only through a release** with two approvers (already the rule; now it has a home).
- **Progressive rollout** (percentage, store pilot, feature flag) is a release's plan, executed by Infrastructure or
  the deployment tool `[CONFIRM]`.
- **SLOs** come from quality attributes: "availability 99.9% monthly" in Architect becomes an SLO in Operate, with an
  error budget.
- **Incidents** (from alerts, or opened by a person) link to the release and item; the SRE agent drafts the timeline
  and the post-incident review; follow-ups become ideas or defects.
- **Outcome review** (§3.2) closes the loop for the business.

## 4. Systems

The factory is the existing systems plus three new ones (decided 2026-10-19), built in the order Security,
Quality, Operations. Every system is a hosted app in the one frame
(`design.md` §2).

| System | Rail | Covers | Project | Status |
| --- | --- | --- | --- | --- |
| Home | Home | For you, Overview, Lifecycle, Approvals, Activity, Metrics, Teams & roles | `nooblyjs-ai-host` | Built |
| Product Factory | Factory (Product section) | Strategy, Discover, Specify (with elicitation), Architect, UX, UI | `nooblyjs-ai-factory/product` | Built; strategy and elicitation to extend |
| Software Factory | Factory (Build) | Build | `nooblyjs-ai-factory` | Built |
| **Quality** | Quality | Test strategy, test cases, test runs, coverage, defects, evidence | `nooblyjs-ai-quality` (new) `[CONFIRM name]` | Decided; Phase 20 |
| **Security** | Security | Threat models, scans, findings, risk acceptance, pen tests, compliance evidence | `nooblyjs-ai-security` (new) `[CONFIRM name]` | Decided; Phase 19 |
| Infrastructure | Factory (Infrastructure section) | Designs, environments, provisioning, drift, cloud cost | `nooblyjs-ai-factory/infrastructure` | Built on a mock |
| **Operations** | Ops | Releases, deployments, SLOs, incidents, post-incident reviews, outcome reviews | `nooblyjs-ai-operations` (new) `[CONFIRM name]` | Decided; Phases 22–23 |
| Digital Teammates | Teammates | The agents | `nooblyjs-ai-teammate` | Built |
| Knowledge | Knowledge | The memory every stage reads and writes | `nooblyjs-ai-knowledge` | Built |
| Platform | Platform | Repos, containers, models, budgets, guardrails, secrets, audit | `nooblyjs-ai-host` | Built (runtime simulated) |

**Since 2026-10-19 the Product Factory and Infrastructure are sections of the Software Factory** (one rail item,
**Factory**, with its sidebar grouped Product · Build · Infrastructure), not apps of their own. Whether Quality, Security
and Operations become sections of the Factory too, or stay apps of their own as decided, is open (§9).

Alternatives considered: Quality inside the Factory and Infrastructure (where its pieces are today), and Security
inside Platform. Both were rejected because testing and security each span four or more stages and need their own
people, screens and approvals. Their artefacts would otherwise be scattered across apps that don't own them.

## 5. People

Work roles shape a person's home; they never grant permissions. Today's six stay. Four are added:

| Work role | What they do | Their home leads with | New? |
| --- | --- | --- | --- |
| Business owner | Owns a portfolio or value stream's outcomes and funding | Business cases waiting, outcome reviews, spend by value stream | New |
| Product manager | Turns signals into specs and follows items to outcome | (as today) plus outcome reviews due | |
| Business analyst | Runs elicitation, keeps requirements and traceability whole | Sessions to run, candidate requirements to triage, open questions | New |
| Architect | Owns design decisions and threat models | (as today) plus threat models to accept | |
| Designer | Journeys, flows, screens | (as today) | |
| Developer | Reviews, steers and merges agent work | (as today) plus findings on their repos | |
| QA / test engineer | Owns test strategy and the release candidate's quality | Failing tests in environments, coverage gaps, defects | New |
| Security engineer | Owns findings, threat models, pen tests, risk | Findings past fix-by, threat models to review, risk acceptances expiring | New |
| Engineering lead | Flow, people, agents, budgets | (as today) plus DORA measures | |
| Platform engineer / SRE | Platform, environments, releases, on-call | (as today) plus incidents, SLOs burning, releases to deploy | Extended |

**Access roles stay the five we have** (Viewer, Contributor, Approver, Architect, Owner). New decisions are new
**permissions** on that matrix, not new roles:

| New permission | Proposed holders | Used for |
| --- | --- | --- |
| `accept-requirement` | Approver and up | Turning a candidate requirement into a requirement |
| `accept-threat-model` | Architect, Owner | Stage 3 exit |
| `accept-risk` | Owner (and Architect for low and medium) `[CONFIRM]` | Risk acceptance on a finding |
| `accept-release-candidate` | Approver and up | Stage 7 exit |
| `deploy-production` | Approver and up, two of them | Stage 8 exit (exists as a rule) |
| `declare-incident` | Contributor and up (people only) | Opening an incident |

**Agents stay capped at Contributor.** They draft threat models, test plans, release notes and post-incident
reviews; they never accept, approve, deploy, accept a risk or close an incident.

### New approval rules (to add to "Who approves what")

| Decision | Approver | Target time | If late |
| --- | --- | --- | --- |
| Business case → Discover accepted | Business owner | `[CONFIRM]` 3 working days | Remind |
| Threat model accepted | Architect | 1 working day | Remind, then escalate |
| Release candidate accepted | QA lead | 4 hours | Remind |
| Risk acceptance | Risk owner (`accept-risk`) | 1 working day | Hold the release |
| Production deploy | Two approvers | Same day | Hold deploy (exists) |
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
| Idea → production | Item opened to its first production release (median) |
| Idea → outcome | Item opened to its outcome review, and the share whose goals were met |
| Deployment frequency | Production releases per product per week |
| Change lead time | First commit of a work item to its production release (median) |
| Change failure rate | % of production releases followed by an incident or rollback within `[CONFIRM]` 7 days |
| Time to restore | Incident opened to resolved (median) |
| Requirement coverage | % of an item's acceptance criteria with a passing test in its latest environment |
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

**Open**

1. Who owns releases: Operations (proposed), Infrastructure, or the lifecycle engine? (Infrastructure I10.)
2. The app names and mount paths (`nooblyjs-ai-quality`, `-security`, `-operations`), or, now that Product and
   Infrastructure are sections of the Software Factory (2026-10-19), whether Quality, Security and Operations should be
   sections of it too (`/factory/quality`, …), which would keep the whole lifecycle in one app.
3. The work hierarchy (epic, feature, requirement) against ideas, specs and Jira (`nooblyjs-ai-factory/product` §8).
4. Which scanners, load-test and monitoring tools are approved (`stack.md` §6), and where they run.
5. Fix-by days per finding severity, and who may accept which risk.
6. Compliance regimes in scope `[PLACEHOLDER]`.
7. Everything still open in the host `product.md` §12 (hosting target and region, model cloud, IaC tool), which
   Release and Operate depend on.
