# Phase F17: The dashboard

**Goal:** a factory you can't see is one you can't trust. Show its live state in a browser, straight from the event log, with no framework.

```bash
factory dashboard                 # on its own…
factory serve --dashboard         # …or next to the scheduler, in one process
# Dashboard: http://127.0.0.1:11203/#token=…     ← open this link
```

---

## What you see

| Page | Shows | You can |
|---|---|---|
| **The line** (`#/`) | A column per station of the default line (triage … merge), each running run as a card in the column of the station it's at. Then *queued* (with the reason each is waiting: "daily budget…", "next tick"), *waiting for a person*, and *done (recent)* | open a run |
| **Runs** | Every run: status, station, cost, age | |
| **A run** | Its stations as chips (✓ ⏳ ✗, tries, cost), its story (the `factory logs` lines), the agent's output, live, checks, review findings, the evidence bundle, artifacts | pause, resume, cancel, **retry from** a station |
| **Inbox** | Approvals, questions, policy gaps, scope requests, with the agent's options as buttons | approve, reject (with feedback), answer |
| **Metrics** | F20 | |
| Header | 🟢/🛑, running/queued, **spend today** of the budget, inbox count, a live dot | stop all / resume all |

## How it's built

```
browser ──GET /api/…  (Bearer token)──▶ api.js ──▶ projections (runs, inbox, system) ─┐
   ▲                                                                                  ├─ the event log (SQLite)
   └──── EventSource /api/events ◀── sse.js ◀── store.read({ after: seq }) ───────────┘
```

| File | What it does |
|---|---|
| `src/server/http.js` | A router (`/api/runs/:id`), JSON in and out, the token check, static files |
| `src/server/sse.js` | Server-sent events from the log, by `seq` |
| `src/server/api.js` | The endpoints, built from the **same functions the CLI uses** (`pickRuns`, `openEntries`, `cancelRun`, `describe`…), so page and terminal can't disagree |
| `src/server/dashboard/` | `index.html`, `style.css`, `app.js`: one page, plain modules, hash routes |
| `src/commands/dashboard.js` | `factory dashboard`, the token, `startDashboard()` (also used by `serve --dashboard`) |

### Live: SSE from the log

```
GET /api/events            (the browser reconnects with Last-Event-ID: 121)

id: 122
event: factory
data: {"seq":122,"type":"step.started","runId":"run-…","line":"┌ build"}
```

Each message's `id` is the event's **seq**. When the connection drops (a laptop sleeps, a proxy times out), the browser reconnects **by itself** and sends `Last-Event-ID`, and the server continues from exactly there: nothing lost, nothing twice. That's F05's event log paying off again: **the log *is* the feed**. There's no separate message bus to keep in step with it.

The server **polls** the log (`seq > ?` every 500 ms, an indexed query) instead of listening to in-process notifications. `factory serve`, `factory submit`, an inbox answer from another terminal and a GitHub webhook all append to the same SQLite file from different processes, and only the file sees them all.

The page doesn't patch itself event by event: any event → re-fetch the current view, debounced to 300 ms. It's simple and always right; at this scale nobody can tell the difference. (It won't redraw while you're typing an answer.)

SSE, not WebSockets: the data flows one way (server → browser), actions are ordinary POSTs, and SSE is plain HTTP with reconnection built in.

### Security

The dashboard can press **Stop all** and approve work, so:

1. **It listens on `127.0.0.1`** only. For another machine, use an SSH tunnel.
2. **Every `/api/` route needs the token**, compared in constant time. It's made once and kept in `~/.factory/dashboard-token` (0600), or set with `FACTORY_DASHBOARD_TOKEN`.
3. **The token travels in the URL *fragment*** (`#token=…`). Browsers never send fragments to servers or in `Referer` headers. The page moves it to `sessionStorage` and removes it from the address bar.
4. **`EventSource` can't send headers**, so `GET /api/events?token=` is allowed. **A POST must use the header**: a token in a query string ends up in logs and history, and those shouldn't be able to *act*.
5. **Untrusted text goes in as text.** Agent output, issue bodies and review findings are written with `textContent` (the page's `h()` helper), never `innerHTML`. Otherwise an issue containing `<img onerror=…>` would run script in a page that has a Stop-all button. A Content-Security-Policy (`default-src 'self'`) blocks inline scripts as a second line of defence.
6. The page itself (HTML, JS, CSS) needs no token: it holds no data. Static paths can't escape the folder (`/../package.json` → 404).

### Retry from the browser

`factory run retry` runs the retry *in the terminal's own process*. The dashboard can't do that, since it isn't a worker. So **Retry from** appends `run.rewound` (those stations start over) and `run.requeued`, and `factory serve` picks it up like any queued run. The dashboard **records intent**; workers do the work.

## Tests

- **Auth**: page public; API 401 without or with a wrong token; `?token=` fine for GET, refused for POST; the token file is 0600; no path traversal.
- **API**: after a real run, status (the line's stations, a queued run and why it waits), runs, and one run: steps (spec *pending* for a small item), story, agent output, evidence, no terminal colour codes; 404 for an unknown run; stop-all and resume-all.
- **Acting**: an agent asks (`ask_human`) → the question is in `/api/inbox` → an empty answer is refused → answered → the run is **queued** again. Retrying a parked run is refused; retrying a finished one from `review` resets review onward and keeps build; cancel.
- **SSE**: connected before new events → they arrive live, with their seqs; reconnect with `Last-Event-ID: n` → only what came after `n`; `?after=0` → from the start.

## The checkpoint

*Run 5 items and watch them move across stations; answer an agent's question from the browser.*

There's no browser in my environment, so I watched `/api/status`, the same JSON the line view draws, once a second, and answered through `POST /api/inbox/:id`, which is what the inbox form sends. Four slow subtract items and one new example, `divide-asks.json`, where the builder asks *"What should divide(x, 0) do?"* before writing anything:

```
t+1s  queued:2  build[72c4,b1e2,c790]   parked:0  done:0  inbox:0     ← 3 at a time (maxConcurrent)
t+5s  queued:0  triage[9196,16c7]       parked:0  done:3  inbox:0
t+7s  queued:0  build[16c7]             parked:1  done:3  inbox:1     ← the divide builder asked
>> answering ask-…: throw a RangeError
t+8s  queued:0  build[9196,16c7]        parked:0  done:3  inbox:0     ← straight back to build, with the answer
t+10s queued:0                          parked:0  done:5  inbox:0
```

The divide PR's Decisions section: *"divide(x, 0) throws a RangeError: a person chose it over returning Infinity when asked."* To see it yourself, open the printed link while this runs:

```bash
export FACTORY_HOME=/tmp/f17; for i in 1 2 3 4 5; do examples/make-demo-repo.sh /tmp/f17/calc$i; done
for i in 1 2 3 4; do node bin/factory.js submit examples/issues/add-subtract.md --repo /tmp/f17/calc$i --script examples/scripts/subtract-slow.json --autonomy L2 --allow-unsandboxed; done
node bin/factory.js submit examples/issues/add-divide.md --repo /tmp/f17/calc5 --script examples/scripts/divide-asks.json --autonomy L2 --allow-unsandboxed
node bin/factory.js serve --dashboard
```

What watching taught me: with scripted agents, **almost all the time is in build**; verify, review and deliver pass between two polls. That's a question F20's metrics will answer properly: which station is slowest and most expensive with real models?

## What we learned

- **The event log is the feed.** Resumable live updates came almost free, because every event already had a sequence number.
- **Poll the shared truth**, not in-process notifications, when many processes write.
- **One set of functions, two faces.** The API calls what the CLI calls, so they can't drift.
- **A dashboard with buttons is an attack surface**: localhost, a token, the fragment, header-only POSTs, `textContent`, CSP.
- **The UI records intent; workers act.** Retry, cancel and answer are all events; `factory serve` does the rest.
- How the commercial factories appear to do it: Devin's session view (live shell/editor/browser plus chat), Codex's and Jules's task lists with per-task logs and diffs, GitHub Actions' live log streaming. All show a live per-task log beside the state of a queue. Most use a hosted web app with SSO; this is the same shape, local.
