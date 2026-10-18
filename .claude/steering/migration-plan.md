# Migration plan: EngX (`/home/stephen/Code`) → nooblyjs-ai

> Status: **draft for review** · written 2026-10-18 · owner: Stephen
>
> Goal: every feature in the eight EngX repos under `/home/stephen/Code` lives in this monorepo
> (`/home/stephen/Code - private/nooblyjs-ai`) under the nooblyjs name, with no EngX/ShopriteX branding,
> no company data and no secrets, and with every project's tests passing offline.

---

## 1. Summary

The EngX workspace is a **host platform plus hosted apps**: one host process (`engx`) loads five child apps through a
`register()` contract and draws one shared frame (rail, sidebar, chat dock) from a UI kit in `engx-core`. This repo
has an **older, standalone** snapshot of some of those projects and none of the platform pieces.

| Area | State in this repo | Work |
| --- | --- | --- |
| `harness` | In sync (only line endings and the EngX colour theme differ) | Nothing to port; adopt steering only |
| `common` (AI providers) | Behind: no Bedrock, Vertex, Azure, model discovery | Small port |
| `teammate` | Behind and diverged: no Team board, no hosted mode, no layered layout; has its own standalone login/admin work that EngX dropped | Merge (keep both modes) |
| `factory` | Behind: old flat layout, SQLite event store; no hosting (F26), no intake, no Bitbucket forge | Restructure + port |
| `product` | **Missing** (Product Factory) | New project |
| `infrastructure` | **Missing** | New project |
| `knowledge` | **Missing** (the Wiki Platform: wiki + datasources + AI answers + MCP) | New project, largest |
| Host app (`engx`) | **Missing**: lifecycle engine, Home, onboarding, people, team chat, Platform/governance, metrics, Teams bot, dev tools, Electron/Edge apps | New project, the backbone |
| `nooblyjs-core` (outside the monorepo, `../nooblyjs-core`) | Behind `engx-core`: no UI kit/frame, no `FsStore`, no Express 5 route shim | Port into that repo first |
| `desktop` | Exists here only (no EngX counterpart) | Keep; optionally host later |

Everything else depends on the core and the host, so the order is **core → common → host → apps**, one project at
a time, each ending with green tests.

---

## 2. What was analysed

Source workspace `/home/stephen/Code` (no `.git` in any repo, so **no history comes across**; this is a code copy):

| Source repo | Files¹ | JS lines² | Tests | What it is |
| --- | --- | --- | --- | --- |
| `engx` | 755 | 26 k | 45 | The host: composition root, lifecycle engine (`src/lifecycle/`), Home/For you/Approvals/Activity/Metrics, onboarding & people, team chat, Platform (repos, model routes, budgets, guardrails, containers, secrets refs, audit), Teams bot + simulator, Jira/Bitbucket dev tools with a write gate, backup/restore, perf, seed, `apps/electron`, `apps/edge`, `apps/msteams` |
| `engx-core` | 589 | 122 k | 127 | `nooblyjs-core` fork + UI kit (`public/ui/`), `src/shell/`, `src/store/fs-store.js`, `src/aiservice/common` (the AI module), Express 5 route shim |
| `engx-ai-harness` | 310 | 17 k | 41 | `noobly` CLI agent harness (bin renamed `engx`) |
| `engx-ai-factory` | 499 | 21 k | 66 | Software Factory, restructured to `config/controllers/middleware/models/roles/routes/services/utils`, hosted at `/factory` |
| `engx-ai-teammates` | 261 | 17 k | 42 | Digital Teammates, same layered layout, hosted-only at `/teammates` |
| `engx-ai-product` | 169 | 13 k | 20 | Product Factory: signals → ideas → specs → architecture (C4) → UX/UI, RICE, roadmap, drafting agents; `/product` |
| `engx-ai-infrastructure` | 84 | 5 k | 7 | Designs, environments, provisioning runs (mock provisioner), drift, policies, cloud cost; `/infrastructure` |
| `engx-ai-knowledge` | 1209 | 271 k³ | 96 | Wiki Platform (CommonJS, Express 4): wiki, datasources/workflows, AI answers with citations, redaction, process-model, MCP server; hosted at `/wiki` through an adapter |

