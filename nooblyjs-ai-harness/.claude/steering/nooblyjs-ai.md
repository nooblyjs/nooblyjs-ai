---
inclusion: always
---

# NooblyJS: the shared rules (read this first)

> **Generated from `../nooblyjs-ai-host/.claude/steering/nooblyjs-ai-shared-rules.md` by `npm run steering:sync` in `../nooblyjs-ai-host`. Do not edit
> it here: change the source in nooblyjs-ai-host, and run the sync.** This project's other steering files describe only this project.

This project is part of **NooblyJS AI**, an engineering-lifecycle platform (idea → spec → architecture → design →
build → ship, where AI agents draft and people decide). The projects sit side by side in the `nooblyjs-ai` monorepo; `nooblyjs-core` is a separate repo next to it
(`../../nooblyjs-core`).
`nooblyjs-ai-host` is the one host process: it mounts each hosted app at its own path and serves one frame (rail, sidebar,
chat dock) from the UI kit in `nooblyjs-core/public/ui/`.

## Who owns what

**`nooblyjs-ai-host` owns everything shared.** Read the nooblyjs-ai-host file before you change anything it owns; if this repo's docs
disagree with it, nooblyjs-ai-host wins, so fix this repo's docs in the same change.

| Shared topic | Where it lives (in `../nooblyjs-ai-host/`) |
| --- | --- |
| The product: the 8-stage lifecycle, every screen, roles and the permissions matrix, governance rules | `.claude/steering/product.md` |
| Stack, storage, API conventions, agents and model routing, events, config, commands | `.claude/steering/tech.md` |
| **The hosted-app contract** (`register()`, `options.host`, the UI module and `ctx`, CSS scoping, standalone mode) | `.claude/steering/structure.md` §2a |
| **The cross-app services** (`host.service('workflows' / 'teammates' / 'knowledge' / 'product' / 'factory' / 'platform' / 'devtools' …)`) | `.claude/steering/tech.md` §8b |
| **The one roadmap**: every phase for every repo, the hosted-app checklist, and the hosted apps' open work | **`../.claude/steering/roadmap.md`**, in the monorepo root, not in nooblyjs-ai-host |
| **The whole factory across the SDLC**: the eight stages, the new systems, the trace, checks, the target stack | `../.claude/steering/{product,design,stack}.md`, in the monorepo root |
| Why the host owns the shell | `.claude/adr/ADR-001-host-owned-shell.md` |
| Porting an app with its own UI into the frame | `.claude/guides/porting-an-app.md` |

**This project owns only itself:** what it does and its screens (`product.md`), where its code and data live and the
`services` and events it offers (`structure.md`), and its own values for the contract and how it differs from the
default (`tech.md`). Work for this repo is planned as a phase in the one roadmap (the monorepo root's `.claude/steering/roadmap.md`), with its spec in
`../nooblyjs-ai-host/.claude/specs/`. There is no roadmap here. Bugs and small changes in this project are logged in the one log,
`../nooblyjs-ai-host/.claude/specs/bugs-and-changes/tasks.md`, and fixed here.

## The non-negotiables, in brief

- **Stack.** Node.js 24 (minimum 22.12), ES modules, Express 5 (the host's `express`, Express 5 route syntax).
  Plain HTML, CSS and JS in the browser: no React, TypeScript, bundler, build step or CSS framework.
  Dependencies: `js-yaml`, sibling projects as `file:../<project>`, `nooblyjs-core` as `file:../../nooblyjs-core` and
  the AI module as `file:../../nooblyjs-core/src/aiservice/common`; anything else needs a reason.
- **Storage is files.** Markdown with YAML front matter, `.yaml` config, append-only daily YAML streams, written only
  under this app's `dataDir` through `host.store` (FsStore). No SQLite, JSON databases, Mongo or Postgres.
- **Hosted, an app** mounts once under its mount path, never listens on a port, never calls
  `serverManager.initialize()`, never imports another child project (`host.service(name)` and events instead), never
  draws the rail or sidebar, and scopes every CSS selector under `[data-module="<name>"]`.
- **Agents propose, people decide.** Agents are capped at the Contributor access role and never merge to `main`,
  approve, accept a decision, or change a guardrail or budget, including from chat, Teams or an API key. Each rule
  has a test that proves it refuses.
- **Everything is accounted for.** Every write is audited (`host.audit`). Every agent action records actor, item,
  system, model route and cost, and is a teammate task (`host.service('teammates').runTask`), checked by
  `host.service('platform').checkAgentWork` first.
- **Models** only through `nooblyjs-ai-common`, on AWS Bedrock, Google Vertex AI or Azure, asked for by work type, never
  by model id. Direct consumer APIs in development only. No GitHub Copilot integrations.
- **Permissions come only from the access role** (Viewer, Contributor, Approver, Architect, Owner). A work role only
  shapes a person's home.
- **Time comes from `host.clock`**, never `Date.now()`, for targets, reminders and "today".
- **Bitbucket and Jira are production systems.** Only NooblyJS's devtools service calls them. It reads with GET, and
  writes only through its write gate, which sends nothing until a deployment, an Owner and a write token allow it
  and has no way to merge or delete. A hosted app holds no token: it asks `host.service('devtools')`. **Tests never
  write to them: use a fake `fetch`.**
- **Tests** use `node:test`, offline by default with a mock provider; live tests are opt-in (`*.live.test.js`).
- **Unknowns:** `[PLACEHOLDER]` for company facts, `[CONFIRM]` for decisions to check. Never invent them.
- **Status is said in words**, not colour alone. WCAG 2.2 AA.
