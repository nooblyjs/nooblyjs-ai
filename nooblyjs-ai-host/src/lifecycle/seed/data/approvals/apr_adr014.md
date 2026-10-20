---
id: apr_adr014
type: adr
itemId: PRD-031
subject: ADR-014
title: Cache slot availability in Redis
from: null
to: null
requestedBy:
  id: rhea-voss
  name: Rhea Voss
  kind: agent
requestedAt: '2026-10-08T16:00:00.000Z'
reviewers:
  - id: stevie
    role: Engineering
    status: waiting
  - id: thabo-n
    role: Architect
    status: waiting
cost:
  usd: 1.95
  note: Drafted with the container view
status: open
sampleData: true
---

Cache slot availability per store in Redis with a 30-second TTL, refreshed on slot.released. A new dependency (Redis); the alternative is a Postgres materialised view.
