---
inclusion: always
---

# Infrastructure: where things live

> `stack.md` has the platform rules and the `register()` contract; `product.md` says what the module
> does and shows. This repo is NooblyJS's **Infrastructure** module: it owns infrastructure designs,
> environments, provisioning runs, drift, blueprints, policies and cloud cost, and its **screens**,
> which are a UI module in the NooblyJS frame at `/infrastructure/…`. They call this repo's API at
> **`/infrastructure/api/v1`**. The layout follows `../nooblyjs-ai-host/.claude/steering/structure.md` §2a.
>
> §2 and §3 describe what is on disk. In §4–§7, anything not marked *(built)* in the roadmap is still a
> **proposal** to settle with NooblyJS, together with the open points in `product.md` §8. `docs/roadmap-history.md`
> says what was built, and noobly's `roadmap.md` what is open.

## 1. Who owns what

| Owner | Owns | Example |
| --- | --- | --- |
| **`nooblyjs-ai-infrastructure`** (this repo) | Infrastructure **designs** and their versions, resources, plans, policy results, **environments**, **provisioning runs**, drift, blueprints, policies, cloud cost | `data/infrastructure/designs/INF-031.md` |
| `nooblyjs-ai-product` | What a design is built from: ADRs, the container view, quality attributes, the spec's rollout plan | ADR-014, PRD-031 |
| the lifecycle engine (part of `noobly`, `src/lifecycle/`) | **Items**, stages, **approvals** (targets, escalation), handoffs, releases `[CONFIRM]` | the approval for INF-031 v2 |
| `nooblyjs-ai-factory` | Builds, PRs, test runs and gates | PR #485, the e2e suite's result |
| `nooblyjs-ai-teammate` | The infrastructure agent and its billing | Ines Tau drafts INF-031 |
| `noobly` | The frame, people, access roles, audit, events, budgets, guardrails, repositories, secrets references | the rail item for `/infrastructure` |

This repo **never records an approval or moves an item's stage itself**. "Approve & provision Test"
is a person's decision: the API passes it to `host.service('workflows')`, and this repo starts the
run when `approval.decided` arrives.

## 2. Layout

```
nooblyjs-ai-infrastructure/
  index.js                  register(app, serverManager, options) → HostedApp (ui, nav, status, services, seed, close)
  server.js                 standalone dev server (stack.md §5); `--seed [--reset]` seeds and exits
  package.json              "name": "nooblyjs-ai-infrastructure", "type": "module", "main": "index.js",
                            "exports": { ".": "./index.js" }, engines.node >= 22.12
  .env.example
  src/
    routes/index.js         the whole API router, mounted under /infrastructure/api/v1: auth, audit, the routes
                            by area, 404 and errors. Split it into one file per area when it outgrows one screen
    services/               business rules, one file per concern:
                            designs.js (read, decide, automatic applies) · policy-checks.js · code.js (design →
                            infrastructure code, from blueprints) · environments.js (read, promotion path, create
                            under the apply rules) · runs.js (the queue, progress, resume) · drift.js (check,
                            restore, keep) · cost.js (the ledger against the budget) · policies.js (policies and
                            blueprints) · summary.js (status card, badge, `services` for other apps) ·
                            views.js (every status in words)
    provisioners/           index.js (picks the adapter) · mock.js (default) · <tool>.js ([DECIDE], stack.md §4)
    repos/index.js          one repo per entity, over host.store: designs (with versions) · environments · runs ·
                            drift · config (blueprints, policies, apply rules, promotion paths, budget, agent) · cost
    seed/                   index.js + data/ mirroring data/infrastructure/ for the INF-031 story; times in it are
                            relative ({{ago:40m}}) and placed around the moment of seeding
    util/                   ids.js · http.js (If-Match, people only, refusals with an audit record) · errors.js
  public/                   the UI module the NooblyJS frame loads (no index.html of its own)
    css/infrastructure.css  only what the kit doesn't cover; every selector starts with [data-module="infrastructure"]
    js/
      module.js             the route table
      lib.js                shared page helpers
      pages/                environments.js · environment.js · designs.js · design.js · runs.js · testing.js ·
                            blueprints.js · cost.js · policies.js
  test/
    register.test.js        the hosted-app contract (the hosted-app checklist in noobly roadmap.md)
    governance.test.js      refuses: an agent approves, someone else approves, Production from here, no approved
                            version, a blocking policy, a stale If-Match, an agent on drift, a non-Owner on policies
    public/module.test.js   CSS scoped, nav rows routed, every page exports render(), no inline styles
    routes/story.test.js    the seed story through the API: both mocked screens, a decision, runs, drift
    fixtures/host.js        stand-in host (also used by server.js), test serverManager, fake partner services
    helpers.js              startApp(): the app on a bare Express 5 app, port 0, temp data folder
  .claude/
    steering/               product.md · stack.md · structure.md · ui/ (design input, read-only)
    specs/                  per-feature Kiro specs (requirements, design, tasks)
```

## 3. Screens and routes

