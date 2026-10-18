---
inclusion: always
---

# Agent harness: what NooblyJS needs from this repo

> Extracted from the NooblyJS product definition (`../nooblyjs-ai-host/.claude/steering/product.md`, the source
> of truth) and the design mockups in `../nooblyjs-ai-host/.claude/steering/brief/`. This file lists only
> what the **agent runtime** must provide to NooblyJS. The harness's own plan and phase history
> are in `.claude/specs/` (PRD, Architecture, Roadmap) and `.claude/docs/`. If this file and
> the NooblyJS `product.md` disagree, NooblyJS wins. Numbers are **sample data** from the PRD-031
> "Same-day delivery slots" story.

## 1. Where the harness fits

NooblyJS AI is an engineering-lifecycle platform: AI agents draft and build, and **people
decide**. `nooblyjs-ai-harness` is **what every NooblyJS agent runs in**. It is a library, not a
hosted app. It has no screens of its own, and NooblyJS drives it headlessly through its library
API, not the interactive CLI.

| Who runs agents on the harness | What the agents do | Example (seed) |
| --- | --- | --- |
| `nooblyjs-ai-factory` stations | Plan, scaffold, implement, test and review code in a repo, then open PRs | Run 214 · slots-api · Implement station |
| `nooblyjs-ai-teammate` tasks | Named teammates do work, reply in team chat and answer in Teams meetings | Juno Park fixing checkout accessibility. Ada Quill answering in "Slot rollout sync" |
| `nooblyjs-ai-product` drafting | Draft specs, architecture (container views, ADRs), journeys, flows and screens | Ada drafting PRD-032 (64%). Rhea drafting the PRD-027 container view (22%) |
| `nooblyjs-ai-knowledge` workers | Index sources and clean up | Otis Fern re-indexing 3 repositories |

The harness **enforces the guardrails** at the point where the agent acts: no outbound
internet, staging-only secrets, and tools that can't merge, approve or change policy.

## 2. Capabilities NooblyJS relies on

1. **Headless runs from a worker.** NooblyJS workers start a run with: the task, the agent's
   persona and skills (from Teammates), the context (from Knowledge, with citations), the
   tools allowed for this repo, and a budget. The worker gets streamed progress and a final
   result. No terminal UI is involved.
2. **Models only through `nooblyjs-ai-common`.** Every call goes to AWS Bedrock, Google Vertex
   AI or Azure. NooblyJS asks for a **work type**, never a model id. Platform → Settings →
   Model routing decides the model, fallback and provider. The seed routes:

   | Work type | Used by | Model | Fallback |
   | --- | --- | --- | --- |
   | Specs, architecture, review | Product Factory · Factory review station | Claude Opus ($$$) | Claude Sonnet |
   | Implementation & tests | Factory stations · teammates | Claude Sonnet ($$) | Claude Haiku |
   | Indexing, triage, clean-up | Knowledge · data teammates | Claude Haiku ($) | — |

   Direct consumer APIs (Anthropic, OpenAI, xAI) are allowed **in development only** and are
   refused when `NODE_ENV=production`. GitHub Copilot is never integrated.
3. **Cost on every call.** Every model call and run reports its cost, tagged with `{ actor,
   teammateId, itemId, system, modelRoute, costUsd, at }`. NooblyJS shows the cost of **each
   agent action** in Activity ("Ada Quill clustered 412 support tickets into 5 themes ·
   $0.84"), the cost so far on runs ("41 min · $1.90 so far"), and the cost of each Teams
   answer ("this answer cost $0.06").
4. **Progress you can show.** The harness reports progress as a percentage and the current
   step, which NooblyJS shows as "Ada · 64%", "Rhea drafting the container view · 22%", Live now
   on Activity, and the "working…" state in chat.
5. **Budgets stop work.** At a budget limit the run pauses cleanly ("Pause all agents when a
   budget is reached"), and the reason is reported back.
6. **Guardrail changes take effect without a restart.** Policies are read when work is
   dispatched, so a change by an Owner applies to the next step.
7. **Context with citations.** Knowledge passages arrive fenced and labelled as reference
   data. The agent's output says which sources it used, because drafts and answers must cite
   them. Prompt-injection defences apply to every untrusted input (tickets, code, documents,
   chat).
8. **Parallel, isolated work.** Editing work happens in its own git worktree and branch, so
   several stations or teammates can work on one repo at once. Agents push only to **agent
   branches**.
9. **Skills, memory and MCP** come from the teammate's configuration. The harness runs them
   and doesn't decide them. Only MCP servers that NooblyJS has approved are allowed.

## 3. Rules the harness must enforce

These are company governance rules, checked in the runtime, not only in the UI:

- **Agents are capped at the Contributor access role.** No tool may merge to `main`, approve
  anything, accept an architecture decision, grant a permission, or change a guardrail or
  budget. Merging is a person's action. When an agent needs a permission, NooblyJS posts an
  approval card for a person to answer.
- **Repo access comes from Platform → Repositories.** It is No agent access, Read only, or
  Read + open PRs, with toggles for read code and history, push to agent branches, open pull
  requests, and index into Knowledge. "Merge after all gates pass" stays **off and locked**
  unless an Owner changes the guardrail. A **restricted** repo (e.g. `payments-gateway`) is
  untouchable.
- **Sandbox.** One container per run or task, on the repo's base image (`node-22:22.11`,
  `temurin-21`, `python-3.13`, `go-1.23`, `rn-builder:0.76`). Writes stay inside the
  workspace. **No outbound internet** by default, and package registries are always allowed.
  The guardrail "Allow outbound internet from sandboxes" is off.
- **Secrets.** Agents never see production secrets. Sandboxes and preview environments get
  staging values only (`REDIS_URL → vault · staging`).
- **Personal data is redacted** in agent logs before they are written.
- **Every write and tool action is attributable and audited.**

## 4. Where harness work shows up in NooblyJS

| Screen | What it shows |
| --- | --- |
| Home · Activity | each agent action with its cost. Live now: "9 working", each with its task |
| Home · Overview, sidebar | "Agents working now · 9 agents · 14 items in flight" |
| Platform · Containers | Pools: Factory stations, Teammate sandboxes (one per teammate on a task), Preview environments, Knowledge indexers. Running now: workload, kind, repo, image, CPU, uptime, **Logs / Stop** |
| Platform · Settings | Model routing (work type → model → fallback → 30-day spend), budgets, guardrails with policy history |
| For you · Developer | runs on your repos with station progress and cost so far. "Run 213 is asking you" |
| Team chat, Teams bot | the agent's "working…" or "listening" state, cited sources, cost per answer |

## 5. Open points

- The harness defaults to consumer provider keys (`XAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`). In NooblyJS, providers come only from `nooblyjs-ai-common` routes, and the
  direct providers are development-only.
- The package is named `nooblyjs-learn-harness`, and its sibling repos refer to it as
  `nooblyjs-ai-harness`. Agree on one name.
- How the harness learns the repo-access toggles and guardrails at run time: passed in by
  the worker, or read from a host service `[CONFIRM]`.
