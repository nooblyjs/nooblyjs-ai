# Bugs and changes: tasks

> The log. Rules: `requirements.md`; how a fix is made: `design.md`.
> **Next IDs: BUG-008, CHG-008.** Status: open → fixing → fixed → verified. Only you tick a box, once it is
> verified.

## How to log one

Copy a template below into its section, take the next ID, and bump **Next IDs** above. Leave out what you don't
know; "steps" can be one line.

```markdown
- [ ] BUG-NNN — <title> · S2 · <area> · <repo> · Phase NN
  - Found: 2026-10-12 · Status: open
  - Steps: 1. … 2. …
  - Expected: …
  - Actual: …
  - Notes: signed in as …, dev clock …, `docs/bugs/BUG-NNN/`
```

```markdown
- [ ] CHG-NNN — <title> · <area> · <repo> · Phase NN
  - Asked: 2026-10-12 · Status: open
  - What and why: …
  - Steering: <doc §section, or none>
```

## Bugs

- [ ] BUG-001 — Developer home shows "Merged this week 0" once the seed's merge is in last week · S2 · For you · nooblyjs-ai-host · Phase 3
  - Found: 2026-10-12 · Status: fixed
  - Steps: 1. `node --test test/people.test.js` on Monday 2026-10-12 (or sign in as Priya on a fresh seed).
  - Expected: the "Merged this week" tile is 1 (`web-storefront #476`), as the step 7 test says.
  - Actual: 0. `src/lifecycle/seed/data/items/web-storefront-476.md` has a fixed `completedAt: 2026-10-08T11:03:00.000Z`,
    and `weekStart()` (`src/lifecycle/services/views.js:31`) starts the week on Monday, so after Sunday 2026-10-11 the
    merge falls in last week. `npm test` fails (1 of the suite) from this week on.
  - Notes: found while checking the `apps/` rename; it fails without that change too. Either the seed's merge date
    moves with "now" like the rest of the time-shifted seed, or the test pins the clock.
  - Cause: the merge date does move with "now". The seed stories are written as of Friday 10:00 (ANCHOR) and every
    time moves by the same amount, so waiting times ("26 h") stay true but "this week" only holds on a Friday: on a
    Monday the week's merge and decisions fall in last week. The same breaks e2e Home · Approvals "Done this week 3".
  - Fix: the tests pin the clock. `test/helpers.js` `pinClock()` moves the dev clock (data/dev/clock.yaml) to the
    next Friday 10:00 before NooblyJS starts, and the seed is written at that time; `test/e2e/serve.js` does the same.
    `clockNow()` / `clockDay()` give tests the app's today. The product is unchanged.

- [ ] BUG-002 — Portfolios · Strategic themes: the "What it means" box sits lower than the "Theme" box · S3 · Product · nooblyjs-ai-product · Phase 5
  - Found: 2026-10-12 · Status: fixed · Commit: nooblyjs-ai-product 9de3ccc
  - Steps: 1. Sign in as anyone who can draft. 2. Product Factory · Portfolios.
  - Expected: the Theme and What it means boxes line up, as the `.pf-form__row` rule says (label, box, then any hint).
  - Actual: the "optional" hint sat between the label and its box, pushing that box down a line.
  - Fix: `public/js/pages/strategy.js`: the hint goes under the box (`aria-describedby`), as on the board's RICE form.
  - Check by hand (pure layout): both boxes start at the same height; "optional" is under the second box.

- [ ] BUG-003 — Portfolios · Change themes: no space between the theme chips and Save themes / Cancel · S3 · Product · nooblyjs-ai-product · Phase 5
  - Found: 2026-10-12 · Status: fixed · Commit: nooblyjs-ai-product d902fef
  - Steps: 1. Sign in as an Approver (Stevie). 2. Product Factory · Portfolios. 3. Change themes on a portfolio.
  - Expected: the chips and the buttons are clearly separate rows.
  - Actual: the buttons sat right under the chips.
  - Fix: `public/css/product.css`: `.pf-labels > .actions { margin-top: 16px; }`.
  - Check by hand (pure layout): a clear gap between the chips and Save themes.

