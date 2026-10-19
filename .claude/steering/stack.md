---
inclusion: always
---

# NooblyJS Software Factory: stack

> **Status:** Draft v1 · 2026-10-19. What the factory is built with, what each project actually uses today
> (checked against every `package.json` on 2026-10-19), where projects differ from the rules, and the tools the new
> SDLC stages need. The full rules are in `nooblyjs-ai-host/.claude/steering/tech.md`, and the summary every project
> carries is `nooblyjs-ai-host/docs/steering/nooblyjs-ai-shared-rules.md`. This file does not repeat them; it adds
> the whole-factory view and the decisions still to take.

---

## 1. The stack at a glance

| Layer | Choice | Not allowed |
| --- | --- | --- |
| Runtime | Node.js 24 LTS (minimum 22.12), ES modules | CommonJS in new code |
| Server | Express 5, JSON APIs, Server-Sent Events + `POST` for live updates | Next, Nest, Fastify, GraphQL, WebSockets in new code |
| Browser | Plain HTML, CSS and JS as native ES modules, on the shared UI kit (`nooblyjs-core/public/ui/`) | React, TypeScript, bundlers, CSS frameworks, CDNs |
| Storage | Markdown + YAML front matter, YAML config, append-only daily YAML event streams, through FsStore (atomic writes, per-path locks, path checks) | SQLite, Postgres, Mongo, Redis as a store of record, JSON databases |
| Shared services | `nooblyjs-core`: auth (local, Google, Entra), logging, caching, queueing, scheduling, notifying, measuring, searching, workflow, filing | Re-implementing any of them per project |
| AI | The AI module (`nooblyjs-core/src/aiservice/common`, linked as `nooblyjs-ai-common`): providers, discovery, catalogue, tokens, cost. Asked for by **work type** through Platform's model routes | Calling a provider SDK from a feature |
| Agent runtime | `nooblyjs-ai-harness`: agent loop, tools, permissions, sandbox (bubblewrap on Linux, seatbelt on macOS), hooks, MCP, skills, memory | Agents outside the harness |
| Tests | `node:test` + `node:assert`, offline with a mock provider; Playwright + axe for screens; live tests opt-in (`*.live.test.js`) | Jest, Mocha, Vitest in new code |
| Identity | Microsoft Entra ID (OIDC) in production; Google sign-in when `AUTH_METHOD=google`; dev person picker, refused in production | A login of each app's own |
| Collaboration | Microsoft Teams bot (Bot Framework, JWT-checked), Outlook through Microsoft Graph | Slack |
| Source and work | Bitbucket Cloud and Jira Cloud, only through the host's devtools service (GET reads; writes through the gate) | Tokens in any hosted app; GitHub Copilot |
| Desktop and browser | Electron window over the host (optional); Edge side-panel extension | A second build of the app |

**No build step.** `npm start` runs the source as written. **Dependencies stay minimal**: `express`, `js-yaml`,
`nooblyjs-core` and sibling projects as `file:` links; anything else needs a reason in the PR.

## 2. The repository

```
<workspace>/
├── nooblyjs-core/              separate repo: services, UI kit and frame, FsStore, the AI module
└── nooblyjs-ai/                this monorepo
    ├── .claude/steering/       this file, product.md, design.md, roadmap.md (the whole factory)
    ├── scripts/each.js         runs install / test / coverage / build / clean in every project, in order
    ├── nooblyjs-ai-host/       the host: frame, Home, lifecycle engine, Platform, chat, Teams, devtools, apps/{electron,edge,msteams}
    ├── nooblyjs-ai-factory/    Software Factory           (/factory, and the `factory` CLI), one package with:
    │   ├── product/            its Product section        (/factory/product; was nooblyjs-ai-product)
    │   └── infrastructure/     its Infrastructure section (/factory/infrastructure; was nooblyjs-ai-infrastructure)
    ├── nooblyjs-ai-teammate/   Digital Teammates          (/teammates, or standalone)
    ├── nooblyjs-ai-knowledge/  Knowledge (the wiki)       (/wiki)
    ├── nooblyjs-ai-harness/    the agent runtime and `noobly` CLI (library)
    └── nooblyjs-ai-desktop/    projects and chat for any LLM (standalone)
```