¹ excluding `node_modules`, `.temp` · ² includes vendored browser libraries · ³ mostly `public/vendor` and the generated `public/app`

Method: file-tree diffs of each pair, a content match that ignores the `engx`↔`noobly` rename, imports and CRLF
(script kept at the bottom of this doc), plus reading each repo's `CLAUDE.md` and the EngX steering docs.

**Important: `engx/.kiro/` is gone from `/home/stephen/Code/engx`.** The design source of truth (product, tech,
structure, roadmap, phase specs, audits, learning notes, UI brief) only survives in
`~/.local/share/Trash/files/engx/.kiro/`. Recover it before anything else (M0).

---

## 3. Findings per project

### 3.1 `engx-core` → `../nooblyjs-core`
236 files differ, but almost all of it is the brand rename. Real deltas, all **only in engx-core**:

- `src/shared/utils/routePattern.js` and its use in `filing`, `workflow`, `searching`, `working` routes: Express 4
  patterns (`*`, `:name(*)`) made to work under Express 5. This is why the target `teammate` currently runs core
  on a separate Express app (`nooblyjs-ai-teammate/src/core/index.js`); with the shim that workaround can go.
- `public/ui/` the **UI kit and frame** (`frame.html`, `js/{api,chat,format,frame,html,icons,router,shell,sse}.js`,
  `js/components/`, `css/{tokens,base,components,shell}.css`, Lexend + JetBrains Mono fonts) and
  `src/shell/{index,css-scope}.js`, `scripts/scope-css.js`.
- `src/store/fs-store.js` (atomic tmp+rename writes, per-path locks, path-segment validation).
- `src/authservice/modules/redirect.js`, `activities/`, `.application/`, and a `test/` folder (node:test) vs
  `tests/` (jest) in nooblyjs-core.
- `src/aiservice/common` (see 3.2): keep it **out** of core here; this repo already split it into
  `nooblyjs-ai-common`.
- nooblyjs-core is **ahead** on its own design-system restyle (`core.css`, login, auth providers): keep nooblyjs-core's
  versions of those files.

### 3.2 `engx-core/src/aiservice/common` → `nooblyjs-ai-common`
Same code except: new `discovery.js` (250 lines), new providers `bedrock.js`, `aws-sigv4.js`,
`aws-eventstream.js`, `vertex.js`, `google-auth.js`, `azure.js`; changes in `models.js` (+55), `providers/index.js`,
`index.js`, `errors.js`, `openai-compatible.js`. Tests live in `engx-core/test/unit/aiservice/common/`
(incl. `cloud-providers.test.js`, `discovery.test.js`, `providers.contract.test.js`).

### 3.3 `engx-ai-harness` → `nooblyjs-ai-harness`
141 files differ, but after normalising CRLF and the brand only `src/ui/theme.js` (EngX navy palette),
`src/ui/markdown.jsx` (18 lines) and `App.jsx` (2 lines) differ. **Nothing to port** except reviewing those two
small diffs and taking the steering content. Do not take the EngX theme.

### 3.4 `engx-ai-factory` → `nooblyjs-ai-factory`
- **Layout**: EngX moved `src/*` into `config/ controllers/ middleware/ models/ roles/ routes/ services/ utils/`
  (enforced by `test/structure.test.js`) and tests mirror it. 79 files are identical after the move, 58 changed,
  15 new.
- **Event store**: target uses `node:sqlite` (`src/store/db.js`); EngX replaced it with daily YAML streams
  (`src/models/store/files.js`, `events.js` −229 lines, `projections.js`, `leases.js`). Files-only matches the rest
  of the platform.
