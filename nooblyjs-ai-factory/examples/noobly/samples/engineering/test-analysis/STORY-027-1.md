---
storyId: STORY-027-1
itemId: PRD-027
title: See the driver on a live map
draftedBy: { id: test-agent, name: Test agent, kind: agent }
draftedAt: '2026-10-08T18:05:00.000Z'
criteria:
  - text: "Given an order is out for delivery, when the customer opens tracking, then the driver's position is shown and is less than 30 seconds old"
    cases: [TC-027-1-1, TC-027-1-2, TC-027-1-3]
  - text: Given the order is delivered, when the driver marks it done, then their position is no longer shared with the customer
    cases: [TC-027-1-4]
cases:
  - { id: TC-027-1-1, title: 'Tracking shows the driver, and the position is under 30 s old', level: e2e, automate: true, status: ready, readyBy: { id: lerato-m, name: Lerato M. }, journey: Track an order from dispatch to the door }
  - { id: TC-027-1-2, title: 'GET /orders/:id/tracking answers the agreed shape', level: contract, automate: true, status: ready, readyBy: { id: lerato-m, name: Lerato M. }, interface: IF-027-02 }
  - { id: TC-027-1-3, title: 'A courier.position event is the position served within 10 s', level: integration, automate: true, status: ready, readyBy: { id: lerato-m, name: Lerato M. }, interface: IF-027-01 }
  - { id: TC-027-1-4, title: 'After delivery the tracking answer has no position', level: integration, automate: true, status: draft }
  - { id: TC-027-1-5, title: 'A screen reader hears where the driver is and when they arrive', level: manual, automate: false, status: ready, readyBy: { id: lerato-m, name: Lerato M. }, why: 'A person checks it with VoiceOver and NVDA' }
interfaces:
  - { id: IF-027-01, cases: [TC-027-1-3] }
  - { id: IF-027-02, cases: [TC-027-1-2] }
  - { id: IF-027-03, cases: [] }
journeys:
  - { name: Track an order from dispatch to the door, cases: [TC-027-1-1] }
sampleData: true
---

STORY-027-1's test analysis: test cases from its acceptance criteria, which the AI must automate and at which level,
an integration test per interface and an E2E test per journey, and what a person checks by hand. A test analyst marks
each case ready. Sample data of the seed story; Phase 16d drafts and edits them.
