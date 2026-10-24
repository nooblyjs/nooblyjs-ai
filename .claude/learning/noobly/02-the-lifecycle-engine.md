# nooblyjs-ai-host: the lifecycle engine and its seven stages

**Lesson 02 · about 10 minutes · 2026-10-10· updated 2026-10-11**

> The lifecycle engine was its own repository, `nooblyjs-ai-workflows`, until 2026-10-10. It is now part of nooblyjs-ai-host, in
> `src/lifecycle/`. It still answers at `/workflows/api/v1` and is `host.service('workflows')` to the other apps.

## What you'll learn

- Every lifecycle item sits in exactly one of seven stages, in a fixed order.
- Stage names are kept in one place, `src/lifecycle/stages.js`, so the rest of the code never guesses.
- The Product Factory uses different names for the same stages, and `stageKey()` translates them.

## The idea, in plain words

Think of a parcel moving through a post office: sorting, then the van, then delivery. A parcel is in exactly one
of those places at a time, and it can only move on to the next one. Nobody can skip the sorting.

Here the parcel is a lifecycle item, such as PRD-031. Its stages are Discover, Specify, Architect, UX design, UI
design, Build and Ship. The order and the labels are written once, in `src/lifecycle/stages.js`.

The analogy stops working in one place: a post office can deliver a parcel back. In NooblyJS an item can be sent back
(a "send-back"), but it still sits in one stage at a time.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `src/lifecycle/stages.js` | `STAGES`: the seven stages, in order, with their labels and the area each hands off to. |
| `src/lifecycle/stages.js` (later lines) | `stageKey()`: turns a name such as `product` or `architecture` into a stage key. |
| `src/lifecycle/services/engine.js` | The engine that moves items between stages and records each move. |
| `src/lifecycle/routes.js` | The API the lifecycle screens call, at `/workflows/api/v1`. |
| `src/lifecycle/repos.js` | Where items, approvals and handoffs are stored: Markdown files under `data/workflows/`. |

## A small piece of code

The seven stages, from `src/lifecycle/stages.js` lines 4 to 12:

```js
// src/lifecycle/stages.js:4
export const STAGES = [
  { key: 'discover', number: 1, label: 'Discover', area: 'Product' },
  { key: 'specify', number: 2, label: 'Specify', area: 'Product' },
  { key: 'architect', number: 3, label: 'Architect', area: 'Architecture' },
  { key: 'ux', number: 4, label: 'UX design', area: 'UX design' },
  { key: 'ui', number: 5, label: 'UI design', area: 'UI design' },
  { key: 'build', number: 6, label: 'Build', area: 'Software Factory' },
  { key: 'ship', number: 7, label: 'Ship', area: 'Ship' },
];
```

- Each stage has a `key` (the code's name), a `number` (the order), a `label` (what people read) and an `area`
  (who owns it, used when naming a handoff such as "Product → Architecture").
- Discover and Specify both belong to the Product Factory. That is why the `area` field exists.
- The array's order is the lifecycle's order. `nextStage()` simply looks one place along it.

## Try it

Run the lifecycle story test, which walks an item through its stages:

```
cd <workspace>/noobly
node --test test/lifecycle/story.test.js
```

Read the first few lines of the test to see which stage an item starts in and what moves it on.

## Words to know

- **Stage**: one of the seven places an item sits in.
- **Lifecycle item**: the unit of work being tracked, such as a spec with an ID like PRD-031.
- **Handoff**: passing an item from one stage's team to the next.
- **Send-back**: returning an item to an earlier stage with a reason.
- **Stage key**: the code's name for a stage, such as `architect`.

## Summary: what you've learnt

- You know an item is always in exactly one of seven ordered stages.
- You know the stages are defined once, in `src/lifecycle/stages.js`, and everything else reads from there.
- You know that a Product Factory name and a lifecycle name are translated by one function, `stageKey()`.
- You know a handoff is named by its two areas, so the owner of each step is always clear.
