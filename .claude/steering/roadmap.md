---
inclusion: always
---

# NooblyJS Software Factory: roadmap

> **The one roadmap** for every project in this monorepo (decided 2026-10-19): every phase, the tracker, the
> hosted-app checklist and the hosted apps' open work. There is no roadmap in any project. What to build is
> `product.md`, how it fits together `design.md`, what it is built with `stack.md` (all in this folder); the detail of
> what is already built stays in `nooblyjs-ai-host/.claude/steering/` (`product.md`, `tech.md`, `structure.md`).
>
> Phases 0–15 moved here from `nooblyjs-ai-host/.claude/steering/roadmap.md` on 2026-10-19, unchanged. Inside them,
> paths such as `data/…`, `src/…`, `test/…`, `.claude/specs/…` and commands such as `npm run seed` are relative to
> `nooblyjs-ai-host` unless a project is named. Phases 16–23 take the factory across the whole SDLC (`product.md` §3).
>
> **Decided 2026-10-19:** nine lifecycle stages (Verify, Release and Operate replace Ship); three new apps, Quality,
> Security and Operations, built in that order; this file is the one roadmap.
>
> **Decided 2026-10-20:** the factory is Product, Design, Build and Test. **Quality is the Software Factory's Test
> section** (built inside `nooblyjs-ai-factory` from Phase 16d), not a separate app. The lifecycle follows how the
> teams work (`product.md` §3.2, §3.2a–c): eight stages, Discover · Product · Design · Engineer · Build · Test ·
> Release · Operate (Test replaces Verify); Design writes the stories that build a feature, handed to the Factory one at
> a time; Engineer is signed off before anything is built; the AI builds and tests, an engineer gives the Build
> approval, a human tester verifies the pull request and gives the Test approval, then it merges; a feature is
> released on its own once all its stories have passed Test.
> Phases 16b–16e build that; checks and the trace move to 16f.
>
> **2026-10-21 (CHG-009):** **Product and Design are hosted apps of their own**, on the rail before the Factory:
> `nooblyjs-ai-product` at `/product` (data `data/product`) and `nooblyjs-ai-design` at `/design` (data `data/design`).
> Product is a product of its own that feeds Design, which feeds the Factory. The Software Factory is Engineering, Build
> and its Test section. Design's Architecture rows are still Product's pages and API, drawn by Design. Where a phase
> below says `/factory/product`, `/factory/design`, the Product section or the Design section, read the app; old
> addresses move on to the app. `host.service('product')` and `host.service('design')` did not change.
>
> **2026-10-20 (CHG-007):** Infrastructure is the hosted app `nooblyjs-ai-infrastructure` at `/infrastructure` again, with
> its data in `data/infrastructure`: the factory is Product, Design, Build and Test, and provisioning infrastructure is
> something different. It was a section of the Software Factory for a day (`/factory/infrastructure`, CHG-005).
>
> **2026-10-19 (until CHG-009):** the Product Factory (`nooblyjs-ai-product`, at `/product`) is a **section of the Software Factory** now:
> one package (`nooblyjs-ai-factory/product`), one rail item (Factory), at `/factory/product`, with its data in
> `data/factory/product`. Where a phase below names that project or its paths, read the section.
> `host.service('product')` did not change.
>
> **2026-10-10:** the lifecycle engine, built in Phase 2 as the hosted app `nooblyjs-ai-workflows`, is part of
> `nooblyjs-ai-host` now (`src/lifecycle/`). Where an earlier phase names `nooblyjs-ai-workflows`, read "the lifecycle
> engine". Its API address, its service name (`workflows`) and its data folder did not change.

---

## How we work through a phase

1. **Kick-off:** create a spec for the phase in `nooblyjs-ai-host/.claude/specs/phase-NN-<name>/`
   (requirements → design → tasks). Answer the phase's *Before you start* questions first.
2. **Build** in small PRs, each with tests. Nothing outside the phase's scope gets built.
3. **Demo:** the phase ends with `npm start` plus the phase's **test script**. Every step says
   what you should see. Automated tests cover the same steps.
4. **Review and steer:** use the *Guide points* to decide what to change. A summary goes to
   `nooblyjs-ai-host/.claude/phases/phase-NN-summary.md`: what was built, the test script result, any
   placeholders used, and the open questions.
5. **Gate:** the next phase starts only when you mark this one ✅ in the tracker.
6. **After the gate:** a done phase's spec is not edited again (each one says so at the top). Bugs and small
   changes found later, in any repo, are logged in **`nooblyjs-ai-host/.claude/specs/bugs-and-changes/`** (`BUG-NNN`, `CHG-NNN`):
   each bug fix starts with a failing test, a change updates the steering doc it alters, and only you tick an
   entry once you have checked it. A change too big for that log becomes a phase here.

### Test kit (available from Phase 0)

| Tool | What it's for |
| --- | --- |
| `NOOBLY_DEV_LOGIN=true` | Person picker on `/login`, so you can switch between seeded people in one click |
| Seeded people | **Stevie** (Owner · Platform engineer) · **Lerato M.** (Approver · Product manager) · **Thabo N.** (Architect · Architect) · **Priya S.** (Contributor · Developer) · **Naledi K.** (new joiner, no profile, job title "Product Manager, Digital") `[CONFIRM name]` |
| `npm run seed -- --reset` | Wipes `data/` and rewrites the PRD-031 story |
| Dev clock (`/dev/clock`) | Moves "now" forward (hours or working days) so you can test targets, reminders and escalations without waiting. **Reset** returns to the real time |
| `/dev/teams` | Teams simulator (from Phase 6) |
| Two browser profiles | One person in each, to watch live updates and chat |
| `data/` folder | Everything is a readable file: open it to check what was written |


### Tracker

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Foundations | ✅ |
| 1 | Shell and design system | ✅ |
| 2 | Lifecycle core: items, approvals, activity | ✅ |
| 3 | People, onboarding and "For you" homes | ✅ |
| 4 | Team chat | ✅ |
| 5 | Product Factory | ✅ |
| 6 | Digital Teammates everywhere (and the Teams simulator) | ✅ |
| 7 | Software Factory integration | ✅ |
| 8 | Knowledge Repository | ✅ |
| 9 | Platform and governance | ✅ |
| 9a | Infrastructure joins NooblyJS | ✅ |
| 10 | Metrics | ✅ |
| 11 | Development tools: Bitbucket and Jira, read-only | ✅ |
| 12 | Microsoft 365: SSO, notifications, the real Teams bot | ✅ (reviewed 2026-10-20; the tenant run is still to do) |
| 13 | Writing to Bitbucket and Jira and production readiness | ✅ (reviewed 2026-10-20; the pilot is still to do) |
| 14 | NooblyJS in the browser: the Edge extension (agent chat beside Jira) | ✅ (reviewed 2026-10-20 as the skeleton in `apps/edge`; its Build list is not built) |
| 15 | No mocks: everything real | ☐ blocked on the cloud, runtime and model decisions (`stack.md` §5) |
| 16a | Nine stages: Verify, Release and Operate replace Ship | ✅ (reviewed 2026-10-21) |
| 16b | Eight stages, and the Factory's five groups | ✅ (reviewed 2026-10-21) |
| 16c | The Design section: business requirements, solution architecture, functional analysis, stories | ✅ (reviewed 2026-10-21) |
| 16d | Engineering: application architecture from the code, and test analysis | ✅ (reviewed 2026-10-21) |
| 16e | Build and Test: the AI builds and tests, engineers and testers approve | ✅ (reviewed 2026-10-21) |
| 16f | One shape for checks, and the trace | ✅ (reviewed 2026-10-21) |
| 17 | Strategy and the business case | ✅ (reviewed 2026-10-21) |
| 18 | Requirements elicitation | ✅ (reviewed 2026-10-21) |
| 19 | Security by design (new app: Security) | ✅ (reviewed 2026-10-21) |
| 20 | Quality (the Factory's Test section) | ✅ (reviewed 2026-10-21) |
| 21 | Testing in environments | ✅ (reviewed 2026-10-21) |
| 22 | Release (new app: Operations, part 1) | ✅ (reviewed 2026-10-21) |
| 23 | Operate and learn (Operations, part 2) | ✅ (reviewed 2026-10-21) |
| 24 | Housekeeping: the wiki's agents as teammate tasks, Teammates on `host.store` | ✅ (reviewed 2026-10-21) |
| 25a | Product: customer evidence, the ideas portal, the feedback form, closing the loop | ◐ in progress (spec `nooblyjs-ai-host/.claude/specs/phase-25a-customer-evidence/`, 2026-10-22) |
| 25b | Product: objectives, roadmaps and capacity (Now · Next · Later) | ☐ planned |

Open bugs and changes: none. BUG-001 to BUG-007 and CHG-001 to CHG-009 are verified (2026-10-21); the next IDs are BUG-008 and CHG-010 (`nooblyjs-ai-host/.claude/specs/bugs-and-changes/tasks.md`).

### The plan from here

```
Now ─► 16a Stages ─► 16b Eight stages ─► 16c Design ─► 16d Engineering ─► 16e Build + Test ─► 16f Checks + trace
                                                                                                             │
       ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┘
       ▼
       17 Strategy ─► 18 Elicitation ─────────┐
                                              ├─► 21 Testing in environments ─► 22 Release ─► 23 Operate & Learn
       19 Security by design ─► 20 Quality ───┘        (Infra I8)                (Infra I10)
                                                                                  ▲
       12 · 13 · 14 sign-offs continue alongside                                 15 No mocks unblocks the real versions
```

- **Close what is open first, in parallel.** Phases 12 and 13 need reviews and outside steps, not new code; they
  run alongside 16–18.
- **Mocks first, real later.** Phases 19–23 build on adapters with offline fakes (`design.md` §9), so they don't
  wait for the cloud decisions. Phase 15 then makes each adapter real.
- **Each new app passes the hosted-app checklist** before its phase closes.

### Hosted-app checklist (used by Phases 2, 5, 6, 7 and 8)

Every child app that joins NooblyJS (`structure.md` §2a) passes these steps before its phase can close:

1. `index.js` exports `register(app, serverManager, options)` and nothing starts listening on import.
2. Listed in `data/config/hosted-apps.yaml`. `npm start` in `nooblyjs-ai-host` logs `mounted <name> at <mountPath>`,
   and `GET /api/v1/shell` lists it with its rail entry and nav.
3. Its UI is a module (`public/js/module.js`) loaded into the NooblyJS frame. The app has no `index.html`
   of its own. Open a thread in the chat panel on a Home page, then click the app on the rail. The
   page doesn't reload (DevTools → Network shows no document request), the rail and sidebar look
   identical, and the chat thread is still open.
4. Deep links work: open `<mountPath>/<some screen>` directly and refresh. The same screen loads (no 404).
5. Its API answers under `<mountPath>/api/v1/…`, and only when signed in. A Contributor is
   refused where the permissions matrix says so, and the refusal is in the audit log.
6. It uses the host's `serverManager` services: its logs appear in the host's log, and `/services/` lists no duplicate service instances.
7. It writes only under `data/<mountPath>/`. Shared records go through the host (check the folders).
8. Set `enabled: false` in `hosted-apps.yaml` and restart. NooblyJS starts, and the rail item shows "Unavailable".
9. Make `register()` throw (test fixture). NooblyJS still starts and logs the error.
10. Make its `module.js` throw on import (test fixture). Its content area shows an error card with
    **Retry**, and the rail, sidebar, chat and other apps keep working.
11. It shares the page cleanly: every selector in its CSS starts with `[data-module="<name>"]`
    (automated check). Leave a page that's loading or subscribed to events, and its requests and
    subscriptions are aborted (DevTools shows the request cancelled).
12. Where the child has a `server.js`: `npm start` inside its repo runs it **standalone** on its own port, using
    the same `register()` and the same frame from `nooblyjs-core`. A library with no server (Teammates) skips this step.


---

# Phases 0–15

## Phase 0 — Foundations

**Goal:** an empty NooblyJS app that boots, signs you in, writes and reads Markdown files safely, and runs its tests.
**Repos:** `nooblyjs-ai-host`, `nooblyjs-core` (FsStore moves here from `nooblyjs-ai-teammate`).

**Before you start**
- Default port `[CONFIRM]`, and the Node version on dev machines (24 LTS recommended).
- Confirm the seeded people list above.

**Build**
- `package.json`, the composition root `app.js` (exports `createApp()`), `.env.example`, graceful shutdown.
  The current `package.json` was copied from `nooblyjs-ai-knowledge` (CommonJS, Express 4, socket.io,
  passport, helmet, …). Replace it with the `tech.md` §1 baseline: `"type": "module"`, `express@5`,
  `js-yaml` and the `file:../` links.
- FsStore moved into `nooblyjs-core` with its guarantees (atomic writes, locks, path safety, cache).
  `nooblyjs-ai-teammate` switched to the shared copy, and its tests still pass.
- Seed loader (`npm run seed`, `--reset`), with the seeded people and teams only.
- Event log and audit log writers (daily YAML streams), even if only sign-in writes to them for now.
- Dev sign-in with the person picker. `GET /healthz`.
- The **hosted-app loader** (`src/hosted-apps.js` + `data/config/hosted-apps.yaml`), which
  initialises the nooblyjs-core `serverManager` once and calls each app's
  `register(app, serverManager, options)`. It passes `host.frame` (a placeholder page until
  Phase 1) and serves `GET /api/v1/shell` with the registered apps. A **stub app** in
  `test/fixtures/hello-app/` (`index.js` + `public/js/module.js`) mounts at `/hello` to prove the contract.
- `npm test` runs on a temp `DATA_DIR`.

**How you test it**
1. `npm install && npm start`. The log prints the URL and the data folder.
2. Open `/healthz`. You see `{ "status": "ok" }` with the version and data dir.
3. Open the app. You're sent to `/login` and see the five seeded people. Pick **Lerato**.
   You land on a placeholder page that says who you are.
4. Open `data/people/lerato-m/PERSON.md`. It's readable Markdown with front matter.
5. Open today's `data/audit/…yaml`. There's a `session.signed_in` record for Lerato.
6. Stop the app, delete `data/`, and start again. The seed is rewritten.
7. `npm test` is green.
8. Set `NODE_ENV=production NOOBLY_DEV_LOGIN=true` and start. The app **refuses to start** and says why.
9. Enable the stub `hello-app` in `hosted-apps.yaml` and restart. The log says `mounted hello-app at /hello`.
   `/hello/` and `/hello/anything` return the frame placeholder, `/hello/js/module.js` is served,
   `GET /api/v1/shell` lists `hello-app` with its nav, and `/hello/api/v1/ping` answers only when signed in.
10. Make the stub's `register()` throw. NooblyJS still starts and logs which app failed.

**Automated checks:** store (atomic write, lock, path escape refused), seed idempotency, dev-login refusal in production, the hosted-app contract (mount, frame fallback, `/api/v1/shell`, auth, failure isolation).
**Done when:** steps 1–10 pass on a clean clone.
**Guide points:** Is the data layout readable to you? Are the file names what you'd expect?
This is the cheapest moment to change `structure.md` §4 and the
`register()` contract in §2a.

---

## Phase 1 — Shell and design system

**Goal:** the NooblyJS shell matches the mockups, every link goes somewhere, and hosted apps load into it.
**Repos:** `nooblyjs-ai-host`, `nooblyjs-core` (the shared UI kit lives in `nooblyjs-core/public/ui/`).

**Before you start:** font hosting and licence (Lexend, JetBrains Mono).

**Build**
- The **shared UI kit** in `nooblyjs-core/public/ui/`, served at `/ui/` by the host: `tokens.css`,
  `base.css`, `shell.css`, `components.css` from brief §7.
- The **frame** (`structure.md` §2a): `createShell()` in `nooblyjs-core` (the frame page,
  `/api/v1/shell`, `/api/v1/shell/status`), plus `frame.js`, `shell.js` and `router.js`. These
  draw the rail, sidebar, status card and chat dock once, and load app modules into the content
  area with an error card when one fails. They also abort `ctx.signal` when you leave a page.
- Home, Product Factory and Platform as **built-in app modules** (`public/js/modules/`), using
  the same contract as hosted apps.
- Components: Button (4 kinds), StatusPill, StatCard, ListRow, DataTable, Kanban column,
  Timeline row, Meter, ProcessChevron, StageStrip, Swimlane, Checklist.
- `/dev/styleguide` page showing every component in every state.
- Suite rail + module sidebar per module, with the nav from `product.md` §5. Every nav item
  routes to a placeholder page ("Not built yet: Phase N") that names its mockup. Rail links to
  `/factory`, `/teammates` and `/wiki` show "Not installed yet" until their app registers.
- The stub `hello-app`'s module loads into the frame, to prove a hosted app looks identical
  and switching to it is client-side. A second fixture whose module throws proves the error card.
- Docked chat-panel slot (empty), responsive stacking, skip link, focus styles.

**How you test it**
1. Open `/dev/styleguide` next to the mockups (`brief/<screen>/*.dc.html`, served over HTTP).
   Colours, type sizes, radii and spacing match.
2. Click every rail item and every sidebar item in every module. Nothing 404s, and the active
   states are right.
3. Narrow the window to phone width (≈375px). The rail and sidebar stack, there's no
   horizontal scroll, and the controls are still ≥ 44px.
4. Unplug the mouse and tab through a page. The focus is always visible and the order makes sense.
5. Click **Hello** on the rail (stub hosted app). The rail and sidebar are pixel-identical to the
   host's pages, and the page doesn't reload (DevTools → Network shows no document request).
   Refresh on `/hello/` and the same screen loads.
6. Enable the throwing fixture and open it. The content area shows an error card with **Retry**,
   and every other rail item still works.
7. Run `npm run test:e2e`. axe reports **0 AA violations** on every placeholder page.

**Done when:** steps 1–7 pass.
**Guide points:** Does it *feel* like the mockups? Check the visual details now, before
real screens multiply them.

---

## Phase 2 — Lifecycle core: items, approvals, activity

**Goal:** PRD-031 can move through every stage with a person approving each gate, and
every move shows up in Activity and the audit log.
**Repos:** `nooblyjs-ai-workflows` (new, hosted API at `/workflows`), `nooblyjs-ai-host`.

**Before you start**
- Confirm the approval rules table (`product.md` §4) and the readiness checks per stage.
- Confirm SSE + POST instead of WebSockets (`tech.md` §4.2).

**Build**
- `nooblyjs-ai-workflows` with `index.js` → `register()` mounting its API at `/workflows/api/v1` (no UI;
  its screens are the host's Home pages).
- Items, stages, readiness checks (with person override + reason), approvals (rules, target
  times, remind → escalate via nooblyjs-core scheduling), handoffs, send-back.
- Events for every transition, the audit middleware on every write, and the SSE stream.
- Screens: **Overview**, **Lifecycle**, **Approvals** (queue + detail + rules), **Activity**
  (filters, Live now, Today so far).
- Seed: the 7 items from the Lifecycle mockup, the 4 approvals waiting on Stevie, and the Activity history.

**How you test it**
1. Sign in as **Stevie**. Overview shows 12 in flight (the seed has 12 items; the mockup's 14 is sample
   data), the stage strip counts and 4 waiting on you.
2. Open **Approvals → PRD-031**. Readiness says **6 of 7 · Rollout plan missing**, and
   Lerato is shown as approved.
3. Try **Approve & send to Architecture**. It's refused because readiness isn't met. Use
   override, enter a reason, and approve. The item moves to Architect.
4. In a second browser as **Lerato**, the Activity page shows Stevie's approval appear
   **without refreshing**.
5. Open `data/workflows/items/PRD-031.md` (the stage changed) and today's audit file (the
   approval and override are recorded with the reason).
6. Sign in as **Priya** (Contributor) and try to approve the ADR. You get a clear "you can't
   approve this" and an audit entry for the refusal.
7. Use the dev clock (`/dev/clock`) to move forward 2 working days (on a weekday). **ADR-015** shows a
   reminder sent and no escalation, because the ADR rule is "Remind". **PRD-029**'s spec approval (rule:
   "Remind, then escalate") shows a reminder, then an escalation to the Owner. Lifecycle marks both
   "waiting too long". (This step first said ADR-014 escalates, which the rules table doesn't allow, and
   ADR-014 is on PRD-031, which step 3 has already moved.)
