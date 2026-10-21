# Phase 3 — People, onboarding and "For you" homes: tasks

> **Status: done, built 2026-10-09.** Summary: `.claude/phases/phase-03-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.
> `nooblyjs-ai-workflows` below is now the lifecycle engine inside `nooblyjs-ai-host` (`src/lifecycle/`, since 2026-10-10).

- [x] 1. `work-roles.yaml` (the six roles' onboarding copy and first-week tasks), work-roles and profiles services, `/api/v1/me/profile`
- [x] 2. Onboarding: API (content, complete, skip), the `/onboarding` page, the redirect for a person with no profile
- [x] 3. First week: tasks ticked from events, the Getting started sidebar card, Hide
- [x] 4. `nooblyjs-ai-workflows`: `services.snapshot()`, `POST items/:id/nudge`
- [x] 5. For you: `/api/v1/home/for-you` for PM, Architect and Developer; the three pages; Show everything; other roles get Overview
- [x] 6. Teams & roles: team cards, permissions matrix, members table, Invite a person
- [x] 7. Seed: profiles with first-week state, more people on teams as needed
- [x] 8. Tests: services and API, the work-role-never-grants-permission rule, e2e + axe for the test script at desktop and phone width
- [x] 9. Steering docs, roadmap steps 5 and 7, the phase summary