- [ ] BUG-004 — Architecture · Decisions: "Ask Rhea to propose one" names a teammate who isn't the hired drafter · S2 · Product · nooblyjs-ai-product · Phase 5
  - Found: 2026-10-12 · Status: fixed · Commit: nooblyjs-ai-product 8d2802d
  - Steps: 1. Hire a teammate other than Rhea Voss (or assign another to architecture). 2. Open any item's Architecture page.
  - Expected: the Decisions card asks the teammate who drafts architecture (`stage-agents.js`), as the container view does.
  - Actual: "Ask Rhea to propose one" was written into the page, next to "Ask StevieB to draft the container view". The
    server already sent the draft to the hired teammate; only the label was wrong.
  - Fix: `public/js/pages/architecture.js` `decisionsCard()` takes the architecture drafter from `GET /drafters`; with
    nobody to draft, the button is left out and the Decisions tab says why.
  - Check: no test renders the page (its modules import from `/ui/`), and the seed hires Rhea, so it was checked in a
    browser: as Stevie, `PUT /product/api/v1/drafters/architecture { teammateId: "ada-quill" }`, then PRD-031's
    Architecture page reads "Ask Ada to propose one".
  - Screenshot: `.temp/screenshots/bug-rhea.png`

- [ ] BUG-005 — For you fails with "listed is not defined" for a Product manager with no teammate hired · S1 · For you · nooblyjs-ai-host · Phase 3
  - Found: 2026-10-14 · Status: fixed
  - Steps: 1. With no agent teammate hired, sign in as a person whose work role is Product manager. 2. Open For you.
  - Expected: the PM home, with the agent panel saying "No agent teammate is hired yet" and a Hire a teammate link.
  - Actual: `GET /api/v1/home/for-you` fails: `ReferenceError: listed is not defined` at `src/services/for-you.js:117`.
  - Cause: `productManager()` reads `listed` (the work role as written, before `withTeammate()` clears its `agent`), but
    `listed` is a local of `build()` and was never passed in. It is only read when nobody is hired, which the seed never is.
  - Fix: `build()` passes `listed` in the layout's `ctx`. Test: `test/services/for-you.test.js`.

- [ ] BUG-006 — NooblyJS fails to start: `ENOENT … scandir 'src/seed/data'` · S1 · Seed · nooblyjs-ai-host · Phase 0
  - Found: 2026-10-19 · Status: fixed
  - Steps: 1. Clone the monorepo. 2. `npm start` in nooblyjs-ai-host.
  - Expected: NooblyJS seeds an empty `data/` and starts.
  - Actual: `NooblyJS failed to start: Error: ENOENT: no such file or directory, scandir '…/nooblyjs-ai-host/src/seed/data'`.
  - Cause: the host's `.gitignore` (and the root one) ignore `data/` unanchored, which also matched `src/seed/data/` and
    `src/lifecycle/seed/data/`, so the migration (M4) never committed them. No copy survived.
  - Fix: both `.gitignore` files keep `**/src/**/seed/data/`. The system files are rebuilt from product.md §4–§6, §5.7,
    §5.8 and the phase 0, 2, 3 and 9 designs: access roles and job titles, hosted apps, organisation and settings
    (`[PLACEHOLDER]`s), work roles (without the sample first-week tasks), budgets, guardrails, model routes, the blank
    Platform/chat/Teams files, the approval rules and readiness checks. `seedMetricsHistory` treats a missing story
    `items/` folder as no items. Check: a fresh `DATA_DIR` seeds 69 files, every app mounts, `/healthz` is 200.
  - Notes: the PRD-031 sample story (people, teams, items, approvals) is not rebuilt, so a new data folder has no
    sample people. Tests that sign in as the sample people (`seed`, most of `platform`, `hosted-apps`, the
    `--reset` case in `blank`) fail until it is.
  - Sample story (2026-10-20): rebuilt in lifecycle v3's eight stages. The five people (`src/seed/data/people/`), the
    three teams, the seven Platform repositories, the thirteen items and eleven approvals of `src/lifecycle/seed/data/`
    (four waiting on Stevie, two on others, four decided this week), the chat and Teams scripts, and the metrics
    history. The `stage` rule (Discover → Product) is built in (`src/lifecycle/config.js`), as the rebuilt rules file
    had lost it. `test/lifecycle.test.js` and `test/people.test.js` had never run on v3 (no sample people): they now
    expect the eight stages, Design after the Product handoff, a Viewer (Naledi) as the one refused, an approval waiting
    on two people asking whom it is for, the Factory installed (it hosts Product), and 16b's matrix row "Accept
    architecture decisions and the Design handoff". Check: host 321 of 321 pass; Factory 533 of 537 (4 skipped, none
    failing, with BUG-007).

