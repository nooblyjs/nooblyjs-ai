---
inclusion: always
---

# Infrastructure: stack, and this repo in NooblyJS

> **Since 2026-10-19 this is the Software Factory's Infrastructure section** (`nooblyjs-ai-factory/infrastructure`, pages in
> `nooblyjs-ai-factory/public/infrastructure`), not an app of its own with a rail item. Where this file says
> `/infrastructure`, read `/factory/infrastructure`; `data/infrastructure`, read `data/factory/infrastructure`;
> `nooblyjs-ai-infrastructure`, read the Factory's Infrastructure section. There is no `server.js` or standalone mode
> any more. See the section's `CLAUDE.md`.

> **Read `NOOBLY.md` first** (in this folder; generated from noobly). noobly owns everything shared, and this file does not
> repeat it: the hosted-app contract is `../../nooblyjs-ai-host/.claude/steering/structure.md` §2a, the cross-app services are
> `../../nooblyjs-ai-host/.claude/steering/tech.md` §8b, governance and the permissions matrix are `../../nooblyjs-ai-host/.claude/steering/product.md`,
> and the one roadmap is `../../.claude/steering/roadmap.md` (with the hosted-app checklist this repo must pass).
> If this file and noobly disagree, **noobly wins**: follow it and fix this file in the same change.
>
> NooblyJS mounts this repo at **`/infrastructure`**. This file gives only this repo's values for the contract, where it
> differs from the defaults, and what it is like today.

## 1. This repo's values

| | |
| --- | --- |
| Entry | `index.js` (`"main"`, `"exports"`); nothing listens on import |
| `register()` | default mount `/infrastructure`, name `infrastructure`, rail label **Infra**, sidebar title `infrastructure`, styles `css/infrastructure.css`, data under `data/infrastructure/` |
| Standalone | `npm start` runs `server.js` (nooblyjs-core's shell and kit, a standalone `host`, data in `./data/infrastructure`) |
| Infrastructure as code | One **provisioner adapter** (§4) behind an interface; the **mock provisioner** is the default. Never a cloud SDK or IaC CLI from a route or service, and no cloud call in a test that is not live |
| AI | Agent work is a teammate task (`host.service('teammates').runTask`) by work type |
| `agent.action` | `system: 'infrastructure'`. Cloud spend is tracked apart from agent (model) cost |
| `services`, events | `host.service('infrastructure')` is in noobly `tech.md` §8b; this repo's events are in `structure.md` §6 |

## 2. Screens (this repo's UI module)

`public/js/module.js` exports the route table. Each page in `public/js/pages/` exports
`render(view, { params, query, ctx, route })` (and an optional `destroy()`) and talks to the API only
through `ctx.api`.

- Build with the kit (`/ui/js/html.js`, `/ui/js/components/`), imported by **absolute URL**. Imports
  inside this app are relative. Everything that reaches HTML goes through the `html` tagged template.
- Every selector in `public/css/` starts with `[data-module="infrastructure"]` (tested). A component
  several apps would use (the resource tile, the plan counts, the code card) belongs in the kit in
  `nooblyjs-core/public/ui/`, not here.
- A page touches only `view`. Never `history`, `popstate` or `<body>`; links are plain `<a href>`.
  Check `ctx.isCurrent()` after each `await`; use `ctx.signal` for requests and listeners.
- **No inline styles.** The mockups in `.claude/steering/ui/` are reference only: turn their inline
  values into kit tokens and classes. They use the NooblyJS tokens already (navy `#14274E`, accent
  `#2F6FE4`, 22px cards, 999px pills, 44px controls, Lexend and JetBrains Mono, self-hosted by the kit).
- Live progress ("Provisioning · 70%", the runs badge) comes from `ctx.sse.on(…)`, in an `aria-live`
  region. A page that refetches on events does so at most once every 2 s.
- A design or environment page calls `ctx.chat.scope({ kind: 'item', id })` with the linked item, so
  the team chat panel shows that item's thread.
- Status is said in words; a tick or a colour is only a second signal. WCAG 2.2 AA.

## 3. Governance the server enforces here

Checked in services before any write, plan or apply. A hidden button is not a control, and every rule
has a test that proves it **refuses**.

- **Apply rules by environment kind** (`product.md` §1, `data/infrastructure/apply-rules.yaml`): Preview
  and Dev apply the latest design version automatically once its policy checks pass; Test and Staging
  need one person's approval of that version for that kind; Production changes only through a release
  with two approvers. **An agent actor is always refused an approval and any apply that needs one**,
  including through chat, the Teams bot or an API key.
- **No design, no apply.** A run names the design version it applies; an approved version is kept as
  its own file and never rewritten.
- **Approvals go through the lifecycle engine (part of `noobly`, `src/lifecycle/`)** (type `infra-design`, NooblyJS Phase 9a): a version waiting for Test or
  Staging has one open approval there per kind, on Home · Approvals. A decision there calls
  `services.decideApproval`, which decides here with the same rules; a decision on the Design screen closes the
  approval there (`src/services/approvals.js`). Without the engine (standalone) the decision is recorded on the
  design only. `infra_design.approved` is emitted either way.
- **Policy checks run on every design version and before every apply.** A failed blocking policy
  refuses the approval request with 422 `policy_failed`.
- **Only approved blueprints** may appear in generated code.
- **Secrets are references** (`vault:test/REDIS_URL`), never values, in `data/`, in designs, in logs
  and in generated code. Agents and non-production environments never receive production values.
- **Budgets and guardrails** are read through the host. At the cloud budget (NooblyJS Platform's **Cloud
  (Infrastructure)** budget; `budget.yaml` standalone), new provisioning is refused with `budget_reached` before
  anything is recorded, and Platform emits `budget.reached`. Destroying or cancelling is a person's action, under
  the apply rules, audited.
- **Every write is audited** (`host.audit`). **Every agent action** emits `agent.action` with
  `{ actor, teammateId, itemId, system: 'infrastructure', modelRoute, costUsd, at }`.
- **Permissions come only from the access role** (Viewer, Contributor, Approver, Architect, Owner).
  A work role such as Platform engineer only shapes a person's Home.

## 4. Provisioning

- **One adapter interface**, `plan(design, environment)`, `apply(plan)`, `destroy(environment)`,
  `detectDrift(environment)`, `estimateCost(design, kind)`, in `src/provisioners/`. Services call
  the interface and never a tool or cloud directly.
- **`mock` is the default** (tests, demos, no credentials): it plays the seed story's plans (+7 / ~2
  / 0), progress and drift on the host's clock. The real adapter (`[DECIDE]` Terraform, OpenTofu, …;
  cloud `[CLOUD]`) is chosen by configuration and refused unless credentials are set.
