---
itemId: PRD-027
counters:
  requirement: 6
  nfr: 7
  feature: 3
  interface: 5
  technical: 4
  story: 3
requirements:
  - id: BR-027-01
    text: Calls asking where the driver is, per week goes from 1,900 to 600.
    source:
      section: Goals
      quote: Calls asking where the driver is, per week
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    status: accepted
    acceptedBy:
      id: lerato-m
      name: Lerato M.
    acceptedAt: 2026-10-07T15:20:00.000Z
  - id: BR-027-02
    text: Out-for-delivery orders whose tracking is opened goes from 0% to 70%.
    source:
      section: Goals
      quote: Out-for-delivery orders whose tracking is opened
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    status: accepted
    acceptedBy:
      id: lerato-m
      name: Lerato M.
    acceptedAt: 2026-10-07T15:20:00.000Z
  - id: BR-027-03
    text: The driver's position on the map is at most 30 seconds old at p95.
    source:
      section: Goals
      quote: Age of the driver's position on the map, p95
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    editedBy:
      id: lerato-m
      name: Lerato M.
      kind: person
    editedAt: 2026-10-07T15:10:00.000Z
    status: accepted
    acceptedBy:
      id: lerato-m
      name: Lerato M.
    acceptedAt: 2026-10-07T15:20:00.000Z
  - id: BR-027-04
    text: >-
      A customer can see their driver on a map from dispatch to their door, so they know their order
      is on its way.
    source:
      section: User stories
      quote: >-
        As a customer, I can see my driver on a map from dispatch to my door so I know my order is
        on its way.
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    status: accepted
    acceptedBy:
      id: lerato-m
      name: Lerato M.
    acceptedAt: 2026-10-07T15:20:00.000Z
  - id: BR-027-05
    text: A customer can see when their driver will arrive, so they can be home.
    source:
      section: User stories
      quote: As a customer, I can see when my driver will arrive so I can be home.
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    status: accepted
    acceptedBy:
      id: lerato-m
      name: Lerato M.
    acceptedAt: 2026-10-07T15:20:00.000Z
  - id: BR-027-06
    text: A customer is told when their order is next on the route, so they can get ready.
    source:
      section: User stories
      quote: As a customer, I am told when my order is next on the route so I can get ready.
    status: proposed
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
systems:
  - repo: acme/web-storefront
    name: web-storefront
    change: changed
    team: checkout-squad
    note: The tracking page and its map, with a text alternative.
    knowledge: []
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - repo: acme/delivery-planner
    name: delivery-planner
    change: changed
    team: delivery-squad
    note: Driver positions from the driver app, routes and arrival windows.
    knowledge: []
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - repo: acme/mobile-app
    name: mobile-app
    change: changed
    team: checkout-squad
    note: The tracking screen and the "you're next" push.
    knowledge: []
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - repo: notification-service
    name: notification-service
    change: new
    team: null
    note: 'Not in Platform yet: a new service that sends push notifications [CONFIRM: owner].'
    knowledge: []
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
nfrs:
  - id: NFR-027-01
    category: performance
    requirement: 'Position age: the driver''s position on the map'
    target: p95 < 30 s
    source:
      kind: quality-attribute
      text: Goals · Age of the driver's position on the map, p95
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: NFR-027-02
    category: availability
    requirement: Customer-facing services stay up, and no write is lost or doubled
    target: 99.9% monthly [CONFIRM]
    source:
      kind: catalogue
      text: NFR catalogue · Availability and consistency · monthly-availability
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: NFR-027-03
    category: security
    requirement: Every API is authenticated and authorised; secrets come from the vault
    target: No open findings above medium at release [CONFIRM]
    source:
      kind: catalogue
      text: NFR catalogue · Security · authenticated-apis
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: NFR-027-04
    category: privacy
    requirement: >-
      A driver's position is shared only while they deliver that customer's order, and is not kept
      after it
    target: 'Deleted at delivery; privacy review passed [PLACEHOLDER: regime]'
    source:
      kind: catalogue
      text: NFR catalogue · Privacy · personal-data
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: NFR-027-05
    category: accessibility
    requirement: The map has a text alternative ("2 stops away · arriving 18:10–18:25")
    target: WCAG 2.2 AA; no axe violations
    source:
      kind: catalogue
      text: NFR catalogue · Accessibility · wcag
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: NFR-027-06
    category: cost
    requirement: Map tiles and position updates within budget at current volume
    target: '[PLACEHOLDER: monthly run cost]'
    source:
      kind: catalogue
      text: NFR catalogue · Cost · run-cost
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: NFR-027-07
    category: operability
    requirement: Each service logs, has health checks and alerts on its SLOs
    target: Dashboards and alerts before release [CONFIRM]
    source:
      kind: catalogue
      text: NFR catalogue · Operability · observable
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
features:
  - id: FEAT-027-1
    title: See the driver on a live map
    summary: >-
      As a customer, I can see my driver on a map from dispatch to my door so I know my order is on
      its way.
    dependsOn: []
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: FEAT-027-2
    title: See when the driver will arrive
    summary: As a customer, I can see when my driver will arrive so I can be home.
    dependsOn:
      - FEAT-027-1
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: FEAT-027-3
    title: Be told when my order is next
    summary: As a customer, I am told when my order is next on the route so I can get ready.
    dependsOn:
      - FEAT-027-2
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
interfaces:
  - id: IF-027-01
    name: Driver app → delivery-planner
    kind: event
    from: Driver app
    to: delivery-planner
    contract: 'courier.position every 10 s: { courierId, lat, lng, at }'
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
  - id: IF-027-02
    name: delivery-planner → web-storefront
    kind: api
    from: delivery-planner
    to: web-storefront
    contract: GET /orders/:id/tracking → { position, stopsAway, window }
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
  - id: IF-027-03
    name: web-storefront → Map tiles provider
    kind: api
    from: web-storefront
    to: Map tiles provider
    contract: 'Tiles behind a MapTiles interface; the provider is ADR-015 [PLACEHOLDER: provider]'
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: IF-027-04
    name: delivery-planner → notification-service
    kind: event
    from: delivery-planner
    to: notification-service
    contract: 'order.next_on_route: { orderId, customerId, window }'
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
  - id: IF-027-05
    name: notification-service → push provider
    kind: api
    from: notification-service
    to: ''
    contract: Push to the customer's device; the push provider is not chosen yet [CONFIRM]
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
technical:
  - id: TR-027-01
    system: web-storefront
    text: >-
      web-storefront shows the tracking page: the driver on a map behind a MapTiles interface,
      refreshed every 10 s, with a text alternative.
    serves:
      - BR-027-02
      - BR-027-04
      - NFR-027-05
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: TR-027-02
    system: delivery-planner
    text: >-
      delivery-planner keeps each driver's latest position from the driver app, serves it with the
      route and arrival window, and deletes it at delivery.
    serves:
      - BR-027-03
      - BR-027-04
      - BR-027-05
      - NFR-027-01
      - NFR-027-04
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: TR-027-03
    system: mobile-app
    text: mobile-app shows the same tracking screen and receives the "you're next" push.
    serves:
      - BR-027-05
      - BR-027-06
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
  - id: TR-027-04
    system: notification-service
    text: notification-service is built to send a push within a minute of order.next_on_route.
    serves:
      - BR-027-06
    draftedBy:
      id: ada-quill
      name: Ada Quill
      kind: agent
