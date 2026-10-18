# nooblyjs-ai-product: what a hosted app returns to NooblyJS

**Lesson 01 · about 10 minutes · 2026-10-10**

## What you'll learn

- A hosted app describes itself to NooblyJS by returning a plain object from `register()`.
- That object holds the app's name, its place on the rail and sidebar, its status card and its services.
- The Product Factory uses this same pattern, so it is the best example to learn from.

## The idea, in plain words

Imagine you rent a stall at a market. You don't draw the market map. You hand the market office a card: your name,
your opening hours, what you sell and the sign for your stall. The office draws the map and puts your sign up.

`nooblyjs-ai-product` does the same. `register()` returns a card, and NooblyJS draws the rail and the sidebar from it. The
app never draws the frame around its own pages. That is the rule that keeps every app looking like one product.

The analogy stops working in one place: a market stall can close whenever it likes. A hosted app must answer through
the card and the `host` object, and NooblyJS can mark it unavailable if it fails.

## Where it lives in this repo

| Path | Why it matters |
| --- | --- |
| `index.js` line 32 | `NAV`: the sidebar rows, each with a path and an icon name. |
| `index.js` line 50 | `register()`: the one function NooblyJS calls, with the Express app, the registry and `host`. |
| `index.js` lines around 126 | The `return { ... }` with `badges`, `card` and `services`. |
| `src/services/` | The Product Factory's engine: drafts, specs, architecture, readiness. |
| `src/routes/` | The API under `/product/api/v1`. |

## A small piece of code

This is the status card the app returns to NooblyJS, from `index.js` lines 126 to 133, trimmed:

```js
// nooblyjs-ai-product/index.js:126
return {
  badges: { reviews: specs.filter((s) => s.status === 'in-review').length },
  card: {
    pill: { text: agentsOnDuty.text, tone: agentsOnDuty.count ? 'info' : 'neutral' },
    meter: { label: `${month} spend`, value: ..., ratio, tone: ... },
  },
};
```

- `badges` is a number on a sidebar item. Here it counts specs in review.
- `card.pill` is the coloured label at the top of the sidebar card.
- `card.meter` is a bar, such as the month's agent spend against its budget.
- The app returns data only. NooblyJS turns it into the picture.

## Try it

Run the test that checks the Product Factory's API and drafts, which goes through the same routes:

```
cd <workspace>/nooblyjs-ai-product
node --test test/routes/drafting.test.js
```

Read the first test. It shows the app being called through its API, the way NooblyJS calls it.

## Words to know

- **`register()`**: the function each hosted app exports. NooblyJS calls it once at start-up.
- **Rail**: the strip of app icons on the far left of the page.
- **Sidebar card**: the box at the bottom of the sidebar showing an app's status.
- **Badge**: a small number on a sidebar item, such as "3 in review".
- **Draft**: a first version of a spec or plan that an agent writes and a person reviews.

## Summary: what you've learnt

- You know a hosted app describes itself by returning a plain object from `register()`.
- You know NooblyJS draws the rail, the sidebar and the frame; the app only supplies data.
- You know the card has a pill, a meter and badges, and the nav is a list of rows with icons.
- You know that each app keeps its own log by asking the registry for a named copy.
