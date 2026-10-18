# Slot capacity model

> Sample data for the NooblyJS "PRD-031 Same-day delivery slots" story. Not a real Acme Retail document.

Type: Runbook · Owner: delivery-planner team · Reviewed: 2026-09-28

## How slot capacity is calculated

Capacity per slot is pickers on shift multiplied by picks per hour, divided by the average basket size, and capped by the van count for the delivery window.

    slot capacity = min( pickers on shift × picks per hour ÷ average basket size , vans in window × drops per van )

A store with 6 pickers at 120 picks per hour and an average basket of 30 items can pick 24 orders an hour. With 4 vans doing 5 drops each in the window, the slot capacity is capped at 20 orders.

## When it is recalculated

The planner recalculates slot capacity at each shift change, and whenever a store manager changes the roster. The result is published as a `slot.capacity` event (see the CapacityPublisher code note).

## What to check when slots show as full too early

1. Is the roster for the shift loaded? An empty roster gives a capacity of zero.
2. Is the average basket size stale? It is refreshed nightly from the last 14 days of orders.
3. Has a store added manual headroom? See the store ops policy on evening headroom.
