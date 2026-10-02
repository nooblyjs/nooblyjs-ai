# Phase F23: Containers and remote workers

**Goal:** the same step, far away. Agent steps run on other machines, which pull work under leases; the repo's own commands run in containers.

```bash
# the control plane
FACTORY_WORKER_ENROLL_TOKEN=… factory serve --workers            # worker API on :8790

# any machine that can reach it (with git, node, this package, and its OWN model key)
factory worker --server http://factory-host:8790 --enroll … --name box-2
factory worker list | revoke <workerId>                           # on the control plane

# the repo's setup and gates in containers (when there's no bubblewrap)
FACTORY_CONTAINER_IMAGE=node:24-slim factory run …                # or "isolation": { "image": … } in config.json
```

---

## Part 1: remote workers

### What moves, and what stays

The line (triage → … → deliver) stays in the **control plane**. Only **agent steps** move to workers, and only the two stations where agents spend most: **build** and **repair**.

Why not whole runs? The store's API is **synchronous and local** (`store.get` returns a row, not a promise; SQLite on this disk), and every station reads and writes it. Moving whole runs would mean a remote store protocol for everything. Moving steps needs only one small protocol, and the step is where the time and money go anyway.

```
control plane (factory serve --workers)                      worker (factory worker)
───────────────────────────────────────                      ──────────────────────
station → stepRunnerFor(ctx) → remoteRunStep
  1. resolve the base in OUR mirror, resolve the prompt       (it can't read our mirror)
  2. bundle the base commits ──── dispatcher queue ◄── POST /worker/lease
                                                    ──► job: prompt, model, provider id, base bundle
                                                         3. clone the bundle; runStep() HERE
                                  events ◄── POST /worker/events     (its workspace, sandbox, key)
                               heartbeat ◄── POST /worker/heartbeat ─► ok | stop
  4. import the result bundle ◄── complete ◄── POST /worker/complete: result + bundle base..result
  5. return runStep()'s shape: the station can't tell the difference
```

`stepRunnerFor(ctx)` is the only change stations see: with workers attached it's `remoteRunStep`, otherwise `runStep`.

### Commits travel as git bundles

The base may be commits **only the control plane has** (a spec branch from F08, an earlier fan-out wave from F10), and the result has to come back as **real commits**. A git bundle is commits in a file: exact, and verified by git on import (every object is checked). It needs no shared disk and no git server. The control plane also checks that the bundle's tip is the sha the worker claims.

**The worker never pushes anywhere.** The control plane imports the bundle into its own mirror and stays the only thing that pushes (F03).

### Leases, again

It's F06's idea at a new scale (`src/remote/dispatcher.js`):
- A worker **holds a step only while it heartbeats**. Streamed agent events count as signs of life too.
- Silent for `leaseMs` → the step goes **back to the queue** for another worker (up to `maxAttempts`), then fails.
- The old worker's next heartbeat hears **"lease lost"** and **aborts its agent**. It doesn't finish a step someone else now owns, and its late result is ignored.
- A cancelled run reaches the worker the same way (`stop: 'cancelled'`).

The queue is **in memory, on purpose**. The *run* is already durable (leased and event-sourced by the scheduler). If the control plane restarts, the scheduler requeues the run, and its step is dispatched again. A second durable queue would be a second truth to keep in step.

### Tokens: enroll once, then your own

Per-worker tokens (listed under F24 in the roadmap) are needed as soon as there are workers:
- An **enrollment token** (`FACTORY_WORKER_ENROLL_TOKEN`) can do exactly one thing: **register** a worker.
- Registering returns that worker's **own token**. The log keeps only its **hash** (`worker.registered`), so the event log never holds a credential.
- `factory worker revoke <id>` (`worker.revoked`) cuts off **one** machine; the others keep working.
- A worker token can't register more workers.

**The model key never travels.** A job names a provider; the worker uses the key in *its* environment. Scripted providers (`--script`) travel as their replies, which are data, so the demos and tests work remotely too.

### What doesn't go remote (yet)

- **Spec**: its check → fix loop runs callbacks against the workspace.
- **Triage and review**: cheap; they could go remote later.
- **Factory MCP tools (F16)**: they talk to the control plane's store. A remote step runs without them; they'd need the worker API to proxy them.
- **Transcripts**: they stay on the worker (no `harnessHome` comes back).

## Part 2: containers (`src/exec/container.js`)

The harness sandbox (bubblewrap) is one way to contain a repo's own code, and it isn't installed here. Containers are the other, and what most factories use. With an image configured, `runCommand` (the one place setup and gates run, F02/F04) uses:

```
docker run --rm --network none --user <you> --read-only --tmpfs /tmp
           --memory 2g --pids-limit 512 --cap-drop ALL --security-opt no-new-privileges
           -v <workspace>:<workspace> -w <workspace> node:24-slim sh -c "<command>"
```

