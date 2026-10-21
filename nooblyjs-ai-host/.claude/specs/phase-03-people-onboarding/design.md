# Phase 3 — People, onboarding and "For you" homes: design

> **Status: done, built 2026-10-09.** Summary: `.claude/phases/phase-03-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

## Pieces

```
nooblyjs-ai-host
  src/services/work-roles.js   the six work roles and their onboarding copy (data/config/work-roles.yaml), job title → role
  src/services/profiles.js     profile.md: read, validate, save; first-week state; ticks tasks from events
  src/services/teams.js        teams with their people and agents; the matrix rows; the members table
  src/services/for-you.js      per-role home data from nooblyjs-ai-workflows' snapshot, scoped to the profile's teams
  src/routes/me.js             /api/v1/me/profile · /api/v1/me/onboarding (GET content, POST complete, POST skip)
  src/routes/home.js           + /api/v1/home/for-you · /api/v1/home/teams · POST /api/v1/home/people (invite)
  src/pages/onboarding.js      the /onboarding page (no rail; kit CSS + css/onboarding.css + one module)
  public/js/pages/onboarding/steps.js
  public/js/pages/home/for-you.js (+ for-you-pm.js, for-you-architect.js, for-you-developer.js, panels.js) · teams.js
nooblyjs-ai-workflows
  services.snapshot(person)    every item row, open approval (with its summary and who may decide) and stage health
  POST items/:id/nudge         a person nudges whoever an item waits on (at most once every 4 hours per item)
```

## Profile (`data/people/<id>/profile.md`)

```yaml
person: thabo-n
workRole: architect             # shapes the home only; never read by a permission check
teams: [delivery-squad]
tools: { github: false, enterprise-knowledge-repository: false }   # stored only until Phases 11–12
notifications: { approvalsInTeams: true }
onboarding: { completed: true, skipped: false, completedAt: … }
firstWeek:
  hidden: false
  done: { pick-role-and-teams: { at: …, event: profile.onboarded } }
```

## First week

Each role in `work-roles.yaml` has `firstWeek: [{ key, text, short, done: { type, where: { path: value } } }]`.
`pick-role-and-teams` is common to all and completes on `profile.onboarded`. The host listens to every
event; when the actor has a profile and an open task whose `done` matches (the event type, and every
`where` value against the payload), it records it in `firstWeek.done` and emits `profile.first_week_progressed`.
Tasks whose event doesn't exist yet (Knowledge pins, PR reviews) simply stay open.

## For you data (`GET /api/v1/home/for-you?scope=mine|all`)

`{ role, home, scope, filters: { what, teams }, summary, tiles: [4], panels: { … }, firstWeek, agent }`.
"Mine" is items owned by the person or belonging to their teams. Per role:

| Role | Tiles | Panels |
| --- | --- | --- |
| Product manager | specs waiting on you · your items in flight · shipped this month · new signals | Waiting on you (Review / Preview / Nudge) · Your items (swimlane) · Top signals (from the Product Factory's API) · your agent |
| Architect | decisions awaiting you · in Architecture (median, target) · standards broken on PRs · models to review | Decisions awaiting sign-off (Accept / Discuss / Open diagram) · Architecture queue · Standards on PRs · Models to review |
| Developer | PRs to review · runs on your repos · needs help · merged this week | PRs waiting for you · Runs on your repos · a run asking you · your engineering teammate |

A source that isn't built returns `{ value: 0, note: '… arrives in Phase N' }` for a tile and
`{ unavailable: { phase, text } }` for a panel.

## Onboarding flow

`GET /onboarding` (signed in) is a server-rendered page with the kit's CSS and one module. The module
loads `GET /api/v1/me/onboarding` (roles with their copy, the suggested role and why, teams with
counts and suggestions, the current profile) and keeps the step in the URL (`?step=2`).
`POST /api/v1/me/onboarding` saves role, teams, tools and the toggle, marks it completed, emits
`profile.onboarded` and answers with where to go. `POST /api/v1/me/onboarding/skip` writes a skipped
profile. The frame handler redirects a person with no profile to `/onboarding`.
