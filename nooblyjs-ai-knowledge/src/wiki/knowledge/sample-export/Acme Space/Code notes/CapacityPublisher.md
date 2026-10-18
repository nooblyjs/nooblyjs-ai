# CapacityPublisher.java

> Sample data for the NooblyJS "PRD-031 Same-day delivery slots" story. Not a real Acme Retail document.

Type: Code note · Repository: delivery-planner · Branch: main

`CapacityPublisher` is the class in delivery-planner that publishes slot capacity. It listens for shift changes and roster edits, asks `CapacityCalculator` to recalculate the slot capacity for every open delivery window of that store, and publishes one `slot.capacity` event per slot.

## The event

    slot.capacity { storeId, slotId, windowStart, windowEnd, capacity, calculatedAt, reason }

`reason` is `shift-change`, `roster-edit` or `manual-headroom`. Consumers (slots-api, the web storefront's slot picker) must treat the newest event per slot as the truth and must not calculate capacity themselves.

## Things that have gone wrong

- A consumer cached slot capacity for an hour and kept selling a slot that had been reduced. Cache for at most 60 seconds.
- Events arrive out of order after a broker failover. Compare `calculatedAt`, not arrival time.