- [ ] BUG-007 — A failing gate passes in the sandbox, and the repository's commands there get the Factory's secrets · S1 · Line, security · nooblyjs-ai-factory · Phase 7
  - Found: 2026-10-20 · Status: fixed
  - Steps: 1. On a machine with bubblewrap, `npm test` in nooblyjs-ai-factory (or `test/software-factory.test.js` in
    the host). 2. The "picker, nearby, basket" run writes `km < maxKm`, whose own test fails.
  - Expected: the run's test gate fails, the fixers can't fix it, and the run asks a person.
  - Actual: `verify (clean checkout …): test passed`, and the run is delivered. These were "the line's 3 known
    failures" (`intake/handoff` steps 2 and 3, and the host's software-factory step 3).
  - Cause: `runCommand()` (`src/services/exec/sandbox.js`) gave a sandboxed command this process's whole environment.
    Only the unsandboxed path used `commandEnv()`. So under a test runner the gate's `node --test` saw
    NODE_TEST_CONTEXT, reported to its parent and exited 0. Worse, in any run, a repository's own setup and gates in
    the sandbox could read GITHUB_TOKEN, FACTORY_WEBHOOK_SECRET and the rest, which F24 had removed only from agents.
  - Fix: the sandboxed path gets `commandEnv()` too (`test/services/exec/sandbox.test.js`, written failing first).
    The third known failure, `redteam` RT4(a), was the test: with a sandbox the harness runs the agent's Bash inside it
    (`autoAllow`, network off) instead of refusing it, so RT4 now checks that it ran sandboxed and reached nothing.
  - Check: Factory 533 of 537 (4 skipped, none failing); host 321 of 321, `software-factory` step 3 included.

## Changes

- [ ] CHG-001 — Strategic themes, portfolio and value stream documents, and their templates · Portfolios, Settings · nooblyjs-ai-product · Phase 5
  - Asked: 2026-10-12 · Status: fixed
  - What and why: model how Acme Retail organises work. Strategic themes sit above portfolios (a portfolio works
    towards many). A portfolio has none or many value streams. Each portfolio and value stream is a Markdown document
    made from a template set in the Product Factory's Settings (portfolio: Key Partners, Key Activities, Key
    Resources, Cost Structure, Revenue Streams; value stream: Description, Value Stream Vision, Customer Segments,
    Channels, Customer Relationship, KPIs or Revenue, Solution Context, Economic Framework, People and Locations,
    Attachments). A product may sit in one of its portfolio's value streams; the board filters by them. Templates and
    theme links are an Approver's (people only). The sample catalogue is now Digital (four value streams), Buying and
    Banking. Portfolio epics, epics, features and requirements are written down but not built.
  - Steering: `nooblyjs-ai-product` `.claude/steering/product.md` §4, §5.7, §5.8, §8 and `structure.md` §2–§4, §6; nooblyjs-ai-host
    `.claude/steering/product.md` §5.3

