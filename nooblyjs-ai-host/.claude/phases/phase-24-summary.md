# Phase 24 — Housekeeping: summary

**Status:** built 2026-10-21, waiting for your review (started at your word after Phase 23 was committed as `7919bab`;
the roadmap had no Phase 24, and you chose "Housekeeping"). Spec: `.claude/specs/phase-24-housekeeping/` (all 6 tasks
done). It closes the housekeeping the roadmap's "After Phase 23" lists. The work is in `nooblyjs-ai-knowledge`,
`nooblyjs-ai-teammate` and `nooblyjs-ai-host`.

## What is there

| Area | What |
| --- | --- |
| The wiki's agents as teammate tasks (A6, S-08) | Hosted, every model client the wiki builds runs each prompt as one task of Ada Quill (`KNOWLEDGE_AGENT_TEAMMATE`) through `teammates.runTask`: `system: knowledge`, `workType: knowledge.<agent>`, the signed-in person as caller. Platform checks it, Teammates bills and audits it. The agent's own provider is never built or called; without Teammates a prompt is refused. Workflow steps (worker threads) ask the main process through the workflow bridge. Standalone, nothing changed |
| No model in Teammates | The task is scripted, which for the wiki is "no answer": the AI panel answers from the sources' passages as it does with no agent; the Prompts test bench says no model is configured |
| Teammates on `host.store` | Hosted, Teammates' store is the host's for its `dataDir`, with Teammates' document cache attached; its own FsStore copy now re-exports nooblyjs-core's |
| `nodemon` | A dev dependency of the host (`npm install --omit=dev` leaves it out); `npm run dev` is unchanged |
| The mocking audit | A6 done; A12 Security scanner, A13 the Test section's test runner, A14 the Operations deployer, A15 the Operations monitor, A16 the on-call channel. Security audit S-08 notes the fix |

## The test script

1. In the real app (`test/knowledge-agents.test.js`, Factory, Teammates and Knowledge hosted): an agent "Chat
   Processing" with an Ollama address of its own (a local server counting requests). The Prompts test bench, as
   Lerato: 502 "No model is configured for the wiki's agents in NooblyJS (ada-quill answers offline)…"; a
   `teammate.task_finished` event with `system: knowledge`, `workType: knowledge.chat-processing`, scripted; the audit
   `agent.knowledge.chat-processing` by `ada-quill`, requested by `lerato-m`. The provider received nothing.
2. The AI panel, same question: answered from 3 sources, "No model is configured here…". The provider received nothing.
3. Teammates' store is the host's (`test/models/host-store.test.js`).
4. `nodemon` is under `devDependencies` in `package.json` and the lock file.
5. The audit has A12–A16.

The red-team case (`nooblyjs-ai-knowledge/test/agent-tasks.test.mjs`): a page telling AI agents to approve PRD-031 and
merge to main, read by a "model" that obeys it. What comes back is only text, the task is attributed to the person
whose question it was, and no approval is decided.

## Tests

- New: Knowledge's `test/agent-tasks.test.mjs` (7: standalone untouched, hosted routing and attribution, refused
  without Teammates, offline, the red-team case, a worker through the bridge, a stale marker cleared standalone); the host's
  `test/knowledge-agents.test.js` (2); Teammates' `test/models/host-store.test.js` (3).
- **Whole suites:** host 415 of 415 (413 before this phase). Knowledge 41 of 41 (34). Teammates 143 of 143 (140).
  Factory 594 of 598, 4 skipped, none failing. Infrastructure 52 of 52. Security 21 of 21. Operations 20 of 20.

## Decisions taken while building

- **The wiki's agents work as Ada Quill** (Research Analyst) unless `KNOWLEDGE_AGENT_TEAMMATE` names another
  `[CONFIRM]`. Each agent configured in the wiki becomes a work type (`knowledge.<agent>`), so Platform can route and
  budget them separately.
- **Agents in the wiki's Agents screen still decide which usages have an agent**; hosted, their provider and model
  settings are not used (the teammate's model and Platform's routes are).
- **A person's own AI settings in the wiki** (security audit S-09: a Viewer could point the server at any endpoint)
  are routed too, so hosted the server never calls the endpoint they set. S-09's other half (minting a token) is not
  touched here.
- **Offline, the scripted task is still a task**: it shows on the teammate's timeline at no model cost, like other
  apps' scripted drafts.

## Open questions

1. Which teammate should the wiki's agents work as (Ada Quill until you say)?
2. The Agents screen still asks for a provider and model, which hosted mean nothing. Hide them when hosted, or leave
   the screen as it is for standalone?
3. Not looked at in a browser here: nothing in the UI changed.
