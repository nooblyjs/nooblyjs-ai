# Phase 1 — Shell and design system: design

> **Status: done, built 2026-10-09.** Summary: `docs/phases/phase-01-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

## 1. Files

```
nooblyjs-core/
  public/ui/
    fonts/           lexend-latin-{300..700}-normal.woff2 · jetbrains-mono-latin-{400,500}-normal.woff2 · LICENSE-*.txt
    css/             tokens.css · base.css · shell.css · components.css
    js/
      html.js        escaping tagged template (SafeHtml), shared with components
      icons.js       inline stroke SVGs (24px grid, stroke 1.7–1.8)
      format.js      money, numbers, durations, relative time
      api.js         fetch wrapper: JSON, CSRF header from the noobly.csrf cookie, errors, AbortSignal
      sse.js         one EventSource per tab, lazy (connects on first subscribe; the stream arrives in Phase 2)
      router.js      pure helpers: compile route patterns, match, pick the app by longest mount path
      shell.js       renders rail, sidebar (groups, badges), status card, person, chat dock
      frame.js       boot: GET /api/v1/shell, draw the shell, route, load modules, ctx, error card
      components/    button · status-pill · stat-card · list-row · data-table · kanban · timeline ·
                     meter · process-chevron · stage-strip · swimlane · checklist · index.js
    frame.html       the one page every UI URL returns
  src/shell/index.js createShell({ express, auth, can, log }) → { frame, router, uiDir, builtIn,
                     add, unavailable, notInstalled, list }  (CommonJS)
noobly/
  public/js/modules/ home.js · product.js · platform.js · dev.js   (built-in UI modules)
  public/js/pages/   placeholder.js · styleguide.js
  public/css/noobly.css   (empty-ish: built-in pages use the kit)
  src/built-in-apps.js  the built-in apps' descriptions: nav, entry, status()
  src/shell.js          removed (now nooblyjs-core's createShell)
  src/pages/placeholder.js  removed (the frame replaces it); login.js keeps its own page, restyled with the kit
  test/fixtures/throwing-app/   a hosted app whose module throws on import
  test/e2e/          shell.spec.js (Playwright + axe) · playwright.config.js
```

## 2. Decisions

- **Components return strings** (`SafeHtml` through the escaping `html` template). Pages set
  `view.innerHTML = String(component(...))`. They can be unit-tested in Node, and they stay
  escaped by default.
- **Built-in entries are absolute** (`/js/modules/home.js`). Hosted apps' entries stay relative
  to their mount path. `noobly/public/` is served at `/` (`index: false, redirect: false`) before
  the frame fallbacks.
- **The page contract gains `route`**: `render(view, { params, query, ctx, route })`, so one
  placeholder page can serve every nav item from the route's `meta` (`{ phase, mockup }`).
- **Status card shape** (`AppStatus.card`): `{ pill: { text, tone }, items: [{ label, value }],
  meter: { label, value, ratio }, lines: [string] }`. Every part is optional (the mockup's shape).
- **Rail order:** Home, Product, the hosted apps with a UI in `hosted-apps.yaml` order, Platform.
  The rail always shows the suite's six. Factory, Teammates and Knowledge appear even when not
  installed, as "Not installed yet". The dev module has no rail item.
- **Home** is mounted at `/`. Its routes are `/` (For you) and `/home/<screen>`.
- **No reload between apps:** the frame intercepts same-origin `<a>` clicks inside the shell
  (unless they have `target`, `download`, a modifier key, or `data-reload`).
- **Chat dock:** an `<aside>` slot, hidden until `ctx.chat.scope()`. Its empty state says team
  chat arrives in Phase 4.
- **Errors:** `import()`, `init()` and `render()` run inside a try/catch. The error card has
  **Retry** (re-import with a cache-busting query).
- **Responsive:** below 1100px the chat dock stacks under the content. Below 860px the rail
  becomes a horizontal top bar and the sidebar a compact block above the content.