Proposed additions (`product.md` §4): `nooblyjs-ai-quality` (`/quality`), `nooblyjs-ai-security` (`/security`),
`nooblyjs-ai-operations` (`/operations`) `[CONFIRM names and mount paths]`. Each is made from the same template as the
Infrastructure section (the smallest clean one): `index.js` → `register()`, `src/{routes,services,repos,seed,util}`,
`public/js/module.js` and pages on the kit, `test/`. The same template works as a new **section** of the Software
Factory (`nooblyjs-ai-factory/<section>/`, added to `src/services/sections.js` and `public/js/sections.js`), which is
how Product and Infrastructure joined it on 2026-10-19; which way the three new ones go is open (`product.md` §9).

## 3. Each project today

| Project | Modules | Runtime dependencies | Tests | Notes |
| --- | --- | --- | --- | --- |
| `nooblyjs-ai-host` | ESM | express, js-yaml, helmet, compression, express-rate-limit, express-session, passport, nooblyjs-core, AI module, the hosted apps | 47 files + Playwright e2e | `nodemon` sits in runtime dependencies; it belongs in dev dependencies |
| `nooblyjs-ai-factory` | ESM | harness, AI module; `nooblyjs-core` and `js-yaml` for its sections | 108 for the line, 19 for the Product section, 7 for Infrastructure | Needs Node 24; event log is daily YAML streams. Since 2026-10-19 one package with the Product and Infrastructure sections (`product/`, `infrastructure/`, each with its own `src/`, `test/` and docs; their pages in `public/<section>/`); no standalone server for either section |
| `nooblyjs-ai-teammate` | ESM | express, js-yaml, nooblyjs-core, AI module | 43 | Keeps its own FsStore copy, not `host.store` |
| `nooblyjs-ai-harness` | ESM, `.jsx` via `tsx` | Ink, React, marked, tsx, AI module | 44 | React is for the **terminal** UI only; no browser code |
| `nooblyjs-ai-knowledge` | **CommonJS** | ~35, including Socket.IO, multer, document converters, `@anthropic-ai/sdk`, `openai`, `@anthropic-ai/claude-agent-sdk` | 96 (Jest and `node:test`) | Express 4 behind an Express 5 adapter; generated browser UI |
| `nooblyjs-ai-desktop` | CommonJS | express, ejs, bootstrap, marked, dompurify, dotenv, nooblyjs-core, AI module | 13 | Standalone, single user, any provider by design |

### Known variances from the rules

| Variance | Why it exists | What to do |
| --- | --- | --- |
| Knowledge is CommonJS, Express 4, Jest, Bootstrap, many dependencies | It is the legacy Wiki Platform, hosted through an adapter (Phase 8) | Leave it while it works; no new code in that style. Retire the standalone UI when the frame version covers it |
| Knowledge's agents call Anthropic and OpenAI SDKs directly | Legacy | **Must change** (mocking audit A6): its agents become teammate tasks through the AI module |
| Desktop is CommonJS, uses EJS and Bootstrap, calls any provider | A standalone personal tool, outside governance | Keep it out of the hosted set, or bring it under the rules before hosting it `[CONFIRM]` |
| Harness uses React (Ink) and `tsx` | Terminal UI | Allowed: the "no React" rule is for the browser |
| Teammates has its own FsStore | It predates the shared one | Move to `host.store` when next touched |
| `nodemon` is a runtime dependency of the host | Oversight | Move to `devDependencies` |

## 4. How the pieces run

- **One process** (`npm start` in the root runs the host on `127.0.0.1:11001`) mounts every enabled app from
  `data/config/hosted-apps.yaml`. Only it writes `data/`.
- **Agent work** is queued with nooblyjs-core queueing and runs in the harness. Today it runs inside the host
  process (Factory runs and teammate tasks), with OS sandboxing on Linux and macOS. Separate workers in containers
  come with a real container runtime.
