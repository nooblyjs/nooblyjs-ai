---
id: apr_slotsapi482
type: build-approval
itemId: slots-api-482
subject: 'slots-api #482'
title: Slot hold & release endpoints
from: build
to: test
requestedBy:
  id: juno-park
  name: Juno Park
  kind: agent
requestedAt: '2026-10-09T08:30:00.000Z'
reviewers:
  - id: stevie
    role: Code owner
    status: waiting
context: Gates passed on a retry · 6 files · +214 −12 · run 213
cost:
  usd: 3.1
  note: Run 213
status: open
sampleData: true
---

POST /slots/:id/hold and the release on expiry (ADR-013). Contract tests passed on the second try.