Sidebar title `infrastructure`, rail label `Infra`. `NavItem.path` is relative to the mount path.

| Nav row (group) | Path | Page | Mockup |
| --- | --- | --- | --- |
| Environments | `/environments` (and `/`, which redirects) | `environments.js` | `ui/noobly-infrastructure-environments` |
| — | `/environments/:name` | `environment.js` | none yet (`Infra-EnvDetail`) |
| Designs | `/designs` | `designs.js` | none yet |
| — | `/designs/:id` | `design.js` | `ui/noobly-infrastructure-design-from-architecture` |
| Provisioning runs (badge `runs`) | `/runs`, `/runs/:id` | `runs.js` | none yet |
| Testing in environments | `/testing` | `testing.js` (what is failing, and tests by environment) | none yet |
| Blueprints (*Govern*) | `/blueprints` | `blueprints.js` | none yet |
| Cost (*Govern*) | `/cost` | `cost.js` | none yet |
| Policies (*Govern*) | `/policies` | `policies.js` | none yet |

URLs: `/infrastructure/environments/test-slots`, `/infrastructure/designs/INF-031`,
`/infrastructure/runs/run_8f3k2`. A screen with no mockup is built in the patterns of the two that exist.

## 4. API (`/infrastructure/api/v1`)

Built. Every route needs a signed-in person with `read`; the "Who" column is what a change needs on top.

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET /about` · `GET /summary` · `POST /seed` | the app and which partners are connected; the status card's facts; rewrite the seed story | Owner to seed, never in production |
| `GET /environments?kind=&product=` | the table: kind, deployed, tests, cost per day, drift | — |
| `GET /environments/:name` | one environment: design and version, deployed versions, test suites, its runs | — |
| `POST /environments` | **New environment** from a design, under the apply rules | Preview, Dev: `draft` · Test, Staging: people only, the approval permission · Production: refused |
| `POST /environments/:name/drift-check` | compare the environment with its design and record anything new | `draft` |
| `GET /promotion-paths/:product` | Preview → Dev → Test → Staging → Production, with each tile's value and line | — |
| `GET /designs` · `GET /designs/:id?kind=test` · `GET /designs/:id/versions` | designs; one design for one kind (resources by layer, code, plan, cost estimate, policy checks, approvals, whether this person may decide), with an `ETag` | — |
| `POST /designs/:id/decision` | **Request changes** or **Approve & provision <kind>** (`If-Match`) | people only, the approval permission in `apply-rules.yaml` |
| `GET /runs?status=&environment=` · `GET /runs/:id` | provisioning runs and their progress (`status=active` for those in progress) | — |
| `GET /drift?status=` · `POST /drift/:id/restore` · `POST /drift/:id/keep` | drift; **Restore from design** (a run); **Keep and update design** (a new design version that needs approval) | people only · restore: the kind's apply rule · keep: `draft` |
| `GET /blueprints` · `GET /policies` · `PUT /policies/:id` | blueprints with who uses them; policies; switch one on or off | Owner (`change-guardrails`), people only |
| `GET /cost?month=` | spend by kind and by environment against the budget | — |

Still to come (roadmap): `POST /designs/:id/drafts` (I7), `POST /runs/:id/cancel` and destroying an
environment (I4), and worker callbacks through the host's `/internal/v1` (I9).

## 5. Data (`data/infrastructure/`, written only by the NooblyJS process)

```
data/infrastructure/
  designs/<INF-ID>.md                      the current version: status, draftedBy, itemId, builtFrom, blueprint,
                                           approvals, approvedVersion + approvedKinds, and `resources` (layer, state,
                                           what it creates, cost per day per kind, its blueprint module, settings)
  designs/<INF-ID>/versions/v<N>.md        earlier and approved versions (never rewritten)
  environments/<name>.md                   test-slots.md, pr-485.md: kind, design + version, deployed, tests, costPerDay,
                                           lifetime, and `observed` (what the provisioner saw that differs from the design)
  runs/<run-id>.md                         environment, design version, plan, status, progress, requestedBy, approvedBy
  drift/<drift-id>.md                      environment, resource, setting, expected and actual, status, who decided
  blueprints.yaml                          name, version, approved
  policies.yaml                            rule, severity (blocks / warns), on/off
  apply-rules.yaml                         environment kind → automatic | approval | release, and the approval permission
  promotion-paths.yaml                     product → its environment per kind, and the release that reaches Production
  budget.yaml                              monthly cloud budget `[CONFIRM: or data/platform/budgets.yaml]`
  agent.yaml                               the infrastructure agent, until Digital Teammates has her (roadmap I7)
  cost/ledger.yaml                         what environments cost, append-only (partition by day when it is real, I9)
  seed.yaml                                which seed story is in the folder, and when it was written
