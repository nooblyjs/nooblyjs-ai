# Phase 1 — Shell and design system: requirements

> **Status: done, built 2026-10-09.** Summary: `docs/phases/phase-01-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

> Source: `.claude/steering/roadmap.md` Phase 1. Goal: the NooblyJS shell matches the mockups, every
> link goes somewhere, and hosted apps load into it. Repos: `nooblyjs-ai-host`, `nooblyjs-core` (the UI kit and
> `createShell()`). Contract: `structure.md` §2a. Why: `docs/adr/ADR-001-host-owned-shell.md`.

## Decisions taken before starting

| Question | Answer |
| --- | --- |
| Fonts | **Self-hosted** Lexend (300–700) and JetBrains Mono (400, 500), latin woff2 from Fontsource, in `nooblyjs-core/public/ui/fonts/` with their SIL OFL 1.1 licences. No calls to Google |
| Design tokens | Brief §7, which the mockups use (Lexend, navy `#14274E`). `.claude/style/styles.css` is an older Factory design system (Avenir, `#12284B`) and is not used |
| Teammates reference copy in `noobly/public/` | Removed: `public/` now holds NooblyJS's own modules. The copy lives on in `nooblyjs-ai-teammate` and in git history |

## Requirements

### R1 — The shared UI kit (`nooblyjs-core/public/ui/`, served at `/ui/`)
1. `tokens.css` SHALL hold every brief §7 token as a custom property, plus the two `@font-face` families.
2. `base.css`, `shell.css` and `components.css` SHALL use only those tokens. No inline styles in pages.
3. Components SHALL exist for Button (primary, accent, secondary, danger), StatusPill, StatCard,
   ListRow, DataTable, Kanban column, Timeline row, Meter, ProcessChevron, StageStrip, Swimlane
   and Checklist. Each is a function that returns escaped HTML, so it can be tested without a browser.
4. Icons SHALL be inline stroke SVGs on a 24px grid, stroke 1.7–1.8, round caps, with no emoji.

### R2 — The frame
1. Every UI URL SHALL return one static frame page. A signed-out person is sent to `/login`.
2. `frame.js` SHALL draw, once: the 84px navy suite rail (Home, Product, then hosted apps with a
   UI, then Platform), the 260px module sidebar (module name, nav rows with groups and badges,
   status card, person) and the content area (max 1240px). It SHALL also draw a docked
   chat-panel slot, shown only when a page scopes it (empty until Phase 4).
3. Navigation SHALL be client-side, including between apps: no document reload. Deep links and
   refresh SHALL load the same screen.
4. An app's module SHALL load on first use (`import()`), with its styles. Its pages SHALL get
   `ctx` (`api`, `hostApi`, `sse`, `signal`, `navigate`, `person`, `can`, `chat`, `setTitle`,
   `isCurrent`). `ctx.signal` SHALL be aborted when the person leaves the page.
5. IF a module or page fails THEN the content area SHALL show an error card with **Retry**, and
   the rail, sidebar and other apps SHALL keep working.
6. Rail items for apps that aren't installed SHALL show "Not installed yet". Unavailable apps
   SHALL show "Unavailable".
7. A skip link, visible focus, and stacking at narrow widths SHALL be in place. At 375px there
   SHALL be no horizontal scroll, and controls SHALL stay at least 44px.

### R3 — Built-in modules
1. Home, Product Factory and Platform SHALL be modules with the nav from `product.md` §5
   (Home: For you, Overview, Lifecycle, Approvals, Activity, Metrics, Teams & roles. Product:
   Overview · Stages · Flow. Platform: Build · Govern).
2. Every nav item SHALL route to a placeholder page that says "Not built yet: Phase N" and
   names its mockup.
3. `/dev/styleguide` (development only) SHALL show every component in every state.

### R4 — Server
1. `createShell()` SHALL move into `nooblyjs-core` (frame page, `/api/v1/shell`,
   `/api/v1/shell/status`, the app list, built-in apps).
2. The status card SHALL support a status pill, label/value items and a meter (the mockup's shape).

### R5 — Tests
1. Unit tests (`node:test`) SHALL cover components, escaping, route matching and the shell API.
2. `npm run test:e2e` (Playwright + axe) SHALL click every rail and sidebar item, check phone
   width, the hello-app's client-side switch, the error card, and **0 WCAG AA violations** on
   every placeholder page.

## Done when
Steps 1–7 of the Phase 1 test script in `roadmap.md` pass.
