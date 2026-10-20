---
id: apr_prd031spec
type: spec
itemId: PRD-031
subject: null
title: Same-day delivery slots
from: product
to: design
requestedBy:
  id: ada-quill
  name: Ada Quill
  kind: agent
requestedAt: '2026-10-08T08:00:00.000Z'
artefactVersion: 4
reviewers:
  - id: lerato-m
    role: Product lead
    status: approved
    at: '2026-10-09T07:40:00.000Z'
    comment: Two comments on the goals; fine to go once the rollout plan is in.
  - id: stevie
    role: Engineering
    status: waiting
cost:
  usd: 7.4
  note: Research + 4 drafts
next: >-
  Design starts the business requirements and the solution architecture; Rhea Voss (architect agent) drafts the
  container view and decisions.
status: open
sampleData: true
---

Customers book a same-day delivery slot and it is held for 10 minutes while they pay. The slot list must load in under 300 ms at p95 during the 18:00 peak. Pilot in [PLACEHOLDER: number] stores.
