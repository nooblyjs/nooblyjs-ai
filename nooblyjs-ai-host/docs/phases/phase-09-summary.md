# Phase 9 — Platform and governance: summary

**Status:** done. Built 2026-10-10 and signed off the same day. Spec: `.claude/specs/phase-09-platform-governance/`
(requirements, design, tasks: all 11 done). Work is in six repos: `nooblyjs-ai-host`, `nooblyjs-core` (its AI module,
`nooblyjs-ai-common`), `nooblyjs-ai-teammate`, `nooblyjs-ai-factory`, `nooblyjs-ai-product` and `nooblyjs-ai-knowledge`. **Nothing is
committed.**

On your existing `data/` folder, the first start writes Platform's seed files (`data/platform/`) and adds the two
new permissions to `data/access/roles.yaml`, keeping everything else (`seedMissing`). `npm run seed -- --reset` gives
the full story.

## Before you started (your answers)

- Hosting target and container runtime: **undecided, so simulated.** Containers run on a simulated runtime behind
  an interface; AKS / EKS / GKE stays `[PLACEHOLDER]`.
- Model provider: **undecided, so all three adapters are built** (Bedrock, Vertex AI, Azure). The seed routes name
  Bedrock. Development uses the Anthropic API until credentials are set; production refuses it.
- Mid-phase you decided that **Infrastructure owns environments and previews**, and that it joins NooblyJS right after
  this phase. Platform · Environments is therefore a read-only summary that will show Infrastructure's list.

## What is there

