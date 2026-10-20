---
id: apr_adr013
type: adr
itemId: PRD-031
subject: ADR-013
title: Release expired holds through events, not polling
from: null
to: null
requestedBy:
  id: rhea-voss
  name: Rhea Voss
  kind: agent
requestedAt: '2026-10-07T10:00:00.000Z'
reviewers:
  - id: stevie
    role: Engineering
    status: approved
    at: '2026-10-07T15:30:00.000Z'
status: approved
decidedAt: '2026-10-07T15:30:00.000Z'
decidedBy: stevie
sampleData: true
---

The Slot API publishes slot.released on the existing event bus when a hold expires.
