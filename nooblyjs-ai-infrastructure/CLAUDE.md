# CLAUDE.md

Guidance for Claude Code in this repository.

`nooblyjs-ai-infrastructure` is NooblyJS's **Infrastructure** module: its screens (a UI module in the NooblyJS frame), its API
at `/infrastructure/api/v1`, infrastructure designs, environments, provisioning runs, drift and cloud cost.
Progress is tracked in NooblyJS's one roadmap, `../.claude/steering/roadmap.md` ("Hosted apps: open work"): update its checkboxes in the same change as the work. How I0–I6 were built is `docs/roadmap-history.md`.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/infrastructure` (NooblyJS Phase 9a: on the rail as Infra; design
approvals through the lifecycle engine (part of `noobly`, `src/lifecycle/`); the cloud budget from NooblyJS Platform; it owns environments and previews). Before changing how it starts, serves
pages, signs people in, stores data, emits events or provisions anything, read `.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a), `.claude/steering/stack.md` (this repo's values and how it differs) and `.claude/steering/structure.md` (the layout). The source of truth
is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a. Where anything here conflicts with NooblyJS, NooblyJS wins.

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm start      # node --env-file-if-exists=.env server.js   (standalone on :11008; NooblyJS loads index.js instead)
npm test       # node --test --test-timeout=20000 "test/**/*.test.js"   (offline, mock provisioner)
npm run seed   # writes the seed story into data/infrastructure/ (-- --reset to start again)
```

This project lives in the `nooblyjs-ai` monorepo; `nooblyjs-core` is a separate repo next to it (`file:../../nooblyjs-core`).
The mockups the screens were designed from (the original design brief) are not kept in this repo; the built screens are the reference.