| Area | What |
| --- | --- |
| The Platform check | `host.service('platform').checkAgentWork()` runs before any agent work: Teammates' `runTask`, Product Factory drafts and Software Factory intake all ask it. It refuses a direct-API route in production, a repository agents may not touch, and a system at its budget. Each refusal is audited (`agent.work_refused`) and nothing is billed |
| No restart | Platform reads its files on every check (cached by modification time). A change through the screens, or by hand in `data/platform/`, applies to the next agent action |
| Repositories | The mockup's seven repositories, filters with counts, and a settings panel: agent access (none, read, read + open PRs), the five "what agents may do" switches, build and test, mapped secrets. "Merge after all gates pass" is locked off. A repository's page has its own chat thread, so a question to a teammate there is checked against its access. Approving Rhea's "read access to delivery-planner" card now grants it |
| Model routing | The mockup's three routes, mapped to the work types callers already send. A route replaces the teammate's own model, its fallback answers once if the provider fails, and `modelRoute` names what answered |
| Cloud providers | `createProvider('bedrock' \| 'vertex' \| 'azure')` in `nooblyjs-ai-common`: SigV4 signing and AWS event-stream decoding, a Google service-account token, and Microsoft Foundry's Anthropic endpoint. `node:crypto` only, no SDKs. Tested offline against a fake `fetch`. A live test per provider runs under `npm run test:live` when its credentials are set |
| Budgets | A spend ledger (`data/platform/spend/YYYY-MM.yaml`, by system and route) fed by every costed task and Factory run. The seed holds the mockup's October numbers. "Pause all agents when a budget is reached" pauses a system at its budget (the Software Factory: daily). `budget.reached` shows in Activity once per limit and period. The Factory's daily cap is Platform's |
| Guardrails | The mockup's five. A change needs an Owner and a reason, and goes in the audit log; policy history is those records. "Redact personal data on ingest" is read by the wiki's import |
| Containers | A simulated runtime. Teammate tasks and Factory runs appear while they run; Stop aborts or cancels them. Stop all also stops the Software Factory. Pools, base images and sample workloads are sample data |
| Other screens | Environments (read-only), Secrets (references only; a production reference is refused), Members (an Owner changes a person's role with a reason; never the last Owner; agents capped), Audit log (filters by actor, action and date, newest first, exactly the files) |
| Status card | The Platform sidebar shows cluster health in words, what is running and queued, and vCPU |

## Test script result (roadmap Phase 9)

Run 2026-10-10 through the real apps (`test/platform.test.js`) and in a browser (`test/e2e/platform.story.js`, with
axe and a 375px check on every screen). No model configured.

| Step | Result |
| --- | --- |
| 1. payments-gateway set to "No agent access"; asking a teammate to read it is refused and audited | PASS. Asked in the repository's chat, Ada's task is refused before it starts: "Agents have no access to acme/payments-gateway…". It shows as `agent.work_refused`, and nothing is billed |
| 2. Product Factory budget below today's spend: agents pause, `budget.reached` in Activity, new drafts say why | PASS. At $400 against $412 spent, Activity says "Product Factory reached its $400 budget ($412 spent): its agents are paused", and a draft request answers 402 with the reason. Other systems keep working |
| 3. "Redact personal data on ingest" off: needs an Owner and a reason; in policy history and the audit log | PASS. Lerato is refused, no reason is refused, and Stevie's change is in both places. The wiki's next import is stored unredacted and says so on Sources |
| 4. "Specs, architecture, review" routed to Sonnet: the next drafting call uses it (`modelRoute`) | PASS. The next draft's `teammate.task_finished` and audit record say `mock/claude-sonnet-5-5`. **Not run with a real model or cloud** |
| 5. Stop all containers: every workload stops, tiles show 0 running | PASS. It also stops the Software Factory (no new runs until it is resumed in the Factory) |
| 6. The audit log filters by actor, action and date, and matches the files | PASS. Same records, newest first |

**Done when:** steps 1–6 pass (they do), and a guardrail or budget change takes effect without a restart (tested:
through the API and by editing the files by hand).

Tests:
- `nooblyjs-ai-host` 175 of 175 (Platform service 12, API 7, the six steps 6).
- `nooblyjs-core` ai-common 130 of 130 (12 new for the cloud hosts).
- `nooblyjs-ai-teammate` 113 of 115: the same 2 Windows file-mode failures as before.
- `nooblyjs-ai-product` 141 of 141.
- `nooblyjs-ai-knowledge` 33 of 33.
- `nooblyjs-ai-factory`: its 3 new tests pass; the full suite has its 25 known failures on this machine, none in the files this phase touched.
- Browser: specs 37, Product story 8, Software Factory story 6, Knowledge story 4, Platform story 7. All pass.

## Decisions that need your confirmation

Marked `[CONFIRM]` or "(mine)" in the requirements.

1. **What pauses:** with "pause on limit" on, a system at its budget refuses new work, and the month's total pauses
   all. Work for a system with no budget of its own (chat, Teams, Home) counts against **Digital Teammates**.
2. **Routes:** `chat.reply` and `meeting.answer` take the "Implementation & tests" route (Sonnet), so chat answers
   now show `mock/claude-sonnet-5-5`. A work type with no route keeps the teammate's model.
3. **Guardrails enforced now:** repository access, budgets, redaction on import. Production-deploy approval and
   "new dependency needs an ADR" are stored and shown, enforced from Phase 12. Outbound internet is recorded only
   (the runtime is simulated).
4. **Who reads the audit log:** Approver, Architect and Owner (`read-audit`). **Who changes roles:** Owner
   (`manage-members`).
5. **Model ids on the clouds:** only Haiku 4.5's Bedrock and Vertex ids are known. Opus 5.5 and Sonnet 5.5 are derived
   (`anthropic.<id>-v1:0` on Bedrock) and can be set with `BEDROCK_MODEL_IDS` / `VERTEX_MODEL_IDS`.
6. **Azure's endpoint shape** is Microsoft Foundry's Anthropic-compatible API at
   `https://<resource>.services.ai.azure.com/anthropic`. Confirm when a resource exists.
7. **An unconnected repository** may be read by agents but never get a PR.

## Not built, or left for later

- A real container runtime and real sandboxes (§12 Q3). The Containers numbers other than what NooblyJS itself runs
  are sample data.
- GitHub: Connect repository records it in NooblyJS only, and View on GitHub is disabled until Phase 12.
- Integrations' Connect and Re-auth (OAuth): Phases 11 and 12. The tab shows each one's state from the environment.
- Enforcing production-deploy approval and the ADR-for-dependency rule (Phase 12).
- **The wiki's own AI agents still call their provider directly**, so their spend is not in the Knowledge budget.
- The mockup's "Stop all containers" in the sidebar status card: it is on the Containers page header instead,
  because the frame's status card has no buttons.
- The Factory's own dashboard still reads its daily budget from its config file for display. Its scheduler uses
  Platform's cap. Both are $20 in the seed.

## Also in this phase

- **The hello app is gone from your rail.** It was a Phase 0 stub that proved the hosted-app contract, listed but
  switched off in `hosted-apps.yaml`, so it showed as unavailable. It is removed from the seed and your `data/`.
  `test/fixtures/hello-app` stays as a test-only fixture for the contract tests.

## Guide points for your review

- Are the default guardrails right? Who should be allowed to change them? (Today Owner only.)
- Is "pause on limit" per system the behaviour you want, or should any reached budget pause everything?

## Next

Infrastructure (`nooblyjs-ai-infrastructure`) joins NooblyJS: its roadmap I6 (rail, hosted-app checklist, e2e), plus the
open I3–I5 items that need no cloud decision. Platform · Environments will then list Infrastructure's environments.
