# Production readiness audit — all of NooblyJS (2026-10-12)

> **Verdict: ready for a supervised pilot on one machine, on loopback, with a small team that is told what is still
> simulated. Not ready for production.** Five things block it: the security findings S-01 to S-05, no way to deploy
> or supervise it (R-02), no CI (R-03), test suites that are not green together and have never run on Linux (R-04), and agents and sign-in that can
> fall back to mocks and passwords in production without saying so (R-07). Behind those: one process with in-memory
> sessions and a 40-second start (R-05), and monitoring that would not notice a hosted app failing (R-06).
>
> Companion: `2026-10-12-security-audit.md`. Earlier: `.claude/audits/mocking-audit.md` (what is still simulated, Phase 15),
> `.claude/audits/phase-13-security-review.md`, `.claude/runbooks/`.

## How it was done

- Code and configuration read across all eight repos (`nooblyjs-ai-host`, `nooblyjs-core`, `nooblyjs-ai-harness`, `nooblyjs-ai-product`,
  `nooblyjs-ai-factory`, `nooblyjs-ai-teammate`, `nooblyjs-ai-knowledge`, `nooblyjs-ai-infrastructure`) and `noobly/apps/`.
- NooblyJS started in **production mode** on a throwaway data folder with every hosted app, outbound network blocked:
  start time, memory, headers, `/healthz`, app states.
- **Every test suite run** on this machine (Windows 11, Node 26.10). Results are in `.temp/test-results/` (`unit.txt`
  and `audit-<repo>.txt`; `-alone` where a suite was run again on its own).
- `npm audit` in every repo; a search for CI, deployment and supervision files.

## Readiness by component

| Component | What it is | Readiness | Main gaps |
| --- | --- | --- | --- |
| **nooblyjs-ai-host** (host) | Composition root, Home, Platform, onboarding, chat, lifecycle engine, Jira/Bitbucket, Metrics, backups, Teams endpoint | **Needs work** | Mounts S-01 open; sessions in memory; `/healthz` blind to apps; mock AI allowed in production; 1 failing test (BUG-001) |
| **nooblyjs-core** | Service registry, UI kit, FsStore, sign-in, filing, AI module | **Not ready** | S-01 (fails open); 3 critical + 9 high dependency findings; password sign-in always on; Express 4 routes force a second Express app inside Teammates; its CI is a GitHub workflow that never runs on Bitbucket |
| **nooblyjs-ai-harness** | Agent runtime and OS sandbox | **Unproven on target** | 51 of 385 tests fail on Windows (symlinks, bash); the sandbox exists only on Linux and macOS; never run on Linux here |
| **nooblyjs-ai-product** | Product Factory | **Needs work** | Drafts are scripted with no model (A1); drafting teammate fixed in code (B3); 154/154 tests pass, but `npm test` never exits (R-04) |
| **nooblyjs-ai-factory** | Software Factory | **Needs work** | 26 failing tests on this machine (25 are a known Windows baseline); no real run has delivered a PR end to end; no container runtime (A3, A8) |
| **nooblyjs-ai-teammate** | Digital Teammates, every agent action's runner | **Nearly** | 2 known Windows file-mode failures; billing rates are sample figures (B8) |
| **nooblyjs-ai-knowledge** | Wiki Platform | **Not ready** | S-02, S-03, S-07; 13 high dependency findings; ignores the host's log level; very large (256k lines, 453 packages) for what NooblyJS uses |
| **nooblyjs-ai-infrastructure** | Environments, provisioning, drift, cost | **Simulated** | Mock provisioner, drift and cost (A4); 46/46 tests pass alone |
| **apps/msteams/noobly-bot** | Teams app package and forwarder | **Waiting on tenant** | Never met a real tenant (A10); Phase 12 awaiting review |
| **apps/edge** | Edge side panel | **Skeleton** | Chat off until Phase 14 (B12) |
| **apps/electron** | Desktop window | **Developer tool** | Fine for that; S-15 |

---

## Blockers

### R-01 — The security findings

S-01 to S-05 in the security audit. S-01 alone (anyone who can reach the port reads `.env`) rules out any network
exposure until it is fixed.

### R-02 — No way to deploy, supervise or roll back

- No Dockerfile, service unit, process-manager file or pipeline in any repo. The hosting target is still open
  (product.md §12 Q3) and the runbook says "your service manager's stop".
- `app.js` exits on any uncaught exception or unhandled rejection (correct), so something must restart it. Nothing is
  defined.
- NooblyJS runs whatever is checked out in eight sibling folders (`file:../<repo>`): there are no versions (most are
  `0.1.0` or `1.0.0`), tags or lock between them, so "the release" cannot be named, reproduced or rolled back. The
  upgrade runbook's step "update the code in every repo" is the whole release process.