- **Same path inside and out**, so error messages and file paths match the workspace.
- **Your uid**, so files it writes are yours, not root's.
- **Read-only** except the workspace and a private `/tmp`.
- **Limits**, so a fork bomb or a leak stops at the container.
- **No network**; the repo's config can ask for network (all or nothing today).
- On a timeout, `docker kill` the container: killing the CLI alone would leave it running.

A test runs a real container (when Docker and the image are there): it can write the workspace, **as you**, and **can't reach the network**.

**Not for the agent.** An image counts as isolation for the *repo's commands* (`commandIsolation()`), never for the *agent's* Bash. That's still `sandboxStatus()`, because the agent's commands run through the harness, which doesn't use the container. I first wired the container into `sandboxStatus()`, which would have let an agent with Bash allow rules run **unsandboxed** while the factory believed it was contained. Running `noobly` itself inside the container needs the harness's container backend (**H37**), and "some network" should mean an allowlist egress proxy. Both are next.

## Tests

- **Dispatcher** (fake clock): one holder per step; heartbeats; a quiet worker loses the step, is told "lease lost", and its late result is ignored; cancel reaches the worker; failures requeue, then fail; no finisher → the run's step fails with a clear reason.
- **Tokens**: enroll only registers; each worker has its own token; only hashes are in the log; revoke one, the others work.
- **End to end over HTTP**: the control plane runs the line, a worker builds, its commits come back as a bundle, the control plane pushes, and the agent's events are in the control plane's log.
- **Lease loss mid-step**: a slow worker's **network goes down** (its agent keeps running). After the lease, a fast worker takes the step and finishes it. When the network returns, the slow worker hears "lease lost" and **stops its agent**, not 60 s later. The run is delivered.
- **Containers**: the arguments, and a real run.

The first version of the lease-loss test failed because the premise was wrong. It used a slow worker with slow heartbeats, but its agent was *streaming events*, which count as signs of life, so its lease never ran out. The honest scenario is a **network partition**: the worker is still running but can't report.

## Checkpoint: a second machine processes steps from the same queue

`factory serve --workers`, plus **two separate `factory worker` processes**, each with its own `FACTORY_HOME` (they share nothing but the URL). Three items:

```
box-1: Registered as worker-…   step-3838e881: issue-1 (attempt 1)
box-2: Registered as worker-…   step-02fdfe7c: issue-1 (attempt 1)
                                step-b55c1c24: issue-1 (attempt 1)
delivered: 3
```

The steps were shared between the two processes over HTTP, and all three runs were delivered. A true second *machine* only needs the URL to be reachable (`FACTORY_WORKERS_HOST=0.0.0.0`, behind TLS or an SSH tunnel: the protocol is plain HTTP with bearer tokens).

## What was built

| File | What it does |
|---|---|
| `src/remote/dispatcher.js` | the step queue: leases, heartbeats, expiry, stop |
| `src/remote/remote-step.js` | `remoteRunStep`: runStep's shape, run far away (bundles both ways) |
| `src/remote/worker.js` | `createWorker`: lease → clone → runStep → stream → bundle → complete |
| `src/server/workers-api.js` | the worker API; enrollment and per-worker tokens; revoke |
| `src/server/http.js` | `authorize` (who is this token?) alongside the single dashboard token |
| `src/exec/container.js` | `containerArgs`, `runInContainer`, `containerRuntime` |
| `src/exec/sandbox.js` | a container fallback for the repo's commands; `commandIsolation()` |
| `src/commands/worker.js` | `factory worker`, `list`, `revoke` |
| `src/commands/queue.js` | `serve --workers` |

## What we learned

- **Move the expensive, self-contained part.** Agent steps travel well; the line, with its synchronous store, stays home.
- **Commits travel as bundles**: exact, verified, and the control plane stays the only pusher.
- **Leases make machines disposable**: a worker can hang, crash or lose its network, and the step moves on.
- **Signs of life aren't only heartbeats.** Streaming events count, which is exactly why a *partition* is the real failure to test.
- **Credentials: enroll once, then per-machine tokens, stored as hashes, revocable one by one.** The model key never crosses the wire.
- **Be precise about what's contained.** A container for the repo's commands isn't a sandbox for the agent; getting that wrong would silently weaken isolation.
- How the commercial factories appear to do it: GitHub Actions self-hosted runners (register with a token, long-poll for jobs, stream logs), Buildkite agents, Devin's and Codex's per-task cloud VMs or containers, Kubernetes-based sandboxes (E2B, Modal, Daytona). Pull-based workers with leases are the common pattern, because workers behind firewalls can reach out but can't be reached.
