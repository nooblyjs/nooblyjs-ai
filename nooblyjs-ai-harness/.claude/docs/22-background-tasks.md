# Phase 22: Background tasks

**Goal:** let the agent start something that keeps running (a dev server, a watcher, a slow build), carry on working, and check back.

---

## The problem

Until now, a Bash call **waits** for its command to finish, up to a 2-minute timeout. That rules out a lot of real work:

| Task | What happened |
|---|---|
| "start the dev server and check the home page" | `npm run dev` never exits: the call hangs, then times out, and the server is killed |
| "run the watcher and fix what it reports" | same |
| a 6-minute build | blocks the whole turn; the model can't look at anything else meanwhile |

The old Bash description even said: *"Servers and watchers never exit: start one only if the user asks."*

## The idea: a task id now, the output later

```
Bash({ command: "npm run dev", run_in_background: true })
  → Started background task 1. …  Output so far: > vite v6.0 starting…

TaskOutput({ task_id: 1, until: "ready|Local:", wait_seconds: 30 })
  → Task 1 is running for 3s.
    VITE ready in 412 ms   ➜  Local: http://localhost:5173/

Bash({ command: "curl -s localhost:5173 | head" })   ← a normal command, while the server runs
TaskStop({ task_id: 1 })
```

| | |
|---|---|
| `Bash` + `run_in_background: true` | starts the command, waits **half a second** (so a typo or a crash shows up right away), returns the task id and the output so far |
| `TaskOutput` | returns only output the model **hasn't seen yet**. `wait_seconds` waits for the task to end; `until` (a regex) stops waiting as soon as a matching line appears. No polling loops |
| `TaskStop` | stops the task and every process it started (its process group, as in Phase 05) |
| `/tasks`, `/tasks stop 2` | the same, for you. The status bar shows `⚙ 2 background` |

## Three design questions

**How does the model find out a task ended?** Polling ("is it done yet?") wastes requests and tokens. Instead, the registry remembers which tasks ended since the model last heard, and noobly **tells** it once:

- if tools are running in the same turn: a `<system-reminder>` on the next tool result
- otherwise: a system reminder with your next message (Phase 07)

> Background task 1 (\`npm run build\`) exited with code 1. It has 37 line(s) of output you haven't read: use TaskOutput with task_id 1.

A task the model stopped itself, or one whose end it already saw, isn't announced again.

**How much output to keep?** A server can print forever. Each task keeps the **newest 1,000,000 characters**; each read returns only what's new (at most the newest 30,000 characters, with a note if more was skipped). The registry tracks absolute positions (`dropped` + `readUpTo`), so "what's new" stays correct even after old output is thrown away.

**When do tasks die?** Never "whenever": always at a defined moment.

| When | How |
|---|---|
| `TaskStop` / `/tasks stop` | SIGTERM to the process group, SIGKILL 2 s later |
| `/clear` | a new conversation shouldn't inherit processes it knows nothing about |
| noobly exits | an `exit` handler kills every running task; sandboxed ones also die with the sandbox (`--die-with-parent`) |

A test checks with `pgrep` that nothing is left running.

## The surprise: sandboxes that can't see each other

Phase 20 started a **new** bubblewrap sandbox for every command, each with its own private network. So this failed:

```
Bash(run_in_background)  node server.js      → listening on 127.0.0.1:4567 … in sandbox A's network
Bash                     curl 127.0.0.1:4567 → connection refused          … sandbox B has its own
```

Trying to join sandbox A's network namespace from outside (`nsenter`) failed on permissions: bubblewrap drops privileges inside, on purpose. The fix was simpler and better:

### One sandbox per session: the executor (`src/sandbox/executor.js`)

Each session now starts **one** long-lived sandbox, and inside it a ~70-line program, the **executor**. noobly sends it commands over a unix socket in the sandbox's private `/tmp`:

```
noobly ──/tmp/executor.sock──► executor (inside bwrap) ──► bash -c "…"
   {"t":"run","script":"…","cwd":"…","env":{…}}
   ◄── {"t":"out","d":"…"}  {"t":"cwd","d":"/work/app"}  {"t":"exit","code":0}
   {"t":"kill","signal":"SIGTERM"}   or just close the connection = SIGKILL
```

- All commands share the sandbox's **network** (still no internet), **`/tmp`** and **process list**, like terminals in one container.
- The proxy **bridge** (Phase 20) runs once, inside the executor.
- Speed was not the reason: bubblewrap is fast either way (measured here: ~10 ms for a new sandbox per command, ~6 ms through the executor).
- To the rest of noobly, a command in the executor looks like a child process (`stdout`, `stderr`, fd 3 for the working folder, `close`, `killGroup()`). `runCommand` and background tasks don't care where it runs.

On macOS (seatbelt) every command still gets its own `sandbox-exec`: seatbelt has no network namespaces, so commands already share `localhost`.

## Try it

```bash
noobly
❯ Start a static file server for this folder in the background, then fetch index.html with curl, then stop the server.
❯ /tasks
```

## Deviations from the plan

- No log **file** per task: the in-memory buffer (1 MB per task) was enough for every case tried, and it dies with the session like the task.
- No `Monitor` that wakes an **idle** session when a line appears; `TaskOutput`'s `until` covers the waiting-while-working case. Waking an idle agent needs a different UI loop (a message that nobody typed), which is worth a phase of its own.

## What we learned

- **Asynchronous work needs notifications, not polling.** One reminder at the right moment saves many "is it done?" requests.
- **Output is a stream, not a result.** Track positions, return only what's new, cap what you keep.
- **Every process needs an owner and an end.** Process groups, `/clear`, exit handlers, and a test that looks for leftovers.
- A security boundary shapes features: the sandbox forced the "one sandbox per session" design, which turned out simpler and faster.
- How Claude Code appears to do it: `run_in_background` on Bash, a tool to read new output and one to stop tasks, and a notification when a background task finishes.
