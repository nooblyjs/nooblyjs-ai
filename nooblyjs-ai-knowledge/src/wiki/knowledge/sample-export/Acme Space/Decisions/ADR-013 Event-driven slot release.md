# ADR-013 · Event-driven slot release

> Sample data for the NooblyJS "PRD-031 Same-day delivery slots" story. Not a real Acme Retail document.

Type: Architecture decision · Status: accepted · Decided: 2026-07-14

## Decision

A held slot is released by an event, not by a scheduled sweep. When a hold expires or a basket is abandoned, slots-api publishes `slot.released`, and the planner adds the order back to that slot's remaining capacity.

## Why

A sweep every five minutes left slots showing as full for up to five minutes after they were free, at the busiest time of day. Events release a slot within a second.

## Consequences

- slots-api must publish `slot.released` exactly once per hold. It uses the hold id as the idempotency key.
- The slot picker shows a hold timer, so a customer knows when their slot will be released.
