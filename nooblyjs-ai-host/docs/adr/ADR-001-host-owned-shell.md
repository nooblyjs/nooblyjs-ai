# ADR-001: The host owns the shell; apps provide UI modules

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Stephen Booysen
- **Affects:** `nooblyjs-ai-host`, `nooblyjs-core` (UI kit, `createShell()`), `nooblyjs-ai-factory`, `nooblyjs-ai-teammate`,
  `nooblyjs-ai-knowledge`
- **Docs updated:** `structure.md` §2a, §3, §6 · `tech.md` §2, §5, §8 · `roadmap.md` hosted-app
  checklist, Phases 0, 1, 6, 7, 8 · `product.md` §5.1, §12 · `CLAUDE.md`

## Context

NooblyJS is one host process that mounts child apps (`/factory`, `/teammates`, `/knowledge`) next
to its own areas (Home, Product Factory, Platform). Every screen shares one shell: an 84px
suite rail, a 260px module sidebar (nav rows with badges, a status card, the signed-in person
and their work role), a content area, and a 380px team chat panel docked on every item and
work page (`product.md` §5.1).

Until now, the steering docs said **one HTML page per app**. Each hosted app served its own
`public/index.html`, loaded the shared UI kit, and called `/ui/js/shell.js` to draw the rail
and sidebar from the nav it was given. Moving between apps was a full page load.

That raised the question this ADR answers: should the host pass its navigation down so each
child draws the shell, or should the host keep the shell and give children a content container
to fill?

Facts that weigh on it:

1. **Chat is cross-cutting and owned by `nooblyjs-ai-host`.** The chat panel follows the person across
   Product, Factory and Teammates pages. With a page load per app, switching apps drops the
   open thread, the unsent draft, the scroll position and the SSE connection.
2. **Most of the shell's content is host data.** The person, their work role, the status card,
   the Getting started card, cross-app badges and which apps are available all come from the
   host. Under the old design, each child would fetch and redraw all of that on every app switch.
3. **The page contract already fits.** `nooblyjs-ai-teammate` pages already export
   `render(view, { params, query, ctx })`, so they render into a container they're given,
   with a context passed in.
4. **The stack rules out frameworks.** There's no build step, no bundler and no framework, so
   any composition has to use native ES modules and dynamic `import()`.

## Decision

**`nooblyjs-ai-host` owns one frame. Every app, built-in or hosted, provides a UI module that the frame
loads into the content area.** The full contract is in `structure.md` §2a. In short:

- **What an app is (data, from the server).** `register()` returns a `HostedApp` description:
  `name`, `label`, `icon`, `mountPath`, `ui: { entry, styles }`, `nav`, an optional
  `status(req)` for badges and the status card, and `close()`. The host builds the rail and
  sidebar from this, filtered by the person's access role, and serves it as `GET /api/v1/shell`.
  It never runs an app's browser code to find out what the shell should show. That way,
  disabled or broken apps can still show "Unavailable", and search can link into every app.
- **What an app does (code, in the browser).** `public/js/module.js` exports a route table:
  `path`, `nav`, `title`, a lazy `page` import, `requires`, `layout`, `redirect`. Pages keep the
  `render(view, { params, query, ctx })` and `destroy()` shape. `ctx` provides an API client bound
  to the app's mount path, SSE, `navigate`, the person, `can()`, the chat scope, and an
  **AbortSignal** that the router fires when the person leaves the page.
- **Routing is the host's job.** The kit's router picks the app by longest mount path, imports
  its module the first time it's opened, matches a route, and updates the sidebar, title and
  chat scope. Switching apps never reloads the page.
- **One frame page for every UI URL.** Its source is nooblyjs-core's `createShell()`. Each app
  passes the host's `options.host.frame` as its fallback for page URLs, so deep links and
  refresh work and the app still owns everything under its mount path. A child's standalone
  `server.js` uses the same `createShell()`, so the code path is the same hosted and standalone.
- **Rules for sharing one document.** CSS is scoped under `[data-module="<name>"]` (checked
  by a test). Pages touch only their `view`. The kit is imported by absolute URL, so all apps
  share one copy. A module that fails to load shows an error card, and the rest of NooblyJS keeps
  working.
- **Transitional escape hatch.** `ui: { mode: 'document' }` makes the rail item a normal link
  to an app that hasn't been ported yet. Apps in that mode don't pass the hosted-app checklist.

## Alternatives considered

1. **Each child draws the shell from nav the host passes in (the previous design).** This is
   the simplest option and isolates apps the most, since each one gets a fresh document.
   Rejected because the chat panel and SSE reset on every app switch. Every child would also
   have to bootstrap host state just to draw chrome it doesn't own, and suite-wide shell
   features would depend on each child loading the right kit version. Cross-document View
   Transitions could hide the flash, but they wouldn't keep any state.
2. **The child's `initialise.js` tells the shell what to draw.** This is the same composition
   as the decision, but the host would execute child code to find out the nav. Rejected
   because the host already has this data at `register()` time. Getting it from the server
   means the rail draws before any child code downloads, unavailable apps still appear,
   permission filtering stays on the server, and nothing extra needs to load for search.
3. **iframes.** These isolate apps strongly, but break shared theming, focus order, deep links
   and accessibility. They also make one docked chat panel awkward. Rejected.
4. **Web Components with shadow DOM.** The shadow boundary would cut the apps off from the
   kit's global tokens and component CSS, which is why the kit exists. Rejected. Plain scoped
   CSS achieves the same goal.

## Consequences

**Better**

- The chat panel, SSE connection and shell state survive moving between apps.
- One place renders the rail, sidebar, status card and chat dock, so the "pixel-identical
  across apps" test passes by construction.
- Suite-wide features (global search, notifications, Getting started) are added once, in the
  host.
- The host knows every app's routes and nav, so titles, role gating, chat scoping and full-width
  layouts behave the same everywhere.
- Porting Teammates is small: its `app.js` shell becomes a route table, and its pages keep
  their signature.

**Costs and how they're contained**

- **Shared document.** One app's CSS or stray listeners could affect another. This is
  contained by scoped CSS (with a test), page code touching only `view`, and `ctx.signal`
  aborting requests and subscriptions on navigation.
- **More contract.** Apps now implement a module contract, not just "serve a page", and
  `nooblyjs-core` grows `createShell()` and `frame.js`. Phase 1 builds this once, and the
  hello-app fixtures test it.
- **Error handling is the frame's job.** Import and render failures are caught per app and
  shown as an error card. Server-side `register()` and `status()` failures are already
  isolated by the host.
- **Code freshness.** Static files are served with `max-age=0` plus ETag, so a restart's new
  module code is picked up on the next load. Module URLs don't need cache-busting.
- **Standalone mode loses chat.** Chat belongs to `nooblyjs-ai-host`, so a child running alone hides the
  chat dock. This is acceptable for development.

**Follow-ups**

- Phase 0: the loader passes `host.frame` (a placeholder) and serves `/api/v1/shell`. The
  hello-app stub ships a `module.js`.
- Phase 1: `createShell()`, `frame.js`, `shell.js` and `router.js` in `nooblyjs-core`. Home,
  Product Factory and Platform become built-in modules. Add a throwing-module fixture.
- Phases 6, 7 and 8: Teammates, Factory and Knowledge each pass the updated hosted-app
  checklist (items 2, 3, 10, 11 and 12 are new or changed).
