# Porting an existing app into the NooblyJS frame

How a child app that had its own page, sidebar and sign-in becomes a **hosted app** in the NooblyJS frame
(`structure.md` §2a, ADR-001). `nooblyjs-ai-teammate` was the first one. Every step below points at the file in
Teammates that does it, so Factory and Knowledge can follow the same path. New apps skip the "bridge" steps and
write pages to the frame's contract from the start.

The end state passes the hosted-app checklist in `roadmap.md`. In short:

- The rail and sidebar come from `register()`.
- The pages come from `public/js/module.js`.
- The API is under `<mountPath>/api/v1`, behind the host's sign-in, permissions, CSRF and audit.
- The CSS is scoped.
- Switching to or from the app never reloads the page.

## 1. Server: describe the app and let the host draw it

`index.js` `register()` returns:

```js
{
  name: 'teammates', label: 'Teammates', icon: 'team',      // icon: a /ui/js/icons.js name
  mountPath,
  ui: { entry: 'js/module.js', styles: ['css/teammates.css'] },
  nav: NAV,                                                    // { key, label, path, icon, badge?, requires? }
  status,                                                      // → { badges, card: { pill, items, meter, lines } }
  seed, close,
}
```

- **Icons** use kit names (`team`, `person`, `clock`, `doc`, `plus`, `book`, `settings`, `key`, …). An unknown
  name shows a dot.
- **Permissions** are rows of the NooblyJS matrix (`product.md` §6, `data/access/roles.yaml`), never the app's own
  ids, because the host refuses a permission it doesn't know. Map the app's old roles onto them in one table and
  use that table on the server and in the browser. Teammates: `PERMISSION_FOR_ROLE = { viewer: 'read',
  manager: 'approve', owner: 'set-budgets', hire: 'hire-teammates' }` in `src/services/auth.js` and
  `public/js/bridge.js`. Where the NooblyJS matrix is stricter than the old app (hiring is Owner-only in NooblyJS), the
  matrix wins.
- **The status card** answers in well under 1 s and shows honest numbers (`index.js` `status()`).

The router (`src/routes/index.js`) changes in four ways:

| Change | Why |
| --- | --- |
| `router.get('/{*rest}', …host.frame…)` for any URL with no file extension | Deep links and refresh land on the right screen. A missing `.js` or `.css` is still a 404, not the frame |
| No `Content-Security-Policy` of its own (`src/middleware/security.js`) | One page, one policy: the host's. If the app needs something more, add it to `noobly/app.js` `CSP_DIRECTIVES` with a comment (Teammates added `img-src blob:` for avatar previews) |
| `authenticate({ …, hostChecksCsrf: Boolean(host.checksCsrf) })` | NooblyJS checks the CSRF token (`noobly.csrf` double-submit cookie) before any app sees a change. When `host.checksCsrf` is true, the app skips its own check instead of expecting a second token in the same header |
| Delete the app's own `index.html`, login page and sign-out | The frame draws them |

## 2. Browser: a module with a route table

`public/js/module.js` exports `routes` and an optional `init()`:

```js
export const routes = [
  { path: '/', redirect: '/team' },
  { path: '/team', nav: 'team', title: 'Team roster', page: page('roster', () => import('./pages/roster.js')) },
  { path: '/team/:id', nav: 'profiles', title: 'Profile', page: page('profile', () => import('./pages/profile.js')) },
  { path: '/settings', nav: 'settings', title: 'Settings', requires: 'set-budgets', page: … },
];
```

Delete the old shell (`public/js/app.js` with its sidebar, router, `popstate`, sign-in state and menu toggle). Then:

- **`base.js`** works out the mount path from its own URL (`new URL('../', import.meta.url)`), with no
  `<meta>` tag or server-written base. The app's paths keep working under any mount path.
- **`api.js`** sends the host's CSRF token. Import `csrfToken` from `/ui/js/api.js` and send it as `X-CSRF-Token`.
  A 401 sends the person to `/login?next=…`.
- **Toasts and dialogs** live in one element at the end of `<body>` that carries `data-module="<name>"`
  (`ui.js` `portal()`), so the app's scoped CSS still reaches them.

### Old pages: a bridge first, then the frame's signature

Old pages rarely match the frame's page contract. Teammates' pages took `render(view, { params: [..], query,
ctx, isCurrent })`, returned `{ cleanup }`, and used `ctx.meta`, `ctx.session`, `ctx.on`, `ctx.can('manager')`.

**Step 1, to get into the frame quickly:** a bridge (`legacyPage(key, load)`) that adapts one to the other, so
the pages move unchanged. Teammates ran this way for a phase.

**Step 2, which Teammates has now done (NooblyJS Phase 6):** each page exports `render(view, { params, query, ctx,
route })` and `destroy()` itself, and the bridge is deleted. What the pages share lives in one small module,
`public/js/client.js`:

- `api` is the kit's `createApi` bound to the mount path, and `appUrl('/team/ada')` adds the mount path.
- `enter(view, ctx, key)` gives the page its element inside the frame's view and the app's ctx: `meta` and
  `session` (fetched once per tab), `can(role)` mapped to an NooblyJS permission, and `on(kind, fn)` for live updates.
- **Live updates use the host's stream.** The app emits its changes with `host.events.emit()`, carrying the
  page's data as `live`, and `on()` is `ctx.sse.on()`. The app's own `EventSource` and `/api/v1/events` are gone.
- `html` and `icon` are imported from the kit. The app's copies of `html.js`, `icons.js`, `api.js` and
  `base.js` are deleted. An icon the kit lacks is added to the kit.

**Step 3, a page at a time:** rebuild the page from the kit's components. Teammates' roster is the example
(`pages/roster.js`). It renders inside `.tm-kit`; pages still on the app's own components render inside `.tm-root`.

## 3. CSS: scope it, bridge the tokens, revert collisions

1. **Scope everything** with nooblyjs-core's tool. It's a one-off: the output becomes the app's stylesheet.

   ```bash
   node node_modules/nooblyjs-core/scripts/scope-css.js public/css/old.css public/css/app.css --module teammates > public/css/teammates.css
   ```

   - `:root`, `html` and `body` become `[data-module="teammates"]`.
   - `body:not(.x)` becomes a condition on the scope. Teammates rewrote it to `.tm-root:not(.x)`, because role
     classes live on the bridge root.
   - `@media` contents are scoped.
   - `@import` and `@font-face` are dropped: fonts belong to the kit.
   - The `drop` option removes the old shell's rules. Teammates dropped `.sidebar`, `.nav-link`, `.topbar`,
     `.owner-*` and `.budget-mini`.
   - Prefix `@keyframes` names yourself (`tm-spin`), because they're global.
2. **Bridge the tokens.** Keep the old custom-property names, but point them at the kit's
   (`--ink: var(--navy-900)`, `--font-body: var(--font-ui)`, …) in a block after the old values. The app picks up
   NooblyJS's type and colours without touching its rules. Delete an old token that has the same name as a kit
   token (`--border`, `--divider`), because a self-reference is a cycle.
3. **Revert kit class collisions.** The kit's component classes (`.card`, `.btn`, `.stat`, `.meter`, …) are
   global. Where the app uses the same names for its own components, reset them inside the app's pages:
   `[data-module="x"] :where(.tm-root, #x-portal) :is(.card, .btn, …) { all: revert; margin: 0; padding: 0;
   box-sizing: border-box; }`.
   - `:where()` keeps the specificity equal to the app's own rules, which come later and win.
   - The frame's own notices ("Not for your role", the error card) sit outside the root, so they keep the kit's look.
   - A test lists the collisions (`test/public/module.test.js`), so a new one fails the build.
   - **Before the first page moves to kit components**, confine the other direction too: put the app's
     element-level rules (`*`, `h1`, `a`, `button`…) and its rules for the colliding names under
     `:where(.tm-root)`, so they stop at the older pages. Kit-built pages then render in a second root (`.tm-kit`)
     with the kit's own look, and their extra styles use new class names. Dialogs and toasts need a `.tm-root`
     element inside the portal for the same reason.
4. **Fix what axe finds.** The e2e walk scans every nav page. Teammates needed:
   - `role="img"` on a labelled avatar row
   - `tabindex="0" role="region" aria-label` on every scroll box (`.table-wrap`, `.recent-list`, `.memory-list`,
     dialog `.output`, Markdown tables)
   - underlined links inside running text

## 4. Tests that hold the pattern

In the child repo (`node --test`):

- every selector in `public/css` is scoped (`unscopedSelectors` from `nooblyjs-core/src/shell/css-scope.js`)
- the collision list is complete
- every nav row has a route
- no page calls `history.pushState`, listens for `popstate` or touches `<body>`
- page URLs answer with `host.frame`, a missing file answers 404, and there's no CSP of the app's own

In `nooblyjs-ai-host` (`test/<app>.test.js` plus `test/e2e/shell.spec.js`):

- the shell lists the app as `ready` with its `ui`, kit icons and permission-filtered nav
- page URLs return the frame
- the API takes the NooblyJS session and CSRF token, and refuses without the token
- refusals are audited with NooblyJS permission ids
- the status card has the right shape
- the app writes only under `data/<mountPath>/`
- in a browser: the rail item, sidebar active states and axe on every page; navigating from a list to a
  detail page and back without a reload; "Not for your role" for a Viewer; no sideways scroll at 375px

## 5. Turn it on

Set `enabled: true` for the app in `src/seed/data/config/hosted-apps.yaml`. An existing `data/` keeps its own
`data/config/hosted-apps.yaml`: flip it there too. Add the app to `test/e2e/serve.js`.