8. Send PRD-027 back to Specify with a reason. Lifecycle shows it back in Specify, and
   "Sent back for changes" goes up by 1.

**Done when:** steps 1–8 pass, every number on the 4 screens comes from files and events (no
hard-coding), and `nooblyjs-ai-workflows` passes the **hosted-app checklist** (all steps).
**Guide points:** Are the approval rules and readiness checks the ones you want? Is the
Activity wording right?

---

## Phase 3 — People, onboarding and "For you" homes

**Goal:** a new person is guided to their role, teams and first tasks, and every role lands on a home built for them.
**Repos:** `nooblyjs-ai-host`.

**Before you start**
- The job title → work role mapping (`data/access/job-title-roles.yaml`).
- What Designer, Engineering lead and Platform engineer land on for now (`product.md` §12 Q12).

**Build**
- **Teams & roles**: team cards, permissions matrix (read from `roles.yaml`), members table,
  Invite a person.
- Profiles (`/api/v1/me/profile`), **4-step onboarding**, Change role.
- **For you** homes for Product manager, Architect and Developer (tiles, filter row, panels,
  Show everything). The Getting started card and the **Your first week** checklist complete from events.
- Overview stays available for everyone.

**How you test it**
1. Sign in as **Naledi** (new joiner). You go straight to onboarding, and **Product manager**
   is pre-selected because of the job title.
2. Step through: the tasks and agents shown match the PM card. Pick **Delivery squad**,
   turn on "Send approvals to me in Teams" (stored only for now), and finish with **Open my home**.
3. The PM home greets her by the time of day ("Good morning, Naledi"). The filter row shows "My items ·
   Delivery squad". **Show everything** widens the counts. The sidebar says **Getting started · 1 of 4**.
4. Click **Skip for now** as someone with no profile (after a fresh reset, or a person you invite from
   Teams & roles). You land on a home with a Getting started card, and onboarding is offered again.
5. Sign in as **Lerato** (PM). Her home leads with what waits on her (PRD-029 to review, PRD-032 to
   preview, a Nudge for the lockers). Her first week is already at **2 of 4**, because the seed story has
   her approving PRD-031 that morning. (This step first had her approve PRD-031 here; step 6 now shows a
   task ticking live.)
6. Sign in as **Thabo**. The Architect home shows ADR-014 and ADR-015 with Accept / Discuss. The
   "standards broken on PRs" and "models to review" panels are there and name the phase that fills them
   (7 and 8). Click **Accept** on ADR-014: "Decide on ADR-014" ticks in Your first week and the Getting
   started card goes to 2 of 4, without refreshing.
7. Sign in as **Priya**. The Developer home shows her pull requests (the seed has 2 in flight). The
   "Runs on your repos" and "A run is asking you" panels say they arrive with the Software Factory
   (Phase 7, which lists them in its build).
8. As Priya, **Change role** to Architect. The home changes, but approving ADR-014 is **still
   refused**, because the work role does not grant permissions.

**Done when:** steps 1–8 pass at desktop and phone width.
**Guide points:** Is each home leading with the right thing? Is the onboarding copy right?
Decide whether to commission the missing three "For you" designs.

---

## Phase 4 — Team chat

**Goal:** people and agents talk in a thread next to the work, and agents can't take decisions there.
**Repos:** `nooblyjs-ai-host` (chat), `nooblyjs-ai-workflows` (item edits from threads).

**Before you start**
- Ask design for the chat-panel export (the brief describes it, but no mockup file exists).
- Is Teams-channel mirroring in scope (`product.md` §12 Q10)?

**Build**
- Threads per item, repo and channel. Messages as daily YAML streams, @mentions, and SSE delivery.
- Agent replies through a `chat.reply` task, using the **mock provider with scripted answers**
  (real models arrive in Phase 6). "Working…" state, cards (plan, comparison, PR link,
  facts), citations, system lines, quick-action chips.
- **Approval cards** answered only by the right access role. Agents are always refused.
- The panel appears on Spec, Architecture and Repositories, and on any item page.

**How you test it**
1. As **Lerato**, open PRD-031 and type `@Ada draft a rollout plan`. "Ada is working…"
   appears, then a reply with a **plan card** and citations.
