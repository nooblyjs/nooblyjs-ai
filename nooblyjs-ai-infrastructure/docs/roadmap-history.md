> **History, not a plan (2026-10-11).** NooblyJS keeps one roadmap: `../nooblyjs-ai-host/.claude/steering/roadmap.md`. This file is
> how this repo was built before that; what was still open here is in that roadmap under "Hosted apps: open work".

# Infrastructure — Roadmap

> The order this module is built in, and where it stands. Scope comes from `product.md`, the rules from
> `stack.md`, the layout from `structure.md`. Each phase ends with something you can run and judge.
> Update the tracker and the phase's checkboxes **in the same change** as the work.
>
> Status marks: ✅ done and tested · 🟡 partly done (the open boxes say what is left) · ☐ not started ·
> ⛔ blocked on a decision outside this repo.

## Tracker

| Phase | Name | Status | Needs |
| --- | --- | --- | --- |
| I0 | Scaffold and the hosted-app contract | ✅ | — |
| I1 | Seed story and read API | ✅ | — |
| I2 | The two mocked screens: Environments, Design | ✅ | — |
| I3 | Decisions and governance | ✅ | — |
| I4 | Provisioning runs and drift (mock provisioner) | ✅ | — |
| I5 | The screens with no mockup | 🟡 | design exports (not ours to make) |
| I6 | Join NooblyJS | ✅ | — (NooblyJS Phase 9a) |
| I7 | The drafting agent (Ines Tau) | ☐ | I6, Digital Teammates |
| I8 | Previews and tests from the Software Factory | ☐ | I6, Factory events |
| I9 | A real provisioner | ⛔ | cloud, region and IaC tool |
| I10 | Releases to Production, hardening | ☐ | I9, who owns releases |

## How to check any phase

```bash
npm install       # links ../nooblyjs-core
npm test          # offline: mock provisioner, stand-in host
npm start         # standalone on http://localhost:11008, sign in at /login (Stevie is the Owner)
npm run seed -- --reset
```

Seeded people (the stand-in host's, the same as NooblyJS's): **Stevie** (Owner) · **Lerato M.** (Approver) ·
**Thabo N.** (Architect) · **Priya S.** (Contributor) · **Naledi K.** (Viewer) · **Ada Quill** (an agent).

---

## I0 — Scaffold and the hosted-app contract ✅

**Goal:** NooblyJS (or `server.js`) can mount the module, and a broken start can't take the host down.

- [x] `package.json` (ES modules, `nooblyjs-core` as `file:../../nooblyjs-core`, Express for `server.js` only)
- [x] `index.js` → `register(app, serverManager, options)` returning the `HostedApp` description
- [x] API under `/infrastructure/api/v1`: signed-in only, one error shape, writes audited
- [x] `public/` served under the mount path; every other page URL answers with the host's frame
- [x] `server.js` standalone mode on the same `register()`, with the dev sign-in
- [x] `test/register.test.js`: mount, 401, 403 with an audit record, nothing written outside `dataDir`, `close()`

**Test it:** `npm test`. Then `npm start`, open `/infrastructure/api/v1/about` signed out (401) and signed in.

## I1 — Seed story and read API ✅

**Goal:** the INF-031 story is on disk as readable files, and every number on a screen comes from them.

- [x] Seed: INF-031 (v1 approved, v2 waiting), six environments, one run at 70%, one drift, blueprints,
      policies, apply rules, the promotion path, the budget and October's cost ledger
- [x] Repos over `host.store` (designs with versions, environments, runs, drift, config, cost)
- [x] Read API: environments, promotion path, designs (resources, code, plan, cost estimate, policy
      checks), runs, drift, blueprints, policies, cost, summary
- [x] `status()` for the sidebar card and the runs badge; `services` for other apps

**Test it:** after `npm start`, open `data/infrastructure/designs/INF-031.md` and compare it with
`GET /infrastructure/api/v1/designs/INF-031?kind=test`.