- TLS: development uses self-signed certificates (`certs/`); who terminates TLS in production, and `TRUST_PROXY` and
  `PUBLIC_BASE_URL` behind it, are not written down.

**Do:** decide the host (Linux; the Factory's sandbox needs it). Write one deployment definition (container image or
service unit) with restart on failure, a pinned Node LTS (24; nooblyjs-core still says `>=18`, this machine runs 26), the
data volume, and TLS at a proxy. Tag the eight repos together per release and record the set.

### R-03 — No CI

No repo has a pipeline that runs. nooblyjs-core's `.github/workflows/ci.yml` cannot run on Bitbucket. The suites, `npm
audit` and the 15-minute Playwright + axe run (`npm run test:e2e`) only run when someone remembers.

**Do:** Bitbucket Pipelines, on Linux: every repo's `npm test`, `npm audit --omit=dev` (fail on high), and NooblyJS's
e2e on merge to `main`. Add the route-guard probe from security S-01.5.

### R-04 — The suites are not green together, and none has run on Linux

Run on 2026-10-12 (Windows; results in `.temp/test-results/`):

| Suite | Result | Why |
| --- | --- | --- |
| nooblyjs-ai-host `npm test` | 1 failure | **BUG-001**: the seed's merged PR has a fixed date, so "Merged this week" is 0 from Monday 2026-10-12 |
| nooblyjs-core (jest) | 3 failures of 2,308 | An Ollama provider test, a POSIX-only path test, a log-folder test: environment |
| nooblyjs-ai-harness | 51 failures of 385 | Windows: symlinks need privileges, Bash-specific tests. Never run on Linux, its target |
| nooblyjs-ai-factory | 26 failures of 370 | 25 are a known Windows baseline (measured 2026-10-10); the 26th not isolated |
| nooblyjs-ai-teammate | 2 failures of 118 | Known Windows file-mode tests |
| nooblyjs-ai-knowledge | 34/34 alone | **5 failures when run beside the other suites** |
| nooblyjs-ai-infrastructure | 46/46 alone | **5 cancelled (20 s timeouts) when run beside the others** |
| nooblyjs-ai-product | 154/154, but `npm test` **never exits** | `test/routes/board.test.js` leaves a handle open and the script has no `--test-force-exit`; run with it, all pass in 42 s |

So: a known baseline of failures is being carried, two suites share state (they pass alone, fail together), and the
harness and Factory, which run untrusted code, have never been tested on the OS they will run on.

**Do:** fix BUG-001; mark Windows-only failures as skipped on Windows with a reason, so the baseline is zero; isolate
the suites (temporary folders and ports per test file); run all of it on Linux in CI (R-03).

### R-07 — Production can quietly run on mocks and passwords

- `AI_PROVIDER` defaults to `mock`, and `src/config.js` refuses only `anthropic` in production. A production start
  without model settings plays scripted answers to real people (mocking audit A1).
- `AUTH_METHOD=azure` with a missing client or tenant id falls back to local password sign-in with a warning, in
  production too.
- The rest of `.claude/audits/mocking-audit.md` (A1–A11, B1–B12) is open: no container runtime, no provisioner, unresolved secret
  references, sample budgets and standards. That is Phase 15's scope and is right to be a phase; the two above should
  simply refuse to start.

**Do:** in production, refuse `AI_PROVIDER=mock` (or unset) and an incomplete Entra configuration, as `NOOBLY_DEV_LOGIN`
already is.

---

## Major

### R-05 — One process, one disk, sessions in memory

- **Sessions** use express-session's default `MemoryStore` (`app.js:152`, no `store`). Every restart signs everyone out,
  memory grows with sessions, and a second instance is impossible. (Teammates already keeps its own sessions in a file:
  its test "a restart does not sign people out" exists for exactly this.) **Do:** a file-backed session store under
  `DATA_DIR`, matching the files-only rule.
- **Start time**: about 40 seconds in production mode with the small seed (6 s loading, 34 s mounting; most of it the
  wiki importing and indexing). A restart is a 40-second outage that grows with the wiki. **Do:** measure it on a year
  of data; index in the background and report "starting" until done (R-06).
- **Memory**: 205 MB resident after start with the seed. The wiki's own `dev` script asks for an 8 GB heap
  (`--max-old-space-size=8192`), a hint of what it needs on real content `[CONFIRM on real data]`.
- **Scale**: one process, files on one disk, the wiki's search index and the caches in memory. That is the design
  (tech.md) and fine for a pilot; it means no high availability and a ceiling on concurrent use that has not been
  measured. Phase 13's `npm run perf` (14 pages under 141 ms at 10× the seed, which is 3.2 MB) shows headroom on
  volume, not on concurrent users. **Do:** a concurrency test (e.g. 50 people for 10 minutes) before the pilot grows.

### R-06 — Monitoring would not notice much

- `/healthz` answers `{"status":"ok"}` whatever the hosted apps' state; a wiki that failed to mount still reports ok.
  There is no readiness endpoint. **Do:** `/healthz/ready` that lists each app's state and fails while starting or when
  a required app is Unavailable.
- No metrics endpoint, error tracking or alerting. Logs are JSON to stdout in production plus a rotating file in
  `data/logs`; nobody is named to read them. **Do:** ship stdout to the company's log platform `[CONFIRM which]`, and alert
  on: process restarts, `audit write failed`, `backup failed`, `budget.reached`, sign-in failures, 5xx rate.
- The hosted wiki ignores `LOG_LEVEL`: started with `LOG_LEVEL=error`, it logged every document written and indexed
  at INFO. **Do:** pass `host.logLevel` to its logger.

### R-08 — Backups: tested restore, but on the same machine and without alerts

Good: nightly, verified by hash, restore proven into an empty folder (Phase 13), the initial admin password left out.
Gaps: only when `BACKUP_DIR` is set; nothing says it must be off the NooblyJS machine; not encrypted (security S-10); a
failed backup is a log line only; RPO is up to 24 hours and RTO is unmeasured (restore + 40 s start). **Do:** set
`BACKUP_DIR` to storage off the machine, alert on failure and on "no backup in 26 hours", time a full restore.

### R-09 — Dependencies and platform drift

- Dependency findings: security S-04 (nooblyjs-core 523 packages, the wiki 453; NooblyJS's own 111).
- nooblyjs-core registers Express 4 route patterns that Express 5 rejects, so Teammates runs core's routes on a second,
  core-owned Express app (CLAUDE.md "Known pitfall"). Two Express apps in one process is the kind of thing that breaks
  on an upgrade.
- Node: nooblyjs-ai-host says `>=22.12`, nooblyjs-core `>=18`; this machine runs 26.10. **Do:** one supported LTS everywhere, pinned in
  `engines` and the deployment.

### R-10 — Data that only grows

Events, audit and chat are append-only daily YAML streams with no retention; metrics roll-ups and the Factory's log grow
the same way. Nothing watches disk space. POPIA expects a retention period for personal data `[CONFIRM]`. **Do:** a
retention rule per stream (archive, then delete), and a disk-space alert.

---

## Minor

- **R-11 Time-dependent seed and tests.** BUG-001 is one case of a fixed date in the time-shifted seed; check the rest of
  `src/lifecycle/seed/` for absolute dates.
- **R-12 Body size.** 10 MB on every route (security S-14).
- **R-13 Runbooks.** Six good ones. Missing: who is on call, an incident runbook (an S-01-like exposure: what to rotate,
  in what order), and the release runbook R-02 needs.
- **R-14 The Teams tab template** (`apps/msteams/noobly-app`, React + Vite) is outside the stack rules; it is not built into
  NooblyJS. Delete it or say in `structure.md` that it is not shipped.
- **R-15 Accessibility** is checked by axe in the e2e run (good); it only runs by hand (R-03).

## What is in good shape

- **Governance is enforced on the server**: agents capped at Contributor, never approve or merge; permissions only from
  the access role; every write and every refusal audited; the write gate for Jira and Bitbucket. All five hosted apps
  and NooblyJS refused a Viewer's writes, apart from the wiki (security S-02).
- **Files-only storage done carefully**: atomic writes (temporary file, then rename), per-path locks, path checks; a
  stop never leaves half a file.
- **Configuration refuses unsafe combinations**: no development sign-in, unsigned Teams activities, weak session secret
  or direct model API in production.
- **Graceful shutdown**: SIGTERM/SIGINT close the hosted apps and core services, with a 10-second limit.
- **Backups and restore** are real and verified (R-08 is about where they go).
- **Runbooks, ADRs, phase summaries and steering docs** are current and specific.
- **Business time** comes from one clock (`src/services/clock.js`), so reminders and targets can be tested.

## Order of work

1. Security S-01, then S-02/S-03 (the security audit's order).
2. R-07 (two refusals in `src/config.js`), BUG-001.
3. R-03 CI on Linux, with R-04's suites made green there.
4. R-02 deployment, versions and TLS; R-05 file-backed sessions.
5. R-06 readiness and alerts; R-08 off-machine backups.
6. Phase 15 (the mocks), then R-09 and R-10.

Each of these can be logged in `.claude/specs/bugs-and-changes/` (the smaller ones) or become part of a roadmap phase
(R-02, R-03, R-05, R-06 are a "production hosting" phase between 13 and 15).
