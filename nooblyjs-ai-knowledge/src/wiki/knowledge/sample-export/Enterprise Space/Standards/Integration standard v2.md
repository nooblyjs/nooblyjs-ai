# Integration standard v2

> Sample data for the NooblyJS "PRD-031 Same-day delivery slots" story. Not a real Acme Retail document.

Type: Standard · Owner: Group architecture · Reviewed: 2026-06-02

Services integrate through events first and synchronous APIs second.

- An event carries the id of the thing it is about, when it happened, and the reason. Consumers treat the newest event per id as the truth.
- A consumer never recalculates what another service owns. Slot capacity, for example, is owned by the delivery planner.
- Synchronous calls have a timeout of at most 2 seconds and a fallback.
