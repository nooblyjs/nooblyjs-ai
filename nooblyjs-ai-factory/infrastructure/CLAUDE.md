# CLAUDE.md

Guidance for Claude Code in this folder.

This folder is the Software Factory's **Infrastructure section**: infrastructure designs, environments, provisioning
runs, drift and cloud cost, with its API and a mock provisioner. Its pages are in `../public/infrastructure/`. It was the
hosted app `nooblyjs-ai-infrastructure` at `/infrastructure` (rail label Infra) until 2026-10-19. Now it is part of
`nooblyjs-ai-factory`, one package and one NooblyJS app:

| | Since 2026-10-19 | Before |
| --- | --- | --- |
| Where it answers | `/factory/infrastructure` (API at `/factory/infrastructure/api/v1`) | `/infrastructure` |
| Who mounts it | the Factory's `register()` (`../src/services/sections.js`) | NooblyJS, from `hosted-apps.yaml` |
| Its data | `data/factory/infrastructure/` (moved there on the first start) | `data/infrastructure/` |
| Its sidebar rows | the Factory's sidebar, group **Infrastructure** (keys `infra-…`) | its own rail item and sidebar |
| `host.service('infrastructure')` | the same services, from the Factory's `provides`; `infra-design` approvals unchanged | from this app |
| Standalone | none: `server.js` is gone; run NooblyJS | `npm start` in this repo, on :11008 |

`index.js` still exports `register(app, serverManager, { mountPath, dataDir, host })`, which the Factory calls and the
tests in `test/` call on their own (at `/infrastructure`, on `test/fixtures/host.js`). The docs in `.claude/steering/`
and `docs/` were written when this was an app of its own: where they say `/infrastructure`, `data/infrastructure`,
`server.js` or `nooblyjs-ai-infrastructure`, read the column above. `INFRA_PROVISIONER`, `INFRA_MOCK_STEP_MS` and
`INFRA_SWEEP_CHECK_MS` are read from NooblyJS's `.env`. An install that doesn't use this section leaves it out with
`FACTORY_SECTIONS=product`.

## Part of NooblyJS (read first)

The shared rules are the Factory's copy, imported below (paths in it are relative to `nooblyjs-ai-factory/`). The full
hosted-app contract is `../../nooblyjs-ai-host/.claude/steering/structure.md` §2a; this section's own scope is
`.claude/steering/product.md`, its layout `.claude/steering/structure.md`, its values `.claude/steering/stack.md`.
Progress is tracked in the one roadmap, `../../.claude/steering/roadmap.md` ("Hosted apps: open work"): update its
checkboxes in the same change as the work. How I0–I6 were built is `docs/roadmap-history.md`.

@../.claude/steering/nooblyjs-ai.md

## Commands (from `nooblyjs-ai-factory/`)

```bash
node --test "infrastructure/test/**/*.test.js"   # this section's tests (offline, mock provisioner); npm test runs them with the Factory's
npm start                                         # in ../../nooblyjs-ai-host: NooblyJS, with the Factory and this section
```
