# CLAUDE.md

Guidance for Claude Code in this repository.

`nooblyjs-ai-product` is NooblyJS's **Product Factory**: its screens (a UI module in the NooblyJS frame, like Teammates), its API at `/product/api/v1`, the artefacts (signals, ideas, specs, architecture, UX and UI) and the drafting agents. It is built in NooblyJS Phase 5 (its sub-phases are history in `docs/roadmap-history.md`; what is open is in `../nooblyjs-ai-host/.claude/steering/roadmap.md` ("Hosted apps: open work")). Start from `.claude/steering/structure.md`.

## Part of NooblyJS (read first)

This repo is hosted by **NooblyJS** (`../nooblyjs-ai-host`) at `/product`. Before changing how it starts, serves
pages, signs people in, stores data, emits events or calls models, read
`.claude/steering/nooblyjs-ai.md` (the shared rules, imported below: noobly owns them, and the full contract is `../nooblyjs-ai-host/.claude/steering/structure.md` §2a), `.claude/steering/tech.md` (this repo's values and how it differs) and
`.claude/steering/structure.md` (this repo's layout as a hosted app). The source of truth is
`../nooblyjs-ai-host/.claude/steering/structure.md` §2a. Where anything below conflicts with those, they win.

@.claude/steering/nooblyjs-ai.md

## Commands

```bash
npm start      # node --env-file-if-exists=.env server.js   (standalone; NooblyJS loads index.js instead)
npm test       # node --test --test-timeout=20000 "test/**/*.test.js"   (offline, mock provider)
npm run seed   # writes the seed story into data/product/ (-- --reset to start again)
```

This project lives in the `nooblyjs-ai` monorepo next to the projects it links (`file:../<project>`); `nooblyjs-core` is a separate repo next to the monorepo (`file:../../nooblyjs-core`).