- [ ] CHG-002 — "Opportunity" is "idea" everywhere, ids included · Product board, Home, lifecycle · nooblyjs-ai-product, nooblyjs-ai-host · Phase 5
  - Asked: 2026-10-12 · Status: fixed
  - What and why: Acme Retail calls them ideas. The word on every screen ("New idea", the Ideas column), the ids
    (OPP-018 → IDEA-018), the API (`/product/api/v1/ideas`, `POST /signals/:id/idea`), the files
    (`data/product/ideas/`), a spec's `idea` field, the lifecycle item type `idea` and the events (`idea.created`,
    `idea.updated`, `idea.scored`, payload `ideaId`). An older data folder is moved over at start (nooblyjs-ai-product
    `migrateFromOpportunities`; nooblyjs-ai-host `src/seed/ideas.js` for lifecycle items, Jira links and work-role first things);
    the event and audit streams keep what they recorded. The UX journey map's "Opportunity" row is a different
    thing and keeps its name. Phase summaries and earlier phase specs are history and keep the old word.
  - Steering: nooblyjs-ai-host `.claude/steering/product.md`, `tech.md`, `structure.md`, `roadmap.md`; `nooblyjs-ai-product`
    `.claude/steering/product.md`, `structure.md`

- [ ] CHG-003 — With no teammate to ask, the "Ask …" buttons go and a person does the work · Product · nooblyjs-ai-product · Phase 5
  - Asked: 2026-10-12 · Status: fixed · Commit: nooblyjs-ai-product 8d2802d
  - What and why: with nobody hired, every stage still offered "Ask the agent" buttons that could only be refused, and
    some steps had no other way through (an empty spec had no Edit; an empty container view had no editor). Now, when
    `GET /drafters` gives a stage no teammate, its Ask buttons are not shown, the page says why (with Hire a
    teammate), and a person does it: **Write the spec** (the Edit form, from version 0), **Write it as code** (the
    container view), New ADR, a journey (steps one a line), a flow (`from → to | branch`), **Answer it** on an open
    question, a screen, and the handoff's work items (`repo | title`). With a teammate hired, the Ask buttons
    name them (UX and UI no longer say "the design agent" / "the UI agent") and the same forms sit behind a button.
    No API changed; the empty handoff's text is "No work items planned yet" instead of "Ask the UI agent…".
  - Check: in a browser on the e2e seed with every teammate moved out, as Stevie on PRD-030: no Ask button on Spec,
    Architecture, UX or UI; the spec, container view, journey, flow, screen and work items were each saved by hand.
    With the teammates back, PRD-032 shows "Ask Ada…" and "Ask Rhea…" and the forms stay hidden until asked for.
    `nooblyjs-ai-product` `npm test` 160/160.
  - Notes: on the seed, UX and UI have **no** drafter even with nine hired: their usual teammates (Design agent, UI
    agent) aren't in the roster and none is assigned, so the API says "Choose which teammate drafts…". Those pages
    have no chooser (the spec page does), so they show that sentence and the forms. A chooser would be its own entry.
  - Steering: `nooblyjs-ai-product` `.claude/steering/product.md` §3 item 3

