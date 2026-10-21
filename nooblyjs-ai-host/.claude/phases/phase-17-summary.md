# Phase 17 — Strategy and the business case: summary

**Status:** built 2026-10-21, waiting for your review (started at your word, with the defaults, while 16a–16f wait for
theirs). Spec: `.claude/specs/phase-17-strategy-business-case/`. Root `product.md` §3.3 and §5 are what it builds. The
work is in `nooblyjs-ai-factory/product` (the hierarchy, business cases, the board, the pages), `nooblyjs-ai-host` (the
idea acceptance rule, spend by value stream, budgets by portfolio, the Business owner) and `nooblyjs-ai-infrastructure`
(cloud spend by item).

## What is there

| Area | What |
| --- | --- |
| The work hierarchy | Under a portfolio (and optionally one of its value streams): **portfolio epics** (`PEPIC-001`), **epics** (`EPIC-001`, under a portfolio epic or the portfolio) and **features** (`FEAT-001`, under an epic), in the Product section's `catalogue.yaml`, each with a document from its template (new templates in Settings: Portfolio epic, Epic, Feature). Added on the Portfolios page (`draft`); where each may sit is checked |
| Ideas under features | An idea names its feature (refused when there is no such feature). The board shows each idea's feature, filters by epic and by feature with counts, and New idea can file under a feature |
| The business case | On an idea or an epic (`business-cases/<id>.md`): value hypothesis, who benefits, the measure (what, today, target), the cost estimate (agent spend, cloud a month, people's days) and the horizon are required; risks optional. **Ask Ada to draft it**: a teammate task that fills what is empty, with the estimate drawn from the factory's history of similar items (the same product, else value stream). Each number says where it came from: agent spend from the event log, a month of infrastructure in production from Infrastructure's design, working days in Product, Design and Engineer from the lifecycle. The measure's target is left for a person. A person edits it (an agent never saves one); a number they set says it is theirs |
| Accepting an idea | The Discover exit (`idea` rule: Business owner, `approve`, 3 working days, readiness needed): the readiness check **"Business case complete"** comes from the Product section; the business case page's Accept opens the idea's lifecycle item when it has none, and the idea moves to Product. An override needs a reason |
| Budgets by portfolio | Platform · Settings · Budgets: a monthly budget per portfolio, beside the per-system ones (`PUT /api/v1/platform/settings/budgets/portfolios/:name`, `set-budgets`, audited, `budget.changed`). It pauses nothing |
| Spend by value stream | Home · Metrics: this month's agent spend (each `spend` fact that names an item, through the item's parents to its product's value stream) and cloud spend (Infrastructure's ledger shared across its environments by their cost a day, through each one's design to its item), each portfolio against its budget, and what can't be placed said |
| The Business owner | The work role (its onboarding card: decide business cases, watch spend against budget, shape the work) and its home: business cases waiting, ideas ready to accept, epics with none, the first portfolio's spend against budget, spend by portfolio and by value stream |
| The seed | The Product section's sample spend now names the specs it was for (PRD-031, PRD-027, PRD-029, PRD-030), so spend is placed in Digital Commerce and Rewards |

## The test script

Run in the real app by `test/strategy.test.js`, every step passing, with the Factory and Infrastructure hosted:

1. Priya adds EPIC-001 · Same-day everything under Digital › Digital Commerce and FEAT-001 · See capacity by store
   under it (each with its document), and files IDEA-021 under FEAT-001. The board filtered by FEAT-001 (or EPIC-001)
   shows only IDEA-021; the Digital Commerce board lists the epic and the feature with their counts.
2. Lerato's Accept is refused (`readiness_failed`: "Business case not complete: there is none yet"). Ada drafts it:
   "Customers of Delivery…", and an estimate from the Delivery product's specs: agent spend ("The median agent spend
   of … similar items in the Delivery product (PRD-031 $…), from the event log"), cloud ("PRD-031: INF-031 at $… a day,
   from Infrastructure") and people's days ("… PRD-031 …, from the lifecycle"). The measure's target is still missing,
   so Accept is still refused; Lerato sets it, the case is complete, and Accept moves IDEA-021 to Product.
3. Priya can't set a portfolio budget (an Owner's); Stevie sets Digital to $5,000. Metrics' spend by value stream:
   Digital Commerce with agent and cloud spend (PRD-031 among its items), Rewards with agent spend, and Digital
   "$… of $5,000 this month".
4. Lerato as a Business owner: the home's tiles are business cases waiting, ideas ready to accept, epics without a
   case, and "Digital this month" ("of $5,000 · agent $…, cloud $…"); EPIC-001 and IDEA-018 are among the cases waiting,
   IDEA-021 isn't.

## Tests

- New in the host: `test/strategy.test.js` (4: the test script), `test/services/places.test.js` (2),
  `test/lifecycle/ideas.test.js` (2). In the Product section: `product/test/services/business.test.js` (3). In
  Infrastructure: `test/cost-by-item.test.js`.
- Changed: the lists that name every approval rule, work role and template (`people.test.js`, `story.test.js`,
  `blank.test.js`, the Product section's `strategy.test.js`) now include the `idea` rule, the Business owner and the
  three new templates.
- **Whole suites:** host 377 of 377 pass (369 before this phase). Factory 583 of 587 pass, 4 skipped, none failing
  (580 of 584 before). Infrastructure 48 of 48 (47 before). No test that passed before fails.

## Decisions taken while building

- **"Accepted" is the lifecycle's to give**: a person can't set an idea's status to accepted by editing it; Accept does,
  after the lifecycle engine records the decision.
- **An item in Discover that isn't an idea has no checks**, so nothing else is held by the business case check.
- **A spend fact carries its item** (Metrics' roll-ups are version 3); spend is placed through the item's parents, so a
  pull request's run counts for its story's item.
- **Cloud spend is shared by cost a day** across a kind's environments, because Infrastructure's ledger is by kind; an
  environment of no design is "unattributed".
- **The Business owner is listed after the Product manager** in onboarding, so the PM card stays first.

## Open questions

1. **The hierarchy against Design's features and Jira** `[CONFIRM]`: Design's `FEAT-031-1` stay per item for now; should
   a story's feature be a hierarchy feature (Phase 18)? Should Jira get epics and features?
2. **The estimate** is the median of similar items' history: is it trusted enough to use (the roadmap's guide point)?
   With no history it says so and is 0 until a person sets it.
3. **Who accepts an idea**: the `idea` rule waits on `approve` (Approvers and up), named "Business owner" as root
   `product.md` §5 says; the 3 working days are its `[CONFIRM]`.
4. **Renaming and removing** epics and features isn't built (their documents can be edited).
5. Not looked at in a browser here: the Portfolios page's work, the business case page, the hierarchy's documents,
   Platform's budgets by portfolio, the Metrics card and the Business owner's home. The tests read their APIs; the e2e
   specs were not run.

## Guide points (roadmap)

Is the cost estimate trusted enough to use? Does Jira need the hierarchy too?
