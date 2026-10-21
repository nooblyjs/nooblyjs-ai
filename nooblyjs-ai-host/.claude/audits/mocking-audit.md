# What is still mocked, simulated or static (audit, 2026-10-11; updated 2026-10-21, Phase 24)

Found by reading the code of every repo and by starting NooblyJS on a blank data folder (`npm run seed:blank`) and
looking at what each page still shows with nothing in the system. This is the list the roadmap's **Phase 15 — No
mocks** works through. Every adapter a later phase adds as a mock gets its line here (A12–A16, from Phases 19–23). "Real" says what replaces each one; "Needs" says what must be decided or supplied first.

Three kinds of thing are on it:

- **Mock or simulated behaviour**: code that pretends (a scripted answer, a pretend provisioner).
- **Static data**: numbers or names that are written in a file or in code and shown as if they were measured.
- **Sample content**: the PRD-031 seed story. This one is already solved: `npm run seed:blank` starts without it.

## A. Mock or simulated behaviour

| # | What | Where | Real | Needs |
| --- | --- | --- | --- | --- |
| A1 | **Agents answer from scripts when no model is configured.** Chat replies, Teams answers and meeting notes play `data/chat/scripts.yaml` and `data/teams/scripts.yaml`; Product Factory drafts play each stage's `mock()` (content marked `[PLACEHOLDER]`); Teammates has a `MockProvider`; the wiki answers from the sources' own sentences | `noobly/src/services/chat.js`, `chat-reply.js`, `src/teams/bot.js`; `nooblyjs-ai-factory/product/src/services/draft-kinds.js`, `architecture.js`, `ux.js`, `ui.js`; `nooblyjs-ai-teammate/src/services/providers/mock.js`; `nooblyjs-core/src/aiservice/common/providers/mock.js`; `nooblyjs-ai-knowledge/src/wiki/knowledge/answers.js` | A model is always configured outside tests. With none, an agent says it cannot answer and nothing is posted or billed. Scripts stay for tests only | Model credentials on Bedrock, Vertex or Azure |
| A2 | **Models run on the direct Anthropic API in development.** The Bedrock, Vertex and Azure adapters exist but have never been called with real credentials | `nooblyjs-core/src/aiservice/common/providers/{bedrock,vertex,azure}.js`; `nooblyjs-ai-teammate/src/services/providers/index.js` | One cloud host, proven with a live test; the direct API is removed from the default path | Which cloud hosts the models (product.md §12 Q4) |
| A3 | **The container runtime is simulated.** Pools, slots and "Cluster healthy (simulated)" come from `pools.yaml`; nothing starts a container. Real teammate tasks and Factory runs do show while they run | `noobly/src/services/platform/containers.js` | A runtime adapter (Docker or Kubernetes) behind the same interface: real pools, logs, usage and Stop | Hosting target (product.md §12 Q3) |
| A4 | **Infrastructure provisions nothing.** The mock provisioner computes plans and cost estimates from the design and "applies" by waiting; drift is whatever the environment file says was observed; cloud cost is those estimates | `nooblyjs-ai-infrastructure/src/provisioners/mock.js`, `services/cost.js`, `services/drift.js` | A real provisioner adapter, real drift detection, and cost from the cloud's billing data | Cloud, region and IaC tool (roadmap "Hosted apps: open work", I9) |
| A5 | **The Infrastructure agent does not draft.** Designs are written by people or come from the seed | `nooblyjs-ai-infrastructure` (I7) | Ines Tau drafts designs as teammate tasks | A model (A1) |
| A6 | ~~**The wiki's own AI agents call their provider directly**, not through Teammates, so their work is not checked by Platform, billed or attributed~~ **Done in Phase 24 (2026-10-21):** hosted, every model client the wiki builds runs its prompts as Ada Quill's teammate tasks (`system: knowledge`), workflow steps too (through the workflow bridge); without Teammates a prompt is refused, and with no model the AI panel answers from the sources. Standalone, the wiki still calls the agent's provider | `nooblyjs-ai-knowledge/src/shared/ai/agentTasks.js`, `src/hosted/platform.cjs` | They run as teammate tasks (built) | — |
| A7 | **Secrets are references nobody resolves.** `vault:staging/REDIS_URL` is stored and shown; no vault is connected, and nothing hands a value to a sandbox | `noobly/src/services/platform/index.js` | A secret store adapter that resolves a reference for a run | Which secret store |
| A8 | **On Windows there is no sandbox.** The harness has a real OS sandbox on Linux (bubblewrap) and macOS (seatbelt): writes only to the workspace, no network, credentials hidden. Windows has none, so on this machine a demo repository's gate commands run unsandboxed (allowed in development only). No run is in a container (A3), and the base image a repository names is not used | `nooblyjs-ai-factory/src/services/exec/sandbox.js`, `nooblyjs-ai-harness/src/sandbox/` | Runs on Linux inside the runtime of A3, on the repository's base image, with staging secrets only | A3 |
| A9 | **Writes to Jira and Bitbucket are recorded, not sent.** This one is deliberate and stays the default; it is "real" once an Owner switches a system to Send | `noobly/src/services/devtools/writes.js` | Run the Phase 13 test script against a test project and a scratch repository | Write tokens |
| A10 | **The Teams bot has only met the simulator and the Agents Playground**; approval emails have only met a fake Graph | `noobly/src/teams/`, `src/services/notify.js` | The bot registered in the tenant; `Mail.Send` granted | Tenant steps (Phase 12) |
| A11 | **The job title is not read** (so onboarding does not suggest a role) | `noobly/src/services/entra.js` | `AZURE_AD_READ_PROFILE=true` | Admin consent for `User.Read` |
| A12 | **Security scans nothing** (Phase 19). The mock scanner reads a run's files with a few plain rules (secret patterns, `eval`, the `package.json` dependencies for the SBOM); its DAST calls nothing (a web app's preview is said to lack a Content-Security-Policy, the seed story's finding) and there is no image to scan. Every result says it came from the mock. `SECURITY_SCANNER` other than `mock` is refused at start | `nooblyjs-ai-security/src/scanners/mock.js` | A scanner adapter per kind (SAST, dependencies and SBOM, secrets, DAST, images) | Which scanners |
| A13 | **The Test section's test runner runs nothing** (Phase 21). It runs no browser and calls no environment: e2e results are the environment's baseline plus the stories' automated cases as the last Build-level run left them, load is a fixed p95 (240 ms) against the item's performance target, accessibility finds nothing. Every result says it is the mock. `TEST_RUNNER` other than `mock` is refused | `nooblyjs-ai-factory/quality/src/runners/mock.js` | A runner adapter that runs the suites against the preview or environment Infrastructure made | The test tools, and real environments (A4) |
| A14 | **Operations deploys nothing** (Phase 22). The mock deployer applies a release through Infrastructure by recording it (rollout steps, rollback); said on every release and on Policies. `OPERATIONS_DEPLOYER` other than `mock` is refused | `nooblyjs-ai-operations/src/deployers/mock.js` | A deployer adapter for the deployment tool, still only through a release with its two approvals (I10) | The deployment tool; real environments (A4) |
| A15 | **Operations watches nothing in production** (Phase 23). The mock monitor burns an SLO's error budget only when a person burns it (development), and a goal's measure today is halfway to its target unless set; said on SLOs, outcome reviews and Policies. `OPERATIONS_MONITOR` other than `mock` is refused | `nooblyjs-ai-operations/src/monitors/mock.js` | A monitoring adapter that reads availability, latency and the spec's measures from the platform | The monitoring platform (`[PLACEHOLDER]`) |
| A16 | **On-call alerts have only met the Teams simulator** (Phase 23): its "On-call" channel in development; in Teams they go to `TEAMS_ONCALL_CONVERSATION`, which is not set | `noobly/src/services/notify.js` (`oncall`) | The on-call channel in the tenant, with the bot in it (A10) | The channel; A10 |