- **New**: F26 hosting (`src/services/hosted.js`, `to-express.js`, root `index.js` exports `register()`), intake from
  lifecycle handoffs (`src/services/intake/{handoff,attributes,demo-repo}.js`, `config/repos-map.js`), a Bitbucket
  forge (`services/forge/bitbucket.js`), worker API split out (`routes/workers.js`, `controllers/workers.js`,
  `middleware/{auth,worker-auth,body,static}.js`), the UI module (`public/js/{module,lib,parts}.js`,
  `pages/{line,runs,run,inbox,campaigns,metrics}.js`, `public/css/factory.css`), `examples/engx/`,
  `.claude/docs/F26-hosted-in-engx.md`, `workflows/`.
- Both require **Node ≥ 24**; this machine has **Node 22.22.1**.

### 3.5 `engx-ai-teammates` → `nooblyjs-ai-teammate`
- Same layered layout as the factory (EngX) vs `repos/ store/ providers/ seed/ util/` (target).
- **EngX only**: the Team board (`services/board*.js`, `models/board.js`, `routes|controllers/board.js`,
  `public/js/pages/board.js`), `services/host-tasks.js` (`runTask` for chat, drafting and the Teams bot: refuse,
  bill, attribute), hosted UI module (`public/js/module.js`, `client.js`, kit components), `controllers/{tasks,
  uploads,settings}.js`, large changes in `routes/api.js`, `controllers/tools.js`, `webhooks`, `memory`, `billing`,
  `config/app.js`.
- **Target only** (recent work, keep it): standalone `server.js`, nooblyjs-core sign-in and admin
  (`src/core/{index,job-queue,logger,metrics,session-store}.js`, `public/js/pages/login.js`, `admin.js`),
  `public/index.html`, `.env.example`.
- EngX made Teammates **hosted-only**. The contract (§2a) allows a standalone `server.js` that calls `register()`;
  use that to keep the target's standalone mode.

### 3.6 `engx-ai-product`, `engx-ai-infrastructure` (missing)
Both are clean ESM hosted apps (`index.js` → `register()`, standalone `server.js`, `src/{routes,services,repos,
seed,util}`, `public/js/module.js` + pages on the UI kit). Dependencies: core (`src/shell`, `/ui/js/*`), product
also `ai-common` and `harness`. Their `.kiro/steering/{brief,ui}` hold the UI mockups.

### 3.7 `engx-ai-knowledge` (missing)
- CommonJS, Express 4, large dependency list including `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`,
  `@modelcontextprotocol/sdk`, `helmet`, `multer`, `mammoth`, `chokidar`, `express-session`… Conflicts with the
  "no vendor SDKs, minimal deps" rule in the other projects.
- Hosted through an adapter (`index.mjs`, `src/hosted/{platform.cjs,legacyApp.cjs,api.mjs}`) that translates paths,
  Express 4→5 patterns and Socket.IO → host events.
- The browser UI is **generated** (`npm run port:ui`) from `src/web/wiki/public` and `src/web/datasources/public`
  into `public/app` and `public/vendor`; `npm test` fails when the output is stale.
- It descends from `../nooblyjs-apps/nooblyjs-application-wiki` but has moved far past it (knowledge layer,
  redaction, process model, MCP). Port from EngX, not from the old wiki.
- Uses globals (`global.eventBus`, `io`, `treeCache`), and its file watcher and intervals have no stop (why the host
  runs tests with `--test-force-exit`).

### 3.8 `engx` host (missing)
Owns everything shared: the product, the lifecycle engine, governance, the hosted-app contract, cross-app services
(`host.service('teammates'|'knowledge'|'platform'|'workflows'|'teams')`), one roadmap (Phases 0–15) and the shared
steering rules synced into each child (`npm run steering:sync`, `docs/steering/engx-shared-rules.md`).
Enterprise-specific parts: Entra SSO, Microsoft 365 notifications and the Teams bot (`src/teams/`,
`apps/msteams`), Jira/Bitbucket read + gated writes (`src/services/devtools/`), the Edge extension (`apps/edge`).
Business-specific seed story ("PRD-031 Same-day delivery slots") and org config (`data/config/organisation.yaml`).

### 3.9 Hygiene found in the source
- **Secrets on disk**: `engx/.env` (9 KB), `engx/certs/server.key` + `server.crt`, session files
  (`engx-ai-teammates/data/core/sessions.json`, `data/core/auth/sessions.json`), logs. Never copy these.
