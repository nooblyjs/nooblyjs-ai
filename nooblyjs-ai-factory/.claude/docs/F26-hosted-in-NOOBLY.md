# Phase F26: Hosted in NooblyJS

**Goal:** open the factory's dashboard inside NooblyJS at `/factory`, signed in as yourself, with no server or token of the factory's own.

---

## The idea

Until now the dashboard was its own little website: `factory dashboard` started a `node:http` server on 127.0.0.1 and printed a link with a token in it. NooblyJS works the other way round. It is **one process that hosts many apps**. Each app exports a `register()` function, NooblyJS calls it with its own Express app, and the app attaches itself under one path. NooblyJS owns everything around the content: the page, the rail, the sidebar, sign-in, permissions, the audit log.

```
NooblyJS (one Node process)
 ├─ its frame page ── rail · sidebar · [ content area ] · chat
 │                                        ▲
 │                                        │ imports /factory/js/module.js
 └─ register(app, serverManager, { mountPath: '/factory', dataDir, host })
        ├─ /factory/api/v1/…   the SAME route table as `factory dashboard`
        ├─ /factory/js, /css   the UI module and its stylesheet
        └─ /factory/<page>     → host.frame (NooblyJS's page; our module draws inside it)
```

So hosting changes the edges and nothing in the middle. The event log is still the only source of truth, and the API handlers are the ones from F17, untouched.

## What was built

| File | What it does |
|---|---|
| `src/services/hosted.js` | `register()`: checks what the host passed, opens the log in `dataDir`, mounts one router, returns the app's description (`nav`, `status()`, `services`, `close()`). Also the `PERMISSIONS` table and the bridge from the log to the host's events |
| `src/services/to-express.js` | `toExpressRouter(routes)`: turns the `[method, pattern, handler]` table into routes on the host's Express, with NooblyJS's error shape |
| `index.js` | exports `register`, `NAV`, `PERMISSIONS` next to the library's exports |
| `public/js/module.js` | the route table the NooblyJS frame matches (`/line`, `/runs`, `/runs/:id`, `/inbox`, `/campaigns`, `/metrics`) |
| `public/js/lib.js` | `h()` (safe DOM), formatting, and `page()`: a view → the frame's `render(view, { params, ctx })`, kept fresh while open |
| `public/js/parts.js` | icons, role avatars, pills, the command dialog, the inbox card |
| `public/js/pages/*.js` | one page each, ported from `public/dashboard/app.js` |
| `public/css/factory.css` | the dashboard's CSS, every selector under `[data-module="factory"] .fx-root`, its tokens pointed at NooblyJS's |
| `test/register.test.js`, `test/module.test.js`, `test/fixtures/host.js` | the hosted-app contract, on a stand-in host |
| `../nooblyjs-ai-host`: `package.json`, `src/seed/data/config/hosted-apps.yaml`, `test/factory.test.js` | NooblyJS depends on the factory, enables it, and tests it through the real host |

## Details that mattered

- **Permissions are the host's, and every write must name one.** Reads need `read`. `PERMISSIONS` maps each POST to a row of NooblyJS's matrix: run actions need `draft`, the inbox and the kill switch need `approve`. A POST that isn't in the table makes `register()` throw, so a new write can't ship ungated. Agents are capped at Contributor, so they can never answer the inbox: there's a test that proves the refusal.
- **Who answered.** The inbox used to record `<USER> (dashboard)`. Handlers now get a `principal`, and hosted answers are recorded as `Lerato M. (NooblyJS)`.
- **No stream of our own.** `/api/events` (the F17 SSE feed) is not mounted. Instead `register()` polls the log, like the SSE feed did, and passes a few events on to `host.events` (`run.started`, `run.finished`, `run.asked`), which NooblyJS shows in Activity and streams to the browser. Pages listen for those through `ctx.sse`, and also ask `status` for the log's `seq` every 4 seconds while visible, because work done by another process (`factory serve`) changes the log without the host hearing about every step.
- **One page, shared.** The old CSS had `*`, `body` and `button` rules. Scoped under the app's root element they can't touch NooblyJS's frame. NooblyJS's kit also has classes called `.card`, `.btn`, `.pill`… so those are reverted inside our root first; `test/module.test.js` fails if a new collision appears.
- **A regex that dropped too much.** The one-off scoping pass dropped unused classes by pattern, and `table\b` also matched `.table-wrap`. Nothing looked wrong until a browser at phone width showed the page scrolling sideways. The check that found the cause compares every old selector with the new file.
- **`public/dashboard/` stays** for `factory dashboard`. Hosted, only `public/js` and `public/css` are served.

## Not done yet

The rest of NooblyJS's Phase 7 (`.claude/steering/tech.md` §9): the log is still SQLite (in `data/factory/factory.db`), not daily YAML streams; the scheduler doesn't run inside NooblyJS; handoffs don't create runs; the merge station isn't refused when hosted; there is no standalone `server.js`; the pages keep their own look instead of the kit's components, and still use the browser's `alert` and `confirm`.

## Try it

```bash
cd ../nooblyjs-ai-host && npm install && npm start          # then open /factory
# give it something to show: point the CLI at the folder NooblyJS gave the factory
export FACTORY_HOME=$PWD/data/factory
node ../nooblyjs-ai-factory/bin/factory.js submit ../nooblyjs-ai-factory/examples/issues/add-subtract.md --repo /tmp/calc
node ../nooblyjs-ai-factory/bin/factory.js serve    # works the queue; the pages follow along
```

## What we learned

- A route table that is plain data (`[method, pattern, handler]`) can be served by two different routers. The adapter is 40 lines.
- "Where does it listen, who is calling, what may they do" are the host's questions. An app that keeps them at its edges can be hosted without changing what it does.