- [ ] CHG-004 — Every app takes the warm Noobly theme, and a two-circle mark replaces the old logos · UI kit, every app, Edge, Teams · nooblyjs-core, nooblyjs-ai-host, nooblyjs-ai-teammate, nooblyjs-ai-factory, nooblyjs-ai-knowledge
  - Asked: 2026-10-18 · Status: fixed · Commit: nooblyjs-core 74bb8a3; nooblyjs-ai the CHG-004 commit
  - What and why: the apps still showed the old navy theme (the kit's tokens, Lexend) and an old `≡×` logo. The
    shared theme is `nooblyjs/styling/styles.css` (warm paper, ink, terracotta; Bricolage Grotesque and Figtree).
    The kit keeps its token names and takes those values; the fonts are self-hosted (the CSP allows `'self'` only).
    `styles.css` is copied as it is where a page loads it unscoped (desktop, the factory dashboard, the standalone
    wiki and datasources). Teammates and Factory keep their scoped copies with the new values. The host,
    Edge and the wiki's own colours were moved off navy; the hosted wiki CSS was regenerated (`npm run port:ui`).
    The favicon, the rail logo, `/images/nooblyjs-logo.png`, a new `/favicon.ico`, the Edge icons and the Teams
    icons are one mark: two overlapping circles, terracotta and peach, with a cream lens.
  - Check: on the e2e seed (dev sign-in), Home, Product, Teammates, Factory, Wiki, Infrastructure and Platform
    screenshotted; axe colour-contrast finds nothing on any of them. Tests: teammate 140/140, knowledge 34/34,
    host shell 7/7. Six host and factory tests (`teams-real` steps 4–5, `software-factory` step 3, factory
    `redteam` RT4, `intake/handoff` steps 2–3) fail the same way without this change.
  - Notes: the Teams app needs its manifest version bumped and the package uploaded again for the new icons. The
    Teams tab's `App.css` (the toolkit template) and the wiki's own "N" logo were left as they were.
  - Steering: nooblyjs-ai-host `.claude/steering/tech.md` (fonts), `structure.md` (fonts/)

- [ ] CHG-005 — Product and Infrastructure become sections of the Software Factory: one package, one app at /factory · Rail, Factory, Product, Infrastructure · nooblyjs-ai-factory, nooblyjs-ai-host, monorepo root · Phase 16a+
  - Asked: 2026-10-19 · Status: fixed
  - What and why: asked for "one package, one app": `nooblyjs-ai-product` and `nooblyjs-ai-infrastructure` moved into
    `nooblyjs-ai-factory` as `product/` and `infrastructure/` (`git mv`, history kept), their pages into
    `public/product/` and `public/infrastructure/`. The Factory's `register()` mounts them at `/factory/product` and
    `/factory/infrastructure` (`src/services/sections.js`), each with its own store in `data/factory/<section>/`, and
    `provides: { product, infrastructure }` keeps `host.service('product')` and `host.service('infrastructure')`. Its UI
    module adds their routes (`public/js/sections.js`: each page gets a ctx bound to its section and draws in its own
    `data-module` scope). One rail item; the sidebar is grouped Product · Build · Infrastructure; the status card has a
    line per section. `FACTORY_SECTIONS` leaves one out. The host skips their entries in an older `hosted-apps.yaml`,
    moves `data/product` and `data/infrastructure` once (`foldData`), reads `provides` as an object, and links to the
    new paths. The sections' standalone `server.js` and its tests are gone.
  - Check: factory package 579 tests, 572 pass (the line's 3 known failures: `redteam` RT4, `intake/handoff` steps
    2–3, the same before); Product section 157 (160 less the 3 standalone-server tests), Infrastructure 46; host 315,
    122 pass, and no test that passed before fails (the rest fail on the missing sample story, BUG-006); knowledge
    34/34. A blank install boots with the rail Home · Factory · Teammates · Wiki · Platform, both sections' APIs answer
    under `/factory/…`, and `/product/api/v1` is gone. Not checked in a browser: Chromium here lacks system libraries
    (`libatk`); `test/sections.test.js` renders a section page through the wrapper with the kit's API client instead.
    The e2e specs were updated but not run (they sign in as the sample people, BUG-006).
  - Notes: the e2e servers now always host the Factory (Product needs it); Infrastructure only for its story, through
    `FACTORY_SECTIONS`. The learning notes in `.claude/learning/` and the dated audits still name the old projects.
  - Steering: root `product.md` §4 and §9, `stack.md` §2–§3, `roadmap.md` (note at the top, Phases 16b–23, open work);
    host `product.md` §5.1, §5.7a, §10, `structure.md` §1, §2a, §4, `tech.md` §1, §2, §8, §8b; the Factory's
    `CLAUDE.md`, `.claude/steering/{product,structure,tech,Architecture}.md`; each section's `CLAUDE.md` and a note on
    its steering files.

- [ ] CHG-006 — The sidebar's groups are clearer: a header with an icon and a line, and a divider between groups · UI kit, Factory · nooblyjs-core, nooblyjs-ai-factory · Phase 16a+
  - Asked: 2026-10-19 · Status: fixed
  - What and why: the Factory's Product, Build and Infrastructure groups were small grey captions and ran together.
    The kit's `renderNav` now draws each group as its own block (`role="group"`, named by its header, so a screen reader
    hears "Product, group") with a divider above every group after the first, and a header in ink: the name, and, when
    the app describes it in its new `groups` field, a kit icon and a one-line hint. The Factory describes its three
    (Product · From signal to handoff; Build · Issues in, reviewed pull requests out; Infrastructure · Designs,
    environments and cost). Platform's Build and Govern get the clearer header without an icon or hint. At phone
    width the groups still fold into the one scrolling strip.
  - Check: host `kit.test.js` (the blocks, the header, the hint, a group with no entry, ungrouped rows: it found that a
    sidebar whose first row has no group, like Home's, would have broken, fixed before this was logged); factory
    `register.test.js` and `sections.test.js`; `/api/v1/shell` on a blank install carries the Factory's `groups`. Not
    looked at in a browser here (no Chromium libraries): please check the sidebar at desktop and phone width, and
    reload with the cache emptied, since `/ui/css/shell.css` may be cached.
  - Steering: nooblyjs-ai-host `structure.md` §2a (`groups`)

- [ ] CHG-007 — Infrastructure is an app of its own again, not a section of the Software Factory · Rail, Factory, Infrastructure · nooblyjs-ai-infrastructure, nooblyjs-ai-factory, nooblyjs-ai-host, monorepo root · Phase 16a+
  - Asked: 2026-10-20 · Status: fixed
  - What and why: "Infrastructure is not part of the factory. The factory should be Product, Design, Build, Test but
    provisioning of infrastructure is something different." This undoes the Infrastructure half of CHG-005; Product
    stays a section. `nooblyjs-ai-infrastructure` is back at the monorepo root as it was before CHG-005 (`index.js`,
    `server.js` standalone on :11008, its own `package.json`, tests, docs and pages in `public/`), hosted at
    `/infrastructure` with the rail label Infra. The Factory's `SECTIONS` (server and browser) list Product only, its
    sidebar is Product · Build, and `provides` is `{ product }`. The host lists it again (`SUITE_APPS`, the seeded
    `hosted-apps.yaml`, its `package.json`), links to `/infrastructure` (Platform · Environments and Containers, the
    perf script), and `src/hosted-apps.js` `UNFOLDED` + `foldData` move an install's `data/factory/infrastructure`
    back to `data/infrastructure` once, adding its `hosted-apps.yaml` entry (a line at the end) when it was missing. The
    monorepo scripts (`each.js`, `start:infrastructure`) and the steering sync have it again. CHG-006's Infrastructure
    group header goes with it: the Factory describes two groups now.
  - Check: Infrastructure 46/46; factory package 534, 527 pass (the line's 3 known failures, as in CHG-005); the
    Factory's `sections`, `register` and `module` tests 22/22; host 317, 122 pass, against 316 and 121 for the same tree
    without this change: no test that passed fails, and the new `foldData` test passes (the rest fail on the missing
    sample story, BUG-006). Not checked in a browser; the e2e specs were updated but not run (BUG-006).
  - Notes: the history notes in docs/phases, `.claude/learning/` and the dated audits still describe it as they were.
    Decided the same day: Quality is the Factory's Test section, not a separate app (root `product.md` §4, §9;
    `roadmap.md` Phase 20; `stack.md` §2; `design.md`).
  - Steering: root `product.md` §2, §4, §9, `stack.md` §2–§3, `roadmap.md` (note at the top, Phase 16b and later,
    open work); host `product.md` §5.1, §5.7, §5.7a, §10, `structure.md` §1, §2a, §4, `tech.md` (intro), §8, §8b,
    `CLAUDE.md`, `docs/mocking-audit.md`; the Factory's `CLAUDE.md` and `.claude/steering/{product,structure,tech,
    Architecture}.md`; `nooblyjs-ai-infrastructure/CLAUDE.md`.

## Closed

_Verified, won't fix, duplicates and changes moved to a phase, newest first._