- **Runtime data** committed in folders: `engx/data/**`, `engx-ai-teammates/data/**` (memories, timesheets,
  audit), `engx-ai-knowledge/.application`. Copy seed sources (`src/seed/data`) only.
- **Company references**: ~440 hits for ShopriteX / Shoprite / shopritelabs / Checkers across data, src, tests,
  workflows, docs, `.kiro`. Plus `ENGX_*` env vars (`ENGX_DEV_LOGIN`, `ENGX_OWNERS`, `ENGX_PUBLIC_URL`,
  `ENGX_SAMPLE_DATA`, `ENGX_SKIP_SIBLINGS`, `ENGX_URL`, `ENGX_BOT_URL`, `ENGX_ACCOUNT`, `ENGX_NODE`), cookies
  (`engx.sid`, `engx.csrf`), CSS classes (`engx-shell`, `engx-rail`, `engx-card`…), event names, bin `engx`.
- **CRLF** line endings in ~390 source files (Windows checkout in `C:\work-repositories\`).
- `bitbucket.org/shopritelabs` URLs in `package.json` files, `"license": "UNLICENSED"`, `"private": true`.

---

## 4. Decisions (recommendations; confirm before M1)

| # | Decision | Recommendation |
| --- | --- | --- |
| D0 | **Right to move the code.** The source is labelled ShopriteX, `UNLICENSED`, hosted on the company Bitbucket, and this repo points at a public GitHub org. | Confirm you own it or are allowed to relicense it before anything is pushed. The plan assumes yes, and strips all company content regardless. |
| D1 | Where the host lives | New project **`nooblyjs-ai-host`** (replace the empty `nooblyjs-ai/nooblyjs-ai` stub; a folder named like the repo is confusing). Product name in the UI: "NooblyJS AI". |
| D2 | Where engx-core's additions go | Into **`../nooblyjs-core`** (its own repo, as today). The AI module stays in `nooblyjs-ai-common`. Alternative: vendor core into the monorepo; not recommended (other nooblyjs repos use it). |
| D3 | Factory event store | Take EngX's **YAML streams**, drop SQLite (files-only everywhere, no Node sqlite flag). |
| D4 | Teammate modes | **Both**: hosted `register()` + standalone `server.js` with the nooblyjs-core login you added. |
| D5 | Steering format | `.kiro/steering/*` → **`.claude/steering/*`** (this repo's convention); child repos get a generated `.claude/steering/nooblyjs-ai.md` from the host's shared-rules file. Keep phase history as `docs/`. |
| D6 | Enterprise integrations (Entra/M365/Teams bot, Jira/Bitbucket, Edge extension) | Port them, **off by default**, behind config, with company values removed. They are generic integrations; only the data is company-specific. Bitbucket forge stays next to GitHub/local. |
| D7 | Knowledge's vendor SDKs | Port as-is first (to get the feature over), then move model calls onto `nooblyjs-ai-common` in a follow-up (M9b). |
| D8 | Rename map (below) | Mechanical, applied by a script, reviewed by grep. |
| D9 | Node version | Install **Node 24 LTS** locally (factory requires ≥ 24; root scripts run everything). |
| D10 | `desktop` | Stays standalone in this migration; hosting it is optional follow-up M12. |

### Rename map (D8)

| EngX | nooblyjs-ai |
| --- | --- |
| `engx` (host repo/package) | `nooblyjs-ai-host` |
| `engx-core` | `nooblyjs-core` (`file:../../nooblyjs-core`) |
| `engx-ai-common`, `EngX-ai-common` | `nooblyjs-ai-common` (`file:../nooblyjs-ai-common`) |
| `engx-ai-harness`, `EngX-ai-harness`, `engx-learn-harness` | `nooblyjs-ai-harness` (package name stays `nooblyjs-learn-harness` until you choose otherwise) |
| `engx-ai-factory` | `nooblyjs-ai-factory` |
| `engx-ai-teammates` | `nooblyjs-ai-teammate` |
| `engx-ai-product` / `-infrastructure` / `-knowledge` | `nooblyjs-ai-product` / `-infrastructure` / `-knowledge` |
| bin `engx` | `noobly` (already in target) |
| `ENGX_*` env vars | `NOOBLY_*` |
| `engx.sid`, `engx.csrf` | `noobly.sid`, `noobly.csrf` |
| CSS `engx-*` classes, `data-engx-*` | `nb-*` (one prefix; choose once) |
| event / service names containing `engx` (e.g. `request.engx`, `FACTORY_HOSTED=engx`) | `noobly` |
| "EngX" in UI copy and docs | "NooblyJS AI" |
| ShopriteX, Shoprite, Checkers, shopritelabs, company people/teams | removed or `[PLACEHOLDER]` / neutral sample company |
| `C:\work-repositories\` | `/home/stephen/Code - private/` (sibling layout) |

---

## 5. Target layout

```
nooblyjs-ai/                        (this repo)
  package.json, scripts/each.js     root runner; PROJECTS in dependency order
  .claude/steering/                 migration plan, shared rules source (from engx docs/steering)
  nooblyjs-ai-common/               AI module (providers incl. Bedrock/Vertex/Azure, discovery)
  nooblyjs-ai-harness/              agent runtime + CLI
  nooblyjs-ai-host/                 the host (ex engx): frame, Home, lifecycle, people, chat, Platform, metrics, bot
  nooblyjs-ai-teammate/             hosted + standalone
  nooblyjs-ai-factory/              hosted + CLI
  nooblyjs-ai-product/              hosted (+ standalone server.js)
  nooblyjs-ai-infrastructure/       hosted (+ standalone server.js)
  nooblyjs-ai-knowledge/            hosted via index.mjs (+ standalone app.js)
  nooblyjs-ai-desktop/              standalone (unchanged)
../nooblyjs-core/                   gains UI kit, shell, FsStore, Express 5 route shim
```

Dependency direction stays as in EngX: host → apps → (core, harness → common). Apps never import each other.

`scripts/each.js` order: `common, harness, factory, teammate, product, infrastructure, knowledge, host, desktop`.
Root `npm start` becomes the host (plus desktop if wanted).

---

## 6. Rules for every step

1. **Copy, never move**: the source stays untouched; work on a branch (`migrate/<project>`), one commit per step.
2. **Exclude**: `node_modules`, `.temp`, `temp`, `data/` (except seed sources under `src/**/seed`), `.env`, `certs/`,
   `*.key`, `*.crt`, `*.log`, `sessions.json`, `.application/` runtime data, `package-lock.json` (regenerate).
   Use one `rsync --exclude-from=scripts/migrate/exclude.txt` list.
3. **Normalise** CRLF → LF on copy.
4. **Rename** with `scripts/migrate/rebrand.mjs` (the map in §4), then grep. The step is not done until
   `grep -rniE 'engx|shoprite|checkers|work-repositories'` over the project (outside `node_modules`) returns
   nothing, or only lines listed in an allow-list with a reason.
5. **Tests are the bar**: each project runs its own `npm test` offline (mock providers, no API keys, no network);
   live tests stay opt-in.
6. Keep the target's conventions where they already exist (root scripts `start/test/coverage/build/clean`,
   `nooblyjs-core` path `file:../../nooblyjs-core`).
7. Each migrated repo gets `CLAUDE.md` + `.claude/steering/{product,tech,structure}.md` rewritten from its `.kiro`
   copies, pointing at the host's shared rules instead of `../engx`.

---

## 7. Phases

Each phase lists **steps** and **done when**. Rough size: S < 1 day, M 1–3 days, L 3–5 days, XL > 1 week.

### M0 — Preparation (S)
- Restore `~/.local/share/Trash/files/engx/.kiro` to a staging folder outside both workspaces (read-only reference).
  Do the same check for the other repos' `.kiro` (they still have theirs).
- Record a **baseline**: run `npm test` in each source repo (on Node 24), save results to
  `.temp/migration/baseline/<repo>.txt`. Known: factory F05 multi-process test is flaky (1 in 4); two Windows-only
  `0o600` assertions in teammates.
- Write `scripts/migrate/exclude.txt`, `scripts/migrate/rebrand.mjs` (map + dry-run report), and
  `scripts/migrate/check.sh` (the grep gate). Keep the analysis script (`match.py`) for re-checking drift.
- Install Node 24 (D9). Confirm D0–D10.
- **Done when**: baseline results exist for all 8 repos, the scripts run in dry-run mode, decisions are signed off.

### M1 — `nooblyjs-core` catches up with `engx-core` (M) — in `../nooblyjs-core`
- Add `src/shared/utils/routePattern.js` and apply it in filing, workflow, searching and working routes.
- Add `src/store/fs-store.js`, `src/shell/{index,css-scope}.js`, `scripts/scope-css.js`,
  `src/authservice/modules/redirect.js`, `activities/`.
- Add the UI kit `public/ui/` (frame, JS, components, CSS tokens, fonts and their licences). Rebrand tokens and the
  favicon; keep nooblyjs-core's own restyled `src/views/css/core.css` and auth pages.
- Port `engx-core/test/**` unit tests that cover the new parts (store, shell, route patterns, UI kit) into
  nooblyjs-core's test setup.
- **Done when**: nooblyjs-core's existing tests and the ported ones pass; an Express 5 app can mount core's routes
  directly (prove with a test); `/ui/frame.html` serves.

### M2 — `nooblyjs-ai-common` (S)
- Port `discovery.js`, the six cloud providers, and the `models.js`, `providers/index.js`, `index.js`,
  `errors.js`, `openai-compatible.js` changes. Add `exports` entries for the new modules.
- Port `engx-core/test/unit/aiservice/common/**` (`cloud-providers`, `discovery`, `providers.contract`, …) and
  fixtures.
- Update README (cloud routes: Bedrock / Vertex / Azure; direct APIs for development).
- **Done when**: `npm test` green; `factory`, `harness`, `teammate`, `desktop` tests still green against it.

### M3 — `nooblyjs-ai-harness` (S)
- Review `markdown.jsx` (18 lines) and `App.jsx` (2 lines) diffs; take any fix that is not branding.
- Bring the `.kiro/steering/{product}.md` content into `.claude/steering/` where it adds anything.
- **Done when**: tests green; diff against EngX is only branding/theme.

### M4 — `nooblyjs-ai-host` (XL) — the backbone
Split in sub-steps so each lands green:

- **M4a Skeleton**: copy `app.js`, `src/{engx→host}.js`, `config.js`, `hosted-apps.js`, `built-in-apps.js`,
  `middleware/`, `pages/`, `routes/session.js`, `util/`, `startup/`, `scripts/{seed,kill-port,backup,restore,perf,
  clean-modules,sync-steering}.js`, `public/`, `src/seed/` (seed data rebranded to a neutral sample company),
  `data/config/*.yaml` templates as seed files, `.env.example` (rebranded vars). Drop `src/utils/*` leftovers the
  CLAUDE.md marks unused, and `install-siblings.js`/`detach-git.js` (the monorepo replaces them).
  `hosted-apps.yaml` starts with **no** apps enabled. Done when: the host boots, dev sign-in works, the frame and
  `/dev/styleguide` render, `test/{config,session,shell,kit,css-scope,seed,blank,rate-limit,store}.test.js` pass.
- **M4b Lifecycle + Home**: `src/lifecycle/**`, `routes/{home,events,me}.js`, `services/{activity,events,clock,
  people,profiles,work-roles,for-you,notify,audit-log}.js`, onboarding. Tests: `test/lifecycle/**`,
  `lifecycle`, `people`, `ideas-migration`.
- **M4c Team chat + agents**: `services/{chat,chat-reply,agents}.js`, `routes/chat.js`, `data/chat/scripts.yaml`.
- **M4d Platform & governance**: `src/services/platform/**`, `routes/platform.js`. Tests: `platform`,
  `platform-api`, `provision`, `agents`.
- **M4e Metrics**: `src/services/metrics/**`, `src/seed/metrics-history.js`, `scripts/metrics-reconcile.js`.
- **M4f Integrations (off by default, D6)**: `services/entra.js`, `src/teams/**` + simulator, `routes/teams.js`,
  `services/devtools/**` with the write gate (`DEVTOOLS_WRITES`), `routes/devtools.js`, `test/fixtures/atlassian.js`,
  `apps/msteams` (rebrand the manifest; new app IDs), `apps/edge`, `apps/electron`, `docs/runbooks`,
  `docs/security`.
- **M4g Docs/steering**: shared rules → `nooblyjs-ai-host/docs/steering/shared-rules.md` → synced into each child's
  `.claude/steering/nooblyjs-ai.md`; product/tech/structure/roadmap from the recovered `.kiro` into
  `nooblyjs-ai-host/.claude/steering/`, rebranded; phase summaries into `docs/phases/`; ADR-001.
- **Done when**: all 45 host test files pass except those for apps not yet migrated (marked `skip` with the phase
  that re-enables them); `npm run seed -- --reset` and `npm start` give a working Home with no hosted apps.

### M5 — `nooblyjs-ai-teammate` (L)
- Move to EngX's layered `src/` layout and take its code (board, host-tasks, hosted UI module, controllers),
  rebranded.
- Re-add the target's standalone mode as `server.js` → own Express + nooblyjs-core sign-in/admin → `register()`.
  With M1's route shim, delete the separate core Express app workaround in `src/core/index.js` if tests allow.
- Seed data only from `src/config/seed-data.js` / `src/services/seed.js`; delete committed `data/` runtime files from
  the repo and add `data/` to `.gitignore`.
- Enable in the host's `hosted-apps.yaml`; un-skip `test/teammates.test.js`, `chat`, `teams-bot`.
- **Done when**: teammate tests green (both modes), host tests for teammates green, `npm start` in the teammate folder
  still gives the standalone app with login.

### M6 — `nooblyjs-ai-factory` (L)
- Adopt the layered layout and `test/structure.test.js`; replace the SQLite store with the YAML store (D3); add
  hosting (`index.js` `register()`, `services/hosted.js`, `to-express.js`), intake, Bitbucket forge, worker routes,
  the UI module and `public/css/factory.css`, `examples/engx` → `examples/hosted`.
- Merge the F-docs and steering (the diffs are mostly branding plus the F26 doc).
- `FACTORY_HOSTED=engx` → `FACTORY_HOSTED=noobly`.
- **Done when**: `npm test` and `npm run check:examples` green; CLI `factory run` works offline with the scripted
  agent; host tests `factory`, `software-factory` green.

### M7 — `nooblyjs-ai-product` (M) — new
- Copy, rebrand, depend on `nooblyjs-core`, `nooblyjs-ai-common`, `nooblyjs-ai-harness`. Steering + UI mockups
  (`.kiro/steering/ui`) into `.claude/steering/` (mockups read-only).
- Replace the seed story with a neutral one, or keep its shape with neutral names.
- **Done when**: its 20 test files green; host `product` test green; drafting runs through
  `host.service('teammates').runTask()` with the mock provider.

### M8 — `nooblyjs-ai-infrastructure` (S–M) — new
- Copy, rebrand, depend on `nooblyjs-core`. Approvals as `infra-design` in the lifecycle engine; cloud budget from
  Platform.
- **Done when**: its 7 test files green; host `infrastructure`, `provision` tests green; Platform · Environments lists
  its environments.

### M9 — `nooblyjs-ai-knowledge` (XL) — new
- **M9a Port as-is**: copy `src/`, `index.mjs`, `app.js`, `scripts/` (incl. `port-wiki-ui.mjs`), `test/`, `tests/`
  (decide whether the jest `tests/` folder is still alive; the npm `test` script only runs `test/**/*.test.mjs`),
  `public/` hand-written parts, `.docs` → `docs/`, `workflows/`, `src/wiki/knowledge/sample-export` (check the
  sample is already redacted and has no company content; replace it if not).
  Regenerate `public/app` and `public/vendor` with `npm run port:ui` instead of copying them.
  Run `scripts/generate-certs.js` locally only; never copy certs.
- **M9b Align** (follow-up, can trail): model calls through `nooblyjs-ai-common` instead of the Anthropic SDKs;
  give the watcher and intervals a stop so `--test-force-exit` can go; consider ESM.
- **Done when**: its `npm test` green including the `--check` that generated UI is fresh; host `knowledge` test
  green; `host.service('knowledge')` answers with citations and no model configured.

### M10 — Workspace integration (M)
- Root `package.json`: `start` → host; `start:<app>` for each standalone mode; `seed`, `test:e2e`.
- `scripts/each.js` PROJECTS order (§5); `--only` aliases.
- Host's Playwright e2e (`test/e2e`, six configs) and axe checks; port `test/live/*` as opt-in.
- Root `README.md`: what each project is, how to start, Node 24, sibling `nooblyjs-core`.
- Shared rules sync: `npm run steering:sync` in the host writes every child's `.claude/steering/nooblyjs-ai.md`;
  `test/steering.test.js` guards it.
- **Done when**: `npm install && npm test` at the root is green for all projects; `npm start` brings up the host with
  all five apps on the rail; e2e green.

### M11 — Clean-up and sign-off (S)
- `scripts/migrate/check.sh` over the whole repo: zero brand/company hits, no secrets (`git secrets`/`gitleaks`
  style scan), no files over 1 MB outside `public/vendor`.
- Compare the final test counts with the M0 baseline (every source test either ported, or listed as dropped with a
  reason in `docs/migration-notes.md`).
- Remove `scripts/migrate/` (or keep for the next re-sync) and this plan's "draft" status.
- Mark the EngX workspace as the archived source.

### M12 — Optional follow-ups
- Host `nooblyjs-ai-desktop` as a hosted app (`/desktop`).
- Retire Express 4 in knowledge; one Express 5 everywhere.
- Publish packages / split back out if wanted.

---

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Company IP or personal data leaks into a public repo | D0 sign-off; exclusion list; grep gate per step; secret scan in M11; never copy `data/`, `.env`, `certs/` |
| The design source of truth (`engx/.kiro`) lives only in Trash | Restore it in M0 before emptying Trash |
| Rebrand script breaks code (identifiers, cookies, event names in tests) | Dry-run report, run per project, tests after each; event/cookie renames done in one commit across host + apps |
| Hosted contract mismatch while apps are half-migrated | Host starts with all apps disabled; enable one per phase |
| Node 22 locally vs ≥ 24 needed | D9 before M0 baseline |
| Target-only teammate work lost when taking the EngX version | M5 keeps standalone mode explicitly; compare with `git diff` against today's `HEAD` before committing |
| Knowledge's size and globals destabilise the host process | Port as-is behind the adapter (it already handles this in EngX); M9b for hardening |
| Flaky tests hide real failures | Baseline in M0 records the known flakes |
| Two sources drift if EngX keeps changing | Freeze or re-sync with `match.py` before each phase |

---

## 9. Order and effort at a glance

```
M0 prep ─► M1 core ─► M2 common ─► M3 harness ─► M4 host (a→g) ─┬─► M5 teammate ─┐
                                                                 ├─► M6 factory  ─┤
                                                                 ├─► M7 product  ─┼─► M10 workspace ─► M11 sign-off
                                                                 ├─► M8 infra    ─┤
                                                                 └─► M9 knowledge ┘
```

M5 should land before M7 (product drafting and host chat call `runTask`). M6–M9 can otherwise run in any order.
Rough total: 4–6 weeks of focused work, dominated by M4 and M9.

---

## Appendix A — re-running the drift analysis

`match.py` (kept in `scripts/migrate/`) pairs files by name across layouts and counts changed lines after
normalising CRLF, imports and the brand:

```bash
python3 -I scripts/migrate/match.py /home/stephen/Code/engx-ai-factory ./nooblyjs-ai-factory src
```

Results on 2026-10-18: factory `same=79 changed=58 new=15`; teammate `same=29 changed=36 new=15` (src) and
`changed=16 new=3` (public).
