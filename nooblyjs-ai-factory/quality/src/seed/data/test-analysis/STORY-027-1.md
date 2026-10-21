---
storyId: STORY-027-1
itemId: PRD-027
title: See the driver on a live map
counter: 7
criteria:
  - text: "Given an order is out for delivery, when the customer opens tracking, then the driver's position is shown and is less than 30 seconds old"
    cases: [TC-027-1-1]
  - text: Given the order is delivered, when the driver marks it done, then their position is no longer shared with the customer
    cases: [TC-027-1-2]
cases:
  - id: TC-027-1-1
    criterion: 0
    title: "The driver's position is shown and is less than 30 seconds old"
    given: an order is out for delivery
    when: the customer opens tracking
    then: "the driver's position is shown and is less than 30 seconds old"
    level: e2e
    automate: true
    systems: [web-storefront, delivery-planner]
    status: ready
    readyBy: { id: lerato-m, name: Lerato M. }
    readyAt: '2026-10-09T08:50:00.000Z'
  - id: TC-027-1-2
    criterion: 1
    title: Their position is no longer shared with the customer
    given: the order is delivered
    when: the driver marks it done
    then: their position is no longer shared with the customer
    level: integration
    automate: true
    systems: [web-storefront, delivery-planner]
    status: draft
  - id: TC-027-1-3
    interface: IF-027-01
    title: "Driver app → delivery-planner: the agreed contract"
    given: Driver app calls delivery-planner
    when: the request is made as agreed
    then: "the answer has the agreed shape (courier.position every 10 s: { courierId, lat, lng, at })"
    level: contract
    automate: true
    systems: [delivery-planner]
    status: ready
    readyBy: { id: lerato-m, name: Lerato M. }
    readyAt: '2026-10-09T08:50:00.000Z'
  - id: TC-027-1-4
    interface: IF-027-02
    title: "delivery-planner → web-storefront: the agreed contract"
    given: delivery-planner calls web-storefront
    when: the request is made as agreed
    then: "the answer has the agreed shape (GET /orders/:id/tracking → { position, stopsAway, window })"
    level: contract
    automate: true
    systems: [delivery-planner, web-storefront]
    status: ready
    readyBy: { id: lerato-m, name: Lerato M. }
    readyAt: '2026-10-09T08:50:00.000Z'
  - id: TC-027-1-5
    interface: IF-027-03
    title: "web-storefront → Map tiles provider: the agreed contract"
    given: web-storefront calls Map tiles provider
    when: the request is made as agreed
    then: the answer has the agreed shape (tiles behind a MapTiles interface)
    level: contract
    automate: true
    systems: [web-storefront]
    status: draft
  - id: TC-027-1-6
    journey: See the driver on a live map
    title: See the driver on a live map, from start to end
    given: a customer starts to see the driver on a live map
    when: they go through it end to end
    then: every criterion of the story holds
    level: e2e
    automate: true
    systems: [web-storefront, delivery-planner]
    status: ready
    readyBy: { id: lerato-m, name: Lerato M. }
    readyAt: '2026-10-09T08:50:00.000Z'
  - id: TC-027-1-7
    nfr: NFR-027-05
    title: 'The map has a text alternative: a person checks it with a screen reader and the keyboard'
    given: 'The map has a text alternative ("2 stops away · arriving 18:10–18:25")'
    when: it is checked
    then: 'the target holds: WCAG 2.2 AA; no axe violations'
    level: manual
    automate: false
    systems: [web-storefront, delivery-planner]
    status: ready
    readyBy: { id: lerato-m, name: Lerato M. }
    readyAt: '2026-10-09T08:50:00.000Z'
draftedBy: { id: ada-quill, name: Ada Quill, kind: agent }
draftedAt: '2026-10-08T18:05:00.000Z'
sampleData: true
---

# Test analysis of STORY-027-1

Sample data of the seed story: one criterion has a ready test case, one a draft; the map tiles' contract test is a draft.
