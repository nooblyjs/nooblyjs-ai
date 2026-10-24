# Learning progress

One line per lesson: date, repo, lesson, concepts covered. The `learning` skill reads this first. `README.md` has
the reading order and what is not taught yet.

2026-10-11 | (all) | 00 00-the-whole-application.md | what NooblyJS is for; agents draft, people decide; the seven stages; the nine repos as one program and one screen; register() and the host object; services and events; the four places governance is enforced; data/ as Markdown and YAML; one item end to end
2026-10-10 | nooblyjs-ai-host | 01 noobly/01-how-noobly-starts.md | the host as one program; app.js as composition root; createApp() order; hosted apps listed in hosted-apps.yaml and opened by register(); mount paths; running one test (updated 2026-10-11: createApp's fakes for tests, line numbers)
2026-10-10 | nooblyjs-ai-host | 02 noobly/02-the-lifecycle-engine.md | the seven stages in one array; key, number, label, area; nextStage(); the engine that moves items (was nooblyjs-ai-workflows/01-the-seven-stages.md; moved and updated 2026-10-11 to src/lifecycle/)
2026-10-11 | nooblyjs-ai-host | 03 noobly/03-platform-checks-every-agent-action.md | checkAgentWork before any agent work; model route, repository access, budget, in order; a refusal is an answer with a reason; every refusal audited
2026-10-11 | nooblyjs-ai-host | 04 noobly/04-the-write-gate.md | Jira and Bitbucket as production systems; one door (writes.send); kinds, keys, askers, facts, rules; the three locks; Record only and the outbox; no merge or delete
2026-10-10 | nooblyjs-core | 01 nooblyjs-core/01-the-service-registry.md | what nooblyjs-core is (a set of services); ServiceRegistry singleton in index.js; getService() cache keyed by service:provider:instanceName; providers and defaults
2026-10-24 | nooblyjs-ai-design | 01 nooblyjs-ai-design/01-from-spec-to-stories.md | Design as bridge between Product and Engineering; four layers (requirements, architecture, analysis, stories); agents draft, people accept; handoff to Engineering
2026-10-10 | nooblyjs-core | 02 nooblyjs-core/02-the-service-factory.md | the factory as one function per service folder (src/<service>/index.js); provider switch and dependencies vs provider options; routes and views attached in the factory
2026-10-10 | nooblyjs-ai-teammate | 01 nooblyjs-ai-teammate/01-every-agent-action-is-a-task.md | a teammate as a named, hired, budgeted agent; runTask as the one way an agent works; checked, billed and recorded so no agent acts unseen
2026-10-24 | nooblyjs-ai-teammate | 02 nooblyjs-ai-teammate/02-how-teammates-are-managed.md | the data model (Markdown with YAML); profiles, skills, knowledge, memory; layered architecture (routes→services→models→providers); the composition root; atomic writes and caching
2026-10-10 | nooblyjs-ai-product | 01 nooblyjs-ai-product/01-what-a-hosted-app-returns.md | a hosted app describes itself by the plain object register() returns; name, rail and sidebar, status card, services; Product as the example
2026-10-24 | nooblyjs-ai-product | 02 nooblyjs-ai-product/02-signals-ideas-specs.md | signals and ideas; specs with readiness checks; RICE scoring and the roadmap; portfolio hierarchy (epics, features); business cases drafted by agents
2026-10-10 | nooblyjs-ai-factory | 01 nooblyjs-ai-factory/01-worker-and-control-plane.md | what the factory is for (issue in, PR out); harness as worker vs factory as control plane; the agent's deny list (no git push, gh); scrubbed agent environment
2026-10-10 | nooblyjs-ai-factory | 02 nooblyjs-ai-factory/02-the-event-log.md | the event log as the only write (append, never edit); projections derived from events (bank-statement analogy); seq as global order; idempotency keys make a repeat a no-op; YAML files, rebuildable
2026-10-24 | nooblyjs-ai-factory | 03 nooblyjs-ai-factory/03-lines-and-stations.md | the line as a pipeline of stations (triage→spec→build→verify→review→repair→deliver→merge); decide() as a pure state machine; stations as data in JSON; conditions (when), retries, and movement
2026-10-10 | nooblyjs-ai-knowledge | 01 nooblyjs-ai-knowledge/01-one-router-three-kinds-of-request.md | the one mounted router under /wiki; the three kinds of request (signed-in API, browser files, pages handed to host.frame); the auth gate before the API
2026-10-10 | nooblyjs-ai-knowledge | 02 nooblyjs-ai-knowledge/02-redact-before-you-store.md | personal data removed before a file is written; redaction as a pure function (text in, cleaned text and counts out); the original never stored (was numbered 01; renumbered 2026-10-11)
2026-10-10 | nooblyjs-ai-infrastructure | 01 nooblyjs-ai-infrastructure/01-the-provisioner-adapter.md | never talking to a cloud directly; one provisioner interface with a plug-in per cloud or tool; only the mock exists until a cloud is chosen
2026-10-10 | nooblyjs-ai-harness | 01 nooblyjs-ai-harness/01-the-agent-loop.md | turn vs round; runTurn() as an async generator; the while loop and maxTurns brake; tool_use / tool_result pairing; stop_reason and when the loop ends
2026-10-24 | nooblyjs-ai-harness | 02 nooblyjs-ai-harness/02-tools-and-permissions.md | tools as the model's API; the permission gate deciding allow/deny/ask; deny rules absolute; allow rules as explicit allowlist; permission modes (default/plan/bypass/acceptEdits)

Removed 2026-10-11 as duplicates of the lessons above: nooblyjs-ai-factory/01-the-event-log.md (same idea as
02-the-event-log.md) and nooblyjs-ai-harness/01-the-agent-turn.md (same idea as 01-the-agent-loop.md).