```

Conventions (NooblyJS `structure.md` §5):

| Thing | Convention | Example |
| --- | --- | --- |
| Files (JS, CSS) | kebab-case | `policy-checks.js` |
| Design ids | `INF-<NNN>` | `INF-031` |
| Environment names | kebab-case, also the file name | `test-slots`, `pr-485`, `staging` |
| Generated ids | `<prefix>_<random>` | `run_8f3k2`, `drf_2k9x1`, `drft_a71` |
| Environment kinds | lower case | `preview`, `dev`, `test`, `staging`, `production` |
| Front-matter and YAML keys | camelCase | `draftedBy`, `costPerDay`, `builtFrom` |
| Secrets | references only | `vault:test/REDIS_URL` |
| Events | `<entity>.<past-tense verb>` | `environment.provisioned` |
| CSS classes | component-first, kebab-case, scoped | `[data-module="infrastructure"] .resource-tile--new` |
| Tests | `<unit>.test.js`, mirroring `src/` | `test/services/apply-rules.test.js` |

Routes never call the store: `routes` → `services` → `repos` → `host.store`.

## 6. Talking to the rest of NooblyJS

| Direction | What |
| --- | --- |
| Emits | `infra_design.drafted`, `infra_design.updated`, `infra_design.approval_requested`, `infra_design.approved`, `infra_design.changes_requested`, `policy.checked`, `environment.plan_ready`, `environment.provisioning_started`, `environment.provisioning_progressed`, `environment.provisioned`, `environment.provisioning_failed`, `environment.destroyed`, `environment.promoted`, `drift.detected`, `drift.restored`, `drift.accepted`, `budget.reached`, `draft.requested`, `draft.failed`, `agent.action` |
| Listens to | `approval.decided` (start or refuse a run) · `adr.accepted`, `architecture.updated` (a design may be stale; offer a new draft) · `pr.opened` (create a preview) · `pr.merged` (destroy it) · `run.finished` (test results for an environment) · `budget.reached`, `guardrail.changed` |
| `services` it exposes | `environmentsFor(itemId)` · `previewFor(repo, prNumber)` · `designFor(itemId)` · `testTargets(kind)` (where the Factory deploys and tests) · `waitingFor(person)` (Home · Waiting on you) · `summary(person)` (the status card) · `metrics()` (cloud spend) |
| Services it uses | `workflows` (approvals, items, releases) · `product` (`artefactsFor(itemId)`, `gatesFor(itemId)`) · `factory` (`runsForItem`) · `teammates` (`runTask`, work type `infrastructure-drafting` `[CONFIRM]`) · `knowledge` (context). Any may be missing when standalone |

Event names here are proposed; agree them with the lifecycle engine (part of `noobly`, `src/lifecycle/`) and `nooblyjs-ai-factory` before use,
because Activity, Metrics and the audit log read them.

## 7. Drafting and provisioning flows

1. **Draft.** A person asks (`POST /designs/:id/drafts`), or an accepted ADR arrives for an item
   `[CONFIRM automatic]`. The service checks the budget, records `drafts/<id>.md` and queues a job.
   `workers/drafting.js` reads the architecture through `host.service('product')` and runs a teammate
   task. The result is a **new design version**; it never overwrites a person's edit (`If-Match`).
2. **Check.** Policy checks, the plan and the cost estimate are computed for the new version.
3. **Decide.** A person approves or requests changes; the lifecycle engine (part of `noobly`, `src/lifecycle/`) records it.
4. **Provision.** On `approval.decided`, `apply-rules.js` decides what may run: Preview and Dev at
   once, Test or Staging for the kind that was approved, Production never from here. The run is
   queued, the adapter applies, progress is emitted, and the environment file is written when it finishes.
5. **Watch.** The drift sweep compares each environment with its design; a difference is recorded
   and waits for a person.

## 8. Seed

`seed({ reset })` writes the INF-031 "Infrastructure for same-day slots" story (`product.md` §7):
INF-031 at v2 waiting for the platform owner, its resources, plan (+7 / ~2 / 0), cost estimate and
policy results (four passed, one warning); the environments `pr-485`, `pr-486` (provisioning at 70%),
`dev-slots` (drift on Redis maxmemory), `test-slots`, `staging` and `prod`; one run in progress; the
blueprints `node-service v3` and `redis v2`; a $6,000 monthly budget with $2,140 spent. It refers to
PRD-031 and ADR-014 by id only, because those belong to `nooblyjs-ai-product`. Mockup numbers are sample data.

## 9. Where to put new things

- **A new screen:** a page in `public/js/pages/`, a route in `module.js`, a `nav` row in `index.js`
  if it has one, its API in `src/routes/`, and an e2e spec in `../nooblyjs-ai-host/test/e2e/`.
- **A component other apps would use:** the UI kit in `nooblyjs-core/public/ui/`, never here.
- **A new entity:** a repo in `src/repos/`, a folder in `data/infrastructure/` (update §5), seed
  files, and the events it emits (update §6).
- **A new rule or policy:** a service function plus a "refuses" test; if people change it at
  runtime, it is YAML in `data/infrastructure/`.
- **A new cloud or tool:** an adapter in `src/provisioners/` behind the same interface.
- **Design input:** the original mockups are not kept in this repo; the built screens are the reference.
