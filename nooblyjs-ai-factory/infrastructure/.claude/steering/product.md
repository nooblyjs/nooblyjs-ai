---
inclusion: always
---

# Infrastructure (`nooblyjs-ai-infrastructure`)

> **Since 2026-10-19 this is the Software Factory's Infrastructure section** (`nooblyjs-ai-factory/infrastructure`, pages in
> `nooblyjs-ai-factory/public/infrastructure`), not an app of its own with a rail item. Where this file says
> `/infrastructure`, read `/factory/infrastructure`; `data/infrastructure`, read `data/factory/infrastructure`;
> `nooblyjs-ai-infrastructure`, read the Factory's Infrastructure section. There is no `server.js` or standalone mode
> any more. See the section's `CLAUDE.md`.

> **What this repo is:** NooblyJS's Infrastructure module. It owns **infrastructure designs** (drafted by
> an agent from an approved architecture), the **environments** built from them, the **provisioning
> runs** that build them, drift, and what the environments cost. It owns its **screens** (a UI module
> in the NooblyJS frame, rail label **Infra**, sidebar `infrastructure`) and a JSON API.
>
> **Source of truth:** the two mockups in `.claude/steering/ui/` (`noobly-infrastructure-environments`,
> `noobly-infrastructure-design-from-architecture`) for what this module shows, and the NooblyJS product
> definition (`../../nooblyjs-ai-host/.claude/steering/product.md`) for governance, roles, the lifecycle and the shell.
> If this file disagrees with the NooblyJS `product.md`, **NooblyJS wins**. `stack.md` has the platform rules,
> `structure.md` the layout, API and data.
>
> **Not yet in NooblyJS.** The NooblyJS `product.md` lists five systems and has no Infrastructure module; its
> Platform nav has an "Environments" row with no mockup. This file is therefore partly a proposal:
> see §8 for what must be agreed with NooblyJS before building. All numbers below are **sample data** from
> the mockups (the PRD-031 "Same-day delivery slots" story). Anything in `[BRACKETS]` is undecided.

## 1. Core rules (apply to every change here)

- **People decide; agents propose.** The infrastructure agent writes designs and infrastructure code
  and runs **plans**. It never approves a design. Who may apply:

  | Environment kind | Apply | From the mockup |
  | --- | --- | --- |
  | Preview, Dev | Automatic: the latest design version, once its policy checks pass, with no approval `[CONFIRM]` | "Preview and Dev apply automatically" |
  | Test, Staging | **One approval** by a person | "Applying to Staging or Production always needs a person" |
  | Production | **Only through a release**, with two approvers | "Changes only through a release" · "Release Slots 1.0 · 2 approvers" |

  Enforce this in services, not in the UI. Agents are capped at the **Contributor** access role.
- **Every environment is built from a design.** No design, no environment, and a Test or Staging
  environment only from a version a person approved for that kind. A change made by hand is
  **drift**, and a person resolves it.
- **Only approved blueprints.** Infrastructure code is composed from versioned blueprints
  (`node-service v3`, `redis v2`); anything else fails a policy check.
