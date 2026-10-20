---
id: apr_story0271design
type: design-handoff
itemId: STORY-027-1
subject: STORY-027-1
title: See the driver on a live map
from: design
to: engineer
requestedBy:
  id: thabo-n
  name: Thabo N.
  kind: person
requestedAt: '2026-10-08T15:30:00.000Z'
dueAt: '2026-10-09T15:30:00.000Z'
reviewers:
  - id: thabo-n
    role: Solution Architect
    status: approved
    at: '2026-10-08T15:30:00.000Z'
workItems:
  - repo: web-storefront
    title: See the driver on a live map
  - repo: delivery-planner
    title: See the driver on a live map
repoCount: 2
override:
  by: thabo-n
  reason: ADR-015 is decided in Friday's architecture review; the map is built behind a tiles interface either way.
  at: '2026-10-08T15:30:00.000Z'
  failing:
    - decisions-decided
status: approved
decidedAt: '2026-10-08T15:30:00.000Z'
decidedBy: thabo-n
sampleData: true
---

STORY-027-1's Design handoff: two work items, one per impacted system it touches.