## I2 — The two mocked screens ✅

**Goal:** Environments and Design INF-031 match their mockups, in the NooblyJS frame.

- [x] UI module (`public/js/module.js`), scoped CSS, no inline styles except the kit's meter
- [x] **Environments**: promotion path, the table, Needs attention, the agent card, cost by kind
- [x] **Design**: breadcrumb, pills, Built from, resources by layer with the environment switch, the
      generated code, plan, cost estimate, policy checks, approvals
- [x] `test/public/module.test.js`: CSS scoped, every nav row routed, pages leave history and `<body>` alone
- [x] axe and 375px on every screen in NooblyJS's e2e suite (`../nooblyjs-ai-host/test/e2e/infrastructure.story.js`)
- [ ] Side-by-side check against the mockups at 1440px

**Test it:** `npm start`, sign in as Stevie, open `/infrastructure` next to
`.claude/steering/ui/*/…dc.html` (serve that folder over HTTP).

## I3 — Decisions and governance ✅

**Goal:** only the right person can approve, and every rule in `stack.md` §4 has a test that refuses.

- [x] **Approve & provision** and **Request changes**, people only, with `If-Match`
- [x] Apply rules by kind from `apply-rules.yaml`: Preview and Dev automatic, Test and Staging one
      approval, Production refused outside a release
- [x] A failed blocking policy refuses the approval (422 `policy_failed`); a warning doesn't
- [x] An approved design version is kept and never rewritten
- [x] Policies switched on and off by an Owner, audited
- [x] `test/governance.test.js`: agent approves, agent restores drift, Contributor approves, production
      apply, no approved design, blocking policy
- [x] Approvals through the lifecycle engine (part of `noobly`, `src/lifecycle/`) (type `infra-design`, 1 working day, remind): one open approval per kind a
      version waits on, shown on Home · Approvals; deciding there or on the Design screen is one decision
      (`src/services/approvals.js`). Standalone, the decision is recorded on the design only
- [x] The cloud budget read from Platform (its **Cloud (Infrastructure)** budget), and new provisioning paused at
      the limit with Platform's reason (`runs.gate`); standalone, `budget.yaml`
- [ ] Confirm which access role is the "platform owner" (today `change-repo-access`, so Owner) `[CONFIRM]`

**Test it:** as Priya, try to approve INF-031: refused, and the refusal is in the audit log. As Stevie,
approve it: runs start for `test-slots` and `pr-485`.

## I4 — Provisioning runs and drift ✅

**Goal:** an approval becomes runs you can watch, and drift waits for a person.

- [x] The provisioner interface and the `mock` adapter (plan, estimate, apply with progress, detect drift)
- [x] Runs queued on the host's queue, one at a time, resumed after a restart
- [x] **New environment** from an approved design
- [x] Drift: **Check for drift**, **Restore from design** (a run) and **Keep and update design** (a new
      design version that needs approval)
- [x] Events for every step (`structure.md` §6)
- [x] The drift sweep every 6 business hours on `host.clock` (`src/services/sweep.js`; a minute timer checks
      whether it is due, `INFRA_SWEEP_CHECK_MS`). It finds and records, never repairs
- [x] Cancel a run (queued: at once; running: at the next step) and destroy an environment (Preview and Dev with
      `draft`; Test and Staging with the platform owner and a reason; Production refused)
- [x] Live progress from the host's event stream (`public/js/live.js`); the timed refresh is only for standalone,
      where there is no stream

**Test it:** approve INF-031 and watch Provisioning runs. On Environments, click **Restore from design**
on the `dev-slots` drift.

## I5 — The screens with no mockup 🟡

**Goal:** every nav row leads somewhere useful. These are built in the patterns of the two mocked
screens; they are **not** checked against a design, because none exists.

- [x] Designs (list) · Provisioning runs · Environment detail (Testing in environments)
- [x] Blueprints · Cost · Policies
- [ ] Ask design for the exports (`Infra-EnvDetail` is linked from both mockups), then redo to match
- [x] Run detail with its log (`/infrastructure/runs/:id`)

