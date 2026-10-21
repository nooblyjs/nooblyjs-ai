# Phase 17 — Strategy and the business case: requirements

> **Status: done, signed off 2026-10-21** (built 2026-10-21). Summary: `.claude/phases/phase-17-summary.md`. Root `product.md` §3.3, §5; root `roadmap.md` Phase 17. Bugs found
> while reviewing it go in `.claude/specs/bugs-and-changes/`.

> Asked 2026-10-21: "Please continue with next phase" (16a–16f still waiting for review).

Goal: work can be followed from a strategic theme to an item, each idea has a business case, and spend can be seen by
value stream.

## Decisions taken before starting (2026-10-21, the defaults)

- **The work hierarchy** (`product.md` §9 Q3). Under a portfolio (and optionally one of its value streams): a
  **portfolio epic** (`PEPIC-001`), an **epic** (`EPIC-001`, under a portfolio epic or straight under the portfolio) and a
  **feature** (`FEAT-001`, under an epic). They live in the Product section's catalogue, each with a document made from
  its template, like portfolios. **An idea belongs to a feature** (optional), and its spec follows its idea. Design's
  per-item features (`FEAT-031-1`) stay the slices an item's stories build; linking them to a hierarchy feature, and
  "a spec's requirements are the feature's", are left for Phase 18 `[CONFIRM]`. **Jira** keeps only the stories (no
  epics or features are written there) `[CONFIRM]`.
- **The business case template.** On an idea or an epic: **value hypothesis**, **who benefits**, the **measure**
  (what, today, target), the **cost estimate** (agent spend, cloud spend a month, people's days, each with where it came
  from) and the **horizon** (months) are required; **risks and assumptions** is optional. It is complete when every
  required field is filled. An agent drafts it (a teammate task: Ada Quill stands in, as for Design's drafts); a person
  edits it.
- **The estimate** is drawn from the factory's own history of similar items (the same product, else the same value
  stream): agent spend per item from the event log, cloud spend from Infrastructure's environments built for them, and
  people's days from the lifecycle (the working days those items spent in Product, Design and Engineer). Each number
  says which items it came from, or that there is no history yet.
- **Accepting an idea** is the Discover exit, a person's (`approve`), gated by the readiness check **"Business case
  complete"** (an override needs a reason). The Product section's Accept opens the idea's lifecycle item when it has none.
- **Budgets by portfolio** sit beside the per-system budgets in Platform · Settings · Budgets (monthly). **Spend by value
  stream** in Metrics is this month's: agent spend (events that name an item, through the item's product) and cloud
  spend (Infrastructure's ledger shared across its environments by their cost a day, through each environment's design
  and its item); what can't be placed is said.

## R1 — The work hierarchy
1. Add a portfolio epic, an epic and a feature (`draft`), each with its document from its template.
2. An idea names its feature; the board filters by epic and by feature, with counts, and its cards say their feature.

## R2 — The business case
1. On an idea or an epic: the fields above; Ask Ada to draft it (the estimate with its sources); a person edits it.
2. An idea can't be accepted until its business case is complete (the Discover readiness check), unless a person
   overrides with a reason.

## R3 — Budgets and spend
1. Platform · Settings · Budgets: a monthly budget per portfolio (`set-budgets`).
2. Home · Metrics · Spend by value stream: agent and cloud spend this month per value stream, each portfolio against
   its budget.

## R4 — The Business owner
The work role, its onboarding card and its For you home: business cases waiting (ideas whose case is incomplete or
whose acceptance waits; epics without one) and spend against budget per portfolio.

## Test script (roadmap Phase 17)
1. Add an epic and a feature under Digital › Digital Commerce; file an idea under the feature. The board filters by it.
2. The idea can't be accepted until its business case is complete; ask an agent to draft it and see an estimate with
   where its numbers came from.
3. Set a budget for the Digital portfolio; Metrics · Spend shows agent and cloud spend by value stream.
4. Sign in as a Business owner: the home leads with business cases waiting and spend against budget.

**Done when:** steps 1–4 pass, and no test that passed before fails.

## Out of scope
Outcome reviews rolling up to themes (Phase 23); the hierarchy in Jira; requirements under features (Phase 18).
