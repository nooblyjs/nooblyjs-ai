# CLAUDE.md

Guidance for Claude Code in this folder.

This folder is the Software Factory's **Product section** (the Product Factory): its API, its artefacts (signals,
ideas, specs, architecture, UX and UI) and the drafting agents. Its pages are in `../public/product/`. It was the
hosted app `nooblyjs-ai-product` at `/product` until 2026-10-19. Now it is part of `nooblyjs-ai-factory`, one package
and one NooblyJS app:

| | Since 2026-10-19 | Before |
| --- | --- | --- |
| Where it answers | `/factory/product` (API at `/factory/product/api/v1`) | `/product` |
| Who mounts it | the Factory's `register()` (`../src/services/sections.js`) | NooblyJS, from `hosted-apps.yaml` |
| Its data | `data/factory/product/` (moved there on the first start) | `data/product/` |
| Its sidebar rows | the Factory's sidebar, group **Product** (keys `product-…`) | its own rail item and sidebar |
| `host.service('product')` | the same services, from the Factory's `provides` | from this app |
| Standalone | none: `server.js` is gone; run NooblyJS | `npm start` in this repo |

`index.js` still exports `register(app, serverManager, { mountPath, dataDir, host })`, which the Factory calls and the
tests in `test/` call on their own (at `/product`, on `test/fixtures/host.js`). The docs in `.claude/steering/` and
`docs/` were written when this was an app of its own: where they say `/product`, `data/product`, `server.js` or
`nooblyjs-ai-product`, read the column above.

## Part of NooblyJS (read first)

The shared rules are the Factory's copy, imported below (paths in it are relative to `nooblyjs-ai-factory/`). The full
hosted-app contract is `../../nooblyjs-ai-host/.claude/steering/structure.md` §2a; this section's own scope is
`.claude/steering/product.md`, its layout `.claude/steering/structure.md`, its values `.claude/steering/tech.md`.
What is open is in the one roadmap, `../../.claude/steering/roadmap.md` ("Hosted apps: open work").

@../.claude/steering/nooblyjs-ai.md

## Commands (from `nooblyjs-ai-factory/`)

```bash
node --test "product/test/**/*.test.js"   # this section's tests (offline, mock provider); npm test runs them with the Factory's
npm start                                  # in ../../nooblyjs-ai-host: NooblyJS, with the Factory and this section at /factory/product
```
