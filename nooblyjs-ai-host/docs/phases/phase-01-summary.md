# Phase 1 — Shell and design system: summary

**Status:** done. Built 2026-10-09 and signed off. Spec: `.claude/specs/phase-01-shell/`.

## What was built

| Area | What |
| --- | --- |
| UI kit CSS | `nooblyjs-core/public/ui/css/`: `tokens.css` (brief §7 colours, type scale, radii, spacing, shadows, plus `@font-face`), `base.css` (reset, type, skip link, focus ring, `.visually-hidden`), `shell.css` (rail, sidebar, status card, person, content, chat dock; stacks at ≤1100px and ≤860px; `.shell--full`), `components.css` |
| Fonts | Lexend 300–700 and JetBrains Mono 400/500, self-hosted woff2 in `public/ui/fonts/` with their OFL licences. No font CDN, so the CSP stays `'self'` |
| UI kit JS | `html.js` (escaping tagged template, `SafeHtml`), `icons.js` (inline SVG strokes), `format.js`, `api.js` (fetch wrapper with CSRF, JSON, `ApiError`, abort signal), `sse.js` (one lazy EventSource, off until Phase 2), `router.js` (pure: longest mount path, route match, paths), `shell.js` (rail, nav, status card, person, chat dock) |
| Components | `button` (primary, accent, secondary, danger, small, disabled, link), `statusPill`, `statCard`, `listRow`, `dataTable`, `kanbanColumn`, `timelineRow`, `meter`, `processChevrons`, `stageStrip`, `swimlane`, `checklist`, plus `pageHead`, `card`, `notice`. Every one returns escaped strings, so they're unit-tested in Node |
| Frame | `public/ui/frame.html` + `frame.js`: boots from `GET /api/v1/shell`, draws the rail and sidebar, intercepts same-origin links, imports each app's module once, matches its route, gives the page a `ctx` (api, hostApi, signal, sse, can, navigate, chat.scope, setTitle, isCurrent), aborts the old page's signal and calls `destroy()`. Error card with **Retry** when a module or page throws. Focus moves to the new `h1`, and the title is announced. Status cards refresh every 60 s |
| Server half | `nooblyjs-core/src/shell/index.js` `createShell()`: the frame handler (signed-in only, `no-store`), `/api/v1/shell` (person, permissions, features, apps), `/api/v1/shell/status` (1 s cap per app), and rail order: built-ins at the start, hosted apps, then built-ins at the end. `nooblyjs-ai-host` serves `/ui/` from the kit and its own `public/` at the root |
| Built-in apps | `src/built-in-apps.js` describes Home, Product Factory, Platform and Dev (dev sign-in only, no rail item), with the `product.md` §5 nav and honest-zero status cards. `public/js/modules/{home,product,platform,dev}.js` are route tables. Every nav item opens a placeholder ("Not built yet: Phase N") naming its mockup. `/product/specs/:id` shows the chat dock slot |
| Not installed | Factory, Teammates and Knowledge sit on the rail as "Not installed yet" (the phase they arrive in) until their app registers. A failed `register()` shows "Unavailable" |
| Styleguide | `/dev/styleguide`: every token, the type scale, every component in every state, and all icons |
| Sign-in | Restyled with the kit (`src/pages/login.js` + `public/css/login.css`) |
| Fixtures | `hello-app` now renders inside the frame (with a `requires` route), and `throwing-app` has a module that throws on import |

## Test script result (roadmap Phase 1)

Run on 2026-10-09.

| Step | Result |
| --- | --- |
| 1. Styleguide next to the mockups | Checked by screenshot against `noobly-platform-home`: rail, sidebar, type and colours match. One fix came out of it: the person row at the foot of the sidebar wrapped, so Sign out is now a 44px icon button with a hidden label, and long names truncate. **Your eye check is still wanted** |
| 2. Every rail and sidebar item, no 404s, right active states | PASS (e2e walks 8 rail items and all their nav rows) |
| 3. Phone width 375px: stacks, no horizontal scroll, controls ≥ 44px | PASS (e2e, on six pages) |
| 4. Keyboard: visible focus, sensible order | PASS (e2e: skip link first, jumps to content; focus ring present) |
| 5. Hello: same rail and sidebar, no reload, refresh works | PASS (e2e: one navigation entry across four app switches; deep link plus refresh) |
| 6. Throwing fixture: error card with Retry, other apps work | PASS (e2e) |
| 7. `npm run test:e2e`: 0 AA violations on every placeholder page | PASS: 10 of 10, axe with WCAG 2.0/2.1/2.2 A and AA tags on every page visited |

`npm test`: 47 of 47 pass (adds kit, component, router and shell API tests).

## Things found and fixed on the way

- Kit `.js` files were read as CommonJS by Node. Fixed with `public/ui/package.json` `{"type":"module"}`.
- The value-chain chevron's text failed contrast. It's now white on the dark fill.
- Scrollable tables weren't keyboard-reachable. `.table-wrap` and the swimlane now have `tabindex="0"`, `role="region"` and a label.
- Hidden table captions escaped `.table-wrap` and caused sideways scroll on phones. Fixed with `position: relative`.
- The skip link was being routed, and a `#hash` change re-rendered the page and stole focus. The frame now ignores in-page anchors and hash-only `popstate`.

## Placeholders and assumptions

- The Dev app (`/dev`) exists only when `NOOBLY_DEV_LOGIN=true`. The Teams simulator joins it in Phase 6.
- Badges (Approvals 4 in the mockup) show only when an app reports a number. Today everything reports zero, so no badges show.
- The chat dock is an empty slot that says team chat arrives in Phase 4.

## Guide points for your review

- Does it *feel* like the mockups? Compare `/dev/styleguide` and `/` with `brief/noobly-platform-home/Main.dc.html`.
- The rail labels "Not installed yet" under Factory, Teammates and Knowledge. Keep them, or show a quieter marker?