- **Containers** run over the `ContainerRuntime` interface (simulated today). **Infrastructure** runs over the
  provisioner interface (mock today).
- **Backups**: `npm run backup` writes a dated, verified copy of `data/` outside it; `npm run restore`.
- **Tests**: `npm test` at the root runs every project's suite offline (`scripts/each.js`). `npm run test:e2e` runs
  the host's Playwright and axe walk.

## 5. Decisions still open (they block "real")

Repeated from the host `product.md` §12 and the mocking audit, because Release and Operate depend on them.

| Decision | Blocks | Default until decided |
| --- | --- | --- |
| Which cloud hosts the models (Bedrock, Vertex or Azure) | Real agents in production (A1, A2) | Anthropic API in development; mock in tests |
| Hosting target and container runtime (AKS, EKS, GKE; Docker or Kubernetes) and data region | Real sandboxes, pools, previews (A3, A8) | Simulated runtime |
| Cloud, region and IaC tool (Terraform, OpenTofu, …) | Real provisioning, drift, cost (A4) | Mock provisioner |
| Secret store | Secrets resolved for runs (A7) | References only |
| Image registry and image scanner | Real base images and CVEs (B1) | Typed-in file |
| Diagram-as-code format | Architecture interchange | The current text format |

## 6. Tools the new stages need (proposed)

Every tool below runs **as a command inside a harness sandbox**, from the repository's base image or a tool image,
behind the adapters in `design.md` §9. None is an npm dependency of a NooblyJS project, so the minimal-dependency
rule holds. All are `[CONFIRM]`: the choice is the company's, and each needs an approved image.

| Need | Stage | Candidates | Already in the factory |
| --- | --- | --- | --- |
| Secret scanning | Build | gitleaks, or the Factory's own scanner | `nooblyjs-ai-factory/src/services/security/secret-scan.js` |
| Static analysis (SAST) | Build | Semgrep, CodeQL CLI (licence permitting), SonarQube | — |
| Dependency and licence scan (SCA) | Build | `npm audit`, OSV-Scanner, Trivy (filesystem mode) | `npm audit` used by hand in the Phase 13 review |
| SBOM | Build, Release | Syft, CycloneDX CLI | — |
| IaC scan | Build, Architect | Checkov, Trivy (config mode) | Infrastructure policy checks (own rules) |
| Container image scan | Verify, Operate | Trivy, Grype | CVE status typed into `base-images.yaml` |
| Dynamic scan (DAST) | Verify | OWASP ZAP baseline and API scans | — |
| End-to-end tests | Verify | Playwright | Host e2e suite |
| Accessibility tests | Verify | axe-core with Playwright | Host e2e suite |
| Load tests | Verify | k6, Artillery | — |
| Resilience tests | Verify | Fault injection through the container runtime `[CONFIRM]` | — |
| Contract tests | Build | Pact, or schema checks from the API contract | Factory contract-test gate (seed) |
| Monitoring and SLOs | Operate | The company's observability platform `[PLACEHOLDER]` (the mockup's Datadog row was dropped 2026-10-11) | — |
| Feature flags and progressive rollout | Release | `[PLACEHOLDER]` | — |
| Incident paging | Operate | Teams (existing bot and channels) first; a paging tool `[PLACEHOLDER]` | Teams bot |

## 7. Conventions (short)

- **Ids**: typed and global (`PRD-031`, `REQ-031-04`, `ADR-014`, `INF-031`, `REL-…`); see `design.md` §4.
- **Events**: `<thing>.<past_tense>` (`approval.decided`, `finding.opened`), with `{ actor, itemId, system, at }`
  and, for agent work, `{ teammateId, modelRoute, costUsd }`.
- **Time** from `host.clock`, never `Date.now()`.
- **Unknowns**: `[PLACEHOLDER]` for company facts, `[CONFIRM]` for decisions. Never invent them.
- **Words, not colour**: every status has a word. WCAG 2.2 AA, checked by axe.
- **One bug and change log** for every project: `nooblyjs-ai-host/.claude/specs/bugs-and-changes/tasks.md`.