stories:
  - id: STORY-027-1
    feature: FEAT-027-1
    title: See the driver on a live map
    requirements:
      - BR-027-01
      - BR-027-02
      - BR-027-03
      - BR-027-04
    systems:
      - web-storefront
      - delivery-planner
    interfaces:
      - IF-027-01
      - IF-027-02
      - IF-027-03
    technical:
      - TR-027-01
      - TR-027-02
    nfrs:
      - NFR-027-01
      - NFR-027-02
      - NFR-027-03
      - NFR-027-04
      - NFR-027-05
    criteria:
      - >-
        Given an order is out for delivery, when the customer opens tracking, then the driver's
        position is shown and is less than 30 seconds old
      - >-
        Given the order is delivered, when the driver marks it done, then their position is no
        longer shared with the customer
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    editedBy:
      id: priya-s
      name: Priya S.
      kind: person
  - id: STORY-027-2
    feature: FEAT-027-2
    title: See when the driver will arrive
    requirements:
      - BR-027-05
    systems:
      - delivery-planner
      - web-storefront
      - mobile-app
    interfaces:
      - IF-027-02
    technical:
      - TR-027-02
      - TR-027-03
    nfrs:
      - NFR-027-01
      - NFR-027-02
      - NFR-027-05
    criteria:
      - >-
        Given the driver is two stops away, when the route updates, then the arrival window narrows
        to 15 minutes
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
  - id: STORY-027-3
    feature: FEAT-027-3
    title: Be told when my order is next
    requirements:
      - BR-027-06
    systems:
      - delivery-planner
      - notification-service
      - mobile-app
    interfaces:
      - IF-027-04
      - IF-027-05
    technical:
      - TR-027-03
      - TR-027-04
    nfrs:
      - NFR-027-02
      - NFR-027-03
      - NFR-027-04
      - NFR-027-07
    criteria:
      - >-
        Given the customer's order is next, when the driver leaves the previous stop, then the
        customer gets a push notification within 1 minute
    draftedBy:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