- **Generated code is a pull request**, never a direct push, to the repository Platform has granted
  (`infra/<product>/<kind>`), composed only from blueprints.
- **Runs are queued** with `serverManager.queue()`. They execute in the NooblyJS process for now, as the
  Software Factory's do; sandboxed workers on `nooblyjs-ai-harness` (no outbound internet except
  allow-listed endpoints, no production credentials) come later `[CONFIRM]`. A worker never writes to
  `data/`: it reports through the API.
- **Drift** is found by a scheduled sweep (`serverManager.scheduling()`, on `host.clock`) and
  recorded; it is never repaired automatically.
- **Cost** has two parts that are never mixed: cloud spend (from the adapter) and agent model cost
  (from the teammate task, on the timesheet).

## 5. Running it

Clone the repos side by side (`<workspace>/noobly`, `…\nooblyjs-core`, …) so `file:../` links resolve.

```bash
npm install     # links the sibling repos
npm start       # node --env-file-if-exists=.env server.js
npm test        # node --test "test/**/*.test.js"   (offline, mock provisioner)
npm run seed    # node --env-file-if-exists=.env server.js --seed   (-- --reset wipes first)
```

## 6. This repo today

Hosted in NooblyJS since Phase 9a: registered at `/infrastructure`, its `infra-design` approvals in the lifecycle
engine (Home · Approvals), the cloud budget from Platform, and its environments on Platform · Environments. Not
done: the agent does not draft, the Software Factory does not feed it, and there is no real provisioner. The phase
history is `docs/roadmap-history.md`; what is open is in `../../.claude/steering/roadmap.md`, "Hosted apps: open
work".

Environment variables (standalone): `PORT` (11008), `DATA_DIR` (`./data`), `INFRA_PROVISIONER`
(`mock`), `INFRA_MOCK_STEP_MS` (how long the mock takes for each 10% of a run; default 1200).
