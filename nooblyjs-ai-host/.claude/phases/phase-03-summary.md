# Phase 3 — People, onboarding and "For you" homes: summary

**Status:** done. Built 2026-10-09 and signed off. Spec: `.claude/specs/phase-03-people-onboarding/`.

To see it, run `npm run seed -- --reset` (it wipes `data/`) and `npm start`. The seeded profiles now carry
first-week state, and Naledi has no profile, so she is the person to sign in as for onboarding.

## What was built

| Area | What |
| --- | --- |
| Work roles | `data/config/work-roles.yaml`: the six roles with the mockup's onboarding copy (blurb, promise, three tasks, what the home leads with, agents, tools, first three things, where "Open my home" goes) and, per first-week task, the event that completes it |
| Profiles | `src/services/profiles.js` and `GET/PUT /api/v1/me/profile`: work role, teams, tools, the Teams toggle, onboarding state and first-week state in `data/people/<id>/profile.md`. No permission check reads it |
| Onboarding | `/onboarding` (no rail, its own layout): four steps with the step list, role pre-selected from the job title, teams with counts and "Suggested", tools, "You're set". Back, Skip for now, Continue and the browser's Back all work. A person with no profile is redirected there from any page. **Change role** reopens it with the current choices |
| First week | Tasks are ticked only by events: the host listens to every event and ticks the actor's matching tasks. Home's sidebar shows **Getting started** (n of 4, next task) while tasks are open; **Hide** puts it away |
| For you | `GET /api/v1/home/for-you` and one page per role (`public/js/pages/home/for-you*.js`): greeting by time of day, a summary in words, Change role and one primary action, the filter row with **Show everything**, four tiles, the role's panels and Your first week. Designer, Engineering lead and Platform engineer see the Overview with a line saying why |
| Decisions from a home | **Accept** (Architect) and **Nudge** (PM) call the lifecycle engine, so the same rules apply as on Approvals. Accept is offered only where the engine says the person may decide |
| Teams & roles | Team cards (people round, agents square), the roles × permissions matrix read from `roles.yaml`, the members table with approvals in 30 days, the approval rules (read-only), and **Invite a person** (Owners), which creates the record, the team membership and the sign-in account at once |
| `nooblyjs-ai-workflows` | `services.snapshot(person)` (everything a home needs in one read) and `POST items/:id/nudge` (at most once every 4 hours per item) |

## Test script result (roadmap Phase 3)

Run on 2026-10-09 in a real browser (`test/e2e/people.spec.js`) and at the API (`test/people.test.js`).

| Step | Result |
| --- | --- |
| 1. Naledi goes straight to onboarding; Product manager is pre-selected | PASS |
| 2. Step through, pick Delivery squad, Teams toggle stored, Open my home | PASS |
| 3. PM home greets Naledi; "My items · Delivery squad"; Show everything widens the counts | PASS (7 items → 10). The greeting follows the time of day |
| 4. Skip for now: a home with a Getting started card, onboarding offered again | PASS, shown with a person invited from Teams & roles (Naledi has already onboarded by then) |
| 5. Lerato approves PRD-031 from her home; the task ticks; 2 of 4 | PASS **as amended**: she already approved PRD-031 in the seed story, so she starts at 2 of 4. Her home leads with PRD-029, PRD-032 and a Nudge |
| 6. Thabo's Architect home: ADR-014 and ADR-015 with Accept / Discuss, standards, models | PASS, and extended: accepting ADR-014 ticks "Decide on ADR-014" live and the card goes to 2 of 4. The standards and models panels name Phases 7 and 8 |
| 7. Priya's Developer home: 3 PRs and "Run 213 is asking you" | PASS **as amended**: 2 PRs (what the seed has). The runs and question panels say they arrive with the Software Factory in Phase 7 |
| 8. Priya changes role to Architect: the home changes, approving ADR-014 is still refused | PASS: no Accept is offered, and the API answers 403 with her access role |

Tests: `nooblyjs-ai-host` 91 of 91, `nooblyjs-ai-workflows` 23 of 23. `npm run test:e2e`: 29 of 29, with 0 WCAG AA violations on
onboarding (all four steps), the three homes and Teams & roles, and no sideways scroll at 375px.
`nooblyjs-ai-product` was not changed in this phase and was not re-run.

## Decisions I took that need your confirmation

1. **Step 5 was changed** (above), because Phase 2's Approvals screen already shows Lerato as having approved PRD-031.
2. **Step 7 was changed** (above). Runs and their questions are in Phase 7's build list; I did not seed fake ones.
3. **Panels with no source yet show an honest zero and the phase**, not the mockup's sample numbers: standards
   broken on PRs, models to review, runs, "idea → production" on Shipped this month.
4. **Inviting a person needs the `hire-teammates` permission** (Owners). The matrix has no "manage members" row.
5. **Roles without a For you layout** (Designer, Engineering lead, Platform engineer) see the Overview on `/`,
   and "Open my home" takes them where the onboarding mockup says (Overview, or Platform · Repositories).
6. **Skip for now** records a skipped profile with the suggested role, so the person isn't redirected on every page.
7. **Stevie's first week is hidden in the seed**, so his sidebar keeps the systems card the Overview mockup shows.
8. **Tools and "Send approvals to me in Teams" are stored only**. The tools step uses checkboxes with a note,
   not "Connect" buttons, because nothing connects until Phases 11 and 12.

## Not built, or different from the mockups

- **Editing the approval rules** in Teams & roles: shown read-only (not in this phase's build list).
- **Agent models** in the members table ("Agent · Opus"): shown as "Agent" until Teammates shares them (Phase 6).
- **"Microsoft account"** after "Signed in as" on onboarding, and **"Suggested · you're in its Teams channel"**:
  the suggestion is "you are on this team" until Microsoft 365 arrives (Phase 11).
- **Top signals for your domain** shows the board's top three signals overall, read from the Product Factory in
  the browser; it isn't filtered by the PM's domain.
- First-week tasks whose event no app emits yet (pin a Knowledge space, review a PR, answer a run) can't tick yet.
- The mockup's team sizes (5 people, 4 people…) are sample data; the cards count the seeded people.

## Guide points for your review

- Is each home leading with the right thing? Compare with `brief/noobly-for-you-{product-manager,architect,developer}`.
- Is the onboarding copy right? It is all in `data/config/work-roles.yaml`.
- Decide whether to commission the three missing "For you" designs (`product.md` §12 Q12).