- **Policy checks gate approval**, the way readiness gates a spec. A warning (e.g. "Cache tier above
  Test default") is shown in words and does not block; a failure does `[CONFIRM which block]`.
- **Agents never see production secrets.** Designs reference secrets by name; non-production
  environments get that environment's own values ("Secrets vault · test-environment values").
- **Every agent action is attributed and costed**, and every write is audited. Cloud spend is
  tracked separately from agent (model) cost.
- **Status is said in words**, not colour alone ("Waiting for the platform owner", "Drift on Redis
  config", "41 of 42 e2e · 1 failing"). WCAG 2.2 AA.
- **A build moves right only when that environment's tests pass.**

## 2. Where Infrastructure fits

It sits between Architecture and Ship. The Product Factory's architecture is its input; the Software
Factory deploys into what it builds.

```
Architect ──► Infrastructure design ──► environments ──► Build (Factory deploys, tests run) ──► Ship (release)
 ADRs, container view,     INF-031            preview · dev · test · staging · production
 quality attributes, rollout plan
```

| Reads from | What |
| --- | --- |
| Product Factory (`nooblyjs-ai-product`) | ADRs (ADR-014 · slot cache), the container view, quality attributes, the spec's rollout plan and acceptance criteria |
| Software Factory (`nooblyjs-ai-factory`) | builds and PRs to deploy (a preview per open PR), test results per environment |
| Lifecycle (the lifecycle engine (part of `noobly`, `src/lifecycle/`)) | approvals for designs and applies, the release that changes Production |
| Platform (`noobly`) | budgets, guardrails, repositories, the audit log |

Primary users: **Platform engineers** (approve designs, resolve drift, own blueprints and policies),
**Architects** (their accepted ADR counts as their sign-off on the design), **Developers** (where is
my PR deployed, which tests ran there) and **Engineering leads** (cost).

## 3. Capabilities

1. **Design from architecture.** The agent drafts an infrastructure design from the item's
   architecture, with provenance ("Built from": ADRs, container view, quality attributes, rollout
   plan, blueprint) and a version.
2. **Resources per environment**, grouped by layer (Edge, Compute, Data, Messaging, Security,
   Observe), each marked **New / Changed / Existing, shared**, with where it came from ("from ADR-014").
3. **Infrastructure code** generated from the design, shown read-only, delivered as a pull request.
4. **Plan** before any apply: resources to add, change and destroy.
5. **Cost estimate** per day and environment kind, and **actual cost** by kind per month against a budget.
6. **Policy checks** on every design version.
7. **Approve & provision**, or **Request changes**.
8. **Environments** with their kind, what is deployed, the tests that ran there and cost per day.
9. **Promotion path** per product: Preview → Dev → Test → Staging → Production.
10. **Preview environments**: one per open PR, destroyed on merge.
11. **Drift**: detect it, then **Restore from design** or **Keep and update design**.
12. **Provisioning runs** with live progress ("Provisioning · 70%").

## 4. Data this module owns

- **Design** — id (`INF-031`), title, version, status, drafted by, linked item, built-from links, blueprint
- **Resource** — layer, name, detail, state (new / changed / existing), source, per environment kind
- **Plan** — environment, add / change / destroy counts
- **PolicyCheck result** — policy, passed / warning / failed
- **Environment** — name (`test-slots`, `pr-485`), kind, design and version, deployed versions,
  tests, cost per day, drift, lifetime ("destroys on merge")
- **ProvisioningRun** — environment, design version, plan, progress, status, who approved, cost
- **Drift** — environment, resource, what changed, resolution
- **Blueprint** — name, version, approved
- **Policy** — rule, severity, on/off
- **Cost** — per environment per day; roll-up by kind per month; the monthly budget

## 5. Screens (this repo's `public/js/`, in the NooblyJS frame)

Sidebar `infrastructure`. Nav: **Environments, Designs, Provisioning runs** (badge: runs in progress),
**Testing in environments** · *Govern*: **Blueprints, Cost, Policies**. Status card: a pill ("1 drift
detected"), "Live environments · 9 · 3 of them previews", and a meter "October cloud spend $2,140 of $6,000".

### 5.1 Environments (`noobly-infrastructure-environments`)

- Eyebrow "NooblyJS · Infrastructure", title **Environments**, lead "Where the Software Factory deploys,
  and where tests run against real infrastructure. Every environment is built from an approved
  design." Actions: **Designs**, **New environment**.
- **Promotion path · slots** ("A build moves right only when that environment's tests pass"), one
  tile per kind; the selected one is outlined and Production is navy:

  | Kind | Value | Line under it |
  | --- | --- | --- |
  | Preview | 3 per-PR | Created per PR, destroyed on merge |
  | Dev | 0.9.4 | Drift on Redis config |
  | Test | 0.9.4 | 41 of 42 e2e · 1 failing |
  | Staging | 0.9.2 | Load test tonight 18:00 |
  | Production | Not yet | Release Slots 1.0 · 2 approvers |

- **All environments** table (`[CLOUD] · [REGION]`; scrolls inside its card). Columns: Environment
  (mono name plus a note), Kind (pill), Deployed, Tests here, Cost / day.

  | Environment | Kind | Deployed | Tests here | Cost / day |
  | --- | --- | --- | --- | --- |
  | `pr-485` · web-storefront · destroys on merge | Preview | PR #485 · 12 min ago | e2e 18/18 | $0.40 |
  | `pr-486` · slots-api · fix for NOOBLY-322 | Preview | Provisioning · 70% (progress bar) | Waiting | $0.60 |
  | `dev-slots` · Drift: Redis maxmemory changed by hand | Dev | api 0.9.4 · web 4.12.0 | smoke 12/12 | $9 |
  | `test-slots` · From design INF-031 v2 | Test | api 0.9.4 · web 4.12.0 | e2e 41/42 · load ✓ | $18 |
  | `staging` · Shared · production-sized | Staging | api 0.9.2 · web 4.11.8 | Load test 18:00 | $41 |
  | `prod` · Changes only through a release | Production | web 4.11.2 | Synthetic checks ✓ | — |

  A row opens the environment's detail (5.3).
- **Needs attention** (warning-bordered card): "Drift · dev-slots", "Redis maxmemory was changed by
  hand and no longer matches design INF-031.", actions **Restore from design** / **Keep and update design**.
- **Infrastructure agent** card (navy): "Ines Tau · Infrastructure agent", current work ("Provisioning
  pr-486 · 70%"), and "Ines writes the infrastructure code from approved designs and runs plans.
  Applying to Staging or Production always needs a person."
- **Cost by kind · October**: bars for Staging $1,230, Test $540, Dev $270, Previews $100.

### 5.2 Design detail (`noobly-infrastructure-design-from-architecture`)

- Breadcrumb Infrastructure / Designs / `INF-031`. Title "Infrastructure for same-day slots". Pills:
  `INF-031 · v2`, status "Waiting for the platform owner", "Drafted by Ines Tau from the architecture
  · 40 min ago". Actions **Request changes**, **Approve & provision Test**.
- **Built from** chips, linking into the Product Factory: ADR-014 · slot cache, Container view ·
  slots, 4 quality attributes, PRD-031 rollout plan, and Blueprint · node-service v3.
- **Resources**, with an environment switch (Preview / Dev / **Test** / Staging / Production) and a
  legend New / Changed / Existing, shared:

  | Layer | Resources |
  | --- | --- |
  | Edge | API gateway — changed (shared · new route `/slots`) |
  | Compute | Slot API · container app — new (2–6 replicas · scales on requests). Hold expiry job — new (every 5 s · from acceptance criterion 1) |
  | Data | Redis cache · 1 GB — new (zone-redundant · from ADR-014). Planner database — existing (private, read only) |
  | Messaging | Event bus — changed (shared · new topic `slot.released`) |
  | Security | Managed identity — new (Slot API → cache, bus, planner). Secrets vault — existing (test-environment values) |
  | Observe | Alarms — new (p95 > 300 ms · cache-miss rate). Logs and traces — existing workspace |

- **Infrastructure code · `infra/slots/test`** (navy code card, mono) with **Open pull request #91**.
- **Plan for Test**: +7 to add, ~2 to change, 0 to destroy.
- **Estimated cost per day**: Preview (each PR) $0.60, Dev $9, **Test $18**, Staging $41, Production ~$62.
- **Policy checks**: Customer data stays in-region ✓ · Encrypted at rest and in transit ✓ · Only
  approved blueprints used ✓ · Fits the Delivery squad budget ✓ · Cache tier above Test default (warning).
- **Approvals**: Thabo N. · Architect — "Via ADR-014"; You · Platform owner — Waiting. Note:
  "Preview and Dev apply automatically. Test and Staging need one approval; Production only changes
  through a release."

### 5.3 Screens with no mockup yet

Build these in the same patterns, and ask design for the exports.

| Screen | What it should show |
| --- | --- |
| Designs (list) | every design with version, status, item, who it waits on |
| Provisioning runs | runs in progress and finished: environment, design version, plan, progress, who approved, cost |
| Testing in environments / environment detail | the mockups link it as `Infra-EnvDetail`: one environment, what is deployed, each test suite's result (the failing e2e), history |
| Blueprints | approved blueprints and versions, which designs use each |
| Cost | spend by kind, environment and team against the budget |
| Policies | the policy rules, on/off, history |

## 6. Where Infrastructure work surfaces elsewhere in NooblyJS

| Screen | What it shows |
| --- | --- |
| Home · Approvals | design approvals and applies to Test and Staging, with plan, cost estimate and policy results |
| Home · Activity | "Ines Tau drafted INF-031 v2", "pr-486 provisioned", drift detected and resolved, each with cost |
| For you · Platform engineer (not yet designed) | designs waiting on you, drift, runs in progress |
| For you · Developer | where a PR's preview is and what ran there |
| Product Factory · Architecture | a link from an accepted ADR to the design built from it |
| Software Factory | the environment a run deployed to; an environment's test result as a gate |
| Platform · Containers | "Preview environments" is a pool there today (§8) |
| Metrics | cloud spend next to agent spend |

## 7. Seed story

INF-031 "Infrastructure for same-day slots", built from PRD-031: v1 approved, v2 waiting for the
platform owner (Thabo N. signed off through ADR-014). Environments `pr-485` (v1), `pr-486` (v2,
provisioning at 70%), `dev-slots` (v2, drifted: Redis maxmemory), `test-slots` (v1, one e2e failing),
`staging` (v1), `prod`. Approving v2 for Test is what moves `test-slots` to v2; the mockup's
"From design INF-031 v2" on that row is ahead of its own approval. The
agent is **Ines Tau**. Budget $6,000 a month, $2,140 spent in October. All sample data.

## 8. Open points (`[CONFIRM]` with NooblyJS before relying on them)

> **Settled in NooblyJS Phase 9a (2026-10-10):** Infrastructure is in NooblyJS's steering and on its rail; it **owns
> environments and previews** (Platform lists them, keeps Secrets, and its preview pool counts ours); the mount path
> and name below; a design is **an artefact with its own approval** (`infra-design` in the lifecycle engine (part of `noobly`, `src/lifecycle/`)), not a
> stage; the cloud budget is Platform's; drift is swept every 6 business hours. Still open: who the platform
> owner is, automatic apply as a Platform guardrail, releases, cloud and region, the IaC tool, Ines Tau.

- **Infrastructure is not in the NooblyJS steering files.** Adding it means updating
  `../../nooblyjs-ai-host/.claude/steering/product.md` (§1 systems, §5.1 rail, §10 child projects), `structure.md`
  §2a (mount table, `hosted-apps.yaml`) and `roadmap.md` (a phase). The mockups put **Infra** on the
  rail between Factory and Teammates.
- **Overlap with Platform.** Platform's nav has **Environments** and **Secrets**, and Platform ·
  Containers has a "Preview environments" pool ("one per open PR, torn down on merge"). Decide which
  module owns environments and previews; this file assumes Infrastructure does and Platform links here.
- **Mount path and name**: `/infrastructure`, `name: 'infrastructure'`, rail label `Infra`.
- **Lifecycle.** Is an infrastructure design a new stage, a gate between Architect and Build, or an
  artefact on the item with its own approval? NooblyJS has seven stages and none is Infrastructure.
- **Approval rules.** "Platform owner" approves a design: which access role and permission is that
  (the matrix has Owner for "change guardrails and repo access")? Target times and escalation for
  design approval and for Test / Staging applies are not given.
- **Automatic apply to Preview and Dev** by an agent needs a guardrail entry in Platform · Settings.
- **Production release**: who owns releases ("Release Slots 1.0") — this module, the lifecycle engine (part of `noobly`, `src/lifecycle/`) or Ship?
- **Cloud and region** are `[CLOUD]` and `[REGION]` in the mockup (NooblyJS §12 Q3). The resource names
  ("container app", "managed identity") are illustrative, not a decision.
- **Infrastructure-as-code tool.** The mockup's code is HCL-style `module` blocks; Terraform,
  OpenTofu or something else is `[DECIDE]`. Which repository holds `infra/…` and receives PR #91?
- **Ines Tau** is not in the Digital Teammates seed. Hire her there, or draft from scripts until then.
- **Design ids.** INF-031 shares its number with PRD-031: is the number always the item's?
- **Sample-data mismatch**: the status card says 9 live environments and 3 previews; the table lists
  six, two of them previews.
- **Drift detection**: how often, and from what (a scheduled plan, or cloud events)?