drafts:
  - part: requirements
    by:
      id: ada-quill
      name: Ada Quill
      kind: agent
    at: 2026-10-07T13:40:00.000Z
    costUsd: 0.42
    modelRoute: specs-architecture-review
    askedBy: naledi-k
  - part: solution
    by:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    at: 2026-10-07T16:05:00.000Z
    costUsd: 1.18
    modelRoute: specs-architecture-review
    askedBy: thabo-n
  - part: functional
    by:
      id: ada-quill
      name: Ada Quill
      kind: agent
    at: 2026-10-08T08:20:00.000Z
    costUsd: 0.66
    modelRoute: specs-architecture-review
    askedBy: priya-s
  - part: stories
    by:
      id: rhea-voss
      name: Rhea Voss
      kind: agent
    at: 2026-10-08T09:30:00.000Z
    costUsd: 0.95
    modelRoute: specs-architecture-review
    askedBy: priya-s
sampleData: true
version: 23
---

# Design of PRD-027

## Business requirements

- BR-027-01 (accepted): Calls asking where the driver is, per week goes from 1,900 to 600.
- BR-027-02 (accepted): Out-for-delivery orders whose tracking is opened goes from 0% to 70%.
- BR-027-03 (accepted): The driver's position on the map is at most 30 seconds old at p95.
- BR-027-04 (accepted): A customer can see their driver on a map from dispatch to their door, so they know their order is on its way.
- BR-027-05 (accepted): A customer can see when their driver will arrive, so they can be home.
- BR-027-06 (proposed): A customer is told when their order is next on the route, so they can get ready.

## Impacted systems

- web-storefront (changed, checkout-squad)
- delivery-planner (changed, delivery-squad)
- mobile-app (changed, checkout-squad)
- notification-service (new)

## NFRs

- NFR-027-01 performance: Position age: the driver's position on the map · p95 < 30 s
- NFR-027-02 availability: Customer-facing services stay up, and no write is lost or doubled · 99.9% monthly [CONFIRM]
- NFR-027-03 security: Every API is authenticated and authorised; secrets come from the vault · No open findings above medium at release [CONFIRM]
- NFR-027-04 privacy: A driver's position is shared only while they deliver that customer's order, and is not kept after it · Deleted at delivery; privacy review passed [PLACEHOLDER: regime]
- NFR-027-05 accessibility: The map has a text alternative ("2 stops away · arriving 18:10–18:25") · WCAG 2.2 AA; no axe violations
- NFR-027-06 cost: Map tiles and position updates within budget at current volume · [PLACEHOLDER: monthly run cost]
- NFR-027-07 operability: Each service logs, has health checks and alerts on its SLOs · Dashboards and alerts before release [CONFIRM]

## Features

- FEAT-027-1: See the driver on a live map
- FEAT-027-2: See when the driver will arrive
- FEAT-027-3: Be told when my order is next

## Interfaces

- IF-027-01 event: Driver app → delivery-planner · courier.position every 10 s: { courierId, lat, lng, at }
- IF-027-02 api: delivery-planner → web-storefront · GET /orders/:id/tracking → { position, stopsAway, window }
- IF-027-03 api: web-storefront → Map tiles provider · Tiles behind a MapTiles interface; the provider is ADR-015 [PLACEHOLDER: provider]
- IF-027-04 event: delivery-planner → notification-service · order.next_on_route: { orderId, customerId, window }
- IF-027-05 api: notification-service → ? · Push to the customer's device; the push provider is not chosen yet [CONFIRM]

## Technical requirements

- TR-027-01 web-storefront: web-storefront shows the tracking page: the driver on a map behind a MapTiles interface, refreshed every 10 s, with a text alternative.
- TR-027-02 delivery-planner: delivery-planner keeps each driver's latest position from the driver app, serves it with the route and arrival window, and deletes it at delivery.
- TR-027-03 mobile-app: mobile-app shows the same tracking screen and receives the "you're next" push.
- TR-027-04 notification-service: notification-service is built to send a push within a minute of order.next_on_route.

## Stories

- STORY-027-1 (FEAT-027-1): See the driver on a live map
- STORY-027-2 (FEAT-027-2): See when the driver will arrive
- STORY-027-3 (FEAT-027-3): Be told when my order is next