## I6 — Join NooblyJS ✅

**Goal:** Infra is on the NooblyJS rail and passes the hosted-app checklist.

- [x] Agreed with NooblyJS (2026-10-10): Infrastructure **owns environments and previews** (Platform lists them and
      keeps Secrets); `/infrastructure`, rail label Infra; a design is an artefact with its own approval, not a stage
- [x] In `../nooblyjs-ai-host`: the dependency, the entry in `hosted-apps.yaml` (and its seed), the rail icon `cube`
- [x] NooblyJS's `product.md`, `structure.md`, `tech.md` and `roadmap.md` (Phase 9a) name it
- [x] The host's `clock` everywhere a time is shown or compared (the sweep is tested by moving it)
- [x] The **hosted-app checklist** (`../nooblyjs-ai-host/test/infrastructure.test.js`, `test/register.test.js`)
- [x] An e2e story over every screen in `../nooblyjs-ai-host/test/e2e/infrastructure.story.js` (axe, 375px)

## I7 — The drafting agent ☐

- [ ] Hire **Ines Tau** in Digital Teammates (she is not in its seed)
- [ ] `POST /designs/:id/drafts` → a teammate task that reads the architecture through
      `host.service('product')` and saves a **new design version**
- [ ] A scripted draft for the seed story, played when no model is configured
- [ ] Offer a new draft when `adr.accepted` or `architecture.updated` arrives for the item
- [ ] `agent.action` with cost, on the timesheet; the team chat panel scoped to the item

## I8 — Previews and tests from the Software Factory ☐

- [ ] `pr.opened` → a preview environment; `pr.merged` → destroy it
- [ ] `run.finished` → the test results shown on an environment
- [ ] `services.testTargets(kind)` so the Factory knows where to deploy and test
- [ ] An environment's test result as a gate ("a build moves right only when that environment's tests pass")
- [ ] Infrastructure rows on Home · Approvals, Activity and the Platform engineer's home

## I9 — A real provisioner ⛔

Blocked on the cloud, the region and the infrastructure-as-code tool (`product.md` §8).

- [ ] The adapter behind the same interface, in `src/provisioners/`
- [ ] Generated code delivered as a pull request to the repository Platform grants
- [ ] Runs in sandboxed workers that report through the API
- [ ] Real cost from the cloud's billing data into the ledger
- [ ] Secrets as references end to end

## I10 — Releases to Production, hardening ☐

- [ ] Production changes through a release with two approvers (who owns releases is open)
- [ ] Security review, backup and restore of `data/infrastructure/`, runbooks

---

## Decisions taken while building

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-10 | The seed has INF-031 **v1 approved** and **v2 waiting**. `dev-slots` and `pr-486` already run v2 (automatic kinds); `test-slots`, `staging` and `pr-485` run v1. The mockup says `test-slots` is "From design INF-031 v2" while v2 still waits for approval | So "Approve & provision Test" has something real to do: it moves `test-slots` to v2 |
| 2026-10-10 | **Preview and Dev apply the latest version without an approval**, once its policy checks pass | The mockup shows drift on Dev's Redis, which only exists in the unapproved v2. `[CONFIRM]`: the alternative is "automatic, but only after approval" |
| 2026-10-10 | The status card counts what is on disk (6 live, 2 previews), not the mockup's 9 and 3 | Honest numbers; the mockup's two figures disagree with its own table |
| 2026-10-10 | Design decisions are recorded here until the lifecycle engine (part of `noobly`, `src/lifecycle/`) has the approval type | It only knows spec approvals and handoffs today |
| 2026-10-10 | A seeded run stays at 70% until the next start, then the mock provisioner finishes it | The first view matches the mockup; nothing is frozen forever |
| 2026-10-10 | Standalone port 11008 | The Product Factory uses 11005 `[CONFIRM]` |
