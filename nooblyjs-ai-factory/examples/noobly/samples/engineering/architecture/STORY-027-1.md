---
storyId: STORY-027-1
itemId: PRD-027
title: See the driver on a live map
draftedBy: { id: rhea-voss, name: Rhea Voss, kind: agent }
draftedAt: '2026-10-08T17:20:00.000Z'
note: Drawn from the code on each repository's main branch and the Knowledge Repository. Sample data of the seed story.
systems:
  - repo: acme/web-storefront
    name: web-storefront
    status: accepted
    acceptedBy: { id: thabo-n, name: Thabo N. }
    acceptedAt: '2026-10-09T08:40:00.000Z'
    readAt: { branch: main, commit: 4f2c9a1 }
    stale: false
    flow:
      - The customer opens Track my order (/orders/:id/track) from the order page or the out-for-delivery email.
      - TrackingPage asks the API gateway for GET /orders/:id/tracking (IF-027-02), answered by delivery-planner.
      - MapView draws the driver's position on tiles from the MapTiles interface (IF-027-03; the provider is ADR-015).
      - The page asks again every 10 seconds while the order is out for delivery, and stops when it is delivered.
      - TrackingSummary says the same in words for screen readers ("Your driver is 2 stops away").
    objects:
      - { name: TrackingSnapshot, kind: value, fields: [orderId, 'position (lat, lng, at)', stopsAway, 'window (from, to)', status], note: 'From IF-027-02; never stored in the browser' }
      - { name: MapTiles, kind: interface, fields: ['tileUrl(z, x, y)', attribution], note: 'One implementation per provider, chosen by ADR-015' }
      - { name: TrackingPage, kind: component, fields: [snapshot, refreshTimer, error], note: 'New, under src/tracking/' }
    nfrs:
      - { component: TrackingPage, requirement: 'First map shown at p95', target: '< 1 s on 4G', from: NFR-027-01 }
      - { component: TrackingSummary, requirement: 'A text alternative for the map', target: 'WCAG 2.2 AA', from: NFR-027-05 }
      - { component: MapView, requirement: 'Tiles cached for the session', target: '[PLACEHOLDER: tiles per order]', from: NFR-027-06 }
    changes:
      - { kind: new, path: src/tracking/, what: 'TrackingPage, MapView, TrackingSummary and the MapTiles interface' }
      - { kind: changed, path: src/routes.js, what: 'The /orders/:id/track route, behind the tracking-map flag' }
      - { kind: changed, path: src/orders/OrderPage.js, what: 'A Track my order link while the order is out for delivery' }
  - repo: acme/delivery-planner
    name: delivery-planner
    status: proposed
    readAt: { branch: main, commit: b91e07d }
    stale: false
    flow:
      - The driver app sends courier.position every 10 seconds (IF-027-01); PositionConsumer keeps the latest per courier.
      - TrackingController answers GET /orders/:id/tracking with the position, the stops before this order and the arrival window from RoutePlanner.
      - When the driver marks the order delivered, OrderDelivered removes the order's position share.
    objects:
      - { name: CourierPosition, kind: entity, fields: [courierId, lat, lng, at], note: 'Latest only; kept in the position cache [CONFIRM: Redis or Postgres]' }
      - { name: Route, kind: entity, fields: [courierId, 'stops (orderId, eta)'], note: 'Existing' }
      - { name: PositionShare, kind: entity, fields: [orderId, courierId, until], note: 'New: ends at delivery (NFR-027-04)' }
    nfrs:
      - { component: PositionConsumer, requirement: 'Position age when read', target: 'p95 < 30 s', from: NFR-027-01 }
      - { component: OrderDelivered, requirement: 'The share ends at delivery', target: 'Within 1 minute', from: NFR-027-04 }
    changes:
      - { kind: new, path: src/main/java/acme/planner/tracking/, what: 'TrackingController and PositionConsumer' }
      - { kind: changed, path: src/main/java/acme/planner/route/RoutePlanner.java, what: 'Stops before an order, and its arrival window' }
sampleData: true
---

STORY-027-1's application architecture, per impacted system. web-storefront's is accepted; delivery-planner's is
proposed, waiting on the Application Architect. Phase 16d drafts these from the code and marks them stale when main moves.