2. In a second browser as **Thabo**, the message and reply appear live in the same thread.
3. Lerato clicks **Apply to spec**. A system line says **"spec v5"**, the spec now has a
   rollout plan, and readiness shows **7 of 7**. (Do this on a fresh seed, before approving PRD-031 in
   Approvals: an approved spec can't be edited.)
4. Ask `@Rhea can we hit 300 ms without Redis?` on the Architecture page. Rhea replies with a
   **comparison card** (Redis vs replica).
5. Rhea posts an approval card asking for read access to `delivery-planner`. **Priya**
   can't answer it, and **Stevie** (Owner) can. The decision appears in Activity and the audit log.
   (The access itself takes effect when Platform manages repositories, in Phase 9.)
6. Click **Summarise thread**. You get a summary message with what changed.
7. Open `data/chat/messages/thr_PRD-031/<today>.yaml`. Every message is there, with author, mentions and cost.

**Done when:** steps 1–7 pass, and no agent action in chat can change a status or approve anything (there's a test for each).
**Guide points:** Does the agent voice and card design work? What quick actions are missing?

---

## Phase 5 — Product Factory

**Goal:** PRD-031 goes from signal to **Send to Software Factory**, with agents drafting and a person approving each gate.
**Repos:** `nooblyjs-ai-host` (screens), `nooblyjs-ai-product` (new, hosted API at `/product`: artefacts and drafting agents), `nooblyjs-ai-workflows` (stage orchestration).

**Before you start**
- Diagram-as-code format (`product.md` §12 Q7).
- Is the Product Factory numbering (Stage 1–4) what you want shown?

**Build**
- **Product board** (signals → ideas with RICE → spec drafting → in review → to
  architecture, filters, top signals, Q4 roadmap), **Spec detail**, **Architecture**
  (diagram as code, ADRs with Accept/Discuss, standards check, quality attributes), **UX
  Design** (journey, flow, research, open questions), **UI Design** (screen gallery,
  design-system reuse, accessibility checks, handoff preview).
- `nooblyjs-ai-product` with `index.js` → `register()` mounting its screens (a UI module in the frame, like
  Teammates) and its API at `/product/api/v1`. It owns `data/product/` and seeds the
  PRD-031 artefacts.
- Per-stage "ask the agent to draft" (mock/scripted until Phase 6), run by `nooblyjs-ai-product`.
- The **handoff** creates work items as files (`data/workflows/handoffs/…`). Jira is read in Phase 11 and written in Phase 13.

**How you test it**
1. As **Lerato**, on the Product board, turn the "Substitutions feel random" signal into an
   idea and score it (RICE). It appears in Ideas.
2. Ask Ada to draft a spec for it. It moves to Spec drafting with progress, then to In review.
3. Walk PRD-031: ask Ada to draft the rollout plan (approval is refused while readiness is 6 of 7), then
   approve the spec → Architecture shows the container view. **Edit as code**,
   change a label, save, and the diagram updates.
4. As **Thabo**, accept ADR-014. The quality attributes table becomes the item's gate list (visible on the item).
5. Open UX Design and UI Design. Screens show their status, and the accessibility checks list
   the failing "Timer needs a screen-reader label".
6. As the Design lead, click **Send to Software Factory**. **6 work items** across 4 repos (the mockup
   says 3, but the six items span four)
   are created, with the estimate $18–$26, and the item moves to Build.

**Done when:** steps 1–6 pass, every screen matches its mockup, and `nooblyjs-ai-product` passes the
**hosted-app checklist** (all steps).
**Guide points:** Are the artifacts the right shape for your teams? Is anything missing from the handoff?

---

## Phase 6 — Digital Teammates everywhere (and the Teams simulator)

> **Started early (2026-10-09):** Teammates is already hosted in the frame, as the pattern for Factory
> and Knowledge (`.claude/guides/porting-an-app.md`). Its rail item, nav, status card, UI module (old pages through
> a bridge), scoped CSS, NooblyJS permissions, CSRF and audit pass checklist steps 1–5, 7 and 10–11 (tests in
> `test/teammates.test.js` and `test/e2e/shell.spec.js`). Still open for this phase: moving its own EventSource to
> `ctx.sse`, checklist steps 6, 8 and 9 (step 12 doesn't apply: Teammates is a library with no `server.js`),
> porting pages to kit components, and everything else below.
>
> **Started 2026-10-10.** Spec: `.claude/specs/phase-06-digital-teammates/`.

**Goal:** teammates from `nooblyjs-ai-teammate` do the real drafting and chatting, and every action shows the teammate, time and cost.
**Repos:** `nooblyjs-ai-teammate`, `nooblyjs-core` (the UI kit, and its AI module in `src/aiservice/common`), `nooblyjs-ai-product`, `nooblyjs-ai-host`.
`nooblyjs-ai-harness` is not adopted in this phase: teammate tasks keep the loop Teammates has, and sandboxed
runs arrive with Phase 7 `[CONFIRM]`.

**Before you start** (answered 2026-10-10)
- Model provider for dev and test (`product.md` §12 Q4): **the Anthropic API, in development only**. The mock
  stays the default. Bedrock, Vertex and Azure are still open.
- Teammate identity in Teams (`tech.md` §7.3): **one NooblyJS bot** with teammate-branded cards.
- Rhea Voss joins the Teammates seed as a **ninth** teammate, so the roster says nine where the mockup says eight.
- Meetings (`product.md` §12 Q10): anyone with `draft` may add a teammate. The meeting's team is billed, else
  the first team of the person who added them.

**Build**
- ~~Give `nooblyjs-ai-teammate` an `index.js` → `register()` at `/teammates`, with its UI as a module in the
  frame~~ (done early).
- `register()` returns **`services`** (`roster`, `get`, `availability`, `runTask`), the only way other apps
  ask a teammate to work.
- Restyle **Team roster** and the other Teammates screens with the shared UI kit, with its CSS
  scoped under `[data-module="teammates"]`. Its own copies of the CSS and JS helpers are removed.
- Replace the scripted chat and drafting answers with real teammate tasks (when a provider is
  configured). Cost goes to timesheets and team billing.
- **Teams bot flows in the simulator** (`/dev/teams`): asks who to add → teammate joins →
  answers with an Adaptive Card. MeetingSession with `joinedAt` and the billed team.

**How you test it**
1. Click **Teammates** on the rail. You're on `/teammates/team`, rendered by the hosted app's module without a page reload,
   and it matches the mockup (9 teammates with Rhea Voss, where the mockup has 8; filters, budget card).
2. With a provider configured, ask Ada in the PRD-031 thread a new question. It's a real
   answer, and the roster shows her billed hours go up. The billing screen shows the cost against Delivery squad.
3. Pause **Sable Reyes**. Mentioning @Sable gets a clear "paused" reply, and nothing is billed.
4. Open `/dev/teams`, the "Slot rollout sync" meeting chat. Type `@NooblyJS`. The **pick a teammate**
   card lists available teammates with role, status and rate.
5. Click **Add** on Ada. You see the "joined" line, her intro, and the "billed to Delivery squad" note.
6. As Lerato in the simulator, ask `@Ada what's still blocking the slot pilot?`. You get an
   answer card (stage, readiness, waiting on, pilot stores), **Open in NooblyJS**, sources and the
   cost. **Ask Thabo to decide** opens NooblyJS and doesn't decide in chat.
7. A message sent in the simulator *before* Ada joined is not in her context (check her answer
   and the session file).
8. **Choose someone else** swaps Ada for Rhea.

**Done when:** steps 1–8 pass, with no provider configured everything still works on scripted
answers, and `nooblyjs-ai-teammate` passes the **hosted-app checklist**.
**Guide points:** Are teammate personalities, rates and answers right? Are you happy with the bot's identity approach before going near a real tenant?

---

## Phase 7 — Software Factory integration

**Goal:** a handoff produces Factory runs and PRs, gates use the item's quality attributes, and stuck runs ask a developer.
**Repos:** `nooblyjs-ai-factory`, `nooblyjs-ai-harness`, `nooblyjs-ai-host`.

> **Approved 2026-10-10.** Spec: `.claude/specs/phase-07-software-factory/`. Summary:
> `.claude/phases/phase-07-summary.md`. Steps 1–5 pass offline; the one run with a real model stopped at triage
> ("Needs information"), so "once with a real model" is still open. The test script runs on the seeded **PRD-028** handoff (six work items, four
> repositories): the demo repository stands in for `web-storefront`, so two work items become runs and four wait
> for a repository.

**Before you start** (answered 2026-10-10)
- Runs work on **a local demo repo** under `data/factory/repos/`, made by a Node script. Real Bitbucket repositories are read in Phase 11; opening PRs on one waits for Phase 13.
- The event log moves to daily YAML streams **first**, before the integration work.
- Runs execute **inside the NooblyJS process** for now. Separate workers come later.
- Unsandboxed commands are allowed **in development only**, and refused in production.

**Build**
- Give `nooblyjs-ai-factory` an `index.js` → `register()` that attaches it at **`/factory`**, with
  its UI as a module (`public/js/module.js`) loaded into the NooblyJS frame. Its event log is daily YAML streams under
  `data/factory/events/` (SQLite is gone), and its scheduler runs in the NooblyJS process. Line, Runs, Inbox, Campaigns
  and **Metrics** use the UI kit's page head, status pills, stat cards and notices.
- Work items from the handoff become factory issues, for the repositories named in `data/factory/repos.yaml`.
  A quality attribute is a gate's when its "verified by" names a gate the repository declares; the rest are
  listed on the PR as "not checked by a gate". Runs, PRs and gate results report back to the item.
- "Run asking you" questions show on the Developer home and in the item thread.
- The `merge` station **refuses** when hosted, and a configured agent merge (autonomy L3) is refused and audited.
  Merging is a person's action (governance).

**How you test it**
1. Hand off a small item to the demo repo. Runs appear on the Line and on **Priya's** home.
2. A run finishes and a PR file appears with its evidence, gates, cost and source spec.
3. Force a gate to fail twice. The run asks Priya a question. She answers on her home and the run continues.
4. Try to configure an agent merge. It's refused and audited.
5. Factory **Metrics** shows the runs, the median times and the cost. The empty state shows on a fresh reset.

**Done when:** steps 1–5 pass offline (scripted agent), and once with a real model, and
`nooblyjs-ai-factory` passes the **hosted-app checklist** (e.g. open `/factory/runs/<id>` directly).
**Guide points:** Is the PR evidence enough for a reviewer? What should a stuck run ask?

---

## Phase 8 — Knowledge Repository

**Goal:** one searchable, cited memory that agents use when they draft, with the L0 process model rendered from imported data.
**Repos:** `nooblyjs-ai-knowledge`, `nooblyjs-ai-host`, `nooblyjs-ai-product`.

> **Done 2026-10-10** (signed off as built, with the summary's decisions accepted). Spec: `.claude/specs/phase-08-knowledge-repository/`. Summary:
> `.claude/phases/phase-08-summary.md`. `nooblyjs-ai-knowledge` is the existing Wiki Platform, hosted at **`/wiki`**;
> this phase extended its own modules instead of building the screens listed below from scratch.

**Before you start** (answered 2026-10-10)
- The phase's features are built **in the wiki's own modules**, and the app stays at **`/wiki`**.
- The content is **a sample export** for the PRD-031 story, with `[PLACEHOLDER]` process-model codes. Real data
  comes later through the same folder format.
- Search **already works and is not changed**: no semantic search, no new index.

**Build**
- `nooblyjs-ai-knowledge` (the Wiki Platform) hosted at **`/wiki`** through its `register()` (`index.mjs`), its UI
  generated into the NooblyJS frame. New in this phase: **Sources** and **Needs review** screens beside Spaces, and
  asking in its AI panel. Collections, Graph, Contributions and Access from the mockup are not built.
- Spaces and sources (a wiki export folder; connectors come later). Import with **PII redaction** (email
  addresses, phone numbers, ID numbers), **cited answers** that work with no model configured (Add to item,
  Save as page, This is wrong), and **Needs review** fed by "This is wrong". Freshness rules are not built.
- The **L0 Enterprise Process Model**, drawn from a `process-model` block in each model page (bands, chevrons,
  drill-down to L1/L2) with **Used across NooblyJS**. Ask about this model and Rebuild context are not built; Pin,
  Share and Subscribe are the wiki's own.
- A Product Factory draft gets relevant knowledge as context (`host.service('knowledge').contextFor()`), keeps
  it as its sources and links it to the spec. Chat and Teams answers do not use Knowledge yet.

**How you test it**
1. Import the sample wiki export. The Sources page shows the sync status and document counts.
2. Ask "How is slot capacity calculated?". You get an answer with 3 citations. **Add to
   PRD-031** puts it in the spec's linked knowledge.
3. Click **This is wrong** on an answer. It's recorded and the document gets a review flag.
4. Open Enterprise Space → Business processes → L0 Enterprise Process Model. The three bands render from the imported files. Click **Supply**
   to drill down. "Used across NooblyJS" lists PRD-031 and ADR-014.
5. Ingest a document with a phone number and an email address. The stored file has them **redacted**.
6. Ask Ada to draft a spec. The draft cites knowledge documents.

**Done when:** steps 1–6 pass, and `nooblyjs-ai-knowledge` passes the **hosted-app checklist**
(e.g. open `/wiki/#/Enterprise%20Space/Business%20processes/L0%20Enterprise%20Process%20Model.md` directly).
**Guide points:** Is the answer quality good enough? Which sources come next?

---

## Phase 9 — Platform and governance

**Goal:** repos, sandboxes, models, budgets and guardrails are managed in one place, and changes affect agents immediately.
**Repos:** `nooblyjs-ai-host`, `nooblyjs-ai-common` (Bedrock / Vertex / Azure adapters), `nooblyjs-ai-harness`, `nooblyjs-core`.

**Before you start** (answered 2026-10-10)
- Hosting target and container runtime (`product.md` §12 Q3): **still undecided.** Containers are built over a
  **simulated runtime** behind an interface; AKS / EKS / GKE stays `[PLACEHOLDER]`.
- Provider (Q4): **still undecided.** All three adapters (**Bedrock, Vertex, Azure**) are built in `nooblyjs-ai-common`
  and each model route names its provider. Development and test stay on the Anthropic API, refused in production.

> **Done 2026-10-10** (signed off as built). Spec: `.claude/specs/phase-09-platform-governance/`. Summary:
> `.claude/phases/phase-09-summary.md`. Infrastructure (`nooblyjs-ai-infrastructure`) owns environments and previews and
> joins NooblyJS next; Platform · Environments is a read-only summary.

**Build**
- **Repositories** (agent access, build/test/image, permission toggles, mapped secrets as
  references). **Containers** (pools, running, logs/stop, base images + CVE status, Stop all).
  **Settings** (model routing, budgets with pause-on-limit, guardrails with history,
  integrations). Plus Environments, Secrets, Members and **Audit log** screens.
- Model routing through the approved provider adapters. Direct consumer APIs are blocked in production.

**How you test it**
1. Set `payments-gateway` to "No agent access". Asking a teammate to read it is refused, and the refusal is audited.
2. Lower the Product Factory budget below today's spend. Agents pause, `budget.reached` shows in
   Activity, and new drafting requests say why they're paused.
3. Turn off "Redact personal data on ingest". It needs an Owner and a reason, and it shows in policy history and the audit log.
4. Change the route for "Specs, architecture, review" to Sonnet. The next drafting call uses it (visible in the event's `modelRoute`).
5. Click **Stop all containers**. Every running workload stops and the tiles show 0 running.
6. The audit log screen filters by actor, action and date, and matches the files.

**Done when:** steps 1–6 pass, and a guardrail or budget change takes effect without a restart.
**Guide points:** Are the default guardrails right? Who should be allowed to change them?

---

## Phase 9a — Infrastructure joins NooblyJS

**Goal:** NooblyJS Infrastructure (designs → environments → provisioning runs → drift → cloud cost) is on the rail,
passes the hosted-app checklist, and works with Home, Platform and the lifecycle engine.
**Repos:** `nooblyjs-ai-infrastructure`, `nooblyjs-ai-host` (with its lifecycle engine).

> Added 2026-10-10 at Stevie's request, between Phases 9 and 10 (so the later phases keep their numbers). Spec:
> `.claude/specs/phase-09a-infrastructure/`. **Done 2026-10-10** (signed off as built): summary in
> `.claude/phases/phase-09a-summary.md`. The app already ran standalone with nine screens and a mock
> provisioner; this phase is its own roadmap's **I6** plus the open items of **I3–I5** that need no cloud decision.

**Before you start** (answered 2026-10-10)
- Scope: I6 + the open I3–I5 items. Not the drafting agent (I7), previews from PRs (I8), a real provisioner (I9,
  blocked on cloud, region and IaC tool) or releases (I10).
- **Infrastructure owns environments and previews**; Platform · Environments lists them and links there.

**Build**
- Hosted at `/infrastructure`, rail label **Infra** between Factory and Teammates; the hosted-app checklist.
- An `infra-design` approval type in the lifecycle engine: a design waiting for approval shows on Home · Approvals,
  and deciding it there or on the Design screen is the same decision. No new lifecycle stage.
- A **Cloud (Infrastructure)** budget in Platform · Settings; new provisioning pauses at it.
- A drift sweep every 6 business hours; cancel a run; destroy an environment; live progress from the event
  stream; a run detail page with its log.
- Platform · Environments and the Preview environments pool show Infrastructure's environments.

**How you test it**
1. **Infra** is on the rail between Factory and Teammates, with "1 drift detected". Opening it doesn't reload the page.
2. Home · Approvals shows INF-031 · Approve & provision Test. Priya is refused (audited); Stevie approves it there,
   and a run for `test-slots` starts.
3. Provisioning runs move with no refresh. The run's page shows the plan, who approved and its log.
4. Lower the Cloud budget below this month's cloud spend: **New environment** is refused with the reason, and
   Activity shows `budget.reached`.
5. Move the dev clock 6 hours: the drift sweep ran (Activity). Restore `dev-slots` from its design.
6. Cancel a queued run and destroy `pr-485`: both audited, and `pr-485` leaves Platform · Environments and the pool.
7. Platform · Environments lists Infrastructure's environments, each linking to it.

**Done when:** steps 1–7 pass, and `nooblyjs-ai-infrastructure` passes the **hosted-app checklist**.
**Guide points:** Is an infrastructure design an artefact with its own approval, or should it be a lifecycle stage?
Who is the "platform owner" who approves designs?

---

## Phase 10 — Metrics

**Goal:** Home Metrics tells you how fast ideas become merged code, what it costs, and who does the work, and it reconciles with the event log.
**Repos:** `nooblyjs-ai-host`.

> **Done 2026-10-10** (signed off as built). Spec: `.claude/specs/phase-10-metrics/`; summary and the decisions to
> confirm: `.claude/phases/phase-10-summary.md`. Steps 1 to 4 pass. nooblyjs-core's measuring service is not used (it
> keeps counters in memory; these numbers are regenerable from the event files). The seed writes a sample history
> of events from which the mockup's numbers are computed.

**Build:** idea → merge, PRs merged, first-pass gates, human edits, cost per merged PR, lead
time by stage per week, spend by system, agent vs people share with median, p90 and
sent-back rate. Daily roll-ups are regenerable.

**How you test it**
1. Open Metrics (30 days) on the seeded data. The numbers match the mockup story.
2. Run `npm run metrics:reconcile`. Every tile is recomputed from raw events with **0 differences**.
3. Approve something and send something back. The relevant numbers move on refresh.
4. Delete `data/metrics/rollups/` and reload. The numbers are identical.

**Done when:** steps 1–4 pass.
**Guide points:** Which metric will you actually manage by? Are any missing?

---

## Phase 11 — Development tools: Bitbucket and Jira, read-only

**Goal:** NooblyJS reads the tools teams already work in. Platform's repositories are real Bitbucket repositories, a
product and an initiative say which repositories and which Jira project they use, and people and agents see Jira
issues, branches, commits and pull requests next to the item. **Nothing is written to Bitbucket or Jira.**
**Repos:** `nooblyjs-ai-host`, `nooblyjs-ai-product`, `nooblyjs-ai-factory`, `nooblyjs-ai-harness` (the first repository connected).

> Added 2026-10-10 at Stevie's request, ahead of the Teams bot (which moves to Phase 12). Bitbucket replaces GitHub
> everywhere in NooblyJS: the company's source control is Bitbucket Cloud (workspace `acme`). Jira and Bitbucket
> are production systems, so this phase is read-only by construction; writing is Phase 13. **Done 2026-10-10**
> (signed off as built): summary in `.claude/phases/phase-11-summary.md`. Spec:
> `.claude/specs/phase-11-development-tools/`.

**Before you start:** read-only API tokens for Jira and Bitbucket (the first ones could write; see the spec), and
the first slice: the repository `nooblyjs-ai-harness`, then Digital Commerce.

**Build**
- One connector for each tool in `nooblyjs-ai-host` (`host.service('devtools')`), which can only send GET requests. Tokens stay
  in `.env`; Platform · Settings · Integrations shows what each one can read.
- **Platform · Repositories** lists real Bitbucket repositories (imported by workspace project, starting with
  `nooblyjs-ai-harness`), with branch, last commit and open pull requests. Agent access stays NooblyJS's own record.
- **Where an initiative's repositories are set:** a product has default repositories and a Jira project; an item's
  Architecture confirms or narrows them; the handoff and the Software Factory use exactly that list.
- **Jira, read:** search and link issues to an idea, a spec or a work item; an item shows its linked issues
  with status, assignee and sprint; the Software Factory reads Stories, Tasks and Defects for its work items.
- Agents get the same reads as tools (search issues, read an issue, read a file, list pull requests), checked by
  Platform's repository access and audited like every agent action.

**How you test it**
1. Platform · Settings · Integrations shows Jira and Bitbucket connected, with the account and what it can read.
2. Platform · Repositories lists `nooblyjs-ai-harness` from Bitbucket with its main branch and last commit.
3. Give the product "Delivery" a Jira project and a repository; a new idea in it starts with both.
4. In Architecture, narrow the item's repositories; the handoff shows exactly those.
5. Link a Jira issue to an item; its status and assignee show on the item and change when it changes in Jira.
6. Ask a teammate in chat "what is open in Jira for this item?"; the answer cites the issues, and the read is in the audit log.
7. Try to make the connector send anything but a GET (a test does this): it is refused before any request leaves NooblyJS.

**Done when:** steps 1–7 pass, and the Jira and Bitbucket audit logs show no write by NooblyJS.
**Guide points:** Is the linking the right way round (NooblyJS points at Jira)? Which writes do you want first in Phase 13?

---

## Phase 12 — Microsoft 365: SSO, notifications, the real Teams bot

**Goal:** people sign in with Microsoft, get approvals in Teams and Outlook, and can bring teammates into real Teams meetings.
**Repos:** `nooblyjs-ai-host`, `nooblyjs-core` (the Entra sign-in reads the job title).

> **Built 2026-10-11, reviewed 2026-10-20.** Spec: `.claude/specs/phase-12-microsoft-365/`; summary:
> `.claude/phases/phase-12-summary.md`. Steps 1–6 pass offline (a test signing key plays the Bot Framework) and steps
> 3–5 in the Agents Playground; the tenant run waits for the bot's registration.

**Before you start:** the Entra app registrations (SSO + bot), the tenant for sideloading, and
who may add teammates to meetings (`product.md` §12 Q10).

**Build**
- Entra ID OIDC sign-in, with the job title from Graph feeding onboarding. Dev login stays dev-only.
- Teams and Outlook notifications for approvals, with deep links. Approve-from-Teams cards open NooblyJS.
- The real Teams bot on `/api/teams/messages` with JWT verification, the same flows as the
  simulator, and meeting notes posted back to the item on request.

**How you test it**
1. Sign in with your Microsoft account. Onboarding pre-selects the role from your real job title.
2. Request an approval from you. A Teams message and an Outlook email arrive, and the link opens the right approval.
3. Sideload the NooblyJS app into a test meeting chat and @mention it. You get the same pick-a-teammate card as the simulator.
4. Add Ada, ask her a question, and get an answer card with sources and cost. The message is in the item's Activity and the audit log.
5. Ask "post meeting notes to PRD-031". A notes entry appears on the item.
6. Send a request with a forged token to `/api/teams/messages`. You get **401**, and it's logged.

**Done when:** steps 1–6 pass in the test tenant.
**Guide points:** Is the Teams experience something people will use? Plan the rollout.

---

## Phase 13 — Writing to Bitbucket and Jira and production readiness

**Goal:** NooblyJS syncs with the systems teams already use and is ready for a pilot squad.
**Repos:** all.

> **Built 2026-10-11, reviewed 2026-10-20.** Spec: `.claude/specs/phase-13-writing-and-readiness/`; summary:
> `.claude/phases/phase-13-summary.md`. Steps 1 and 2 pass offline against a fake Jira and Bitbucket; steps 3 and 4 pass
> for real on this machine. **Nothing has been written to the real Jira or Bitbucket**: NooblyJS records writes until a
> deployment, an Owner and a write token allow them. The run against real systems and the pilot's sign-off are open.
> Targetprocess was removed from scope on 2026-10-11.

**Before you start:** the sync direction and source of truth for Jira  (`product.md` §12 Q6), and the pilot squad and date.

**Build**
- Bitbucket: the Software Factory opens pull requests on real repositories, with checks (Pipelines) and default
  reviewers. Agents still never merge. Jira two-way work-item sync, each kind of write with its own approval rule.
- Hardening: security review, backup and restore of `data/`, a performance check on
  realistic file counts, and runbooks.

**How you test it**
1. A handoff creates Jira issues, and moving one in Jira updates the item in NooblyJS (and the reverse).
2. A PR opened by the factory on a real repo shows its checks and reviewers, and merging it in Bitbucket moves the item to Ship.
3. Restore `data/` from last night's backup into a fresh install. Everything is back, and the audit log is intact.
4. Load 10× the seed volume. The key pages load in under 1 s `[CONFIRM target]`.

**Done when:** steps 1–4 pass and the pilot squad signs off.
**Guide points:** Go or no-go for the pilot.

---

## Phase 14 — NooblyJS in the browser: the Edge extension

**Goal:** a person on a Jira issue asks a NooblyJS teammate about it in Edge's side panel, and gets drafts (description,
acceptance criteria, sub-tasks, comments) that they put into Jira themselves and save. `product.md` §5.11, `tech.md` §7.4.
**Repos:** `nooblyjs-ai-host` (`apps/edge` and the extension's API). **Depends on:** Phase 4 (team chat), 6
(teammates), 11 (reading Jira, issue links) and 12 (Entra sign-in). It does not need Phase 13: the extension never
writes to Jira itself, so it can come before it `[CONFIRM order]`.

**Reviewed 2026-10-20 as the skeleton below; the Build list is not built yet.** **Already there (skeleton, 2026-10-11):** the side panel, signing in from the NooblyJS session (`/api/v1/shell`), the
NooblyJS status check, the Jira issue reader, settings, icons, `npm run test:edge`.

**Before you start:** `product.md` §12 Q14 (is "Put in the field" the person's write?), which draft kinds come
first, and how it is installed (Edge policy or opt-in). Register the extension id that NooblyJS accepts.

**Build**
- `POST /api/v1/extension/token`: a short-lived token from the NooblyJS session, for allowed extension ids only, scoped to
  the extension's routes. Audited (`extension.signed_in`).
- `GET /api/v1/extension/context?jira=DTE-412`: the linked NooblyJS item, its thread, and what a teammate would be given
  (through `devtools`, read only).
- The chat in the panel on the item's thread (or the issue's own), with the same teammates, answers, sources and
  cost as team chat. Page text is redacted before it reaches a model.
- Drafts: description, acceptance criteria, sub-tasks, comment, bug report, as teammate tasks by work type
  (`jira-drafting`), each billed to the person's team.
- **Put in the field** (content script): places the reviewed draft in Jira's editor for that field and records
  `extension.draft_inserted` (issue, field, item, teammate, cost). It never presses Save, Create or Transition.
- **Link to item** and **Save to Knowledge** from the panel.
- Edge Add-ons packaging, or an internal policy install `[CONFIRM]`.

**How you test it**
1. Signed in to NooblyJS in Edge, open the panel: it says who you are with no sign-in of its own. Signed out, **Sign in
   to NooblyJS** opens NooblyJS; back in the panel, it shows your name.
2. On DTE-412 (linked to PRD-031), the panel shows the issue and "part of PRD-031". Ask "@Ada what is blocking
   this?": an answer with sources and cost, also in PRD-031's thread and Activity.
3. Ask for acceptance criteria, edit them, press **Put in the field**: the text is in Jira's editor, not saved.
   Press Jira's Save: Jira's history shows you as the author. NooblyJS's audit log has `extension.draft_inserted`.
4. As a Viewer: the chat answers, but drafting is refused (`draft` permission), and the refusal is audited.
5. A request with no session, or from another extension id, to the extension's API gets **401**, and it is logged.
6. Nothing in the extension calls a Jira API or presses a Jira button (`test/edge-extension.test.js`, and a check of
   the network log during step 3).

**Done when:** steps 1–6 pass in Edge against your Jira site.
**Guide points:** Which pages next (Bitbucket pull requests, Confluence, SharePoint)?

---

## Phase 15 — No mocks: everything real

**Goal:** nothing in NooblyJS pretends. Every number is measured, every agent answer comes from a model, every
environment and container exists, and a new installation starts empty and is filled by people using it.
**Repos:** all. **The list:** `.claude/audits/mocking-audit.md` (2026-10-11), items A1–A11 (mock or simulated behaviour) and
B1–B12 (static data shown as real).

**Already there (2026-10-11):** `npm run seed:blank` makes a data folder with the system files and no sample
content, and NooblyJS and every app start on it (`test/blank.test.js`). The sample story stays for demos and tests.

**Before you start:** these decide what "real" is, and most of the phase waits on them: which cloud hosts the
models (`product.md` §12 Q4); the hosting target and container runtime (Q3); the cloud, region and
infrastructure-as-code tool (Infrastructure I9); the image registry and the secret store; Acme Retail's real
architecture standards, budgets and teammate rates.

**Build** (each item removes a line from the audit)
- **Models (A1, A2):** one cloud provider proven with a live test. With no model, an agent says it cannot answer:
  no script is played outside tests, and nothing is posted or billed. The direct Anthropic API leaves the default path.
- **Who does what (B3, B4, B5):** which hired teammate drafts specs, architecture, UX, UI and infrastructure is a
  setting, not a name in code. Onboarding names the teammates and tools that exist here; first-week tasks come
  from what is really waiting.
- **The wiki's agents (A6)** and **the Infrastructure agent (A5)** run as teammate tasks.
- **Containers and sandboxes (A3, A8, B1, B2, B11):** a real runtime adapter; runs in containers on the
  repository's base image; base images and CVEs from the registry; pool limits that hold.
- **Infrastructure (A4):** a real provisioner, real drift detection, cost from the cloud's billing data.
- **Secrets (A7):** a secret store resolves a reference for a run; agents and previews get staging values only.
- **Real settings (B6, B7, B8, B9):** the standards, readiness checks, budgets, rates and company facts are
  Acme Retail's, entered in the app; every `[PLACEHOLDER]` is gone.
- **Loose ends (B10):** a tile with no source is wired or removed.
- **Outside systems (A9, A10, A11):** the Phase 12 and 13 test scripts run against the tenant, a test Jira project
  and a scratch repository.
- **Guard:** a test that fails when production code plays a script, reads a `sampleData` file, or shows the word
  "simulated"; and a check that the development tools (`/dev/…`, the person picker) are refused in production.

**How you test it**
1. `npm run seed:blank -- --owner you@…`, start NooblyJS with `NODE_ENV=production` and real providers. Sign in; every
   page is empty and says what to do first. Nothing says "simulated", "sample" or "[PLACEHOLDER]".
2. Create a team, connect a repository, hire a teammate, and take one item from a signal to a merged pull request.
   Every agent step is a real model call with a real cost; the run is a real container; the preview environment
   exists in the cloud and its cost appears from billing.
3. Remove the model credentials: asking an agent gets "no model is configured", and no scripted answer.
4. `grep` of the audit's file list finds no mock on a production path; the guard test passes.
5. Home · Metrics shows only what happened in steps 1–4.

**Done when:** steps 1–5 pass and `.claude/audits/mocking-audit.md` has no open item (or each one left is a decision you took).
**Guide points:** which mocks stay on purpose (the offline test doubles; Record only as the default for writes)?


---

# Phases 16–23: the whole SDLC

## Phase 16a — Nine stages

> **Built 2026-10-19, waiting for review.** Spec: `nooblyjs-ai-host/.claude/specs/phase-16a-nine-stages/`. Summary:
> `nooblyjs-ai-host/.claude/phases/phase-16a-summary.md`. Phase 16 was split in two: the stages here, the checks and the
> trace in 16b (now 16f, after the lifecycle v3 phases 16b–16e), so the small change everything else needs did not wait on the one that touches every app.

**Goal:** the lifecycle has nine stages, and leaving each new one is a person's decision with its own permission.
**Repos:** `nooblyjs-ai-host` (lifecycle engine, Home, Metrics, roles).

**Decided before it starts (2026-10-19):** nine stages. While building, `ship` turned out to map to **Verify**, not
Release: an item entered Ship when people merged its pull requests, which in nine stages is Verify's waiting.

**Build**
- Stages `verify`, `release`, `operate`; items in `ship` move to `verify` once (audited, no stage event); history still
  says Ship.
- Approve & move: Build → Verify is the merge, Verify → Release the release candidate (`accept-release-candidate`,
  readiness-gated), Release → Operate the production deploy (two different people, `deploy-production`), Operate →
  done the outcome review. A person's merge in Bitbucket moves Build → Verify.
- `threat-model` and `risk-acceptance` as app approvals for the Security app (refused until it runs).
- Six new permissions (`accept-requirement`, `accept-threat-model`, `accept-risk`, `accept-release-candidate`,
  `deploy-production`, `declare-incident`), built in for older data folders, on Teams & roles.
- Overview, Lifecycle, the item page and the PM's home show nine stages; Metrics has Verify, Release and Operate rows,
  Ship as history, and "Build to release" on the chart.

**How you test it** (steps 1–5 need the PRD-031 sample story, which BUG-006 left unbuilt; until it is back,
`node --test test/lifecycle/nine-stages.test.js` in `nooblyjs-ai-host` runs each of them on its own items)
1. Start NooblyJS. Home · Overview shows nine stages, each saying what waits there in words.
2. On an item in Build, **Approve the merge** as Lerato: it moves to Verify. As Priya you are refused, and so is an
   agent; both refusals are in the audit log.
3. **Accept the release candidate**: it moves to Release. Add a Verify check to `data/workflows/readiness.yaml` and
   try again on another item: refused until you override with a reason.
4. **Approve the production deploy** as Lerato: it waits on another approver. Lerato can't approve twice; Stevie's
   approval moves it to Operate. **Close with the outcome review**: the item is done.
5. Put an item file in `stage: ship` and restart: it is in Verify, its history says Ship then Verify (migrated), the
   audit log has one `lifecycle.stages_migrated`, and Activity shows no handoff. Restart again: nothing more is written.
6. Teams & roles shows the six new permissions in words.

**Done when:** steps 1–6 pass, and no test that passed before fails.
**Guide points:** Is two people for every production deploy the right friction? Should an outcome review be due a fixed
time after release, or when its measure has data?

---

## Phase 16b — Eight stages, and the Factory's five groups

> **Built 2026-10-20, waiting for review.** Spec: `nooblyjs-ai-host/.claude/specs/phase-16b-product-design-build/`.
> Summary: `nooblyjs-ai-host/.claude/phases/phase-16b-summary.md`.

**Goal:** the lifecycle has the eight stages of version 3, every handoff between them is a person's decision with its
own permission, and the Software Factory's sidebar follows the work.
**Repos:** `nooblyjs-ai-host` (lifecycle engine, Home, Metrics, roles), `nooblyjs-ai-factory` (sections and sidebar,
the Product section's Architecture pages).

**Decided before it starts (2026-10-20):** `product.md` §3.2, §3.2a–c and §4. The handoffs are per item in this
phase; 16c makes them per story.

**Build**
- Stages `discover, product, design, engineer, build, test, release, operate`. Active items move once:
  `specify`/`ux`/`ui` → `product`, `architect` → `design`, `verify` and `ship` → `test` (audited, no stage event);
  history keeps its labels; handoffs are named by area ("Product → Design", "Design → Engineering", "Engineering →
  Build", "Build → Test").
- **Product handoff** (rule `spec`, its words "Product → Design (spec, UX and UI)", a Product lead) → Design.
- **Design handoff** (`design-handoff`, `accept-decisions`, a Solution Architect) → Engineer. The **UI handoff**
  (`ui-handoff`) is retired: an open one is withdrawn, with the reason said.
- **Engineering sign-off** (`engineering-signoff`, one approval: an Application Architect with `accept-decisions` and a
  test lead with `sign-off-tests`) → Build. The Factory's intake starts no run before it.
- **Build approval** (`build-approval`, waiting on an engineer, the code owner; today's `merge` rule) → Test.
- **Test approval** (`test-approval`, waiting on a tester) → the pull request may merge (a person merges); the item
  leaves Test for Release.
- **Anyone may approve for anyone else**, on every approval: an approval waits on the people its rule's permission
  names, and any person who is not a Viewer may give it on behalf of one of them; the approval, Activity and the audit
  log record who gave it (`by`) and for whom (`for`). Agents and Viewers are refused. The production deploy still needs
  two different people. `sign-off-tests` (a new permission, built in for older data folders) names the testers and test
  leads approvals wait on.
- The release candidate (`release-candidate`, `accept-release-candidate`, Phase 16a) is retired with Verify: an open
  one is withdrawn, with the reason said.
- Agents are refused every one of these decisions, and the refusal is audited.
- The Factory's sidebar: **Product · Design · Engineering · Build · Test** (`product.md` §4). The Design section
  (`design/`, `/factory/design`) starts with **Architecture**, moved from `/factory/product/architecture` (the old
  address redirects; links other apps hand out follow). Engineering and Test rows say in words what comes in 16d–16e.
  `sections.js` lets one section put rows in more than one group (Test: Engineering and Test).
- Work roles: Solution Architect, Functional Analyst, Application Architect, Test analyst (homes come with 16c–16e; the first two came with 16c).
- Metrics stage groups: Product (Discover, Product, and history's Specify, UX, UI), Design (and history's Architect),
  Engineer, Build, Test (and history's Verify), Release, Operate.

**How you test it**
1. Home · Overview shows eight stages, each saying what waits there in words.
2. Approve a Product handoff as a Product lead: the item is in Design. As a Contributor, and as an agent, refused and
   audited.
3. Approve the Design handoff as an Architect: Engineer. The Engineering sign-off with only the Architect waits on a
   test lead; with both, Build.
4. Give the Build approval as an engineer: the item is in Test, and the pull request can't merge yet. Give the Test
   approval as a tester: it can merge, and the item is in Release. On another item, give the Test approval as Lerato on
   Naledi's behalf: allowed, and Activity and the audit log say "Lerato for Naledi".
5. Put item files in `stage: ux`, `architect`, `verify` and `ship` and restart: Product, Design, Test, Test; one
   `lifecycle.stages_migrated`; restart again, nothing more.
6. The Factory's sidebar has the five groups; `/factory/product/architecture/PRD-031` lands on
   `/factory/design/architecture/PRD-031`.

**Done when:** steps 1–6 pass, and no test that passed before fails.
**Guide points:** Are the Build and Test approvals too much friction on small pull requests?

---

## Phase 16c — The Design section

> **Built 2026-10-20, waiting for review** (started at your word with 16a and 16b still waiting for review). Spec:
> `nooblyjs-ai-host/.claude/specs/phase-16c-design-section/`. Summary: `nooblyjs-ai-host/.claude/phases/phase-16c-summary.md`.
> Decided at the start: story ids `STORY-031-1` (and `BR-031-01`, `NFR-031-01`, `IF-031-01`, `TR-031-01`, `FEAT-031-1`),
> and the NFR catalogue as the Design section's `nfr-catalogue.yaml`, seven categories with `[CONFIRM]` targets.

**Goal:** Design turns a Product handoff into business requirements, a solution architecture, a functional analysis
and the stories that build a feature, and hands each story to the Software Factory on its own.
**Repos:** `nooblyjs-ai-factory` (the Design section, `design/`), `nooblyjs-ai-host` (stories as lifecycle items, the
Design handoff per story), `nooblyjs-ai-knowledge` (context for impacted systems).

**Before you start**
- Decided 2026-10-20: a feature has many stories, and a story belongs to exactly one feature. The item's feature
  landscape names the features its stories build.
- The NFR catalogue (shared with Phase 18) and the story id format (proposed `STORY-031-1`).

**Build**
- **Business requirements** (`BR-031-01`), drafted by the analyst agent from the spec and its elicitation record, each
  quoting its source; a Business Analyst accepts each one (`accept-requirement`).
- **Solution architecture**: **Feature landscape** (the features this item serves, the stories each needs, and their
  dependencies), **Impacted systems** (from Platform's repositories and the Knowledge repository: new, changed or
  retired, with an owner), **NFRs** (from the catalogue; they become quality attributes), and the container view, ADRs
  and standards check moved in 16b; links to the threat model (Phase 19) and the infrastructure design
  (Infrastructure app).
- **Functional analysis**: **interface requirements** between impacted systems (each with both sides named, and the
  contract), **technical requirements** per system.
- **Feature generation**: the technical features, which are the **stories** that build a feature. The agent proposes
  them from the landscape and the analysis; an analyst edits, splits and merges them. Each traces to its feature,
  business requirements, systems, interfaces, technical requirements, NFRs and acceptance criteria.
- Design's readiness checks: every business requirement is covered by a story, no decision is still proposed, every
  interface has both sides named.
- **Stories as lifecycle items** (type `story`, linked to their item and their feature). The **Design handoff per
  story** moves it to Engineer; the item stays in Design until its last story goes, then shows its stories' stages.
- Solution Architect and Functional Analyst homes.

**How you test it**
1. PRD-031 enters Design. Ask for business requirements: each quotes the spec. Accept them as Lerato; as an agent,
   refused and audited.
2. Impacted systems lists `web-storefront`, `slots-api` and `stores-service`, each new or changed, with an owner.
3. Add an interface with only one side: the Design handoff check fails, naming it. Name the other side: it passes.
4. Generate the stories: three, each tracing back to business requirements and its feature. Merge two; split one.
5. Hand off STORY-031-1 alone as Thabo: it is in Engineer; PRD-031 is still in Design and shows "1 of 3 stories handed
   off".

**Done when:** steps 1–5 pass, and no test that passed before fails.
**Guide points:** Are generated stories the right size for one pull request or a few? Is the feature landscape read?

---

## Phase 16d — Engineering: application architecture from the code, and test analysis

> **Built 2026-10-20, waiting for review** (started at your word, with your defaults). Spec:
> `nooblyjs-ai-host/.claude/specs/phase-16d-engineering/`. Summary: `nooblyjs-ai-host/.claude/phases/phase-16d-summary.md`.
> Decided at the start: agents read every repository Platform lists, as each one's agent access says; test cases are
> given/when/then, with the levels the AI automates in the Test section's `test-policy.yaml`; the Test section is
> `nooblyjs-ai-factory/quality/` at `/factory/quality`. STORY-027-1's CHG-008 sample is now the seed of the real formats.
> The roadmap's step 2 said "four criteria"; the script counts the criteria Design gave STORY-031-1 (two).

**Goal:** before anything is built, each story has an application architecture drawn from the real code and a test
analysis, signed off in one approval.
**Repos:** `nooblyjs-ai-factory` (Engineering: application architecture in the Factory's own code; the new Test
section, `quality/`, for the test analysis), `nooblyjs-ai-host` (devtools reads, the Engineering sign-off),
`nooblyjs-ai-knowledge`.

**Before you start**
- Which repositories the application architect agent may read (Platform's agent access per repository).
- The test case format, and which test levels the AI must automate per kind of story.

**Build**
- **Application architecture** per story and impacted system: the agent reads the repository (the devtools service,
  read-only, and the Knowledge repository) and drafts the **application flow**, the **objects** it touches, the
  **NFRs** per component and the changes it proposes. A person edits and accepts it. It is marked stale when the
  repository's main branch moves.
- The **Test section** (`quality/`, like the Product section: its own `register()`, pages in `public/quality/`, data in
  `data/factory/quality/`, `provides: { quality }`), starting with **Test analysis**: **test cases** from the acceptance
  criteria (`TC-031-1-1`), **automated testing requirements** (which tests the AI must automate, and at which level),
  **integration tests** per interface and **E2E tests** per journey, and what a person should check by hand; a test
  analyst marks each ready; coverage said in words.
- **Work items** per repository carry their part of the architecture and their test cases.
- **Engineering sign-off** readiness: the architecture accepted, every criterion with a ready test case, every interface
  with an integration test (a person may override with a reason).
- Application Architect and Test analyst homes.

**How you test it**
1. STORY-031-1 in Engineer: ask for the application architecture of `web-storefront`. It names the real modules and
   the flow in the demo repository, and the objects the story touches.
2. Test analysis: four criteria give at least four test cases, each with its automation level; "3 of 4 criteria have
   a ready test case" until the last is marked ready.
3. The sign-off is refused while a criterion has no ready test case, naming it; an override with a reason is allowed
   and audited.
4. Before the sign-off, the Factory starts no run for STORY-031-1; after it, its work items are queued with their test
   cases.
5. Push a commit to the demo repository's main: the architecture says it is stale.

**Done when:** steps 1–5 pass, and no test that passed before fails.
**Guide points:** Is an architecture drawn from code trusted more than one drawn by hand? Is the test analysis too much
before the first line is written?

---

## Phase 16e — Build and Test: the AI builds and tests, engineers and testers approve

> **Built 2026-10-21, waiting for review** (started at your word, with the defaults). Spec:
> `nooblyjs-ai-host/.claude/specs/phase-16e-build-and-test/`. Summary: `nooblyjs-ai-host/.claude/phases/phase-16e-summary.md`.
> Decided at the start: each pull request is a lifecycle item of its own (type `pr`, its story's child) with its Build
> and Test approvals; a person presses Merge after both (the Factory merges on the local forge in their name; Bitbucket
> pull requests are merged in Bitbucket); a Bitbucket merge without both approvals is flagged, not counted `[CONFIRM]`.
> The script counts the ten automated cases the test analysis gives web-storefront ("9 of 10 required tests present
> (TC-031-1-4 missing)"), not the roadmap's "3 of 4", and runs its steps in the order 1, 2, 3, 6, 4, the merge, 5.

**Goal:** the AI writes the code and the automated tests the test analysis asked for; an engineer gives the Build
approval; a human tester verifies the pull request and gives the Test approval; only then does it merge. A feature
goes to Release on its own once all its stories have passed Test.
**Repos:** `nooblyjs-ai-factory` (the line, PR evidence, the Build group's Pull requests, the Test group's Test
approvals), `nooblyjs-ai-host` (lifecycle, Home · Approvals, the devtools write gate).

**Build**
- The line builds each work item against its test cases: the AI writes the **required automated tests** and runs them
  with the gates; the PR evidence lists each one (by test case id) as found and passing, or not.
- **Build approval** on a pull request (Build · Pull requests, Home · Approvals): an engineer approves the code, or
  asks for changes. The pull request moves to Test.
- **Test approval** (Test · Test approvals, Home · Approvals): the tester (or anyone on their behalf, logged) sees the
  AI's test evidence beside the test cases and what to check by hand (in a preview environment once Phase 21 brings
  them), and approves, or sends it back to Build with a reason, which the line repairs and the engineer approves again.
- **Merge** only after both approvals and the gates (`product.md` §3.2c); a new commit clears both. A merge made in
  Bitbucket without them is flagged on the story, not counted as done `[CONFIRM]`.
- A story is done when its last pull request is merged; a **feature** moves to Release when all its stories are done,
  without waiting for the other features of its item.
- Metrics: pull requests waiting on a Build approval, and on a Test approval, with their age.

**How you test it**
1. A run delivers a PR for STORY-031-1; its evidence says "3 of 4 required tests present (TC-031-1-4 missing)".
2. As Lerato (engineer), ask for changes naming TC-031-1-4; the line repairs it; the evidence says 4 of 4. Lerato gives
   the Build approval: the PR is in Test, and can't merge yet.
3. As Naledi (tester), send it back with a reason: it is in Build again. After the repair and Lerato's approval, Naledi
   gives the Test approval: it merges.
4. An agent is refused both approvals, and audited. Lerato gives both, the Test approval on Naledi's behalf: allowed,
   and the PR's evidence and the audit log say who gave each and for whom.
5. When the last story of the slot-booking feature has passed Test, the feature is in Release while PRD-031's other
   feature is still being built.
6. Push a commit to an approved PR: both approvals are cleared.

**Done when:** steps 1–6 pass, and no test that passed before fails.
**Guide points:** Does a human Test approval on every PR slow the line too much? Should small PRs need it?

---

## Phase 16f — One shape for checks, and the trace

> Was Phase 16b until 2026-10-20.
>
> **Built 2026-10-21, waiting for review** (started at your word). Spec: `nooblyjs-ai-host/.claude/specs/phase-16f-checks-and-trace/`.
> Summary: `nooblyjs-ai-host/.claude/phases/phase-16f-summary.md`. Decided at the start: Build and Test approvals are
> checks of a kind of their own (`approval`); NooblyJS emits `check.recorded` when it gathers a check that is new or
> changed; one readiness check can be overridden by a person (other kinds are their app's); a goal is `GOAL-031-1`, a
> story's criterion `AC-031-1-1`, a quality attribute `QA-031-1`. The script's missing link is "AC-031-2-1 has no test"
> (there are no `REQ-…` until Phase 18).

**Goal:** every artefact can be traced, and every kind of check looks and behaves the same.
**Repos:** `nooblyjs-ai-host` (trace, Home), `nooblyjs-ai-factory` (the line and its Product, Design and Test
sections), `nooblyjs-ai-infrastructure` (their `checksFor` and `trace` services).

**Decided before it starts (2026-10-19):** the id prefixes (`design.md` §4) and the check shape (`design.md` §5) as
written.

**Build**
- The **check shape** and `check.recorded`; each existing app maps its own checks to it in a `checksFor` service.
- The **trace**: `links` in front matter, each app's `trace()` service, the derived index, `npm run trace:rebuild`.
- Item page: **Checks** panel and **Trace** tab. Home · Overview: the Learn arrow.

**How you test it**
1. Open PRD-031 · Checks: readiness, Design's and Engineering's checks, quality-attribute gates, the standards check,
   Build and Test approvals and INF-031's policy checks are in one list, each with its source and evidence, said in words.
2. Override a failing readiness check with a reason; the override shows on the check and in the audit log.
3. Open PRD-031 · Trace: from a goal through business requirements, stories and test cases down to `slots-api#482`,
   with the missing links named ("AC-031-04-2 has no test").
4. Delete `data/trace/` and reload: the Trace tab is identical. `npm run trace:rebuild` reports 0 differences.
5. As an agent (test fixture), try to override a check: refused and audited.

**Done when:** steps 1–5 pass, and no test that passed before fails.
**Guide points:** Is the Trace tab something people will open?

---

## Phase 17 — Strategy and the business case

> **Built 2026-10-21, waiting for review** (started at your word, with the defaults). Spec:
> `nooblyjs-ai-host/.claude/specs/phase-17-strategy-business-case/`. Summary: `nooblyjs-ai-host/.claude/phases/phase-17-summary.md`.
> Decided at the start: portfolio epics (`PEPIC-001`), epics (`EPIC-001`) and features (`FEAT-001`) live in the
> Product section's catalogue; an idea belongs to a feature; Design's per-item features and the hierarchy are linked
> later, and Jira gets no hierarchy `[CONFIRM]`. The business case: value hypothesis, who benefits, the measure, the
> cost estimate (agent, cloud a month, people's days, each with its source) and the horizon are required.

**Goal:** work can be followed from a strategic theme to an item, each idea has a business case, and spend can be
seen by value stream.
**Repos:** `nooblyjs-ai-factory` (Product section), `nooblyjs-ai-host` (Home, Platform budgets).

**Before you start**
- `product.md` §9 Q3: how epics, features, stories and requirements map onto ideas, specs and Jira (stories come from
  Design, Phase 16c).
- The business case template (sections, required fields).

**Build**
- Portfolio epics, epics and features (with documents from templates, like portfolios today); an idea sits under a
  feature.
- **Business case** on an idea or epic: value hypothesis, measure, cost estimate drawn from the factory's history
  of similar items (agent, cloud, people), horizon. A readiness check "Business case complete" at Discover.
- **Budgets by portfolio** in Platform · Settings, beside the per-system budgets; spend by value stream in Metrics.
- The **Business owner** work role, its onboarding card and its For you home.

**How you test it**
1. Add an epic and a feature under Digital › Digital Commerce; file an idea under the feature. The board filters by it.
2. The idea can't be accepted until its business case is complete; ask an agent to draft it and see an estimate
   with where its numbers came from.
3. Set a budget for the Digital portfolio; Metrics · Spend shows agent and cloud spend by value stream.
4. Sign in as a Business owner: the home leads with business cases waiting and spend against budget.

**Done when:** steps 1–4 pass.
**Guide points:** Is the cost estimate trusted enough to use? Does Jira need the hierarchy too?

---

## Phase 18 — Requirements elicitation

> **Built 2026-10-21, waiting for review** (started at your word, with the defaults). Spec:
> `nooblyjs-ai-host/.claude/specs/phase-18-requirements-elicitation/`. Summary: `nooblyjs-ai-host/.claude/phases/phase-18-summary.md`.
> Decided at the start: the NFR catalogue is the Design section's, each category now with a prompt, owned by the
> Solution Architects `[CONFIRM]`; candidates from Teams come only from notes a person posted to an item; elicitation
> lives in the Product section, one file per item; an NFR answer from a person who may accept requirements is accepted
> at once; a spec has the "Every question is answered" check only while it has questions.

**Goal:** every requirement says where it came from and who accepted it, and non-functional requirements are asked
for, not remembered.
**Repos:** `nooblyjs-ai-factory` (Product section), `nooblyjs-ai-host` (Teams meeting notes, chat).

**Before you start**
- The NFR catalogue (categories and prompts) and who owns it.
- Whether candidate requirements may come from any Teams meeting a teammate joined, or only ones linked to an item.

**Build**
- **Stakeholder map** per item; **elicitation sessions** (interview, workshop, meeting) with notes; the analyst agent
  proposes **candidate requirements**, each quoting its source; accept, merge or reject (`accept-requirement`).
- **Requirements** with ids (`REQ-031-04`); acceptance criteria hang off requirements; the spec reads from them.
- **NFR catalogue** walk: each category answered or marked not applicable; accepted NFRs become the solution
  architecture's NFRs in Design, and quality attributes.
- **Questions and assumptions** with owners; an open question blocks spec approval unless overridden.
- The **Business analyst** work role and home.

**How you test it**
1. As Lerato, add three stakeholders to PRD-033 and record an interview. Ask the analyst agent for requirements: four
   candidates appear, each quoting the notes.
2. Accept two, merge one into another, reject one with a reason. Only the accepted ones are in the spec.
3. As an agent (fixture), try to accept a candidate: refused and audited.
4. Walk the NFR catalogue; the two performance answers appear in Design as NFRs and quality attributes.
5. Leave a question open: spec approval is refused, naming it. Override with a reason: allowed and audited.
6. Post meeting notes from the Teams simulator to PRD-033: they appear as an elicitation session.

**Done when:** steps 1–6 pass.
**Guide points:** Is the candidate-requirement step too much friction? Which NFR prompts are missing?

---

## Phase 19 — Security by design (new app: Security)

**Goal:** every item has a threat model accepted by an Architect, and every PR is scanned, with findings that have
an owner and a fix-by date.
**Repos:** `nooblyjs-ai-security` (new, `/security`), `nooblyjs-ai-factory` (scan gates; the Design section's solution
architecture), `nooblyjs-ai-host`.

**Before you start**
- `product.md` §9: the fix-by days per severity, and who may accept which risk. (The app itself is decided.)
- Which scanners are approved (`stack.md` §6). The phase runs on the **mock scanner** until they are.

**Build**
- The hosted app: Threat models, Findings, Risk register, Policies. Hosted-app checklist.
- **Threat model** drafted by the security agent from the container view (STRIDE per trust boundary), each
  mitigation a requirement or a quality attribute; accepted through a `threat-model` approval.
- The **scanner adapter** (mock first); Build gates for secrets, SAST, SCA and licence, IaC; SBOM on each PR.
- **Findings** with severity, owner, fix-by, state; "Draft a fix as a PR"; closing needs a passing scan.
- **Risk acceptance**: a person, a reason and an expiry; an expired acceptance reopens the finding.
- The **Security engineer** work role and home.

**How you test it**
1. Open PRD-031 · Design · Solution architecture: ask for a threat model. It lists threats on the slot hold flow, each with a mitigation.
   As Thabo, accept it; as Priya, you can't.
2. A Factory run on `web-storefront` fails the SCA gate (the unapproved chart library). The PR shows the finding.
3. The finding has an owner and a fix-by date. Ask for a fix: a PR appears. Its scan passes; the finding closes.
4. Accept a medium risk with a reason and a 30-day expiry. Move the dev clock 31 days: the finding is open again.
5. An agent tries to accept a risk: refused and audited.
6. The scanner adapter is set to `mock` and says so on Security · Policies; nothing pretends to be a real scan.

**Done when:** steps 1–6 pass and `nooblyjs-ai-security` passes the hosted-app checklist.
**Guide points:** Are fix-by days right? Who should own a finding by default?

---

## Phase 20 — Quality (the Factory's Test section)

> **Until it is built** Test runs, Coverage and Defects show the seed story's sample (CHG-008, `data/factory/testing/`);
> this phase records them from the line and the environments, in the Test section (`quality/`, started in 16d with Test
> analysis).

**Goal:** quality is a fact across an item: coverage over all its stories and features, test runs recorded against
requirements, and defects as items of their own.
**Repos:** `nooblyjs-ai-factory` (the Test section, `quality/` at `/factory/quality` `[CONFIRM folder and path]`, made in
Phase 16d; the line), `nooblyjs-ai-host`.

Decided 2026-10-20: Quality is a section of the Software Factory, not a separate app (root `product.md` §4, §9). Test
analysis (16d) and the tester's Test approval on each pull request (16e) come first; this phase adds what spans them.

**Before you start**
- The defect workflow and severity scale.

**Build**
- Test · **Coverage**: per item and per feature, across its stories: criteria with a ready test case, with an
  automated test, with a passing run ("9 of 12 criteria have a passing test (Build)").
- Test · **Test runs**: the Factory's gate results recorded as test runs against requirements and test cases (Build
  level); environment runs join in Phase 21.
- **Test cases kept in step**: when a criterion changes, its test cases are marked "criterion changed" for a person.
- **Defects** as items linked to the requirement and story they break.
- The Test analyst / tester home grows to coverage gaps and defects.

**How you test it**
1. PRD-031 · Coverage reads across STORY-031-1 to -3 in words.
2. Change a criterion in the spec: its test cases are marked for review.
3. Raise a defect from a failing run; it appears in Lifecycle linked to REQ-031-01 and STORY-031-2.

**Done when:** steps 1–3 pass, and the Factory, with its Test section, still passes the hosted-app checklist.
**Guide points:** What should a test lead see first?

---

## Phase 21 — Testing in environments

> Was "Verify in environments" until 2026-10-20: Verify is no longer a stage. What this phase builds feeds the Test
> stage, where a human tester verifies each pull request before it merges.

**Goal:** each pull request gets a preview environment the tester verifies it in, and the environment suites (function,
performance, accessibility, security) run there and in Test and Staging, as evidence for the Test approval.
**Repos:** `nooblyjs-ai-infrastructure` (I8: previews from PRs), `nooblyjs-ai-factory` (its Test section),
`nooblyjs-ai-security`, `nooblyjs-ai-host`.

**Before you start**
- Which suites run in which environment kind; whether DAST may run in Staging.

**Build**
- Infrastructure I8: `pr.opened` → preview, `pr.merged` → destroy; `run.finished` → results on the environment.
- The **test runner adapter** (mock first): e2e, load (targets from the NFRs), accessibility, resilience.
- Security's **dynamic scan** and **image scan** as suites in the preview, Test and Staging.
- The Test approval shows the preview's link and its suite results beside the test cases; "a build moves right only
  when that environment's tests pass" enforced for promotion.

**How you test it**
1. Open a PR: a preview appears; e2e smoke runs there; the tester opens it from the Test approval; merge: the preview
   goes.
2. `test-slots` shows "41 of 42 e2e · 1 failing", linked to the criterion it proves. Promotion to Staging is refused,
   naming the failing test.
3. Fix it; the run passes; promotion is allowed. The load suite reports p95 against the 300 ms target.
4. A DAST finding in the preview opens a Security finding linked to the pull request and its story.
5. As a tester, give the Test approval with the environment results and the AI's test evidence in one list.

**Done when:** steps 1–5 pass on the mock runner and mock scanner.
**Guide points:** Which suites are worth their run cost? Does the preview make the tester's check quicker?

---

## Phase 22 — Release (new app: Operations, part 1)

**Goal:** production changes only through a release with evidence, two approvers, a rollout plan and a rollback.
**Repos:** `nooblyjs-ai-operations` (new, `/operations`), `nooblyjs-ai-infrastructure` (I10), `nooblyjs-ai-host`,
devtools (Jira fix versions, Bitbucket tags through the write gate).

**Before you start**
- `product.md` §9 Q1: who owns releases (proposed: Operations). The rollout strategies allowed; the feature-flag tool `[PLACEHOLDER]`.

**Build**
- The hosted app: Releases, Deployments. Hosted-app checklist.
- A **release** is one **feature**, released on its own once all its stories have passed Test: its merged work items,
  with version, evidence pack (the Build and Test approvals among it), SBOM, open findings, release notes (drafted by an
  agent), rollout and rollback plans.
- The `deploy` approval (two different people, built in Phase 16a) carries the release; risk acceptance required for findings above threshold.
- The **deployer adapter** (mock first) applies through Infrastructure; rollback in one action.
- Jira fix version and Bitbucket tag as **recorded** writes through the gate.

**How you test it**
1. Release the slot-booking feature ("Slots 1.0") once its stories have passed Test: the evidence pack lists tests,
   scans and approvals, while PRD-031's other feature is still in Build.
2. One approval isn't enough; the second deploys to a 10% pilot; Activity shows each step.
3. Roll back: the environment returns to the previous version and the release says why.
4. A release with an open high finding is refused until a risk is accepted.
5. Try to apply to `prod` without a release: refused by Infrastructure, audited.

**Done when:** steps 1–5 pass and `nooblyjs-ai-operations` passes the hosted-app checklist.
**Guide points:** Is two approvers the right friction for every product?

---

## Phase 23 — Operate and learn (Operations, part 2)

**Goal:** what runs in production is watched against SLOs, incidents are handled and learned from, and every item
ends with an outcome review that feeds Discover.
**Repos:** `nooblyjs-ai-operations`, `nooblyjs-ai-factory` (Product section), `nooblyjs-ai-knowledge`, `nooblyjs-ai-host`.

**Before you start**
- The monitoring platform `[PLACEHOLDER]`; on-call through Teams first; when the outcome review is due.

**Build**
- **SLOs** from quality attributes, with error budgets; the **monitoring adapter** (mock first).
- **Incidents**: declared by a person or raised from an alert; the SRE agent drafts the timeline and post-incident
  review; follow-ups become ideas or defects; the review is written back to Knowledge.
- **Signals from production** into the Product board (`signal.raised`), linked to the release and item.
- **Outcome review** at the due date: goals' measures against target, closing the item or opening an idea.
- DORA measures, idea → outcome, end-to-end cost in Metrics. The **SRE** home.

**How you test it**
1. After Slots 1.0, the availability SLO shows its budget. Burn it with the mock: an alert reaches Teams.
2. Declare an incident; resolve it; the agent's review draft links the release; accept it; it is a Knowledge page.
3. The Product board shows a new signal "Slot list timeouts at peak", linked to Slots 1.0.
4. Move the clock to the outcome review: the goal "slot sell-out before 14:00" shows today vs target; close the item.
5. Metrics shows deployment frequency, change failure rate (1 of 1 in the period) and time to restore.

**Done when:** steps 1–5 pass.
**Guide points:** Which measures will you actually run the factory by?

---

## Phase 24 — Housekeeping

**Goal:** close the housekeeping found in the review of Phases 16–23: every agent action is a teammate task, every
hosted app stores through `host.store`, and the mocking audit lists every mock adapter.
**Repos:** `nooblyjs-ai-knowledge`, `nooblyjs-ai-teammate`, `nooblyjs-ai-host`.

**Before you start**
- Which teammate the wiki's agents work as (default Ada Quill, `KNOWLEDGE_AGENT_TEAMMATE`).

**Build**
- **The wiki's AI agents as teammate tasks** (mocking audit A6, security audit S-08): hosted, every prompt the wiki
  sends (AI panel, Prompts, document and folder workflows, continuous exploration) runs through
  `teammates.runTask`; the agent's own provider is never called; a red-team case for a page carrying instructions.
- **Teammates on `host.store`**; its own FsStore copy goes.
- **`nodemon`** to the host's dev dependencies.
- **The mocking audit** gains a line per mock adapter of Phases 19–23 (scanner, test runner, deployer, monitor, on call).

**How you test it**
1. In the wiki's Agents screen add "Chat Processing" pointing at a provider of its own. Test a prompt on the Prompts
   screen: it runs as Ada Quill's task (Teammates · Work timeline; the audit log has `agent.knowledge.chat-processing`
   for you), and nothing reaches the agent's provider. With no model configured it says so.
2. Ask the AI panel "How is slot capacity calculated?": with no model it answers from the sources, as before.
3. Teammates' files are where they were (`data/teammates/`), written through the host's store.
4. `npm install --omit=dev` in the host leaves `nodemon` out; `npm run dev` still restarts on changes.
5. The mocking audit has A12–A16 and A6 done.

**Done when:** steps 1–5 pass.
**Guide points:** Which teammate should the wiki's agents work as?

---

## Phase 25 — Product enhancements (from Productboard and Aha!)

**Where it came from:** the comparison of 2026-10-21 (`nooblyjs-ai-host/.claude/audits/2026-10-21-product-tools-comparison.md`):
what Productboard and Aha! do well that the Product app does not. What we have and they don't (one loop to the
outcome review, requirements with their sources, architecture, business cases from real spend, accountable agents)
stays as it is. Two parts, each stopping for review.
**Repos:** `nooblyjs-ai-product` (most of it), `nooblyjs-ai-host` (the permission, notifications, Metrics, the PM's
home), `nooblyjs-ai-operations` (a release tells Product), `nooblyjs-ai-design` (dependencies on the roadmap).

**Decided 2026-10-21 (your answers):**
- **Feedback** comes in as planned below: notes typed in, Teams, Jira (read through devtools) and a **feedback form
  on a link** (changed 2026-10-22: the form replaces the support tool's connector, and email is dropped).
- **The feedback form needs no sign-in**: anyone who gets the link can use it, inside Acme or not. Its senders are
  not told anything back and are not counted as colleagues who asked; no email address is asked for. There is no
  limit on how many times it is submitted (decided 2026-10-22).
- **Votes:** 10 open votes per person; a vote comes back when its idea ships or closes (confirmed 2026-10-22).
- **The customer is the portfolio.** There are no customer or company records and no CRM: the people who ask are
  colleagues, and who they ask for is a portfolio, value stream and product from the catalogue. That is the segment
  the board and the evidence filter by. No revenue is held.
- **The portal is for colleagues only, always**: everyone signed in to NooblyJS, and nobody outside Acme. (The
  feedback form is not the portal: it only takes a note in.)
- **Viewers submit, vote and comment too**: a new `suggest` permission that every access role has; agents never.
- **Scoring stays RICE**, as today. Customer importance (25a) and the objective an item serves show beside the score;
  they don't change it.
- **Objectives run by Now · Next · Later**, not by quarter or half, and so does capacity.

### Phase 25a — Customer evidence, the ideas portal, closing the loop

**Goal:** every idea shows who asked for it, for which portfolio, and how much it matters to them; colleagues put
ideas forward and vote; and everyone who asked hears when it ships and whether it worked.

**Before you start**
- Nothing open: the feedback sources, the form and the vote limit are decided above.

**Build**
- **A feedback inbox** (Product · Feedback): each piece of feedback a **note** (`NOTE-0412`) with its source, the
  colleague it came from or through, the portfolio, value stream and product it is about, and when; personal data
  redacted on the way in, as Knowledge's import does. A person, or Ada as a teammate task, highlights a snippet and
  links it to an idea, feature or spec with an **importance** (nice to have, important, critical): an **insight**. Ada
  suggests links and clusters notes into **signals**, which now count real notes instead of a typed number (the
  seeded counts stay sample data).
- **The feedback form on a link**: a person with `draft` makes a link for a portfolio, value stream and product
  (`/product/f/<token>`, a long random token), and can switch it off or replace it, audited. The page is outside
  sign-in (no session; the host's CSRF check, which works signed out; no limit on submissions and no rate limit,
  since the host's general limit covers `/api/…` only; 2,000 characters a message, a hidden spam field, no
  uploads) and shows only the product's name, one text box and an optional name. Each submission is a note with the source
  "Feedback form", tagged from its link, redacted on the way in, audited as from an anonymous sender; the sender sees
  "Thanks, we've got it" and nothing of NooblyJS. A form note can be linked into an insight like any other, but
  it counts as "form feedback", not as a colleague who asked, and closing the loop never tells its sender. Ada treats
  its text as untrusted data, never as instructions (a red-team case).
- **Customer importance** on every idea, feature and spec: how many colleagues asked, for which portfolios, weighted
  by importance, said in words ("12 colleagues across 2 portfolios; 4 say critical"). The board and the evidence
  filter by portfolio, value stream and product.
- **The `suggest` permission** in NooblyJS's matrix: every access role has it, Viewer included; an agent is refused it
  (audited), like every rule that keeps agents from deciding.
- **The ideas portal** (Product · Ideas portal), for colleagues only: submit an idea for a portfolio and product, see
  the others with their status in words, vote (within the limit), comment, follow, and vote **on behalf of a
  colleague** who asked them (a store manager on the phone to support). A person with `draft` merges duplicates
  (votes and followers carried over) and promotes an idea to the board.
- **Closing the loop**: when a feature's release reaches production (Operations), everyone linked to its ideas and
  insights (voters, followers, the colleagues whose notes were linked) is told in NooblyJS and Teams, with the release
  notes; the outcome review tells them again whether the goals were met.
- The PM's home: new feedback, insights to link, portal ideas waiting, and who is to be told.

**How you test it**
1. Priya logs three notes from store managers about slots selling out (one a Teams message) and one from support about
   a customer who wants to edit an order. Ada suggests linking the three to PRD-031 and the fourth to IDEA-019 "Edit
   order until picking starts"; Lerato accepts with "critical" and "important": PRD-031 shows "3 colleagues across 1
   portfolio; 1 says critical". The phone number in one note is redacted.
1a. Lerato makes a feedback link for the Delivery product and opens it in a private window, signed out: she submits
   "Slots were gone by 9am again". It lands in the inbox as a note from "Feedback form", tagged Delivery, and PRD-031
   shows "3 colleagues across 1 portfolio; 1 says critical · 1 form note" once she links it. She submits five more
   in a row and all are taken; a message carrying instructions to Ada is kept as plain text.
   After she switches the link off, it says the form is closed.
2. Signals: "Slots sell out before 10:00" counts the notes behind it; a click shows them. The board filtered by the
   Delivery product shows PRD-031's evidence and not IDEA-019's (Checkout).
3. Naledi (Viewer) submits "Let me add to my order after paying" in the portal and votes; past the limit she is told
   why. Thabo votes on behalf of a store manager. An agent's vote is refused (403) and audited.
4. Lerato merges Naledi's idea into IDEA-019 (votes and followers carried over) and promotes it to the board.
5. Slots 1.0 reaches production: everyone linked to PRD-031's ideas and insights gets "Same-day slots shipped", with
   the release notes; after the outcome review, "0 of 3 goals met" with a link.

**Done when:** steps 1–5 (and 1a) pass.
**Guide points:** Which portfolios bring the most feedback, and does the board now show it?

### Phase 25b — Objectives, roadmaps and capacity

**Goal:** the board and the roadmap say why each item is there (the objective it serves, its RICE score, who asked)
and whether the teams can do what is in Now, and a roadmap is something people edit and share, not a typed file.

**Before you start**
- How long Now is, for capacity (default: the next 12 weeks, set by an Owner) `[CONFIRM]`; Next and Later have no
  dates.
- Each team's people-days available in Now `[PLACEHOLDER]`, from Teams & roles.

**Build**
- **Objectives** (`OBJ-07`), each in **Now, Next or Later**, with key results that have a measure, a start, a target
  and a source (Metrics, the monitor, or typed in); linked to strategic themes, epics, features, ideas and specs;
  progress in words, moved by outcome reviews. An objective is moved between horizons by a Product lead (`approve`),
  audited; an item in Now serving an objective in Later is pointed out.
- **Why, on every card**: the RICE score as today, the objective it serves and its horizon, and customer importance
  (25a), in words ("RICE 42 · serves OBJ-07 (Now) · 12 colleagues asked").
- **Roadmaps from the items themselves** (replacing `roadmap.yaml`): Now · Next · Later by default, a timeline for Now
  from the lifecycle's dates and targets, and views by portfolio, theme, objective or team; releases (Operations) and
  Design's feature dependencies on them; saved views; a read-only roadmap page anyone signed in can be sent; edited in
  the app by a person with `draft`, every change audited.
- **Capacity in Now**: each team's people-days against the business cases' estimates of the items in Now; an
  over-planned Now said in words ("Delivery squad: 64 of 50 days planned in Now"). Next and Later are not checked.
- **Strategy documents**: vision, positioning, personas and competitors from templates (like portfolios today), which
  the drafting agents read (`designInputs`, the spec and business-case drafts).
- **Product reports** in Metrics: feedback over time and by portfolio, planned days by objective and horizon, key
  results' progress.

**How you test it**
1. Lerato creates OBJ-07 "More same-day orders" in Now, with a key result "Same-day slots still open at 12:00, 18% →
   45%", read from the monitor; PRD-031 serves it.
2. The board orders by RICE as today; PRD-031's card says "serves OBJ-07 (Now) · 3 colleagues asked".
3. The roadmap's Now · Next · Later shows PRD-031 in Now with Slots 1.0 and its features' dependencies (Design's
   FEAT-031-…); Lerato moves PRD-027 to Next; the change is audited; the shared page shows it read-only.
4. Capacity: the delivery squad is over-planned in Now and the roadmap says so; moving PRD-025 to Later clears it.
5. The outcome review of PRD-031 moves the key result to 31.5%; the objective says "1 of 1 key result behind".
6. Metrics shows feedback by portfolio and planned days by objective.

**Done when:** steps 1–6 pass.
**Guide points:** Is 12 weeks the right length for Now?

---

---

## Hosted apps: open work

This file is the only roadmap. The hosted apps used to keep their own; those are history now
(`docs/roadmap-history.md` in `nooblyjs-ai-factory/product`, `nooblyjs-ai-teammate` and `nooblyjs-ai-infrastructure`). This is what was
still open in them on 2026-10-11. Each item goes into a numbered phase above (or a new one) before it is built, with
its spec in `nooblyjs-ai-host/.claude/specs/`.

**Product Factory (the Factory's Product section, `nooblyjs-ai-factory/product`, its P8).** Drafts already run through `teammates.runTask()` by work type and
cite `knowledge.contextFor()`, and model routes are Platform's (Phases 6, 8 and 9).
- [ ] Decide which stages draft automatically, now that real costs are known (D3).
- [ ] An agent's edit of a spec from a chat thread, kept as a new spec version. A person's "Apply to spec" exists
      (`product.updateSpec`) `[CONFIRM]`.
- [ ] Opt-in live tests (`*.live.test.js`) for one draft per stage.

**Digital Teammates (`nooblyjs-ai-teammate`, its Phase 7 and backlog).** Backups, a security review and a performance
check are in Phase 13 for all of NooblyJS.
- [ ] CI: the tests on every push (Bitbucket Pipelines).
- [ ] An accessibility audit of the Teammates screens (WCAG 2.2 AA; axe already runs in NooblyJS's e2e suite) and
      prompt-injection cases.
- [ ] Docs: an OpenAPI spec for the outside task endpoint (`POST /teammates/api/v1/teammates/:slug/tasks`), an admin
      guide, and how to write skills.
- Backlog: teammate templates and "save as template"; export and import a teammate; model A/B tests (rating against
  cost); ratings on work items feeding memory and reviews.

**Infrastructure (`nooblyjs-ai-infrastructure`, its I2–I10).**
- [ ] I2: a side-by-side check against the mockups at 1440px.
- [ ] I3: confirm which access role is the "platform owner" (today `change-repo-access`, so Owner) `[CONFIRM]`.
- [ ] I5: ask design for the screens with no mockup (`Infra-EnvDetail` is linked from both mockups), then match them.
- [ ] I7, the drafting agent: hire Ines Tau in Digital Teammates; `POST /designs/:id/drafts` as a teammate task that
      reads the architecture through `host.service('product')` and saves a new design version; a scripted draft for
      the seed story; offer a new draft on `adr.accepted` or `architecture.updated`; `agent.action` with cost.
- [x] I8 (built in Phase 21, 2026-10-21: `pr.recorded` → a preview, `pr.merged` → destroyed, the Test section's suites recorded on the environment, promotion only when they pass), previews and tests from the Software Factory: `pr.opened` → a preview environment, `pr.merged` → destroy it;
      `run.finished` → test results on an environment; `services.testTargets(kind)`; an environment's tests as a gate;
      Infrastructure rows on Home · Approvals, Activity and the Platform engineer's home.
- [ ] I9, a real provisioner (**blocked** on the cloud, the region and the IaC tool): the adapter in
      `src/provisioners/`, generated code as a pull request, sandboxed workers, real cloud cost, secrets as references.
- [x] I10 (built in Phase 22, 2026-10-21: Operations owns releases; Infrastructure refuses any other change to Production and checks the release's deploy approval): Production changes only through a release with two approvers (who owns releases is open); runbooks and
      backup of `data/infrastructure/` (with Phase 13).

---

## After Phase 23

- **Phase 15 (No mocks)** turns each adapter real as its decision is taken: models, runtime, provisioner, scanners,
  test runner, deployer, monitoring. Its audit (`nooblyjs-ai-host/.claude/audits/mocking-audit.md`) gains a line per new
  adapter.
- **Pilot the whole loop** with one squad on one product, idea to outcome review, and measure it against today's
  idea → merge baseline.
- **Housekeeping found in this review:** Knowledge's agents onto teammate tasks (A6); Teammates onto `host.store`;
  `nodemon` to dev dependencies in the host (all built in Phase 24, 2026-10-21); README and shared rules point at this
  steering (done 2026-10-19).
