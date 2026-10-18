# Bugs and changes: tasks

> The log. Rules: `requirements.md`; how a fix is made: `design.md`.
> **Next IDs: BUG-006, CHG-004.** Status: open → fixing → fixed → verified. Only you tick a box, once it is
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

## Closed

_Verified, won't fix, duplicates and changes moved to a phase, newest first._
