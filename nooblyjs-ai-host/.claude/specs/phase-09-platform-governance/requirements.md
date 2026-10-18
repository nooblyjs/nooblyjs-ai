# Phase 9 — Platform and governance: requirements

> **Status: done, signed off 2026-10-10.** Summary: `docs/phases/phase-09-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 9. Goal: repositories, sandboxes, models, budgets and guardrails are
> managed in one place, and changes affect agents immediately. Repos: `nooblyjs-ai-host` (the Platform app, its service and
> screens), `nooblyjs-core` (the Bedrock / Vertex / Azure adapters in its AI module, imported as `nooblyjs-ai-common`),
> `nooblyjs-ai-teammate` (every agent task asks Platform first), `nooblyjs-ai-factory` (runs ask Platform first, Stop all),
> `nooblyjs-ai-product` (paused drafting says why), `nooblyjs-ai-knowledge` (the redaction guardrail).
> `nooblyjs-ai-harness` is not changed: sandboxes are simulated in this phase (see decisions).
>
> This one spec covers all the repos. Each task in `tasks.md` names its repo. Screens follow the mockups
> `noobly-platform-repositories`, `noobly-platform-containers` and `noobly-platform-settings` (`product.md` §5.7).

## Where the phase starts

Already there, and used as it is:

- **Platform is a built-in app** at `/platform` with its nav (Repositories, Containers, Environments · Settings,
  Secrets, Members, Audit log), every screen a placeholder naming Phase 9 (`public/js/modules/platform.js`).
- **Permissions** in `data/access/roles.yaml`: `set-budgets`, `change-guardrails`, `change-repo-access` are Owner
  only. `host.can()` and `host.requireRole()` check them, and refusals are audited.
- **The audit log** (`src/services/audit-log.js`): one record per write and per refusal, in daily YAML files.
  Agent actions carry `actor, itemId, system, teammateId, modelRoute, costUsd`.
- **Every agent action is a teammate task** (`runTask` in `nooblyjs-ai-teammate`): it checks the teammate (paused,
  off shift, monthly cap), bills it and emits `teammate.task_*` with `system`, `workType`, `costUsd`, `modelRoute`.
  The model is the **teammate's own** (`teammate.model`); with no model configured `modelRoute` is `mock/scripted`.
- **Work types** callers already pass: `chat.reply`, `meeting.answer`, `spec-drafting`, `architecture-drafting`,
  `ui-drafting`.
- **The Software Factory** has its own daily budget (`spentToday`), a kill switch (`stop-all`, `cancel <run>`) and
  its repositories in `data/factory/…/repos.yaml` (name → folder). It knows nothing of agent access.
- **nooblyjs-ai-common's providers**: `anthropic`, `openai-responses`, `openai-chat`, `mock`. No Bedrock, Vertex or Azure.
- **Activity** already groups `image.*`, `budget.*`, `guardrail.*` events under the system "platform".
- `structure.md` §4 already names the files: `data/platform/repositories/<owner>__<repo>.md`, `pools.yaml`,
  `base-images.yaml`, `model-routes.yaml`, `budgets.yaml`, `guardrails.yaml`, `integrations/<name>.yaml`.

Not there yet: no Platform service or API, no per-repository agent access, no model routing (the route a feature
asks for is ignored), no budgets per system, no guardrails as data, no container view, no audit-log screen, no
cloud provider adapters.

## Decisions taken before starting

Answered by Stevie on 2026-10-10 unless marked (mine).

| Question | Answer |
| --- | --- |
| Hosting target and container runtime (`product.md` §12 Q3) | **Undecided. Simulate it.** Containers run over a `ContainerRuntime` interface with one adapter in this phase: **simulated** (pools and workloads in files and memory). Real NooblyJS work (Factory runs, teammate tasks) appears in it as workloads and can be stopped. AKS / EKS / GKE and the data region stay `[PLACEHOLDER]` |
| Model provider (Q4) | **Undecided. Build all three adapters**: Bedrock, Vertex AI and Azure, in `nooblyjs-ai-common`. Each model route names its provider. Development and test use the Anthropic API (or the mock), which is **refused when `NODE_ENV=production`** |
| Where Platform's rules are enforced (mine) | In **one service**, `host.service('platform')`, owned by `nooblyjs-ai-host`. Teammates' `runTask` and the Factory's run start call it **before** any work starts. A child never reads `data/platform/` itself |
| What "takes effect without a restart" means (mine) | Platform reads its files on every check, cached by file modification time, and its own writes update the cache. No process holds a copy |
| Budgets: where spend comes from (mine) | A **spend ledger** `data/platform/spend/YYYY-MM.yaml` (totals per system per day), added to whenever a costed `teammate.task_finished` or Factory run event arrives. It can be rebuilt from the event stream. The seed writes the mockup's October numbers as sample data |
| Budgets: what pauses (mine) | With **Pause all agents when a budget is reached** on, a system at its monthly budget (Software Factory: its daily cap) refuses new agent work for that system, and the month's total at its limit refuses all. With it off, `budget.reached` is still emitted and work goes on. Teammates' own monthly caps stay as they are in Teammates |
| Which systems have budgets (mine) | `teammates` (Digital Teammates, which also covers chat, `home` and Teams answers), `product`, `factory` (daily cap), `knowledge`. A task whose `system` has no budget counts against Digital Teammates `[CONFIRM]` |
| Model routes and work types (mine) | Three routes, as in the mockup: **Specs, architecture, review** (`spec-drafting`, `architecture-drafting`, `ui-drafting`, `review`) → Opus, fallback Sonnet; **Implementation & tests** (`implementation`, `chat.reply`, `meeting.answer`) → Sonnet, fallback Haiku; **Indexing, triage, clean-up** (`triage`, `indexing`) → Haiku. A work type with no route uses the teammate's own model, as today |
| `modelRoute` with no model configured (mine) | `mock/<routed model id>` (e.g. `mock/claude-sonnet-5-5`), with `scripted: true` as now, so step 4 of the test script can be seen offline |
| Guardrails that are enforced in this phase (mine) | **Agent access per repository**, **redact personal data on ingest** (the wiki's import reads it), **budgets**. Stored and shown, enforced later: *human approval for production deploys* (Phase 12, GitHub), *new dependency requires an ADR* (Phase 12), *outbound internet from sandboxes* (recorded on each workload; the simulated runtime has no network to cut) |
| Can an Owner let agents merge? (mine) | **No.** "Merge after all gates pass" is shown off and locked, with the words "Agents never merge to main (governance)". "Agents open PRs, people merge" cannot be turned off. `product.md` §3.1 is non-negotiable |
| Changing a guardrail (mine) | Owner only (`change-guardrails`), **a reason is required**, and each change is a `guardrail.changed` event and an audit record. **Policy history** is the audit log filtered to guardrail changes, so it can't disagree with it |
| Who may read the audit log (mine) | Approver, Architect and Owner, through a new permission `read-audit` `[CONFIRM]` |
| Members (mine) | Lists people and agents with their access role (agents shown capped at Contributor). An Owner changes a person's access role, with a reason, through a new permission `manage-members` (Owner). An Owner cannot demote the last Owner |
| Secrets (mine) | **References only** (`vault:staging/REDIS_URL`), never values, mapped per repository and environment. A production reference is refused on any repository's agent mappings ("Agents never see production secrets") |
| Environments | **Infrastructure (`nooblyjs-ai-infrastructure`) owns environments and previews** (Stevie, 2026-10-10). Platform · Environments is a read-only summary: from `host.service('infrastructure')` when it is hosted, else `data/platform/environments.yaml`, with a link to `/infrastructure`. Infrastructure joins NooblyJS right after this phase (its roadmap I6, plus the open I3–I5 items) |
| Integrations tab (mine) | GitHub, Jira, Targetprocess, Microsoft Teams/Outlook, Google Drive/SharePoint, Datadog, each **Connected** when its environment variables are set, else **Not connected** naming the phase that wires it. Slack from the mockup is dropped (`product.md` §11). No OAuth in this phase |
| The wiki's direct model calls (mine) | **Not moved in this phase** (Phase 8 gap). Its spend is not in the Knowledge budget until it goes through Teammates; the Knowledge budget counts what reaches the ledger `[CONFIRM]` |

## Requirements

### R1 — Platform service and API
1. `nooblyjs-ai-host` SHALL provide `host.service('platform')` with: `repository(name)`, `checkAgentWork({ system, workType,
   repo, teammateId, itemId })` → `{ ok: true, route }` or `{ ok: false, code, message }`, `route(workType)`,
   `guardrail(key)`, `recordSpend({ system, costUsd, at })`, and the container runtime (`containers`).
2. Its API SHALL be under `/api/v1/platform/…`, signed in only. Reads need `read`; writes need the permission named
   in each requirement below; every write and refusal SHALL be audited with actor, action, target and reason.
3. Every check SHALL read the current files (mtime-cached). A change through the API SHALL apply to the next check
   in the same process, with no restart.
4. With Platform's files missing (a fresh `data/`), defaults SHALL apply: agents read-only on unknown
   repositories, no budget limits, the routes from the seed, every guardrail at its safe default.

### R2 — Repositories and agent access
1. Repositories SHALL be Markdown files with front matter: `name` (`owner/repo`), `branch`, `stack`, `notes`,
   `access` (`none` · `read` · `read-prs`), the five **What agents may do** toggles (`readCode`, `pushAgentBranches`,
   `openPrs`, `merge` (always false), `indexKnowledge`), `build` (`install`, `test`, `image`), `secrets` (references
   by environment), `gates` (n of m), `lastActivity`. The body holds notes.
2. The **Repositories** screen SHALL show the mockup's table, the filters with counts (All / Factory enabled / Read
   only / Not indexed), the status card, and the detail panel at `/platform/repositories/<owner>__<repo>`.
   **Connect repository** adds one (Owner, `change-repo-access`); no GitHub call in this phase.
3. Changing access or a toggle SHALL need `change-repo-access`, SHALL be audited and SHALL emit
   `repo.access_changed`. `access: none` turns every toggle off; `read` allows only `readCode` and `indexKnowledge`.
4. An agent task that names a repository (`repo` on `runTask`, or a chat thread scoped to a repository) SHALL be
   refused with `repo_no_access` when the repository's access is `none`, before the model is called. The refusal
   SHALL be audited (`agent.<workType>_refused` with the reason) and shown where it was asked.
5. A Factory run on a repository that does not allow `openPrs` SHALL be refused at intake with the reason, and the
   handoff's item SHALL show it.
6. The seed SHALL write the mockup's seven repositories (`slots-api`, `web-storefront`, `mobile-app`,
   `delivery-planner`, `inventory-service`, `design-system`, `payments-gateway` restricted with no agent access).
   `web-storefront` is the Factory's demo repository.

### R3 — Model routing and providers
1. `data/platform/model-routes.yaml` SHALL list routes: label, work types, systems that use it, model, fallback,
   provider (`bedrock` · `vertex` · `azure`, or `anthropic` in development), cost tier. Spend for 30 days comes
   from the ledger.
2. `runTask` SHALL use the route for its work type (model, fallback, provider) instead of the teammate's model when
   one matches, and report it in `modelRoute` (`<provider>/<model id>`; `mock/<model id>` with no model).
3. Changing a route SHALL need `change-guardrails`, be audited, emit `model_route.changed`, and apply to the next
   task.
4. `nooblyjs-ai-common` SHALL have three new providers that speak its `stream()` interface with Anthropic-shaped
   requests and replies: **Bedrock** (`InvokeModelWithResponseStream`, AWS Signature V4 signed with `node:crypto`,
   the event-stream framing decoded), **Vertex AI** (`streamRawPredict`, a Google access token from a service-account
   key signed with `node:crypto`, or `GOOGLE_ACCESS_TOKEN`), **Azure** (the Anthropic-compatible endpoint of Azure AI
   Foundry with an API key). No new npm dependencies.
5. Each adapter SHALL be tested offline against a fake `fetch` (signing, request shape, stream decoding, errors and
   retries). A live test per provider SHALL run under `npm run test:live` only when its credentials are set.
6. With `NODE_ENV=production`, a route or `AI_PROVIDER` naming `anthropic` (or any direct consumer API) SHALL be
   refused: the route cannot be saved, and a task on it is refused with `provider_not_allowed`.

### R4 — Budgets
1. `data/platform/budgets.yaml` SHALL hold the month's total limit, a monthly limit per system (Software Factory: a
   daily cap) and `pauseOnLimit`.
2. Spend SHALL be recorded in the ledger from every costed agent task and Factory run, by system and business day
   (`host.clock`).
3. Before an agent task or Factory run starts, Platform SHALL compare the system's spend with its limit. At or over
   the limit with `pauseOnLimit` on, the work SHALL be refused with `budget_reached` and a message naming the system,
   its spend and its limit.
4. The first time a system reaches its limit in a period, and whenever a budget change puts it at or over,
   `budget.reached` SHALL be emitted (it shows in Activity) and audited.
5. Changing a budget or `pauseOnLimit` SHALL need `set-budgets`, be audited and emit `budget.changed`.
6. The Product Factory SHALL show a refused draft's reason ("Agents are paused: Product Factory has reached its
   $400 budget ($412 spent this month)") instead of a generic failure.

### R5 — Guardrails
1. `data/platform/guardrails.yaml` SHALL hold the mockup's five guardrails, each with `on`, a scope note and, where
   it applies, per-repository overrides.
2. Changing one SHALL need `change-guardrails` **and a reason**, SHALL be audited and SHALL emit `guardrail.changed`.
   **Policy history** SHALL list every change: who, when, from → to, and the reason.
3. "Agents open PRs, people merge" SHALL be locked on.
4. "Redact personal data on ingest" SHALL be read by the wiki's import through `host.service('platform')`: off, an
   import stores content as it is and its source record says redaction was off.

### R6 — Containers (simulated runtime)
1. A `ContainerRuntime` interface SHALL have `pools()`, `workloads()`, `logs(id)`, `stop(id, { by, reason })`,
   `stopAll({ by, reason })`, `usage()`. The simulated adapter SHALL be the only one in this phase.
2. Real work SHALL appear as workloads: a teammate task while it runs (Teammate sandboxes), a Factory run while it
   runs (Factory stations). The seed adds sample workloads and the mockup's pools and base images, marked as sample
   data.
3. **Stop** on a workload SHALL end it: a teammate task through its abort signal, a Factory run through the
   Factory's cancel, a sample workload by removing it. **Stop all containers** SHALL stop every running workload, ask
   the Factory to stop all, and leave the tiles at 0 running. Both need `change-guardrails`, are audited and emit
   `container.stopped` / `containers.stopped_all`.
4. The **Containers** screen SHALL show the mockup's tiles (running, queued, failed; vCPU; memory; compute today
   against the Software Factory daily cap), pools with **Full**, running workloads sorted by uptime with **Logs** and
   **Stop**, and base images with CVE status in words. The status card SHALL carry **Stop all containers**.

### R7 — Environments, Secrets, Members, Audit log, Settings
1. **Environments** SHALL list the environments, read-only: Infrastructure's when it is hosted, else `environments.yaml`, linking to `/infrastructure`.
2. **Secrets** SHALL list every reference by repository and environment, never a value. An Owner
   (`change-repo-access`) adds or removes one; a production reference on an agent mapping is refused.
3. **Members** SHALL list people and agents with access roles; an Owner (`manage-members`) changes a person's
   access role with a reason. The last Owner cannot be demoted. Agents cannot be raised above Contributor.
4. **Audit log** SHALL filter by actor, action and date range, list actor, action, target, cost and time, page
   through results, and match the files exactly (same records, same order). It needs `read-audit`.
5. **Settings** SHALL have the tabs Models / Budgets / Guardrails / Integrations / Organisation with **Save
   changes**, which saves only what changed and names what it saved. Integrations shows each one's state in words.

### R8 — Governance and quality
1. No agent (any actor of kind `agent`) SHALL be able to change any Platform setting, whatever its access role.
2. Every Platform screen SHALL pass axe and work at phone width, and say status in words, not colour alone.
3. Platform SHALL keep working when Teammates, the Factory or the wiki are disabled (their parts say Unavailable).

## Test script (roadmap Phase 9)

1. Set `payments-gateway` to "No agent access". Asking a teammate to read it is refused, and the refusal is audited.
2. Lower the Product Factory budget below this month's spend. Agents pause, `budget.reached` shows in Activity,
   and new drafting requests say why they're paused.
3. Turn off "Redact personal data on ingest". It needs an Owner and a reason, and it shows in policy history and
   the audit log.
4. Change the route for "Specs, architecture, review" to Sonnet. The next drafting call uses it (visible in the
   event's `modelRoute`).
5. Click **Stop all containers**. Every running workload stops and the tiles show 0 running.
6. The audit log screen filters by actor, action and date, and matches the files.

**Done when:** steps 1–6 pass, and a guardrail or budget change takes effect without a restart.

## Out of scope

- A real container runtime (Docker, Kubernetes) and real sandboxes in `nooblyjs-ai-harness`.
- GitHub calls (Connect repository, View on GitHub, gates, per-repo merge rules): Phase 12.
- OAuth for integrations; Microsoft 365: Phase 11.
- Enforcing production-deploy approvals and the new-dependency ADR rule: Phase 12.
- The Infrastructure screens: they are `nooblyjs-ai-infrastructure`'s, joined to NooblyJS after this phase.
- Moving the wiki's AI agents behind Teammates and `nooblyjs-ai-common`.
- Metrics (Phase 10). The 30-day spend column reads the ledger only.
