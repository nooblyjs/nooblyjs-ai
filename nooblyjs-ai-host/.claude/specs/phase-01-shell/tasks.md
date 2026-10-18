# Phase 1 — Shell and design system: tasks

> **Status: done, built 2026-10-09.** Summary: `docs/phases/phase-01-summary.md`.
> Bugs and changes found since go in `.claude/specs/bugs-and-changes/`, not here.

- [x] 1. UI kit CSS in nooblyjs-core: tokens.css (with @font-face), base.css, shell.css, components.css
- [x] 2. UI kit JS: html.js, icons.js, format.js, api.js, sse.js, router.js, components/*.js
- [x] 3. Frame: frame.html, frame.js (shell, router, module loader, ctx, error card), shell.js (rail, sidebar, status card, person, chat dock)
- [x] 4. Server: nooblyjs-core `src/shell/index.js` createShell() (frame, /api/v1/shell, /status, built-ins, rail order); nooblyjs-ai-host uses it, serves /ui/ and its own public/
- [x] 5. Built-in modules in noobly/public/js: home, product, platform, dev (styleguide); placeholder page
- [x] 6. Fixtures: hello-app page in the frame; throwing-module app
- [x] 7. Unit tests: components, html, router matching, shell API, frame fallbacks
- [x] 8. e2e: Playwright + axe (rail/sidebar walk, phone width, no-reload switch, error card, AA)
- [x] 9. Run the Phase 1 test script; docs (structure.md status card shape, summary)
