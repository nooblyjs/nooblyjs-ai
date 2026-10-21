# Phase 3 — People, onboarding and "For you" homes: requirements

> **Status: done, built 2026-10-09.** Summary: `.claude/phases/phase-03-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

> Source: `.claude/steering/roadmap.md` Phase 3. Goal: a new person is guided to their role, teams and
> first tasks, and every role lands on a home built for them. Repos: `nooblyjs-ai-host`, plus two small additions
> in `nooblyjs-ai-workflows` (a snapshot service for the homes, and Nudge).

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| Job title → work role (`data/access/job-title-roles.yaml`) | Kept as seeded (first matching rule wins). The onboarding copy per role (blurb, promise, tasks, tools, first three things, where it lands) is data in `data/config/work-roles.yaml`, from the mockup |
| Where Designer, Engineering lead and Platform engineer land (`product.md` §12 Q12) | As the onboarding mockup: Designer and Engineering lead on **Overview**, Platform engineer on **Platform · Repositories**. Their **For you** page shows the Overview with a line saying their own layout isn't designed yet |
| First-login redirect | A signed-in person with **no profile** is sent to `/onboarding` by the server, from any page. **Skip for now** writes a profile marked skipped, so they land on a home with a Getting started card that offers onboarding again |
| Step 5 says Lerato approves PRD-031 from her home | She already approved it in the seed (Phase 2 shows "Lerato M. approved"). So her first week starts at **2 of 4**, and the live tick is shown by **Thabo accepting ADR-014** from his home (step 6) `[CONFIRM]` |
| Step 7 says Priya sees 3 PRs and "Run 213 is asking you" | PRs come from the lifecycle's PR items: the seed has **2** in flight. Runs and their questions belong to the Software Factory (Phase 7, which lists "Run asking you" in its build). The panel is there and says so `[CONFIRM]` |
| Panels whose source isn't built (standards broken on PRs, models to review, runs, shipped idea → production) | Shown with an honest zero and the phase that fills them. No sample numbers in pages |
| "Good morning, Naledi" | The greeting follows the time of day in the browser |
| Tool connections and "Send approvals to me in Teams" | Stored on the profile only (roadmap: "stored only for now"). Nothing is connected until Phases 11 and 12 |
| Who may invite a person | Owners (the `hire-teammates` permission, the closest in the matrix) `[CONFIRM]` |
| Editing approval rules in Teams & roles | Not in this phase's build list. The page shows the rules read-only |

## Requirements

### R1 — Profiles
1. `GET /api/v1/me/profile` SHALL return the person's work role, teams, tool connections, notification
   preferences, onboarding state and first-week checklist. `PUT` SHALL change them, validating the work
   role and the teams. It is stored in `data/people/<id>/profile.md`.
2. **The work role SHALL never reach a permission check.** A test changes it and proves approval is still refused.

### R2 — Onboarding (`/onboarding`, mockup `noobly-platform-onboarding-first-login`)
1. Four steps with a step list: role (six cards, one pre-selected from the job title, saying where the
   guess came from), what you'll do (promise, three tasks, what the home leads with, the agents), teams
   and tools (teams with people and agent counts, "Suggested" for teams the person is in, two tools,
   the Teams toggle), and "You're set" (summary, first three things, **Open my home**).
2. **Back / Skip for now / Continue** SHALL work by keyboard, and the page SHALL pass axe and fit 375px.
3. **Change role** (on every For you page) SHALL reopen it with the current choices.

### R3 — First week and Getting started
1. The first-week checklist is "Pick your role and teams" plus the role's first three things. Each task
   names the event that completes it; **only an event marks a task done**.
2. While tasks are open and the card isn't hidden, Home's sidebar SHALL show **Getting started** (n of m,
   next task) instead of the systems card. **Hide** hides it.

### R4 — For you (`/`, mockups `noobly-for-you-*`)
1. Product manager, Architect and Developer SHALL each get: greeting and a summary in words, Change role
   and one primary action, the filter row with **Show everything**, four tiles, their panels, and
   Your first week.
2. Data SHALL come from `GET /api/v1/home/for-you`, filtered to the profile's teams, or everything with `?scope=all`.
3. Decisions taken from a home (Accept an ADR, Nudge) SHALL go through the same server rules as Approvals.

### R5 — Teams & roles (`/home/teams`, mockup `noobly-teams-roles`)
1. Team cards (people round, agents square, focus), the roles × permissions matrix read from
   `roles.yaml`, and the members table (name, kind, team, access role, approvals in 30 days).
2. **Invite a person** SHALL create their NooblyJS record and sign-in account (Owners only, audited).
   **Hire a teammate** links to Teammates.

## Done when
Steps 1–8 of the Phase 3 test script pass at desktop and phone width, with the two amendments above.
