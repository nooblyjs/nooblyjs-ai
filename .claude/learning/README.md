# Learning NooblyJS

Short lessons, about ten minutes each, written by the `learning` skill (`.claude/skills/learning/SKILL.md`). Each one
teaches one idea, quotes a little real code, gives one safe thing to try, and ends with what you've learnt.
`PROGRESS.md` lists every lesson with the ideas it covers.

## Where to start

1. **[00 · The whole application](00-the-whole-application.md)**: what NooblyJS is, the seven stages, the nine
   repositories as one program, where everything is kept, and one piece of work from idea to merged pull request.

## Then, by repository

| Repo | Lessons |
| --- | --- |
| nooblyjs-ai-host (the host) | [01 How NooblyJS starts](noobly/01-how-noobly-starts.md) · [02 The lifecycle engine](noobly/02-the-lifecycle-engine.md) · [03 Platform checks every agent action](noobly/03-platform-checks-every-agent-action.md) · [04 The write gate](noobly/04-the-write-gate.md) |
| nooblyjs-core | [01 The service registry](nooblyjs-core/01-the-service-registry.md) · [02 The service factory](nooblyjs-core/02-the-service-factory.md) |
| nooblyjs-ai-teammate | [01 Every agent action is a task](nooblyjs-ai-teammate/01-every-agent-action-is-a-task.md) |
| nooblyjs-ai-product | [01 What a hosted app returns](nooblyjs-ai-product/01-what-a-hosted-app-returns.md) |
| nooblyjs-ai-factory | [01 The worker and the control plane](nooblyjs-ai-factory/01-worker-and-control-plane.md) · [02 The event log](nooblyjs-ai-factory/02-the-event-log.md) |
| nooblyjs-ai-knowledge | [01 One router, three kinds of request](nooblyjs-ai-knowledge/01-one-router-three-kinds-of-request.md) · [02 Redact before you store](nooblyjs-ai-knowledge/02-redact-before-you-store.md) |
| nooblyjs-ai-infrastructure | [01 The provisioner adapter](nooblyjs-ai-infrastructure/01-the-provisioner-adapter.md) |
| nooblyjs-ai-harness | [01 The agent loop](nooblyjs-ai-harness/01-the-agent-loop.md) |

## Not taught yet

Ideas the overview mentions that have no lesson of their own yet, for the next runs of the skill:

- nooblyjs-ai-host: the frame and the UI module (how a page is loaded), team chat, the Teams bot and its token check, Metrics
  built from the event log, backup and restore, the blank start (`npm run seed:blank`).
- nooblyjs-ai-product: drafting (a brief to a teammate task to a new version), readiness checks and the override.
- nooblyjs-ai-teammate: billing and timesheets; memory.
- nooblyjs-ai-factory: stations and gates; the Bitbucket forge.
- nooblyjs-ai-infrastructure: designs, approvals by environment kind, drift.
- The apps in `noobly/apps/`: the Teams app, the Edge extension, the desktop window.

The harness and Teammates repositories also keep older notes of their own (`nooblyjs-ai-harness/.claude/learning/`,
`nooblyjs-ai-teammate/.claude/learning/`); those are about how each was first built, not about NooblyJS.