## B. Static data shown as if it were real

| # | What | Where | Real | Needs |
| --- | --- | --- | --- | --- |
| B1 | **Base images**: "14 repos", "rolled 3 h ago", CVE counts are typed into a file | `data/platform/base-images.yaml` (a blank folder now starts with none) | Read from an image registry and a scanner | Which registry |
| B2 | **Environments on Platform** when Infrastructure is not running, and the cluster's name, region, vCPU and memory, are typed into files, with `[PLACEHOLDER]` names | `data/platform/environments.yaml`, `pools.yaml` | From Infrastructure and the runtime (A3, A4) | Cloud and region |
| B3 | **Which teammate drafts each stage is written in code**: `ada-quill` for specs, `rhea-voss` for architecture, `design-agent` and `ui-agent` for UX and UI, `ines-tau` for Infrastructure. On a blank system none of them is hired, so a draft has nobody to do it | `nooblyjs-ai-factory/product/src/services/spec-writes.js`, `architecture.js`, `ux.js`, `ui.js`; `nooblyjs-ai-infrastructure` `agent.yaml` | A setting: which hired teammate does which kind of work (Platform or Teammates), with a clear message when nobody is assigned | — |
| B4 | **Onboarding copy names agents and tools** ("Ada Quill clusters tickets…", "Agents: Ada Quill · research and spec drafting", the tool lists) whether or not they exist here | `data/config/work-roles.yaml` | The copy names the teammates actually hired for that kind of work, and the tools actually connected | B3 |
| B5 | **First-week tasks name seed items** ("Review PRD-031") | `work-roles.yaml` (a blank folder now starts without them) | Tasks worked out from what is really waiting for that person | — |
| B6 | **Architecture standards, accessibility rules and readiness checks are sample values** ("approvedStack: Node 22, Java 21…") | `data/product/standards.yaml`, `accessibility.yaml`; `data/workflows/readiness.yaml` | Acme Retail's real standards, edited by an Architect in the app | The real standards |
| B7 | **Budgets, model routes and guardrails start from sample figures** ($9,000 for Teammates, $20 a day for the Factory) | `data/platform/budgets.yaml`, `model-routes.yaml`, `guardrails.yaml` | Real figures, set by an Owner (the screens to edit them exist) | The real budgets |
| B8 | **Teammate rates and "tokens per hour"** are sample billing settings; model list prices come from a public catalogue (OpenRouter), not from a bill | `nooblyjs-ai-teammate/src/config/seed-data.js` (`models.md`), `nooblyjs-core/src/aiservice/common/discovery.js` | Rates agreed by the business; cost from the provider's own usage figures | The billing model |
| B9 | **Company facts are placeholders**: data region, cloud, cluster, image registry | `[PLACEHOLDER]` and `[CONFIRM]` in `data/config/organisation.yaml` and Platform's files | Filled in | The facts |
| B10 | **"For you" tiles with no source** show nothing (e.g. *New signals* has a null value) | `noobly/src/services/for-you.js` | Wired to the Product Factory's signals, or removed | — |
| B11 | **The Platform's pools have fixed slot counts** (3 Factory stations, 8 teammate sandboxes) that limit nothing | `pools.yaml` | Limits the runtime enforces (A3) | A3 |
| B12 | **The Edge extension's chat is switched off** and its panel shows a fixed message | `noobly/apps/edge` | Phase 14 | — |

## C. Sample content (solved by a blank start)

The PRD-031 story: people, teams, repositories, items, approvals, specs, designs, environments, hired teammates
with timesheets and invoices, activity, spend and six weeks of metrics history; the demo repository and scripted
agents of the Software Factory; the wiki's sample export. `npm run seed:blank` writes none of it, and a blank data
folder stays blank. The sample story stays available (`npm run seed -- --reset`) for demos and for the tests.

## D. Development-only tools (not mocks to remove)

`/dev/teams` (the Teams simulator), `/dev/clock`, `/dev/styleguide`, the development person picker
(`NOOBLY_DEV_LOGIN`), `TEAMS_BOT_DEV_UNSIGNED`, and the fakes in `test/fixtures/`. They are refused or absent in
production. Phase 15 checks that, and does not remove them.
